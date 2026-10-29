"""Power optimiser: find the number of active cores (and threads) at which a
model decodes with the best tokens per joule, per second, or a balance.

Energy comes from RAPL package counters (Linux powercap, Intel and AMD) when
readable; otherwise it is estimated from the idle/TDP figures and the share
of cores in use, and every number says so (`estimated: true`).

Core control, from portable to privileged:
  * affinity: the process (and PyTorch's threads) are pinned to the first N
    physical cores; works on Linux, Windows and in containers, no privileges;
  * sysfs: on Linux as root, cores beyond N can really be taken offline
    (`/sys/devices/system/cpu/cpuN/online`) and the cpufreq governor set;
    both are restored when the run ends.
"""
from __future__ import annotations

import glob
import os
import time

import psutil
import torch

from . import energy

SYS_CPU = "/sys/devices/system/cpu"


# ---- topology and control -------------------------------------------------

def physical_cpus() -> list[int]:
    """One logical CPU per physical core, in core order (SMT siblings skipped)."""
    seen, out = set(), []
    paths = sorted(glob.glob(f"{SYS_CPU}/cpu[0-9]*/topology/thread_siblings_list"), key=lambda p: int(p.split("/cpu")[-1].split("/")[0]))
    for p in paths:
        try:
            with open(p) as f:
                sib = f.read().strip()
        except OSError:
            continue
        first = int(sib.replace("-", ",").split(",")[0])
        if first not in seen:
            seen.add(first)
            out.append(first)
    if out:
        return out
    # No sysfs topology (Windows, macOS): assume siblings are adjacent when SMT is on.
    logical = psutil.cpu_count(logical=True) or 1
    physical = psutil.cpu_count(logical=False) or logical
    step = max(1, logical // physical)
    return list(range(0, logical, step))[:physical]


def set_affinity(cpus: list[int]) -> bool:
    try:
        if hasattr(os, "sched_setaffinity"):
            os.sched_setaffinity(0, set(cpus))
        else:
            psutil.Process().cpu_affinity(cpus)
        return True
    except (OSError, ValueError, psutil.Error):
        return False


def current_affinity() -> list[int]:
    try:
        return sorted(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else psutil.Process().cpu_affinity()
    except (OSError, psutil.Error):
        return list(range(psutil.cpu_count(logical=True) or 1))


def _write(path: str, value: str) -> bool:
    try:
        with open(path, "w") as f:
            f.write(value)
        return True
    except OSError:
        return False


def can_offline() -> bool:
    return os.access(f"{SYS_CPU}/cpu1/online", os.W_OK) if os.path.exists(f"{SYS_CPU}/cpu1/online") else False


def set_online(cpu: int, on: bool) -> bool:
    return _write(f"{SYS_CPU}/cpu{cpu}/online", "1" if on else "0")


def governors() -> list[str]:
    try:
        with open(f"{SYS_CPU}/cpu0/cpufreq/scaling_available_governors") as f:
            return f.read().split()
    except OSError:
        return []


def set_governor(name: str) -> int:
    return sum(_write(p, name) for p in glob.glob(f"{SYS_CPU}/cpu*/cpufreq/scaling_governor"))


# ---- power sampling ---------------------------------------------------------

class RaplSampler:
    """Average package watts since the previous call; None when RAPL is unavailable."""

    def __init__(self) -> None:
        self.packages = energy._packages()
        self._last = None

    @property
    def available(self) -> bool:
        return bool(self.packages)

    def watts(self) -> float | None:
        if not self.packages:
            return None
        now = time.perf_counter()
        vals = [energy._read(p) for p, _ in self.packages]
        if None in vals:
            return None
        if self._last is None:
            self._last = (now, vals)
            return None
        t0, prev = self._last
        self._last = (now, vals)
        total = 0
        for (_, wrap), a, b in zip(self.packages, prev, vals):
            total += b - a if b >= a else b + wrap - a
        dt = now - t0
        return round(total / 1e6 / dt, 1) if dt > 0 else None


def estimate_watts(active_cores: int, total_cores: int, idle_w: float, tdp_w: float, utilisation: float = 1.0) -> float:
    return round(idle_w + (tdp_w - idle_w) * (active_cores / max(1, total_cores)) * utilisation, 1)


# ---- the optimiser ----------------------------------------------------------

def optimize(params: dict, on_progress=lambda e: None) -> dict:
    """Sweep active cores for one model/precision; measure tok/s and watts at each point."""
    from . import bench, hardware, models

    model_id = params.get("model_id", models.BUILTIN_TINY)
    precision = params.get("precision", "bf16")
    new_tokens = int(params.get("new_tokens", 16))
    repeats = int(params.get("repeats", 2))
    idle_w = float(params.get("idle_w", 10))
    tdp_w = float(params.get("tdp_w", 65))
    hard = bool(params.get("hard_offline", False)) and can_offline()
    governor = params.get("governor")

    hw = hardware.profile()
    phys = [c for c in physical_cpus() if c in set(current_affinity())] or current_affinity()
    total = len(phys)
    counts = params.get("core_counts") or sorted({1, 2, 4, 8, 16, 32, total} & set(range(1, total + 1)))
    counts = [c for c in counts if 1 <= c <= total]

    on_progress({"stage": "loading", "message": f"Loading {model_id}"})
    model, tok, _ = models.load(model_id)
    if precision == "bf16":
        model = model.to(torch.bfloat16)
    elif precision == "fp16":
        model = model.to(torch.float16)

    rapl = RaplSampler()
    source = "rapl" if rapl.available else "estimated"
    original_affinity = current_affinity()
    original_governor = None
    if governor and governor in governors():
        try:
            with open(f"{SYS_CPU}/cpu0/cpufreq/scaling_governor") as f:
                original_governor = f.read().strip()
        except OSError:
            pass
        set_governor(governor)

    points = []
    try:
        for i, n in enumerate(counts):
            cpus = phys[:n]
            on_progress({"stage": "candidate", "index": i, "total": len(counts), "message": f"{n} active core(s): {cpus[0]}..{cpus[-1]}"})
            set_affinity(cpus)
            if hard:
                for c in phys[n:]:
                    set_online(c, False)
            rapl.watts()  # reset the energy window
            t0 = time.perf_counter()
            r = bench.run(model, tok, threads=n, new_tokens=new_tokens, repeats=repeats, run_eval=False)
            elapsed = time.perf_counter() - t0
            w = rapl.watts()
            estimated = w is None
            if estimated:
                w = estimate_watts(n, total, idle_w, tdp_w)
            tps = r["decode_tps"] or 0.0
            point = {"cores": n, "threads": n, "cpus": f"{cpus[0]}-{cpus[-1]}" if n > 1 else str(cpus[0]), "decode_tps": tps,
                     "ttft_ms": r.get("ttft_ms"), "watts": w, "tokens_per_joule": round(tps / w, 4) if w else None,
                     "estimated": estimated, "elapsed_s": round(elapsed, 1), "hard_offline": hard}
            points.append(point)
            on_progress({"stage": "result", "result": point})
            if hard:
                for c in phys[n:]:
                    set_online(c, True)
    finally:
        set_affinity(original_affinity)
        if hard:
            for c in phys:
                set_online(c, True)
        if original_governor:
            set_governor(original_governor)

    ok = [p for p in points if p["decode_tps"]]
    perf = max(ok, key=lambda p: p["decode_tps"]) if ok else None
    eff = max(ok, key=lambda p: p["tokens_per_joule"] or 0) if ok else None
    # Balanced: the fewest cores that still reach 90% of the best speed.
    bal = next((p for p in sorted(ok, key=lambda p: p["cores"]) if perf and p["decode_tps"] >= 0.9 * perf["decode_tps"]), perf)
    return {
        "kind": "power", "model_id": model_id, "precision": precision, "hardware": hw,
        "energy_source": source, "idle_w": idle_w, "tdp_w": tdp_w, "total_physical_cores": total, "hard_offline": hard,
        "governor": governor if original_governor else None, "points": points,
        "recommendation": {"performance": perf, "balanced": bal, "efficiency": eff},
        "best": f"performance {perf['cores']}c · balanced {bal['cores']}c · efficiency {eff['cores']}c" if perf else "no measurement",
    }
