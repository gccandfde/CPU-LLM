# Problems companies and industries face with LLMs on hardware, and the solution

Collected from vendor tuning guides, GitHub discussions, community threads,
serving papers and cost analyses (sources on the [v2 feature page](/v2/features/)),
and from what engineers ask when they evaluate CPUs, GPUs and deployments.
For each problem: **what CPU-LLM / MachineForge does today** (with the tab or
version) and **what is still missing** (planned, see `/v6/features/`).

## 1. CPU vendors (AMD, Intel, Arm, Qualcomm, RISC-V houses)

| Problem | Today | Still missing |
|---|---|---|
| "Can a CPU serve LLMs at all?" is answered with marketing slides, not reproducible numbers customers can rerun | Tune tab measures real decode/prefill per precision with noise bands; every run ships a **recipe + bundle** anyone reruns; Campaigns give the matrix across SKUs | Public, signed report pages a vendor can link from a datasheet |
| Customers misconfigure NUMA (NPS1/NPS4), threads and memory population, then blame the silicon | **Planner → NUMA placement / thread count** with *Measure it*; Insights calibration shows achieved vs spec bandwidth per machine | Automatic BIOS/kernel-setting advice from the measured profile |
| Spec-sheet bandwidth vs what decode gets is a recurring dispute | Agent measures streaming-read bandwidth; **Benchmarks → STREAM**; Insights shows the achieved fraction per run | Per-SKU calibration classes shared across installs (opt-in model zoo) |
| Pre-silicon: "what if we add two channels, double L3, add a matrix unit?" | **Designer**: die / cache / NUMA-level sliders, roofline with vector + matrix ceilings, design-space grid, scale-out planner | Cycle-level import (gem5/SST traces) to tighten the first-order model |
| Performance-per-watt claims need measured energy, not TDP | **Power tab**: RAPL-measured watts, tok/J curves, recommended operating points | Chassis/PDU power for whole-system tok/J |

## 2. GPU and accelerator vendors (NVIDIA, AMD Instinct, startups)

| Problem | Today | Still missing |
|---|---|---|
| Fair comparison against CPUs and rivals on the customer's own workload | Same agent runs the **benchmark suite on CPU and CUDA/ROCm** with identical sizes; Compare and Benchmarks put them side by side | Equal-cost / equal-power normalisation in the Designer (GPU designs, v6) |
| Capacity: KV cache exhausts memory before compute saturates | **Planner → Serving**: users that fit, compute knee, prefill/decode split, disaggregation hint | Multi-GPU and tensor-parallel fabric modelling |
| Customers cannot tell quantisation wins from dequantisation overhead | **Planner → quantisation pay-off** per precision; tuner measures speed *and* perplexity/accuracy per config | Format-specific kernels (FP8/NVFP4) in the suite |

## 3. Enterprises running LLMs on-prem (banks, telcos, healthcare, government)

| Problem | Today | Still missing |
|---|---|---|
| Sizing and build-vs-buy: "how many boxes, what does a token cost us?" | **Planner → Cost per million tokens** and break-even volume; scale-out planner; serving concurrency sweep | Multi-site capacity plan from several hosts' measured runs |
| Idle capacity is the real cost driver | Cost page shows utilisation effect; Power optimiser finds the efficient core count for quiet hours | Scheduled core/power profiles applied automatically (webhooks + scheduler, v6) |
| A kernel, firmware or framework update silently slows inference | **Campaigns** with regression verdicts; nightly matrix from cron (docs/API.md) | Alerts to Slack/Teams on `regressed` (webhooks, v6) |
| Auditability and compliance: who changed what, where did this number come from | **Audit log**, recipes and bundles per run, API keys with roles, backup/restore, security headers (v3–v5) | OIDC SSO with group-to-role mapping, retention policies and legal hold (v6) |
| Air-gapped sites | Agents connect outbound only; built-in model needs no internet; one archive backups | Offline model mirror configuration in Admin |

## 4. Cloud, hosting and datacenter operators

