# CPU-LLM roadmap: v3 → v7

Goal: a production-ready, one-stop platform that hardware vendors, performance
teams and platform teams adopt for **measuring, designing, planning, powering
and operating LLM inference on CPUs (and the GPUs they compare against)**.
Each version is a stable release at `/vN` with a feature page at
`/vN/features/`, release notes in `docs/releases/`, and the previous versions
kept online.

| Version | Theme | Status |
|---|---|---|
| v1 | Tuning: measure, tune, recipes, compare, admin, one-line agent | archived (served) |
| v2 | Design lab: Designer, Planner, Insights, AI advisor | previous stable |
| v3 | Operations and trust: campaigns, regression tracking, exports, audit, metrics, OpenAPI, live forecast | archived (served) |
| v4 | Workloads and power: open-source CPU/GPU benchmark suite, power optimiser (RAPL + dynamic cores) | archived (served) |
| v5 | Enterprise readiness: API keys with roles, API-key-only mode, backup/restore, hardening, operations guide | previous stable |
| **v6** | **GPU everywhere**: GPU inventory and telemetry, tune / benchmarks / power-limit sweeps / campaigns on the GPU, CUDA-aware installers, the problem statement on the Overview; MachineForge v0.2 GPU scheduling | **stable** |
| v7 | OIDC SSO, retention policies, Fleet tab (MachineForge), GPU designs, webhooks, scheduled campaigns, CLI, measured placement sweeps, ROCm telemetry | preview |

## v6: GPU everywhere (shipped)

Every GPU the driver sees is a first-class part of the machine: listed with
driver, memory, power limits and PyTorch usability; sampled at 1 Hz
(utilisation, VRAM, board power) with the one-minute forecast; available as
the device in Tune, Benchmarks (with *Run on CPU and GPU*), Power (board
power-limit sweep) and Campaigns. Installers pick the CUDA build of PyTorch
on hosts with `nvidia-smi` (`CPULLM_DEVICE` overrides). The Overview opens
with *What this solves*. Guide: `/docs/gpu/`.

## v3: operations and trust (shipped)

Campaigns (machines × models, per-machine queues, result matrix), regression
tracking against earlier runs with noise bands, exports (JSON/CSV), audit log,
`/metrics`, OpenAPI + `docs/API.md`, rolling one-minute forecast on live
telemetry, Measure it from the Planner, affinity-aware agent core count.

## v4: workloads and power

1. **Benchmark suite** (agent `cpullm/suite.py`, job kind `benchmark`):
   STREAM copy/scale/add/triad; GEMM TFLOPS fp32/bf16/int8 at several sizes;
   SDPA attention tokens/s at 1k–32k context; embedding/gather GB/s; model
   prefill and decode for the standard models. CPU and CUDA/ROCm on the same
   agent. Results comparable across machines in a **Benchmarks** tab and
   usable as campaign presets; roofline placement of every kernel.
2. **Power optimiser** (agent `cpullm/power.py`, job kind `power`):
   - telemetry: RAPL package/core/DRAM energy (Linux powercap, Intel and AMD),
     watts and joules per token streamed with the 1 Hz samples; estimated
     from TDP × utilisation and labelled *estimated* where counters are
     missing (Windows, most VMs, WSL);
   - control: affinity-based active-core scaling (works everywhere, no
     privileges); on Linux hosts with permission, `sysfs` core online/offline
     and cpufreq governor / EPP;
   - optimiser: for a workload, sweep active cores (and SMT on/off) and
     thread counts, measure tok/s, W, tok/J; recommend the operating point
     for *performance*, *balanced* or *efficiency*; apply it for the run and
     restore afterwards; results and the power curve on a **Power** tab.
3. **Resource prediction**: the v3 forecast extended to power and to
   alerts ("memory full in 40 s", "power above cap in 20 s").
4. **Fleet tab** (MachineForge): capacity, make sized machines with the agent
   inside, launch a campaign across them.
5. **GPU designs** in the Designer; CPU vs GPU at equal cost and power.
6. **Webhooks**, **scheduled campaigns**, **`cpullm` CLI** from OpenAPI,
   **measured placement sweeps**.

## v5: enterprise readiness

Roles (admin / engineer / viewer) and named API keys with rotation; OIDC
sign-in mapping groups to roles with local break-glass; backup and restore of
settings, agents, runs, campaigns and audit; retention policies per campaign
and machine; hardening (security headers, per-key rate limits, CSRF, secrets
at rest, dependency scanning, SBOM); operations guide (HA, upgrade/rollback,
Grafana dashboards, SLOs); adoption kit (brochure, evaluation checklist,
reference architectures, training).

## Held for later

Training projections and distributed-training planning; shared model zoo of
measured results (opt-in); public report pages; cost centres and chargeback;
plugin SDK for custom benchmarks; Windows/macOS MachineForge hosts.
