# CPU-LLM v4: preview

**Preview version.** Everything in [v3](/v3/features/) plus what is being
built next, as it lands. Preview features may change; data and machines are
shared with the stable versions.

## Planned for v4

- **Benchmark suite for open-source workloads (CPU and GPU):** STREAM-style
  bandwidth (copy/scale/add/triad), GEMM TFLOPS per precision, attention
  (SDPA) throughput at several context lengths, embedding/gather bandwidth,
  and standard model decode/prefill, on CPU and on CUDA/ROCm GPUs, run by the
  same agent and compared across machines in a Benchmarks tab and in
  campaigns.
- **Power optimiser:** the agent reads RAPL package energy (Linux powercap,
  Intel and AMD) and, when it may, controls cores (affinity-based core
  scaling everywhere; `sysfs` online/offline and governor on Linux hosts with
  permission); an optimiser run sweeps active cores and thread counts for a
  workload and reports tok/s, watts and tok/J per point, with a recommended
  operating point for a performance, balanced or efficiency target. Live
  power and energy-per-token appear in telemetry where counters exist;
  estimated (and labelled so) where they do not.
- **Resource prediction on screen:** the rolling one-minute forecast from v3
  extended to power, with alerts when the forecast crosses a limit.
- **Fleet tab:** connect to a MachineForge host, make differently sized
  machines with the agent inside, launch a campaign across them.
- **GPU designs** in the Designer and CPU-vs-GPU at equal cost and power.
- **Webhooks** (run / campaign finished, regression detected) and scheduled
  campaigns; a `cpullm` CLI generated from the OpenAPI document.
- **Measured placement sweeps** from the Planner.

Nothing in this list is live yet; the version bar tells you which version you
are using.
