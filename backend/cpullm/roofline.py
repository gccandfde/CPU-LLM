"""Bandwidth roofline for batch-1 decode, and CPU-vs-GPU reference platforms.

At batch size 1 every decoded token reads (roughly) every weight once, so

    decode tokens/s  <=  memory bandwidth / model bytes

This one inequality explains most CPU-vs-GPU gaps, and it tells you which
levers actually help on CPU: fewer bytes per token (quantisation, pruning,
sparsity/MoE routing, smaller students) or more bandwidth (more DDR channels,
NUMA-local placement, HBM / CXL memory).
"""
from __future__ import annotations

# Nominal peak memory bandwidth from vendor spec sheets (GB/s). Sustained
# bandwidth is typically 60-85% of these on CPUs and 80-90% on GPUs.
REFERENCE_PLATFORMS = [
    {"name": "AMD Ryzen 9 7950X (2ch DDR5-5200)", "kind": "cpu", "bandwidth_gbs": 83},
    {"name": "AMD EPYC 9654 Genoa (12ch DDR5-4800)", "kind": "cpu", "bandwidth_gbs": 461},
    {"name": "AMD EPYC 9965 Turin (12ch DDR5-6400)", "kind": "cpu", "bandwidth_gbs": 614},
    {"name": "NVIDIA RTX 4090 (GDDR6X)", "kind": "gpu", "bandwidth_gbs": 1008},
    {"name": "NVIDIA H100 SXM (HBM3)", "kind": "gpu", "bandwidth_gbs": 3350},
    {"name": "AMD Instinct MI300X (HBM3)", "kind": "gpu", "bandwidth_gbs": 5300},
]


def decode_bound_tps(bandwidth_gbs: float, model_bytes: int) -> float:
    return bandwidth_gbs * 1e9 / max(model_bytes, 1)


def analyse(measured_tps: float | None, model_bytes: int, local_bandwidth_gbs: float | None) -> dict:
    out: dict = {"model_mb": round(model_bytes / 1e6, 2)}
    if local_bandwidth_gbs:
        bound = decode_bound_tps(local_bandwidth_gbs, model_bytes)
        out["local_bound_tps"] = round(bound, 1)
        if measured_tps:
            out["bandwidth_efficiency"] = round(measured_tps / bound, 3)
    out["platforms"] = [
        {**p, "bound_tps": round(decode_bound_tps(p["bandwidth_gbs"], model_bytes), 1)}
        for p in REFERENCE_PLATFORMS
    ]
    return out
