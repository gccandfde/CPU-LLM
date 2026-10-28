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
        f"**Selected configuration:** `{result['best']}`  ",
        f"**Run-to-run noise:** ±{base.get('noise_pct', 'n/a')}% (baseline measured at start and end: "
        f"{base.get('decode_tps_runs')} tok/s). Speedups inside this band are not significant.",
        "",
        "## Results",
        "",
        "| Config | Decode tok/s | Speedup | TTFT ms | Perplexity | Δ ppl % | Task acc | Token agreement | Size MB | J/token | In budget |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|",
        f"| baseline/fp32 | {base['decode_tps']} | 1.0 | {base['ttft_ms']} | {base['perplexity']} | 0 | {_acc(base)} | 1.0 | "
        f"{base['model_bytes'] / 1e6:.1f} | {_na(base.get('joules_per_token'))} | ✓ |",
    ]
    for r in result["results"]:
        if "error" in r:
            lines.append(f"| {r['name']} | error: {r['error']} | | | | | | | | | |")
            continue
        lines.append(
            f"| {r['name']} | {r['decode_tps']} | {r['speedup']} | {r['ttft_ms']} | {r['perplexity']} | "
            f"{r['ppl_increase_pct']} | {_acc(r)} | {r['token_agreement']} | {r['model_bytes'] / 1e6:.1f} | "
            f"{_na(r.get('joules_per_token'))} | {'✓' if r['within_budget'] else '✗'} |"
        )
    lines += _batch_section(result.get("batch_scaling")) + _profile_section(result.get("op_profile"))
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


def _na(v) -> str:
    return "n/a" if v is None else str(v)


def _acc(r: dict) -> str:
    return f"{r['eval']['accuracy']:.0%}" if r.get("eval") else "n/a"


def _batch_section(bs: dict | None) -> list[str]:
    if not bs:
        return []
    lines = ["", "## Batch scaling (aggregate decode tokens/s)", "",
             "| Batch | Baseline tok/s | Selected tok/s | Selected ms/step |", "|---:|---:|---:|---:|"]
    for b, s in zip(bs["baseline"], bs["selected"]):
        lines.append(f"| {b['batch']} | {b['aggregate_tps']} | {s['aggregate_tps']} | {s['ms_per_step']} |")
    return lines


def _profile_section(prof: dict | None) -> list[str]:
    if not prof:
        return []
    lines = ["", f"## Where decode time goes (selected config, {prof['total_ms_per_step']} ms/step)", "",
             "| Category | % | ms/step |", "|---|---:|---:|"]
    lines += [f"| {c['category']} | {c['pct']} | {c['ms_per_step']} |" for c in prof["categories"]]
    lines += ["", "| Operator | Category | Calls/step | % | ms/step |", "|---|---|---:|---:|---:|"]
    lines += [f"| `{o['op']}` | {o['category']} | {o['calls_per_step']} | {o['pct']} | {o['ms_per_step']} |"
              for o in prof["top_ops"]]
    return lines


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
