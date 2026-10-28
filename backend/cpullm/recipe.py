"""Recipes: the portable output of a tuning run.

A recipe pins the base model (id + revision), the ordered list of transforms,
and the runtime settings. Replaying it on any machine rebuilds the same model:

    python -m cpullm.reproduce recipe.json
"""
from __future__ import annotations

import json

import torch

from . import models, transforms

SCHEMA = "cpullm.recipe/v1"


def runtime_settings(threads: int, device: str = "cpu") -> dict:
    env = {
        "OMP_NUM_THREADS": str(threads),
        # Pin threads to cores so caches and NUMA-local memory stay warm.
        "OMP_PROC_BIND": "close",
        "OMP_PLACES": "cores",
    }
    return {
        "device": device,
        "threads": threads,
        "interop_threads": 1,
        "env": env,
        "launch_hint": f"numactl --cpunodebind=0 --membind=0 python -m cpullm.reproduce recipe.json",
    }


def build(model_id: str, revision: str | None, transform_list: list[dict], threads: int,
          hardware: dict, expected: dict, device: str = "cpu") -> dict:
    return {
        "schema": SCHEMA,
        "model": {"id": model_id, "revision": revision},
        "transforms": transform_list,
        "runtime": runtime_settings(threads, device),
        "tuned_on": {k: hardware.get(k) for k in
                     ("fingerprint", "model_name", "logical_cores", "memory_total_gb",
                      "memory_bandwidth_gbs", "isa", "gpus")},
        "expected": expected,
    }


def apply(recipe: dict):
    """Rebuild the tuned model from a recipe. Returns (model, tokenizer)."""
    if recipe.get("schema") != SCHEMA:
        raise ValueError(f"Unsupported recipe schema: {recipe.get('schema')}")
    rt = recipe["runtime"]
    model, tok, _ = models.load(recipe["model"]["id"], recipe["model"].get("revision"))
    model = transforms.apply(model.to(rt.get("device", "cpu")), recipe["transforms"])
    torch.set_num_threads(rt["threads"])
    return model, tok


def load_file(path: str) -> dict:
    with open(path) as f:
        return json.load(f)
