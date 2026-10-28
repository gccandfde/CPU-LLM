"""Rebuild a tuned model from a recipe and compare against the recorded numbers.

    python -m cpullm.reproduce recipe.json [--new-tokens 32] [--repeats 3]
"""
from __future__ import annotations

import argparse
import json

from . import bench, hardware, recipe


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("recipe")
    ap.add_argument("--new-tokens", type=int, default=32)
    ap.add_argument("--repeats", type=int, default=3)
    args = ap.parse_args(argv)

    rec = recipe.load_file(args.recipe)
    model, tok = recipe.apply(rec)
    measured = bench.run(model, tok, threads=rec["runtime"]["threads"],
                         new_tokens=args.new_tokens, repeats=args.repeats)
    hw = hardware.profile()
    same_hw = hw["fingerprint"] == rec["tuned_on"].get("fingerprint")

    print(f"Model     : {rec['model']['id']} @ {rec['model']['revision']}")
    print(f"Transforms: {json.dumps(rec['transforms'])}")
    print(f"Hardware  : {hw['model_name']} ({'same' if same_hw else 'different'} machine class as tuning run)")
    print(f"{'metric':<12}{'expected':>14}{'measured':>14}")
    for key in ("decode_tps", "ttft_ms", "perplexity", "model_bytes"):
        print(f"{key:<12}{str(rec['expected'].get(key)):>14}{str(measured[key]):>14}")
    return {"measured": measured, "same_hardware": same_hw}


if __name__ == "__main__":
    main()
