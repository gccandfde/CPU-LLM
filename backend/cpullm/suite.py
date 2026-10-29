"""Open-source workload benchmark suite, CPU and GPU, from one agent.

The kernels are the ones every LLM stack spends its time in, written in plain
PyTorch so the same code runs on CPU (any ISA) and on CUDA/ROCm:

  stream     copy / scale / add / triad over large float32 arrays -> GB/s
             (the McCalpin STREAM pattern; decode is bounded by this number)
  gemm       square matmul at several sizes and dtypes -> TFLOPS (prefill,
             batch > 1 decode; shows the vector unit, AMX/tensor cores)
  attention  scaled-dot-product attention, decode (q = 1 token against a KV
             cache of `ctx`) and prefill (q = ctx) -> tokens/s
  gather     embedding lookup (index_select on a big table) -> GB/s

Every figure is the best of `repeats` timed runs after a warm-up. Results are
comparable across machines because sizes and dtypes are fixed by the request.
"""
from __future__ import annotations

import time

import torch

DEFAULTS = {
    "device": "cpu",
    "repeats": 3,
    "stream_mb": 256,
    "gemm_sizes": [1024, 2048, 4096],
    "gemm_dtypes": ["fp32", "bf16"],
    "attention_ctx": [1024, 4096, 16384],
    "heads": 32, "head_dim": 128,
    "gather_mb": 512,
}
DTYPES = {"fp32": torch.float32, "bf16": torch.bfloat16, "fp16": torch.float16}


def _sync(device: str) -> None:
    if device.startswith("cuda"):
        torch.cuda.synchronize()


def _best(fn, device: str, repeats: int) -> float:
    fn(); _sync(device)  # warm-up
    best = float("inf")
    for _ in range(repeats):
        t0 = time.perf_counter()
        fn(); _sync(device)
        best = min(best, time.perf_counter() - t0)
    return best


def stream(device: str, size_mb: int, repeats: int) -> dict:
    n = size_mb * 1024 * 1024 // 4
    a = torch.rand(n, device=device); b = torch.rand(n, device=device); c = torch.empty_like(a)
    s = 3.0
    bytes_ = n * 4
    out = {"size_mb": size_mb}
    out["copy_gbs"] = 2 * bytes_ / _best(lambda: c.copy_(a), device, repeats) / 1e9
    out["scale_gbs"] = 2 * bytes_ / _best(lambda: torch.mul(a, s, out=c), device, repeats) / 1e9
    out["add_gbs"] = 3 * bytes_ / _best(lambda: torch.add(a, b, out=c), device, repeats) / 1e9
    out["triad_gbs"] = 3 * bytes_ / _best(lambda: torch.add(a, b, alpha=s, out=c), device, repeats) / 1e9
    return {k: round(v, 2) if isinstance(v, float) else v for k, v in out.items()}


def gemm(device: str, sizes: list[int], dtypes: list[str], repeats: int) -> list[dict]:
    rows = []
    for name in dtypes:
        dt = DTYPES.get(name)
        if dt is None:
            continue
        for n in sizes:
            try:
                a = torch.rand(n, n, device=device).to(dt); b = torch.rand(n, n, device=device).to(dt)
                secs = _best(lambda: a @ b, device, repeats)
                rows.append({"n": n, "dtype": name, "tflops": round(2 * n ** 3 / secs / 1e12, 3), "ms": round(secs * 1000, 2)})
            except (RuntimeError, NotImplementedError) as e:  # dtype not supported on this device
                rows.append({"n": n, "dtype": name, "tflops": None, "error": str(e).split("\n")[0][:120]})
                break
    return rows


