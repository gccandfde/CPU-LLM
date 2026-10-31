# CPU-LLM v6: stable

**Stable version.** Everything in [v5](/v5/features/) (tuning, design lab,
campaigns, benchmark suite, power optimiser, API keys and roles, backup and
restore) plus **GPUs as first-class machines** and a dashboard that says what
problem it solves. Data and machines are shared with the earlier versions.

## GPU everywhere

- **Machines:** every GPU the driver sees is listed with driver version,
  memory, compute units, measured copy bandwidth, current and maximum power
  limit, and whether the installed PyTorch can use it. A GPU the CPU build of
  PyTorch cannot see is shown as **driver only** with the one-line fix.
- **Live telemetry** adds GPU utilisation, VRAM and board power at 1 Hz, with
  the same one-minute forecast as CPU and memory.
- **Tune → Device: GPU** (CUDA and ROCm) with the GPU-only precisions (fp16,
  int4 weight-only) enabled and thread counts hidden.
- **Benchmarks:** the suite on the GPU with identical sizes, and **Run on CPU
  and GPU** to queue both back to back on the same machine.
- **Power → Device: GPU:** a board power-limit sweep (max, 85 %, 70 %, 55 %
  or your own list) with decode speed and board power from the driver at each
  step, performance / balanced / efficiency recommendations, and an honest
  single point when the limit cannot be changed (no root, WSL 2).
- **Campaigns → Device: GPU** builds the matrix from machines with a usable
  GPU only; the CSV carries the device.
- **Installer:** Linux/WSL/containers install the CUDA build automatically
  when `nvidia-smi` is present; `CPULLM_DEVICE=cpu|cuda` overrides, Windows
  opts in with `$env:CPULLM_DEVICE='cuda'`.
- **Metrics:** `cpullm_agent_gpus{machine,usable}`.
- **GPU guide** at `/docs/gpu/`, linked from the Guide tab, the footer and
  every GPU hint.

## The problem, on the first screen

The Overview opens with **What this solves**: four problems (nobody knows
what an LLM really does on the hardware they own; threads, precision, NUMA
and cores set by guesswork; CPU-vs-GPU and vendor comparisons as slide-deck
arguments; buying and designing hardware without data), each linking to the
tab that answers it and to the industry-by-industry page at `/problems/`.
The KPI row gains **GPUs in the fleet**.

## Fixes

- `/metrics` no longer fails when benchmark or power runs exist.
- Overview and run lists show the device for every run kind.

## MachineForge v0.2

Companion release: GPU scheduling per machine (whole GPU by index or a
time-sliced share), GPU utilisation in the host monitor and the capacity
card, NVIDIA Container Toolkit installer. See the MachineForge release notes.
