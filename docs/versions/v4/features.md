# CPU-LLM v4: stable

**Stable version.** Everything in [v3](/v3/features/) (tuning, design lab,
campaigns, audit, metrics) plus the two things hardware and platform teams
asked for next: a **benchmark suite for open-source workloads on CPUs and
GPUs**, and a **power optimiser** that controls cores, reads energy counters
and recommends an operating point. Data and machines are shared with the
earlier versions.

## Benchmarks tab: open-source workloads, CPU and GPU

The kernels every LLM stack spends its time in, written in plain PyTorch so
one suite runs on any CPU (any ISA) and on CUDA/ROCm GPUs from the same agent:

| Kernel | What it measures | Why it matters |
|---|---|---|
| STREAM copy / scale / add / triad | sustained memory bandwidth, GB/s | bounds decode at batch 1 |
| GEMM at 1k/2k/4k, fp32 / bf16 (/ fp16 on GPU) | TFLOPS of the vector or matrix unit | bounds prefill and batched serving; bf16 ≫ fp32 shows native BF16/AMX/tensor cores |
| Attention (SDPA) at 1k/4k/16k context | decode tokens/s (1 query vs the KV cache) and prefill tokens/s, KV read GB/s | long-context cost, cache residency |
| Embedding gather | GB/s and lookups/s on a 512 MB table | memory latency and TLB behaviour |

Quick / standard / large sizes; device selector per machine (GPU appears when
the agent sees one). **Compare machines** table puts every finished suite run
side by side with identical sizes, so CPUs, GPUs and firmware or kernel
changes compare directly. Campaign presets can queue the suite across the
fleet.

## Power tab: the power optimiser

*How many cores should this model run on?*

- The agent pins itself to 1, 2, 4, … all physical cores (CPU affinity: works
  on Linux, Windows and inside containers, no privileges) and measures decode
  tok/s at each point.
- **Energy:** RAPL package counters through Linux powercap (Intel and AMD)
  when readable; otherwise an estimate from idle and TDP watts, linear in
  active cores, **always labelled estimated**. Live package watts appear in
  the telemetry stream on hosts with RAPL.
- **Dynamic core control:** with permission on a Linux host, unused cores are
  really taken offline through `sysfs` and the cpufreq governor can be set
  for the run; both are restored afterwards.
- **Recommendation:** operating points for *performance* (fastest),
  *balanced* (fewest cores within 90% of the fastest) and *efficiency* (best
  tokens per joule), with the full tok/s, W and tok/J curves and the table.

## Resource prediction

The one-minute rolling forecast of CPU and memory from v3 stays on the live
telemetry; power joins it on hosts with RAPL.

## Runs, campaigns, API

- Runs of kind `benchmark` and `power` sit next to tuning runs: own detail
  pages, reports and JSON bundles, same exports and audit trail.
- `POST /api/jobs` takes `kind: "tune" | "benchmark" | "power"` with the
  parameters in `docs/API.md`; the OpenAPI document describes them.
- Agent: `usable_cores` (affinity) bounds thread sweeps; v4 agents report
  `power_w` in telemetry when RAPL is readable.

## Honest limits

- Without RAPL the watts are a model, not a measurement; the page says so on
  every number. Windows and most VMs have no readable counters; the lab
  machine or any bare-metal Linux host does.
- Core offlining needs the agent to run as root on Linux; the affinity sweep
  does not.
- The suite is PyTorch-based: it measures what a PyTorch/LLM stack gets, not
  the theoretical peak of hand-written assembly.
