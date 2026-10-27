# Research paper plan

**Working title:** *Bytes per Token: Hardware-Aware Transformation of LLMs for
Bandwidth-Bound CPU Inference*

## Thesis

Batch-1 LLM decode on CPUs is memory-bandwidth bound. A tuner that jointly
picks model transforms (precision, depth/width pruning, expert pruning,
distilled students) and system settings (threads, NUMA/CCD placement), under
an explicit accuracy budget, closes most of the gap to the CPU's bandwidth
roofline. For defined workloads it also reaches GPU-competitive tokens/s per
dollar and per watt. Results ship as reproducible recipes.

## Contributions

1. A roofline-based performance model for CPU LLM decode, validated across
   AMD Zen 3/4/5 desktop and EPYC parts (achieved fraction of measured
   bandwidth per configuration).
2. A constrained search over transforms × runtime settings, with accuracy
   measured (perplexity, task evals, greedy agreement), not assumed.
3. A portable recipe format that rebuilds tuned models deterministically,
   with reproduction results across machines.
4. An empirical study: which transforms pay off on which ISA features
   (AVX2, AVX-512, VNNI, BF16, AMX) and memory systems (channels, NPS modes).

## Experiments

| Axis | Values |
|---|---|
| Hardware | Ryzen 7950X/9950X, EPYC Genoa/Turin (NPS1/NPS4); reference GPUs (RTX 4090, MI300X/H100 where available) |
| Models | SmolLM2 135M/360M/1.7B, Llama-3.2 1B/3B, Qwen2.5 0.5–7B, one MoE (e.g. OLMoE / Mixtral) |
| Transforms | fp32 / bf16 / int8 / int4 weight-only, depth pruning (redundancy-ranked vs positional), LoRA healing, distilled student |
| Runtimes | PyTorch eager, zentorch, llama.cpp, ONNX Runtime |
| Metrics | TTFT, decode tok/s, % of bandwidth roofline, J/token, $/Mtoken, perplexity, task accuracy |

## Methodology checklist

- Pinned model revisions; recipes published as artifacts.
- Warm-up to steady state, median of ≥5 runs, report variance.
- Isolated benchmark host (no UI or other load), fixed frequency governor,
  documented BIOS settings.
- Energy from RAPL / AMD uProf (CPU) and nvidia-smi / rocm-smi (GPU).
- Honest baselines: tuned llama.cpp and vendor-optimised GPU stacks, not
  untuned eager PyTorch.

## Outline

1. Introduction: cost and capacity case for CPU inference
2. Background: transformer decode, memory hierarchy, CPU vs GPU architecture
3. Performance model: bandwidth roofline, prefill vs decode
4. System: profiler, transform library, tuner, recipes
5. Evaluation (above)
6. Discussion: where CPUs win, where they cannot, implications for silicon
   (memory channels, HBM on CPU, AMX-class matrix units)
7. Related work: llama.cpp, DeepSpeed-Inference, IPEX/ZenDNN, LLM pruning
   (ShortGPT, Gromov et al. 2024, Sheared-LLaMA), quantisation (GPTQ, AWQ,
   SmoothQuant), distillation
8. Conclusion
