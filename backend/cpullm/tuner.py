"""Search over transform/runtime configurations and pick the best one.

Objective: maximise decode tokens/s subject to an accuracy budget: perplexity
may rise by at most `max_ppl_increase_pct` over the fp32 baseline and, when the
task eval runs, accuracy may drop by at most `max_eval_drop_pts` points.

After the sweep the winner is optionally compiled (torch.compile), traced at
operator level, and measured across batch sizes.
"""
from __future__ import annotations

import copy
import itertools
from dataclasses import dataclass, field
from typing import Callable

import torch

from . import bench, hardware, models, opprofile, recipe, roofline, transforms


@dataclass
class TuneRequest:
    model_id: str = models.BUILTIN_TINY
    revision: str | None = None
    device: str = "cpu"
    precisions: list[str] = field(default_factory=lambda: ["fp32", "bf16", "int8_dynamic"])
    prune_counts: list[int] = field(default_factory=lambda: [0])
    thread_counts: list[int] | None = None
    new_tokens: int = 32
    repeats: int = 3
    max_ppl_increase_pct: float = 10.0
    run_eval: bool = True
    max_eval_drop_pts: float = 5.0
    compile: bool = False
    profile: bool = True
    batch_sizes: list[int] = field(default_factory=lambda: [1, 4, 16])


def _prune_indices(redundancy: list[float], count: int) -> list[int]:
    """The `count` most redundant blocks, never the first or last (they map
    into and out of the embedding space and are always load-bearing)."""
    if count <= 0:
        return []
    inner = range(1, len(redundancy) - 1)
    return sorted(sorted(inner, key=lambda i: -redundancy[i])[:count])