| Problem | Today | Still missing |
|---|---|---|
| Choosing instance types and CPU generations for inference tiers | Benchmark suite + tuner across the fleet; compare-machines table; cost per token per machine | Instance price import to rank $/M tokens automatically |
| Power caps and energy bills | Power optimiser with measured watts; tok/J in every power run; live power in telemetry on RAPL hosts | Rack-level caps and PDU integration |
| Noisy neighbours ruin benchmarks and SLAs | **MachineForge**: pinned-core, hard-memory-limit machines with no over-commit; the CPU-LLM agent inside each | Pods and VMs (MachineForge phase 2), multi-host pool (phase 3) |
| Capacity planning from live usage | One-minute rolling forecast of CPU and memory on every machine | Longer horizons, power in the forecast, threshold alerts |

## 5. Server OEMs and system integrators (Dell, HPE, Lenovo, Supermicro, white-box)

| Problem | Today | Still missing |
|---|---|---|
| Validating memory population, MRDIMM/channel configs and BIOS defaults for AI SKUs | STREAM + decode per configuration; Designer sweep of channels per node; calibration against measured bandwidth | Automatic BIOS-setting capture into the hardware profile |
| Producing customer-facing benchmark reports per configuration | Markdown report + reproducible bundle per run; campaign CSV export; OpenAPI for report pipelines | Branded PDF report generator |
| Firmware regression across a product line | Campaigns across machines with verdicts | Per-machine presets in a campaign (v6) |

## 6. PC and edge OEMs (AI PCs, workstations, embedded)

| Problem | Today | Still missing |
|---|---|---|
| Which small model and precision fit a laptop's memory and thermals | Tune tab with accuracy budgets; Power optimiser finds the efficient core count (battery life) | NPU backends; thermal throttling capture over long runs |
| Affinity/SMT choices on hybrid cores | `usable_cores`, thread sweeps, Planner thread curve | Per-core-type (P/E) scheduling advice |

## 7. Semiconductor architecture and VLSI teams

| Problem | Today | Still missing |
|---|---|---|
| Existing roofline tools cannot change bandwidth, memory or compute | **Designer** parameterises all of it; roofline with DRAM, L3, vector and matrix ceilings | Area and power models per block to trade die area against tok/s |
| Correlating the analytical model to silicon | Insights calibration: projected vs measured for every run, one click applies the achieved efficiency | Automatic per-SKU calibration and confidence bands on every projection |
| Workload coverage beyond one model | Standard models plus custom (params, layers, KV heads); suite kernels at fixed sizes | Trace-driven workloads from customer prompts |

## 8. ML platform and performance engineering teams

| Problem | Today | Still missing |
|---|---|---|
| Heterogeneous fleets, nobody knows which box runs what best | Machines, Compare, Benchmarks, benchmark matrix on Insights | Fleet tab to make sized machines and fill the matrix automatically (v6) |
| Reproducing a colleague's result | Recipes and bundles; API keys for CI; OpenAPI | `cpullm` CLI generated from the spec (v6) |
| Explaining a result to a non-specialist | AI advisor (Claude) with measurements and the design as context | Advisor citations to the exact runs used |

## 9. Research labs and universities

| Problem | Today | Still missing |
|---|---|---|
| Shared machines and fair experiments | MachineForge pinned machines on one host; open mode on localhost | Users and quotas (MachineForge phase 2) |
| Reproducible papers | Bundles, recipes, exports, versioned platform with archived versions | DOI-style permalinks for runs |

## 10. Sustainability and ESG reporting

| Problem | Today | Still missing |
|---|---|---|
| Energy per token is unmeasured and unreported | tok/J in power runs; `/metrics` for Prometheus | Energy accounting per campaign and per team over time |

## How to use this page

Pick your row, open the tab named in the middle column on the stable version,
and run it on one connected machine first (`/install/agent.ps1` or `.sh`). The
right-hand column is the roadmap; items marked v6 are being built in the
preview at `/v6`.
