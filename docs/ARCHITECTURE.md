# CPU-LLM architecture and roadmap

## Positioning: what "faster than GPU" can honestly mean

At batch size 1, generating each token streams every weight through memory
once, so decode speed is bounded by

    tokens/s  ≤  memory bandwidth ÷ bytes per token

A 12-channel EPYC Genoa has ~460 GB/s; an MI300X has ~5,300 GB/s. For the same
model in the same format, no CPU trick beats an 11× bandwidth gap. A claim of
"faster than GPU" in general will not survive peer review or a semiconductor
customer's lab.

These claims *are* defensible, and they're what the product should sell:

1. **Cost and energy per token.** Tokens/s per dollar and per watt on hardware
   customers already own, including GPUs left idle at low utilisation.
2. **Capacity.** A dual-socket EPYC holds terabytes of DDR5. Models that don't
   fit in a GPU's 24–192 GB run on CPU without multi-GPU sharding or PCIe
   offload, where the CPU often *does* win.
3. **Bytes per token, not FLOPs.** Every transform the tuner applies (lower
   precision, pruning, sparse MoE routing, smaller students) reduces bytes per
   token, which moves CPU decode much closer to GPU decode for a given
   use case.
4. **Latency for small, specialised models.** Interactive batch-1 workloads
   on a distilled, quantised task model can beat a GPU round trip once you
   include PCIe transfers, kernel launch overheads and queueing.

## System design

```
┌──────────── frontend (React, separate deployable) ──────────┐
│ Hardware card · Tuning form · Live telemetry · Results/charts│
└──────────────▲ HTTP /api/*            ▲ WebSocket /api/telemetry
               │                        │
┌──────────────┴────────── backend (FastAPI) ──────────────────┐
│ hardware.py   profile + fingerprint + bandwidth probe        │
│ telemetry.py  psutil sampler (CPU/mem/disk/net rates)         │
│ models.py     HF loader (revision pinned) + built-in tiny     │
│ transforms.py prune_layers · quantize_dynamic · cast · …      │
│ bench.py      prefill/decode timing · perplexity · agreement  │
│ tuner.py      search space → constrained best config          │
│ roofline.py   bandwidth bound, CPU/GPU reference platforms    │
│ recipe.py     portable recipe build/apply                     │
│ report.py     report.md + bundle.zip                          │
│ reproduce.py  CLI: rebuild + re-verify on any machine         │
└───────────────────────────────────────────────────────────────┘
```

**Why the backend stays in Python.** Every tool the tuner relies on
(PyTorch, Hugging Face, torchao, PEFT/LoRA, ONNX Runtime, ZenDNN, llama.cpp
bindings) is Python-first. A Node backend would just shell out to Python.
What makes the product portable is the **recipe format**, not the backend
language: `recipe.json` is plain data, and any runtime can implement it
(including a future C++/llama.cpp or ONNX executor).

**Recipe = rebuild framework.** A recipe pins the model revision, an ordered
list of pure transforms, runtime settings and the expected metrics. Replaying
it is deterministic for accuracy and size (verified in the POC: identical
perplexity and byte count); speed is re-measured and compared.

## Findings from the POC (SmolLM2-135M, 4-vCPU cloud VM)

- **Warm-up matters.** Without a full-length warm-up the first configuration
  measured 3× slower, which would have produced fake "speedups".
- **Blind layer pruning destroys small models** (4 of 30 layers → perplexity
  48 → 200,000). Choosing layers by **measured redundancy** (input/output
  cosine similarity) brought 2 dropped layers down to +15% perplexity. The
  remaining loss is what LoRA "healing" or distillation is for.
- **int8 dynamic quantisation** (activations quantised too) costs +72–98%
  perplexity on a 135M model; per-channel scales and keeping `lm_head` in
  float help. Weight-only int8 is the right fit for bandwidth-bound decode,
  but PyTorch's stock CPU kernel was 3.5× *slower* than fp32 on AVX-512 without
  AMX. That gap is a concrete opportunity for custom kernels.
- **bf16 halves the model** at ~0.1% perplexity cost and was the best
  configuration, even though it's emulated on this CPU (no AVX512_BF16).
- **Isolation is mandatory.** The same recipe ran at 11.5 tok/s while a
  browser rendered the dashboard on the same 4 vCPUs, and 27 tok/s alone. In
  production, the benchmark host must not serve the UI, and runs need pinned
  cores.

## Roadmap

| Phase | Scope |
|---|---|
| **0: POC (this repo)** | Profiling, telemetry, precision/int8/pruning sweep, roofline, recipes |
| **1: Real kernels** | Runtime backends: llama.cpp (GGUF Q4/Q8), ONNX Runtime, AMD ZenDNN / zentorch, IPEX; int4 weight-only (torchao); thread/NUMA/CCD pinning sweeps; `perf`/uProf hardware counters (LLC misses, DRAM BW, IPC) |
| **2: Accuracy recovery** | LoRA / QLoRA healing after pruning and quantisation (PEFT), distillation into task-specific students, real evals (lm-eval-harness tasks, task-specific suites), OpenTelemetry traces per request |
| **3: Architecture reshaping** | Width pruning (heads/FFN channels), MoE expert pruning and routing tuned to cache/CCD topology, KV-cache quantisation, speculative decoding with a CPU-sized draft model |
| **4: Product** | Multi-machine fleet benchmarking, a CPU vs GPU comparison lab on real hardware, signed recipes, recipe registry, per-SKU tuning profiles for silicon vendors |

## What semiconductor companies would pay for

- Per-SKU "best known configuration" reports generated automatically for
  each new CPU (Zen 5, Zen 6, …), with reproducible recipes.
- Evidence of competitive tokens/s per dollar and per watt versus GPUs for
  defined workloads: marketing and sales-engineering collateral.
- A regression harness for compiler, kernel and firmware changes (BIOS
  memory settings, NPS modes, SMT, C-states) that measures their effect on
  LLM throughput.
