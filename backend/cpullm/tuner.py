"""Search over transform/runtime configurations and pick the best one.

Objective: maximise decode tokens/s subject to an accuracy budget
(perplexity may rise by at most `max_ppl_increase_pct` over the fp32 baseline).
"""
from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field
from typing import Callable

import torch

from . import bench, hardware, models, recipe, roofline, transforms


@dataclass
class TuneRequest:
    model_id: str = models.BUILTIN_TINY
    revision: str | None = None
    precisions: list[str] = field(default_factory=lambda: ["fp32", "bf16", "int8_dynamic"])
    prune_counts: list[int] = field(default_factory=lambda: [0])
    thread_counts: list[int] | None = None
    new_tokens: int = 32
    repeats: int = 3
    max_ppl_increase_pct: float = 10.0


def _prune_indices(redundancy: list[float], count: int) -> list[int]:
    """The `count` most redundant blocks, never the first or last (they map
    into and out of the embedding space and are always load-bearing)."""
    if count <= 0:
        return []
    inner = range(1, len(redundancy) - 1)
    return sorted(sorted(inner, key=lambda i: -redundancy[i])[:count])


def candidates(req: TuneRequest, redundancy: list[float], max_threads: int) -> list[dict]:
    threads = req.thread_counts or sorted({max(1, max_threads // 2), max_threads})
    out = []
    for prec, prune, th in itertools.product(req.precisions, req.prune_counts, threads):
        drop = _prune_indices(redundancy, prune)
        tlist = ([{"op": "prune_layers", "drop": drop}] if drop else []) + transforms.precision_transforms(prec)
        out.append({"name": f"{prec}/prune{prune}/t{th}", "precision": prec, "pruned_layers": len(drop),
                    "threads": th, "transforms": tlist})
    return out


def tune(req: TuneRequest, on_progress: Callable[[dict], None] = lambda e: None) -> dict:
    hw = hardware.profile()
    on_progress({"stage": "loading", "message": f"Loading {req.model_id}"})
    base, tok, revision = models.load(req.model_id, req.revision)
    on_progress({"stage": "analyse", "message": "Measuring per-layer redundancy"})
    redundancy = transforms.layer_redundancy(base, torch.tensor([tok.encode(bench.EVAL_TEXT)]))
    max_threads = hw["physical_cores"] or hw["logical_cores"] or 1

    on_progress({"stage": "baseline", "message": "Running fp32 baseline"})
    baseline = bench.run(base, tok, threads=max_threads, new_tokens=req.new_tokens, repeats=req.repeats)
    baseline.update(name="baseline/fp32", precision="fp32", pruned_layers=0, transforms=[])

    cands = candidates(req, redundancy, max_threads)
    results = []
    for i, c in enumerate(cands):
        on_progress({"stage": "candidate", "index": i, "total": len(cands), "message": f"Benchmarking {c['name']}"})
        try:
            model = transforms.apply(copy.deepcopy(base), c["transforms"])
            r = bench.run(model, tok, threads=c["threads"], new_tokens=req.new_tokens,
                          repeats=req.repeats, reference_tokens=baseline["tokens"])
        except Exception as e:  # keep the sweep going; report the failure
            r = {"error": f"{type(e).__name__}: {e}"}
        r.update(c)
        if "error" not in r:
            r["speedup"] = round(r["decode_tps"] / baseline["decode_tps"], 3)
            r["ttft_speedup"] = round(baseline["ttft_ms"] / r["ttft_ms"], 3)
            r["ppl_increase_pct"] = round((r["perplexity"] / baseline["perplexity"] - 1) * 100, 2)
            r["size_reduction"] = round(baseline["model_bytes"] / r["model_bytes"], 3)
            r["within_budget"] = r["ppl_increase_pct"] <= req.max_ppl_increase_pct
        results.append(r)
        on_progress({"stage": "result", "result": _public(r)})

    ok = [r for r in results if r.get("within_budget")]
    best = max(ok, key=lambda r: r["decode_tps"]) if ok else None
    chosen = best or {**baseline, "threads": max_threads}
    expected = {k: chosen.get(k) for k in ("decode_tps", "ttft_ms", "perplexity", "model_bytes", "speedup")}
    rec = recipe.build(req.model_id, revision, chosen["transforms"], chosen["threads"], hw, expected)

    return {
        "request": req.__dict__,
        "hardware": hw,
        "baseline": _public(baseline),
        "results": [_public(r) for r in results],
        "best": chosen["name"],
        "layer_redundancy": redundancy,
        "recipe": rec,
        "roofline": roofline.analyse(chosen.get("decode_tps"), chosen["model_bytes"], hw.get("memory_bandwidth_gbs")),
    }


def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if k != "tokens"}
