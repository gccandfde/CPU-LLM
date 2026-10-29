"""Hardware profiling: CPU topology, ISA features, caches, NUMA and memory bandwidth.

The profile is used for two things:
  1. choosing which transforms are worth trying (e.g. bf16 only pays off with
     AVX512_BF16 / AMX, int8 with VNNI), and
  2. fingerprinting the machine a recipe was tuned on, so a reproduction on
     another machine can be compared like-for-like.
"""
from __future__ import annotations

import glob
import hashlib
import os
import platform
import time
from functools import lru_cache

import psutil

# ISA features that matter for LLM inference kernels on x86.
INTERESTING_FLAGS = [
    "avx2", "fma",
    "avx512f", "avx512bw", "avx512vl",
    "avx512_vnni", "avx512_bf16", "avx_vnni",
    "amx_tile", "amx_bf16", "amx_int8",
]


def _read(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def _cpuinfo() -> dict:
    info: dict = {"vendor": None, "model_name": platform.processor() or None, "flags": set()}
    text = _read("/proc/cpuinfo")
    if not text:
        return _cpuinfo_portable(info)
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key == "vendor_id" and not info["vendor"]:
            info["vendor"] = value
        elif key == "model name" and value:
            info["model_name"] = value
        elif key == "flags" and not info["flags"]:
            info["flags"] = set(value.split())
    return info


def _cpuinfo_portable(info: dict) -> dict:
    """Windows/macOS: no /proc, so read CPUID through py-cpuinfo (optional)."""
    try:
        import cpuinfo
    except ImportError:
        return info
    raw = cpuinfo.get_cpu_info()
    info["vendor"] = raw.get("vendor_id_raw") or info["vendor"]
    info["model_name"] = raw.get("brand_raw") or info["model_name"]
    # py-cpuinfo spells some flags without underscores (avx512vnni); map them
    # onto the /proc/cpuinfo names the rest of the code uses. It does not decode
    # CPUID leaf 7.1, so avx512_bf16 / AMX read as absent here.
    have = {f.replace("_", "") for f in raw.get("flags", [])}
    info["flags"] = {f for f in INTERESTING_FLAGS if f.replace("_", "") in have}
    return info


def _caches() -> list[dict]:
    caches = []
    for d in sorted(glob.glob("/sys/devices/system/cpu/cpu0/cache/index*")):
        level, ctype, size = _read(f"{d}/level"), _read(f"{d}/type"), _read(f"{d}/size")
        if level and size:
            caches.append({"level": int(level), "type": ctype, "size": size,
                           "shared_cpu_list": _read(f"{d}/shared_cpu_list")})
    return caches


def _numa_nodes() -> list[dict]:
    nodes = []
    for d in sorted(glob.glob("/sys/devices/system/node/node[0-9]*")):
        nodes.append({"node": os.path.basename(d), "cpulist": _read(f"{d}/cpulist")})
    return nodes


@lru_cache(maxsize=1)
def measure_memory_bandwidth_gbs(size_mb: int = 256, repeats: int = 5) -> float:
    """Sustained memory bandwidth (GB/s): the better of a multi-threaded
    streaming read (torch.sum, what decode does to the weights) and a
    copy (reads and writes every byte, traffic = 2 * size).

    Decode speed is bounded by how fast the weights can be streamed, so the
    read figure is the one that matters; the copy is kept as a cross-check.
    """
    return measure_memory_bandwidth()["gbs"]


@lru_cache(maxsize=1)
def measure_memory_bandwidth(size_mb: int = 256, repeats: int = 5) -> dict:
    import torch

    n = size_mb * 1024 * 1024 // 4
    src = torch.ones(n, dtype=torch.float32)
    dst = torch.empty_like(src)
    dst.copy_(src)  # warm-up / page-in
    src.sum()

    def best_of(fn, traffic_bytes):
        best = float("inf")
        for _ in range(repeats):
            t0 = time.perf_counter()
            fn()
            best = min(best, time.perf_counter() - t0)
        return traffic_bytes / best / 1e9

    read = best_of(lambda: src.sum(), n * 4)
    copy = best_of(lambda: dst.copy_(src), 2 * n * 4)
    return {"gbs": round(max(read, copy), 2), "read_gbs": round(read, 2), "copy_gbs": round(copy, 2),
            "threads": torch.get_num_threads(), "size_mb": size_mb}


@lru_cache(maxsize=1)
def profile(measure_bandwidth: bool = True) -> dict:
    cpu = _cpuinfo()
    mem = psutil.virtual_memory()
    flags = cpu["flags"]
    prof = {
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "vendor": cpu["vendor"],
        "model_name": cpu["model_name"],
        "physical_cores": psutil.cpu_count(logical=False),
        "logical_cores": psutil.cpu_count(logical=True),
        "isa": {f: (f in flags) for f in INTERESTING_FLAGS},
        "caches": _caches(),
        "numa_nodes": _numa_nodes(),
        "memory_total_gb": round(mem.total / 1e9, 2),
    }
    try:
        import torch

        prof["torch"] = {
            "version": torch.__version__,
            "mkldnn": torch.backends.mkldnn.is_available(),
            "default_threads": torch.get_num_threads(),
            "cpu_capability": torch.backends.cpu.get_cpu_capability(),
        }
    except Exception:  # torch missing or very old
        prof["torch"] = None
    if measure_bandwidth:
        prof["memory_bandwidth_gbs"] = measure_memory_bandwidth_gbs()
    prof["gpus"] = gpus(measure_bandwidth)
    from . import energy

    prof["energy_counters"] = energy.available()
    prof["fingerprint"] = fingerprint(prof)
    return prof


def gpus(measure_bandwidth: bool = True) -> list[dict]:
    """CUDA or ROCm GPUs visible to PyTorch (ROCm builds use the cuda API)."""
    try:
        import torch

        if not torch.cuda.is_available():
            return []
        out = []
        for i in range(torch.cuda.device_count()):
            p = torch.cuda.get_device_properties(i)
            g = {"index": i, "name": p.name, "memory_gb": round(p.total_memory / 1e9, 2),
                 "compute_units": p.multi_processor_count,
                 "runtime": f"ROCm {torch.version.hip}" if torch.version.hip else f"CUDA {torch.version.cuda}"}
            if measure_bandwidth:
                g["memory_bandwidth_gbs"] = _gpu_bandwidth_gbs(i)
            out.append(g)
        return out
    except Exception:
        return []


def _gpu_bandwidth_gbs(index: int, size_mb: int = 512, repeats: int = 10) -> float:
    import torch

    dev = torch.device("cuda", index)
    src = torch.ones(size_mb * 1024 * 1024 // 4, device=dev)
    dst = torch.empty_like(src)
    dst.copy_(src)
    torch.cuda.synchronize(dev)
    t0 = time.perf_counter()
    for _ in range(repeats):
        dst.copy_(src)
    torch.cuda.synchronize(dev)
    return round(2 * src.numel() * 4 * repeats / (time.perf_counter() - t0) / 1e9, 1)


def fingerprint(prof: dict) -> str:
    """Stable short id for 'the same kind of machine'."""
    key = "|".join(str(prof.get(k)) for k in ("arch", "model_name", "logical_cores", "memory_total_gb"))
    key += "|" + ",".join(f for f, on in sorted(prof.get("isa", {}).items()) if on)
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def native_precisions(prof: dict) -> list[str]:
    """Precisions with hardware support on this CPU. Others still run (e.g.
    bf16 is emulated via fp32 FMAs) and can still win on bandwidth-bound decode."""
    isa = prof.get("isa", {})
    out = ["fp32"]
    if isa.get("avx512_bf16") or isa.get("amx_bf16"):
        out.append("bf16")
    if isa.get("avx512_vnni") or isa.get("avx_vnni") or isa.get("amx_int8"):
        out.append("int8_dynamic")
    return out
