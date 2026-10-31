# Using GPUs with CPU-LLM

CPU-LLM measures LLM inference on the hardware you own. From v6 that includes
the GPU in every machine, with the same agent, the same workloads and the same
dashboard, so a CPU and a GPU are compared on equal terms.

## What runs on the GPU

| Tab | On a GPU |
|---|---|
| **Machines** | The GPU is listed with driver, memory, compute units, measured copy bandwidth, current and maximum power limit, and whether PyTorch can use it. Live telemetry adds GPU utilisation, VRAM and board power with the same one-minute forecast as CPU and memory. |
| **Tune** | Device → GPU. Precisions fp32, bf16, fp16, int8 weight-only and int4 weight-only (torchao); thread counts do not apply. Results, recipes and bundles are the same shape as CPU runs. |
| **Benchmarks** | Device → GPU runs STREAM, GEMM (fp32/fp16/bf16), attention and gather on the GPU with identical sizes. **Run on CPU and GPU** queues both back to back for the fairest comparison. |
| **Power** | Device → GPU sweeps the board power limit (max, 85 %, 70 %, 55 %, or your list) and measures decode speed and board power from the driver at each step; recommends performance, balanced and efficiency points. |
| **Campaigns** | Device → GPU builds the matrix only from machines with a usable GPU. |
| **Compare, Runs, Insights** | GPU runs appear next to CPU runs; the device is a column everywhere. |
| **Architecture Lab, Planner** | Already model GPU memory systems; measured GPU bandwidth from connected machines feeds the calibration. |

## Installing the agent with GPU support

PyTorch ships separate builds. The CPU build is small and cannot see a GPU;
the CUDA build is a few GB.

| Platform | Default | Override |
|---|---|---|
| Linux, WSL 2, containers | CUDA build when `nvidia-smi` is on the PATH, CPU build otherwise | `CPULLM_DEVICE=cpu` forces the CPU build; `CPULLM_DEVICE=cuda` forces CUDA and upgrades a CPU-only install |
| Windows | CPU build (the installer prints a hint when it sees `nvidia-smi`) | `$env:CPULLM_DEVICE='cuda'` before `irm …` |
| macOS | CPU build (no CUDA) | — |

Examples:

```
# Linux / WSL 2, force the CUDA build
CPULLM_DEVICE=cuda CPULLM_TOKEN='…' curl -fsSL https://cpullm.gccandfde.com/install/agent.sh | bash

# Windows
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CPULLM_DEVICE='cuda'; $env:CPULLM_SERVER='https://cpullm.gccandfde.com'; $env:CPULLM_TOKEN='…'; irm https://cpullm.gccandfde.com/install/agent.ps1 | iex"
```

A machine whose driver sees a GPU but whose PyTorch cannot still reports the
GPU (**driver only** under Machines) so you know the hardware is there; Tune,
Benchmarks and Power say what to do.

Requirements: an NVIDIA driver recent enough for the CUDA build you install
(the agent uses the default PyPI wheel, CUDA 12.x). On WSL 2 the Windows
driver is enough. ROCm: PyTorch's ROCm wheels use the same `cuda` device
name and work for runs and benchmarks; GPU telemetry and the power-limit
sweep use `nvidia-smi` today, so on ROCm hosts those two show nothing.

## Telemetry fields

Agents with `nvidia-smi` add these to every one-second sample:

```
gpu_percent, gpu_mem_used_gb, gpu_mem_total_gb, gpu_power_w, gpu_temp_c,
gpus: [{ index, name, util_percent, mem_used_gb, mem_total_gb, power_w, temp_c, sm_mhz }]
```

## Power optimiser on a GPU

`POST /api/jobs` with `kind: "power", device: "cuda"`, optional
`power_limits: [115, 95, 80, 65]` (watts) and `gpu_index`. The agent sets
each limit with `nvidia-smi -pl`, runs the decode benchmark while sampling
`power.draw`, and restores the original limit. Setting the limit needs root
(or administrator) and is not supported on WSL 2; in that case the run
measures one point at the current limit and the result carries
`control: "none"` with a note. Results: `points[{limit_w, decode_tps,
ttft_ms, watts, tokens_per_joule}]`, `recommendation`, `gpu`,
`energy_source: nvidia-smi`.

## GPU machines in MachineForge

MachineForge can hand a machine the whole GPU or a time-sliced share
(`gpu_mode: whole | shared`, `gpu_index`). The host needs the NVIDIA
Container Toolkit; the installer ships `scripts/install-nvidia-toolkit.sh`
and `MF_GPU=1` runs it. With **Install the CPU-LLM agent inside** ticked, the
machine installs the CUDA build automatically (it sees `nvidia-smi`) and
appears here with its GPU.

## Limits and what is next

- One GPU per run (`gpu_index`); multi-GPU tensor parallel is not modelled.
- FP8 / NVFP4 kernels are not in the suite yet.
- GPU designs (equal-cost, equal-power CPU vs GPU) in the Designer are on
  the roadmap (`/docs/roadmap/`).
