# CPU-LLM v1: features

**Stable version.** Tune large language models for the CPUs and GPUs you
already have, measure speed *and* accuracy, and take away a recipe that
rebuilds the tuned model anywhere.

> v1 gets fixes only. New features arrive in the [v2 preview](/v2/features/).

## Who it is for

Performance engineers, ML engineers and infrastructure teams who need to know
how fast a given model runs on a given machine, and which settings make it faster
without losing accuracy.

## How it works

1. **Connect a machine.** A small agent runs on the computer you want to tune
   and connects out to this site over HTTPS. No open ports are needed.
2. **Start a tuning run.** Pick a model, CPU or GPU, and a preset.
3. **Read the results.** Speed, accuracy, size and energy per configuration,
   with the best one chosen inside your accuracy budget.
4. **Reuse the recipe.** Download the bundle and rebuild the tuned model on
   any other machine; the numbers are re-verified there.

## Tabs

### Overview
Machines online, finished runs, best speed-up and size reduction, recent runs.

### Machines
Each connected machine's hardware: CPU model, cores and threads, instruction
sets (AVX2, AVX-512, VNNI, BF16, AMX), caches, NUMA nodes, measured memory
bandwidth, GPUs and energy counters, plus live per-core CPU, memory, disk
and network charts.

### Tune
- **Presets:** Quick check (about a minute), Full sweep, Accuracy-first, Max speed.
- **Precision and quantisation:** fp32, bf16, fp16, int8 dynamic, int8 and
  int4 weight-only. Precisions without hardware support are marked *emulated*.
- **Layer pruning, thread counts, batch sizes** to sweep.
- **Accuracy budget:** maximum perplexity increase and task-accuracy drop.
- **Options:** 30-question task evaluation, operator trace, `torch.compile`.
- **Offline machine?** Queue the run; it starts when the machine connects.

### Runs
History with filters. Each run has: summary, every configuration tried,
batch scaling, operator trace (matrix multiply, attention, norms, element-wise,
data movement), per-layer redundancy, a bandwidth roofline against reference
CPUs and GPUs, and the recipe.

### Recipes
Every tuned configuration ready to download: `recipe.json`, a report,
full results and reproduction steps.

### Compare
Up to six runs side by side, across machines, models, CPU and GPU: speed,
accuracy, bandwidth efficiency, batch scaling and operator mix.

### Architecture Lab
What-if model of token generation on any CPU or GPU memory system: model
size, mixture-of-experts, precision, KV cache, batch and context. Shows
memory capacity, the compute knee and tokens per joule. Add your own
hardware; connected machines appear with their measured bandwidth.

### Admin
Password-protected settings, separate from the dashboard:

| Area | What you control |
|---|---|
| Dashboard access | Login on or off, dashboard password |
| Agents and machines | Agent token (show, copy, replace), start command, accept new machines, offline timeout, live history, remove machines |
| Tuning options | Model list and default, other models allowed, precisions, CPU/GPU, per-run limits, presets |
| Data retention | Keep the newest N runs, delete runs older than N days |
| Site | Title and tagline |
| Admin password | Change it; other sessions are signed out |

## What a run measures

| Metric | Meaning |
|---|---|
| Decode tokens/s | Generation speed after the first token |
| Time to first token | Prompt processing latency |
| Perplexity | Language-modelling quality on a fixed text |
| Task accuracy | 30 multiple-choice questions |
| Token agreement | How often the tuned model picks the same next token as the original |
| Size, memory, J/token | Model bytes, process memory, energy where counters exist |
| Run-to-run noise | Baseline measured at start and end, so small gains are not over-read |

## Limits

- One job at a time per machine; runs start one machine at a time.
- One admin password; no per-user accounts.
- The dashboard cannot power a machine on: its agent must be running.
