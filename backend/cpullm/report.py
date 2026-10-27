"""Benchmark report (Markdown) and the downloadable tuning bundle (zip)."""
from __future__ import annotations

import io
import json
import zipfile

REPRODUCE_MD = """# Reproducing this tuned model

1. Install the backend on the target machine:

       pip install torch --index-url https://download.pytorch.org/whl/cpu
       pip install -r backend/requirements.txt

2. Rebuild and benchmark the model from the recipe:

       cd backend
       python -m cpullm.reproduce /path/to/recipe.json

   The command applies the same transforms to the same pinned model revision,
   applies the runtime settings, and prints measured numbers next to the ones
   recorded on the machine the recipe was tuned on.

3. For best results set the recipe's runtime environment before launching:

{env}

   and on multi-socket / multi-CCD systems bind to one NUMA node:

       {launch_hint}
"""


def markdown(result: dict) -> str:
    hw, base, rec, roof = result["hardware"], result["baseline"], result["recipe"], result["roofline"]
    lines = [
        "# CPU-LLM tuning report",
        "",
        f"**Model:** `{rec['model']['id']}` @ `{rec['model']['revision']}`  ",
        f"**Hardware:** {hw['model_name']} — {hw['physical_cores']} cores / {hw['logical_cores']} threads, "
        f"{hw['memory_total_gb']} GB RAM, ~{hw.get('memory_bandwidth_gbs')} GB/s measured copy bandwidth  ",
        f"**ISA:** {', '.join(k for k, v in hw['isa'].items() if v) or 'baseline x86-64'}  ",
        f"**Selected configuration:** `{result['best']}`",
        "",
        "## Results",
        "",
        "| Config | Decode tok/s | Speedup | TTFT ms | Perplexity | Δ ppl % | Token agreement | Size MB | In budget |",
        "|---|---:|---:|---:|---:|---:|---:|---:|:-:|",
        f"| baseline/fp32 | {base['decode_tps']} | 1.0 | {base['ttft_ms']} | {base['perplexity']} | 0 | 1.0 | "
        f"{base['model_bytes'] / 1e6:.1f} | ✓ |",
    ]
    for r in result["results"]:
        if "error" in r:
            lines.append(f"| {r['name']} | error: {r['error']} | | | | | | | |")
            continue
        lines.append(
            f"| {r['name']} | {r['decode_tps']} | {r['speedup']} | {r['ttft_ms']} | {r['perplexity']} | "
            f"{r['ppl_increase_pct']} | {r['token_agreement']} | {r['model_bytes'] / 1e6:.1f} | "
            f"{'✓' if r['within_budget'] else '✗'} |"
        )
    lines += [
        "",
        "## Roofline (batch-1 decode is memory-bandwidth bound)",
        "",
        f"Selected model weighs {roof['model_mb']} MB. Upper bound on this machine: "
        f"{roof.get('local_bound_tps')} tok/s; achieved {roof.get('bandwidth_efficiency')} of it.",
        "",
        "| Platform | Kind | Peak GB/s | Decode bound tok/s |",
        "|---|---|---:|---:|",
    ]
    for p in roof["platforms"]:
        lines.append(f"| {p['name']} | {p['kind']} | {p['bandwidth_gbs']} | {p['bound_tps']} |")
    lines += ["", "## Recipe", "", "```json", json.dumps(rec, indent=2), "```", ""]
    return "\n".join(lines)


def bundle(result: dict) -> bytes:
    rec = result["recipe"]
    env = "\n".join(f"       export {k}={v}" for k, v in rec["runtime"]["env"].items())
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("recipe.json", json.dumps(rec, indent=2))
        z.writestr("report.md", markdown(result))
        z.writestr("results.json", json.dumps(result, indent=2, default=str))
        z.writestr("REPRODUCE.md", REPRODUCE_MD.format(env=env, launch_hint=rec["runtime"]["launch_hint"]))
    return buf.getvalue()
