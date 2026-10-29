// Analytical performance model for LLM decode on CPUs and GPUs.
//
// One decode step for a batch of B sequences must
//   * read every *active* weight once (shared by the whole batch), and
//   * read each sequence's KV cache (context × bytes per token),
//   * do ~2 FLOPs per active parameter per sequence.
// Step time is bounded below by whichever resource saturates first:
//
//   t_step = max( (W_active + B·ctx·KV) / bandwidth ,  2·P_active·B / FLOPS )
//
// At small batch the memory term dominates (decode is bandwidth bound); as
// batch grows the compute term catches up. The batch where they cross is the
// "knee". It sits far lower on CPUs than on GPUs, which is the main reason
// GPUs win at high-throughput serving and CPUs stay competitive at batch 1.

export const BYTES_PER_PARAM = {
  fp32: 4,
  bf16: 2,
  fp16: 2,
  int8: 1 + 2 / 128, // weights + per-group scales
  int4: 0.5 + 2 / 32,
}

// Public architecture numbers from each model's config.json.
// `hub` is the Hugging Face id the tuner runs, so a projection can be measured.
export const MODELS = [
  { id: 'smollm2-135m', name: 'SmolLM2 135M', hub: 'HuggingFaceTB/SmolLM2-135M', params_b: 0.135, active_b: 0.135, layers: 30, kv_heads: 3, head_dim: 64 },
  { id: 'qwen2.5-0.5b', name: 'Qwen2.5 0.5B', hub: 'Qwen/Qwen2.5-0.5B', params_b: 0.494, active_b: 0.494, layers: 24, kv_heads: 2, head_dim: 64 },
  { id: 'llama3.2-1b', name: 'Llama 3.2 1B', hub: 'meta-llama/Llama-3.2-1B', params_b: 1.24, active_b: 1.24, layers: 16, kv_heads: 8, head_dim: 64 },
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B', hub: 'meta-llama/Llama-3.1-8B', params_b: 8.03, active_b: 8.03, layers: 32, kv_heads: 8, head_dim: 128 },
  { id: 'mixtral-8x7b', name: 'Mixtral 8x7B (MoE)', params_b: 46.7, active_b: 12.9, layers: 32, kv_heads: 8, head_dim: 128 },
  { id: 'llama3.1-70b', name: 'Llama 3.1 70B', params_b: 70.6, active_b: 70.6, layers: 80, kv_heads: 8, head_dim: 128 },
]

// Nominal vendor-spec numbers (dense bf16 TFLOPS, peak memory bandwidth,
// max memory, TDP). Approximate; CPU TFLOPS are estimated from cores × clock
// × FMA width. Edit or add your own platforms in the Lab.
export const PLATFORMS = [
  { id: 'ryzen-7950x', name: 'AMD Ryzen 9 7950X', kind: 'cpu', bandwidth_gbs: 83, tflops: 5, memory_gb: 192, watts: 170 },
  { id: 'epyc-9654', name: 'AMD EPYC 9654 (Genoa, 1S)', kind: 'cpu', bandwidth_gbs: 461, tflops: 18, memory_gb: 1536, watts: 360 },
  { id: 'epyc-9965', name: 'AMD EPYC 9965 (Turin, 1S)', kind: 'cpu', bandwidth_gbs: 614, tflops: 50, memory_gb: 3072, watts: 500 },
  { id: 'rtx-4090', name: 'NVIDIA RTX 4090', kind: 'gpu', bandwidth_gbs: 1008, tflops: 165, memory_gb: 24, watts: 450 },
  { id: 'h100-sxm', name: 'NVIDIA H100 SXM', kind: 'gpu', bandwidth_gbs: 3350, tflops: 989, memory_gb: 80, watts: 700 },
  { id: 'mi300x', name: 'AMD Instinct MI300X', kind: 'gpu', bandwidth_gbs: 5300, tflops: 1307, memory_gb: 192, watts: 750 },
]

export function kvBytesPerToken(model, kvBytes = 2) {
  return 2 * model.layers * model.kv_heads * model.head_dim * kvBytes // K and V
}

// Fraction of peak a real system sustains. Defaults are typical, not measured.
export const DEFAULT_EFFICIENCY = { cpu: { bw: 0.7, compute: 0.5 }, gpu: { bw: 0.85, compute: 0.6 } }

export function predict(model, platform, { precision = 'bf16', batch = 1, context = 1024, kvBytes = 2, efficiency } = {}) {
  const eff = efficiency || DEFAULT_EFFICIENCY[platform.kind] || DEFAULT_EFFICIENCY.cpu
  const bpp = BYTES_PER_PARAM[precision]
  const weightsRead = model.active_b * 1e9 * bpp
  const kvRead = batch * context * kvBytesPerToken(model, kvBytes)
  const bw = platform.bandwidth_gbs * 1e9 * eff.bw
  const flops = platform.tflops ? platform.tflops * 1e12 * eff.compute : Infinity
  const tMem = (weightsRead + kvRead) / bw
  const tCompute = (2 * model.active_b * 1e9 * batch) / flops
  const step = Math.max(tMem, tCompute)
  const memoryNeeded = model.params_b * 1e9 * bpp + kvRead
  const aggregate = batch / step
  return {
    step_ms: step * 1000,
    per_sequence_tps: 1 / step,
    aggregate_tps: aggregate,
    bound: tMem >= tCompute ? 'memory' : 'compute',
    memory_needed_gb: memoryNeeded / 1e9,
    fits: !platform.memory_gb || memoryNeeded / 1e9 <= platform.memory_gb,
    tokens_per_joule: platform.watts ? aggregate / platform.watts : null,
    knee_batch: kneeBatch(model, platform, { precision, context, kvBytes, efficiency: eff }),
  }
}

// Smallest batch at which compute time reaches memory time (Infinity if never).
export function kneeBatch(model, platform, { precision = 'bf16', context = 1024, kvBytes = 2, efficiency } = {}) {
  const eff = efficiency || DEFAULT_EFFICIENCY[platform.kind] || DEFAULT_EFFICIENCY.cpu
  if (!platform.tflops) return Infinity
  const bw = platform.bandwidth_gbs * 1e9 * eff.bw
  const flops = platform.tflops * 1e12 * eff.compute
  const W = model.active_b * 1e9 * BYTES_PER_PARAM[precision]
  const kv = context * kvBytesPerToken(model, kvBytes)
  const perSeqCompute = (2 * model.active_b * 1e9) / flops
  // W/bw + B·kv/bw = B·perSeqCompute  →  B = (W/bw) / (perSeqCompute − kv/bw)
  const denom = perSeqCompute - kv / bw
  return denom <= 0 ? Infinity : Math.max(1, (W / bw) / denom)
}

export function sweepBatch(model, platform, opts, batches = [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
  return batches.map((b) => ({ batch: b, ...predict(model, platform, { ...opts, batch: b }) }))
}