def candidates(req: TuneRequest, redundancy: list[float], max_threads: int) -> list[dict]:
    # Thread count barely matters on GPU (it only drives the Python host side).
    threads = [max_threads] if req.device != "cpu" else (
        req.thread_counts or sorted({max(1, max_threads // 2), max_threads}))
    out = []
    for prec, prune, th in itertools.product(req.precisions, req.prune_counts, threads):
        if not transforms.precision_supported(prec, req.device):
            continue
        drop = _prune_indices(redundancy, prune)
        tlist = ([{"op": "prune_layers", "drop": drop}] if drop else []) + transforms.precision_transforms(prec)
        out.append({"name": f"{prec}/prune{prune}/t{th}", "precision": prec, "pruned_layers": len(drop),
                    "threads": th, "transforms": tlist})
    return out


def _score(r: dict, baseline: dict, req: TuneRequest) -> None:
    r["speedup"] = round(r["decode_tps"] / baseline["decode_tps"], 3)
    # A speedup inside run-to-run noise is not a result.
    r["significant"] = abs(r["speedup"] - 1) * 100 > baseline.get("noise_pct", 0)
    r["ttft_speedup"] = round(baseline["ttft_ms"] / r["ttft_ms"], 3)
    r["ppl_increase_pct"] = round((r["perplexity"] / baseline["perplexity"] - 1) * 100, 2)
    r["size_reduction"] = round(baseline["model_bytes"] / r["model_bytes"], 3)
    ok = r["ppl_increase_pct"] <= req.max_ppl_increase_pct
    if r.get("eval") and baseline.get("eval"):
        r["eval_drop_pts"] = round((baseline["eval"]["accuracy"] - r["eval"]["accuracy"]) * 100, 2)
        ok = ok and r["eval_drop_pts"] <= req.max_eval_drop_pts
    r["within_budget"] = ok


def _build(base: torch.nn.Module, tlist: list[dict]) -> torch.nn.Module:
    return transforms.apply(copy.deepcopy(base), tlist)


def tune(req: TuneRequest, on_progress: Callable[[dict], None] = lambda e: None) -> dict:
    if req.device != "cpu" and not torch.cuda.is_available():
        raise ValueError(f"device={req.device!r} requested but no CUDA/ROCm GPU is visible to PyTorch")
    hw = hardware.profile()
    on_progress({"stage": "loading", "message": f"Loading {req.model_id}"})
    base, tok, revision = models.load(req.model_id, req.revision)
    base = base.to(req.device)
    on_progress({"stage": "analyse", "message": "Measuring per-layer redundancy"})
    redundancy = transforms.layer_redundancy(base, torch.tensor([tok.encode(bench.EVAL_TEXT)], device=req.device))
    max_threads = hw["physical_cores"] or hw["logical_cores"] or 1
    bench_args = dict(new_tokens=req.new_tokens, repeats=req.repeats, run_eval=req.run_eval)

    on_progress({"stage": "baseline", "message": "Running fp32 baseline"})
    baseline = bench.run(base, tok, threads=max_threads, **bench_args)
    baseline.update(name="baseline/fp32", precision="fp32", pruned_layers=0, transforms=[])

    cands = candidates(req, redundancy, max_threads)
    total = len(cands) + int(req.compile)
    results = []
    for i, c in enumerate(cands):
        on_progress({"stage": "candidate", "index": i, "total": total, "message": f"Benchmarking {c['name']}"})
        try:
            model = _build(base, c["transforms"])
            r = bench.run(model, tok, threads=c["threads"], reference_tokens=baseline["tokens"], **bench_args)
        except Exception as e:  # keep the sweep going; report the failure
            r = {"error": f"{type(e).__name__}: {e}"}
        r.update(c)
        if "error" not in r:
            _score(r, baseline, req)
        results.append(r)
        on_progress({"stage": "result", "result": _public(r)})

    # Re-measure the baseline: the spread between the two runs is this machine's
    # run-to-run noise (thermal state, other tenants, frequency scaling).
    on_progress({"stage": "baseline", "message": "Re-measuring baseline to estimate noise"})
    again = bench.run(base, tok, threads=max_threads, new_tokens=req.new_tokens, repeats=req.repeats)
    first = baseline["decode_tps"]
    baseline["decode_tps_runs"] = [first, again["decode_tps"]]
    baseline["decode_tps"] = round((first + again["decode_tps"]) / 2, 2)
    baseline["noise_pct"] = round(abs(first - again["decode_tps"]) / baseline["decode_tps"] * 100, 1)
    for r in results:
        if "error" not in r:
            _score(r, baseline, req)

    ok = [r for r in results if r.get("within_budget")]
    chosen = max(ok, key=lambda r: r["decode_tps"]) if ok else {**baseline, "threads": max_threads}

    if req.compile:
        c = {**{k: chosen[k] for k in ("precision", "pruned_layers", "threads")},
             "name": f"{chosen['name']}+compile", "transforms": chosen["transforms"] + [{"op": "compile"}]}
        on_progress({"stage": "candidate", "index": len(cands), "total": total,
                     "message": f"Compiling {chosen['name']} with torch.compile (takes minutes)"})
        try:
            r = bench.run(_build(base, c["transforms"]), tok, threads=c["threads"],
                          reference_tokens=baseline["tokens"], **bench_args)
            r.update(c)
            _score(r, baseline, req)
        except Exception as e:
            r = {**c, "error": f"{type(e).__name__}: {e}"}
        results.append(r)
        on_progress({"stage": "result", "result": _public(r)})
        if r.get("within_budget") and r["decode_tps"] > chosen["decode_tps"]:
            chosen = r

    extras: dict = {}
    if req.profile or len(req.batch_sizes) > 1:
        model = _build(base, [t for t in chosen["transforms"] if t["op"] != "compile"])
        if req.profile:
            on_progress({"stage": "profile", "message": "Tracing operators of the selected configuration"})
            extras["op_profile"] = opprofile.decode_profile(model, tok)
            extras["op_profile_baseline"] = opprofile.decode_profile(base, tok)
        if len(req.batch_sizes) > 1:
            on_progress({"stage": "batch", "message": f"Measuring batch sizes {req.batch_sizes}"})
            extras["batch_scaling"] = {
                "baseline": bench.batch_scaling(base, tok, max_threads, req.batch_sizes),
                "selected": bench.batch_scaling(model, tok, chosen["threads"], req.batch_sizes),
            }

    expected = {k: chosen.get(k) for k in ("decode_tps", "ttft_ms", "perplexity", "model_bytes", "speedup")}
    expected["eval_accuracy"] = (chosen.get("eval") or {}).get("accuracy")
    rec = recipe.build(req.model_id, revision, chosen["transforms"], chosen["threads"], hw, expected, req.device)
    bandwidth = hw["gpus"][0].get("memory_bandwidth_gbs") if req.device != "cpu" and hw.get("gpus") else hw.get("memory_bandwidth_gbs")

    return {
        "request": req.__dict__,
        "hardware": hw,
        "baseline": _public(baseline),
        "results": [_public(r) for r in results],
        "best": chosen["name"],
        "layer_redundancy": redundancy,
        "recipe": rec,
        "roofline": roofline.analyse(chosen.get("decode_tps"), chosen["model_bytes"], bandwidth),
        **extras,
    }


def _public(r: dict) -> dict:
    return {k: v for k, v in r.items() if k != "tokens"}