def attention(device: str, ctxs: list[int], heads: int, head_dim: int, repeats: int) -> list[dict]:
    rows = []
    dt = torch.bfloat16 if device.startswith("cuda") else torch.float32
    for ctx in ctxs:
        try:
            k = torch.rand(1, heads, ctx, head_dim, device=device, dtype=dt); v = torch.rand_like(k)
            q1 = torch.rand(1, heads, 1, head_dim, device=device, dtype=dt)
            decode = _best(lambda: torch.nn.functional.scaled_dot_product_attention(q1, k, v), device, repeats)
            qn = torch.rand(1, heads, ctx, head_dim, device=device, dtype=dt)
            prefill = _best(lambda: torch.nn.functional.scaled_dot_product_attention(qn, k, v, is_causal=True), device, max(1, repeats // 2))
            kv_bytes = 2 * k.numel() * k.element_size()
            rows.append({"ctx": ctx, "decode_tokens_s": round(1 / decode, 1), "decode_ms": round(decode * 1000, 3),
                         "kv_read_gbs": round(kv_bytes / decode / 1e9, 2), "prefill_tokens_s": round(ctx / prefill, 1), "prefill_ms": round(prefill * 1000, 1)})
        except RuntimeError as e:  # out of memory at long context
            rows.append({"ctx": ctx, "error": str(e).split("\n")[0][:120]})
            break
    return rows


def gather(device: str, table_mb: int, repeats: int) -> dict:
    dim = 1024
    rows_n = table_mb * 1024 * 1024 // (dim * 4)
    table = torch.rand(rows_n, dim, device=device)
    idx = torch.randint(0, rows_n, (65536,), device=device)
    secs = _best(lambda: table.index_select(0, idx), device, repeats)
    return {"table_mb": table_mb, "lookups": 65536, "gbs": round(65536 * dim * 4 / secs / 1e9, 2), "lookups_per_s": round(65536 / secs)}


def run(params: dict, on_progress=lambda e: None) -> dict:
    p = {**DEFAULTS, **{k: v for k, v in params.items() if k in DEFAULTS}}
    device = p["device"]
    if device.startswith("cuda") and not torch.cuda.is_available():
        raise ValueError("device=cuda requested but no CUDA/ROCm GPU is visible to PyTorch")
    from . import hardware
    hw = hardware.profile()
    t0 = time.perf_counter()
    stages = [("stream", lambda: stream(device, p["stream_mb"], p["repeats"])),
              ("gemm", lambda: gemm(device, p["gemm_sizes"], p["gemm_dtypes"], p["repeats"])),
              ("attention", lambda: attention(device, p["attention_ctx"], p["heads"], p["head_dim"], p["repeats"])),
              ("gather", lambda: gather(device, p["gather_mb"], p["repeats"]))]
    kernels = {}
    for i, (name, fn) in enumerate(stages):
        on_progress({"stage": "candidate", "index": i, "total": len(stages), "message": f"Benchmarking {name} on {device}"})
        kernels[name] = fn()
        on_progress({"stage": "result", "result": {"name": name, **({"summary": kernels[name]} if not isinstance(kernels[name], list) else {"rows": len(kernels[name])})}})
    gpu = None
    if device.startswith("cuda"):
        props = torch.cuda.get_device_properties(0)
        gpu = {"name": props.name, "memory_gb": round(props.total_memory / 1e9, 1), "sms": props.multi_processor_count}
    peak = {
        "bandwidth_gbs": max(kernels["stream"]["copy_gbs"], kernels["stream"]["triad_gbs"]),
        "tflops": max([r["tflops"] or 0 for r in kernels["gemm"]] or [0]),
        "attention_decode_tokens_s_4k": next((r.get("decode_tokens_s") for r in kernels["attention"] if r.get("ctx") == 4096), None),
    }
    return {"kind": "benchmark", "device": device, "gpu": gpu, "hardware": hw, "threads": torch.get_num_threads(),
            "params": p, "kernels": kernels, "peak": peak, "elapsed_s": round(time.perf_counter() - t0, 1),
            "best": f"{device}: {peak['bandwidth_gbs']} GB/s, {peak['tflops']} TFLOPS"}
