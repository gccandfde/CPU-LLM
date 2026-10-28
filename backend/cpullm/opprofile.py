"""Operator-level trace of decode steps: where does the time go?

Groups PyTorch operators into the categories hardware teams reason about
(matrix multiply, attention, normalisation, elementwise, data movement), so
a run shows e.g. "78% of decode time is GEMV": the signal for whether a
platform needs more bandwidth, wider matrix units or better kernels.
"""
from __future__ import annotations

import torch
from torch.profiler import ProfilerActivity, profile

CATEGORIES = [
    ("matmul", ("mm", "addmm", "matmul", "linear", "bmm", "int8pack", "int4pack", "quantized::linear", "gemm", "mkldnn")),
    ("attention", ("attention", "softmax", "sdpa", "flash")),
    ("norm", ("norm", "rsqrt")),
    ("elementwise", ("mul", "add", "silu", "gelu", "sub", "div", "pow", "neg", "exp", "cos", "sin", "tanh", "sigmoid")),
    ("data movement", ("cat", "copy", "to", "clone", "contiguous", "index", "view", "reshape", "transpose", "slice", "expand", "embedding", "gather", "select", "unsqueeze", "permute")),
]


def _category(name: str) -> str:
    n = name.lower().removeprefix("aten::")
    for cat, keys in CATEGORIES:
        if any(k == n or k in n for k in keys):
            return cat
    return "other"


@torch.inference_mode()
def decode_profile(model, tokenizer, steps: int = 8, top: int = 12) -> dict:
    from .bench import PROMPT, model_device

    device = model_device(model)
    ids = torch.tensor([tokenizer.encode(PROMPT)], device=device)
    out = model(input_ids=ids, use_cache=True)
    nxt, past = out.logits[:, -1, :].argmax(-1, keepdim=True), out.past_key_values
    activities = [ProfilerActivity.CPU] + ([ProfilerActivity.CUDA] if device.type == "cuda" else [])
    with profile(activities=activities) as prof:
        for _ in range(steps):
            out = model(input_ids=nxt, past_key_values=past, use_cache=True)
            past = out.past_key_values
            nxt = out.logits[:, -1, :].argmax(-1, keepdim=True)
            nxt[0, 0].item()

    use_dev = device.type == "cuda"
    events = [e for e in prof.key_averages() if e.key.startswith(("aten::", "quantized::", "torchao::", "mkldnn::"))]

    def self_us(e) -> float:
        return float(getattr(e, "self_device_time_total", 0) if use_dev else e.self_cpu_time_total)

    total = sum(self_us(e) for e in events) or 1.0
    by_cat: dict[str, float] = {}
    for e in events:
        by_cat[_category(e.key)] = by_cat.get(_category(e.key), 0.0) + self_us(e)
    ops = sorted(events, key=self_us, reverse=True)[:top]
    return {
        "steps": steps,
        "clock": "device" if use_dev else "cpu",
        "total_ms_per_step": round(total / steps / 1000, 3),
        "categories": [{"category": c, "pct": round(100 * t / total, 1), "ms_per_step": round(t / steps / 1000, 3)}
                       for c, t in sorted(by_cat.items(), key=lambda kv: -kv[1])],
        "top_ops": [{"op": e.key, "calls_per_step": round(e.count / steps, 1), "pct": round(100 * self_us(e) / total, 1),
                     "ms_per_step": round(self_us(e) / steps / 1000, 3), "category": _category(e.key)} for e in ops],
    }
