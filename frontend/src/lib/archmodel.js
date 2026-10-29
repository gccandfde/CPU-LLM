// Architecture-level what-if model for LLM inference: design a CPU (dies,
// cores, vector units, caches, NUMA nodes, memory channels, fabric), pin a
// workload to it, and project speed, fit, energy and scale-out needs.
//
// Everything here is analytical and first-order. It extends perfmodel.js
// (one decode step = read active weights + KV once, 2 FLOPs/param/sequence)
// with where the bytes come from:
//
//   bandwidth  = nodes × channels × GB/s per channel, scaled by the pinning
//                strategy (remote traffic is capped by the fabric)
//   compute    = dies × cores × GHz × FMA units × lanes(precision) × 2,
//                halved when the precision is not native
//   caches     = tell you what stays resident (KV per step vs L2/L3, one
//                layer's weights vs L3), which decides how much of the
//                bandwidth figure is believable
//
// Measured runs on the Compare tab are the ground truth these projections
// should be checked against.
import { BYTES_PER_PARAM, kvBytesPerToken } from './perfmodel.js'

// Common memory channel speeds (GB/s per 64-bit channel = MT/s × 8 / 1000).
export const CHANNEL_GBS = { 'DDR4-3200': 25.6, 'DDR5-4800': 38.4, 'DDR5-5600': 44.8, 'DDR5-6400': 51.2, 'DDR5-8000': 64, 'LPDDR5X-8533': 68.3, 'HBM3 stack': 819 }

export const PINNING = {
  local: 'Each NUMA node runs its own replica on local memory (best bandwidth, memory ×nodes)',
  interleave: 'One model, threads on every node, memory interleaved (remote traffic crosses the fabric)',
  single: 'One model pinned to one node only (simplest, uses 1/N of the machine)',
}

// Element bits per lane for compute; "native" says which ISA bit enables it.
const LANE_BITS = { fp32: 32, bf16: 16, fp16: 16, int8: 8, int4: 8 } // int4 weights compute in int8
const NATIVE = { fp32: () => true, bf16: (d) => d.isa.bf16, fp16: (d) => d.isa.bf16, int8: (d) => d.isa.vnni, int4: (d) => d.isa.vnni }

export const DESIGNS = [
  {
    id: 'ryzen9-8940hx', name: 'AMD Ryzen 9 8940HX (laptop)', dies: 2, coresPerDie: 8, smt: 2, clockGhz: 4.0, fmaUnits: 1, fmaWidthBits: 512,
    isa: { bf16: true, vnni: true, amx: false }, l1dKb: 32, l2Kb: 1024, l3MbPerDie: 16, l3Gbs: 600,
    numaNodes: 1, channelsPerNode: 2, channel: 'DDR5-5600', capacityGbPerNode: 64, fabricGbs: 64, fabricNs: 90, idleW: 15, tdpW: 55,
  },
  {
    id: 'ryzen9-9950x', name: 'AMD Ryzen 9 9950X (desktop)', dies: 2, coresPerDie: 8, smt: 2, clockGhz: 4.8, fmaUnits: 2, fmaWidthBits: 512,
    isa: { bf16: true, vnni: true, amx: false }, l1dKb: 48, l2Kb: 1024, l3MbPerDie: 32, l3Gbs: 900,
    numaNodes: 1, channelsPerNode: 2, channel: 'DDR5-5600', capacityGbPerNode: 192, fabricGbs: 64, fabricNs: 90, idleW: 25, tdpW: 170,
  },
  {
    id: 'epyc-9654', name: 'AMD EPYC 9654 (Genoa, 1 socket, NPS4)', dies: 12, coresPerDie: 8, smt: 2, clockGhz: 3.0, fmaUnits: 1, fmaWidthBits: 512,
    isa: { bf16: true, vnni: true, amx: false }, l1dKb: 32, l2Kb: 1024, l3MbPerDie: 32, l3Gbs: 600,
    numaNodes: 4, channelsPerNode: 3, channel: 'DDR5-4800', capacityGbPerNode: 384, fabricGbs: 200, fabricNs: 110, idleW: 90, tdpW: 360,
  },
  {
    id: 'xeon-8592plus', name: 'Intel Xeon Platinum 8592+ (Emerald Rapids, 1 socket)', dies: 2, coresPerDie: 32, smt: 2, clockGhz: 2.9, fmaUnits: 2, fmaWidthBits: 512,
    isa: { bf16: true, vnni: true, amx: true }, l1dKb: 48, l2Kb: 2048, l3MbPerDie: 160, l3Gbs: 1200,
    numaNodes: 2, channelsPerNode: 4, channel: 'DDR5-5600', capacityGbPerNode: 2048, fabricGbs: 300, fabricNs: 80, idleW: 100, tdpW: 350,
  },
  {
    id: 'hbm-cpu-concept', name: 'Concept: 64-core CPU with 4 HBM3 stacks', dies: 4, coresPerDie: 16, smt: 2, clockGhz: 3.2, fmaUnits: 2, fmaWidthBits: 512,
    isa: { bf16: true, vnni: true, amx: true }, l1dKb: 48, l2Kb: 2048, l3MbPerDie: 64, l3Gbs: 1500,
    numaNodes: 1, channelsPerNode: 4, channel: 'HBM3 stack', capacityGbPerNode: 96, fabricGbs: 400, fabricNs: 70, idleW: 80, tdpW: 400,
  },
]

export const DEFAULT_WORKLOAD = { precision: 'bf16', batch: 1, context: 2048, prompt: 512, kvBytes: 2, pinning: 'local', threadsPerCore: 1, efficiency: { bw: 0.7, compute: 0.5, l3: 0.8 } }

const cores = (d) => d.dies * d.coresPerDie
const channelGbs = (d) => CHANNEL_GBS[d.channel] ?? Number(d.channel) ?? 0

// Peak numbers that follow from the design alone.
export function peak(d, precision = 'bf16') {
  const lanes = d.fmaWidthBits / LANE_BITS[precision]
  const native = NATIVE[precision](d)
  const opsPerCycle = d.fmaUnits * lanes * 2 * (native ? 1 : 0.5) * (precision === 'int8' || precision === 'int4' ? (d.isa.amx ? 4 : 2) : d.isa.amx && precision !== 'fp32' ? 4 : 1)
  return {
    cores: cores(d), threads: cores(d) * d.smt,
    tflops: cores(d) * d.clockGhz * 1e9 * opsPerCycle / 1e12,
    native,
    bandwidthGbs: d.numaNodes * d.channelsPerNode * channelGbs(d),
    bandwidthPerNodeGbs: d.channelsPerNode * channelGbs(d),
    capacityGb: d.numaNodes * d.capacityGbPerNode,
    l3Mb: d.dies * d.l3MbPerDie, l2Mb: cores(d) * d.l2Kb / 1024,
  }
}

// What the chosen pinning really gets from the memory system.
export function effectiveBandwidth(d, pinning) {
  const p = peak(d)
  if (d.numaNodes === 1 || pinning === 'single') return { gbs: p.bandwidthPerNodeGbs, replicas: 1, note: d.numaNodes === 1 ? 'single NUMA node' : `1 of ${d.numaNodes} nodes used` }
  if (pinning === 'local') return { gbs: p.bandwidthPerNodeGbs, replicas: d.numaNodes, note: `${d.numaNodes} replicas, one per node` }
  // interleave: 1/N of traffic is local, the rest must cross the fabric
  const remote = (d.numaNodes - 1) / d.numaNodes
  const gbs = Math.min(p.bandwidthGbs, d.fabricGbs / remote)
  return { gbs, replicas: 1, note: gbs < p.bandwidthGbs ? `fabric-limited: ${Math.round(remote * 100)}% of traffic is remote` : 'fabric keeps up' }
}

export function simulate(d, model, w = {}) {
  const wl = { ...DEFAULT_WORKLOAD, ...w, efficiency: { ...DEFAULT_WORKLOAD.efficiency, ...(w.efficiency || {}) } }
  const pk = peak(d, wl.precision)
  const eb = effectiveBandwidth(d, wl.pinning)
  const bpp = BYTES_PER_PARAM[wl.precision]
  const threadFrac = Math.min(1, wl.threadsPerCore / 1) // SMT adds little to FMA-bound loops
  const activeCores = wl.pinning === 'single' && d.numaNodes > 1 ? pk.cores / d.numaNodes : pk.cores / (wl.pinning === 'local' ? d.numaNodes : 1)
  const tflops = pk.tflops * (activeCores / pk.cores) * threadFrac * wl.efficiency.compute
  const bw = eb.gbs * 1e9 * wl.efficiency.bw

  const weightsRead = model.active_b * 1e9 * bpp
  const kvPerToken = kvBytesPerToken(model, wl.kvBytes)
  const kvRead = wl.batch * wl.context * kvPerToken
  const tMem = (weightsRead + kvRead) / bw
  const tCompute = (2 * model.active_b * 1e9 * wl.batch) / (tflops * 1e12)
  const step = Math.max(tMem, tCompute)
  const ttft = (2 * model.active_b * 1e9 * wl.prompt * wl.batch) / (tflops * 1e12) + weightsRead / bw

  const memoryNeeded = (model.params_b * 1e9 * bpp + kvRead) / 1e9
  const perReplicaCapacity = d.capacityGbPerNode * (wl.pinning === 'interleave' ? d.numaNodes : 1)
  const watts = d.idleW + (d.tdpW - d.idleW) * (activeCores * eb.replicas / pk.cores)
  const perSeq = 1 / step
  const aggregate = wl.batch * eb.replicas / step

  const layerWeightsMb = weightsRead / model.layers / 1e6
  const kvStepMb = kvRead / 1e6
  return {
    peak: pk, bandwidth: eb, tflopsEffective: tflops, bandwidthEffectiveGbs: bw / 1e9,
    step_ms: step * 1000, ttft_ms: ttft * 1000, per_sequence_tps: perSeq, aggregate_tps: aggregate,
    bound: tMem >= tCompute ? 'memory' : 'compute', utilisation: { memory: tMem / step, compute: tCompute / step },
    memory_needed_gb: memoryNeeded, fits: memoryNeeded <= perReplicaCapacity, replicas: eb.replicas,
    watts, tokens_per_joule: aggregate / watts,
    cache: {
      layerWeightsMb, layerInL3: layerWeightsMb <= pk.l3Mb * wl.efficiency.l3,
      kvStepMb, kvInL3: kvStepMb <= pk.l3Mb * wl.efficiency.l3, kvInL2: kvStepMb <= pk.l2Mb * wl.efficiency.l3,
      // How many times a step's weights exceed L3: >1 means weights stream from DRAM every step.
      l3Turnover: weightsRead / 1e6 / Math.max(1, pk.l3Mb),
    },
  }
}

// Replicas of this design needed to serve `targetTps` aggregate tokens/s, and what that costs.
export function scaleOut(d, model, w, targetTps) {
  const s = simulate(d, model, w)
  const perMachine = s.aggregate_tps
  const machines = Math.max(1, Math.ceil(targetTps / perMachine))
  return {
    machines, per_machine_tps: perMachine, total_tps: machines * perMachine,
    total_watts: machines * s.watts, total_memory_gb: machines * s.memory_needed_gb * s.replicas,
    total_cores: machines * s.peak.cores, fits: s.fits,
    // Fabric a tensor-parallel split would need per layer per step (all-reduce of hidden state, both ways).
    tp_fabric_gbs_hint: model.layers * 2 * (model.kv_heads * model.head_dim * 8) * 2 * w.batch * s.per_sequence_tps / 1e9,
  }
}

// Vary one design field and return the projection at each value.
export function sweep(d, model, w, key, values) {
  return values.map((v) => ({ value: v, ...simulate({ ...d, [key]: v }, model, w) }))
}

// Fields a designer can edit, with ranges for sliders and labels for the table.
export const FIELDS = [
  ['dies', 'Dies (CCDs)', 1, 16, 1], ['coresPerDie', 'Cores per die', 1, 64, 1], ['smt', 'Threads per core', 1, 2, 1], ['clockGhz', 'Clock GHz', 1, 6, 0.1],
  ['fmaUnits', 'FMA units per core', 1, 4, 1], ['fmaWidthBits', 'Vector width (bits)', 128, 1024, 128],
  ['l1dKb', 'L1d per core (KB)', 16, 128, 16], ['l2Kb', 'L2 per core (KB)', 256, 4096, 256], ['l3MbPerDie', 'L3 per die (MB)', 4, 512, 4], ['l3Gbs', 'L3 bandwidth GB/s', 100, 4000, 50],
  ['numaNodes', 'NUMA nodes', 1, 8, 1], ['channelsPerNode', 'Memory channels per node', 1, 12, 1], ['capacityGbPerNode', 'Memory per node (GB)', 8, 4096, 8],
  ['fabricGbs', 'Node fabric GB/s', 16, 2000, 16], ['fabricNs', 'Cross-node latency ns', 20, 300, 10],
  ['idleW', 'Idle power W', 5, 300, 5], ['tdpW', 'Max power W', 15, 1000, 5],
]

// ---------------------------------------------------------------------------
// Questions engineers keep asking (NUMA placement, thread counts, serving
// concurrency, roofline ceilings, quantisation pay-off, cost per token) and
// how far the first-order model can answer them. Sources behind each are in
// docs/versions/v2/features.md.

const coresPerNode = (d) => Math.max(1, Math.round(cores(d) / d.numaNodes))

// Every pinning strategy on this design, ranked by aggregate throughput, with
// the reasons a strategy is or is not usable (model larger than a node, fabric
// limited). Thread recommendation = cores of one node: beyond that, barrier
// cost and remote traffic grow faster than compute (see features doc).
export function placements(d, model, w = {}) {
  const rows = Object.keys(PINNING).map((pinning) => {
    const s = simulate(d, model, { ...w, pinning })
    const perNode = d.capacityGbPerNode
    const spills = s.memory_needed_gb > perNode
    let why = PINNING[pinning]
    if (pinning === 'local' && spills) why = `Not possible: the model (${s.memory_needed_gb.toFixed(0)} GB) does not fit one node (${perNode} GB)`
    if (pinning === 'single' && spills) why = `Not possible: the model does not fit one node (${perNode} GB)`
    if (pinning === 'interleave' && d.numaNodes > 1) why += s.bandwidth.gbs < s.peak.bandwidthGbs ? ` — ${s.bandwidth.note}` : ' — fabric keeps up'
    return { pinning, usable: !(spills && pinning !== 'interleave'), why, threads: pinning === 'interleave' ? s.peak.cores : coresPerNode(d), ...s }
  })
  rows.sort((a, b) => (b.usable - a.usable) || (b.aggregate_tps - a.aggregate_tps))
  return { rows, recommended: rows[0], coresPerNode: coresPerNode(d) }
}

// Throughput against thread count for one replica. Bandwidth takes a few
// cores to saturate (~12 GB/s each), SMT siblings add no FMA throughput, and
// threads beyond the local node pay a barrier + remote-traffic penalty every
// layer. Reproduces the "more threads got slower" curve people report.
export function threadSweep(d, model, w = {}, opts = {}) {
  const perCoreGbs = opts.perCoreGbs ?? 12
  const barrierUs = opts.barrierUs ?? 2
  const base = simulate(d, model, { ...w, pinning: 'single' })
  const node = coresPerNode(d)
  const physical = w.pinning === 'interleave' ? base.peak.cores : node
  const maxThreads = physical * d.smt
  const bpp = BYTES_PER_PARAM[w.precision || DEFAULT_WORKLOAD.precision]
  const bytes = model.active_b * 1e9 * bpp + (w.batch || 1) * (w.context || DEFAULT_WORKLOAD.context) * kvBytesPerToken(model, w.kvBytes || 2)
  const out = []
  for (let t = 1; t <= maxThreads; t++) {
    const activeCores = Math.min(t, physical)
    const crossNode = d.numaNodes > 1 && t > node && w.pinning !== 'interleave'
    const bwCap = Math.min(base.bandwidthEffectiveGbs, activeCores * perCoreGbs) * 1e9 * (crossNode ? 0.6 : 1)
    const flops = base.tflopsEffective * 1e12 * (activeCores / physical)
    const tMem = bytes / bwCap
    const tCompute = (2 * model.active_b * 1e9 * (w.batch || 1)) / flops
    const sync = model.layers * barrierUs * 1e-6 * Math.log2(t + 1) * (crossNode ? 3 : 1)
    const step = Math.max(tMem, tCompute) + sync
    out.push({ threads: t, tps: 1 / step, bound: tMem >= tCompute ? 'memory' : 'compute', smt: t > physical, crossNode })
  }
  // On a flat plateau prefer more threads: decode gains nothing, prefill still does.
  const max = Math.max(...out.map((r) => r.tps))
  const best = out.filter((r) => !r.smt && r.tps >= 0.98 * max).at(-1) || out[0]
  const saturates = out.find((r) => r.tps >= 0.98 * max)?.threads || 1
  return { rows: out, best, saturates, physical, node }
}

// Concurrency sweep for serving: aggregate and per-user speed, TTFT, KV
// memory, how many users fit, and whether prefill (compute) or decode
// (bandwidth) dominates: the question behind prefill/decode disaggregation.
export function serving(d, model, w = {}, users = [1, 2, 4, 8, 16, 32, 64, 128], outputTokens = 256) {
  const wl = { ...DEFAULT_WORKLOAD, ...w }
  const bpp = BYTES_PER_PARAM[wl.precision]
  const kvPerSeq = wl.context * kvBytesPerToken(model, wl.kvBytes)
  const weightsGb = model.params_b * 1e9 * bpp / 1e9
  const capacity = d.capacityGbPerNode * (wl.pinning === 'interleave' ? d.numaNodes : 1)
  const maxUsers = Math.max(0, Math.floor((capacity * 1e9 - weightsGb * 1e9) / kvPerSeq))
  const rows = users.map((u) => {
    const s = simulate(d, model, { ...wl, batch: u })
    // Requests arrive one at a time: TTFT is one prompt's prefill, not the whole batch's.
    const one = simulate(d, model, { ...wl, batch: 1 })
    const decodeS = outputTokens * s.step_ms / 1000
    const prefillS = one.ttft_ms / 1000
    return {
      users: u, aggregate_tps: s.aggregate_tps, per_user_tps: s.per_sequence_tps, ttft_ms: one.ttft_ms,
      kv_gb: u * kvPerSeq / 1e9, fits: u <= maxUsers, bound: s.bound, prefill_share: prefillS / (prefillS + decodeS),
      utilisation: s.utilisation, watts: s.watts, tokens_per_joule: s.tokens_per_joule,
    }
  })
  const knee = rows.find((r) => r.bound === 'compute')?.users ?? null
  const heavyPrefill = rows.some((r) => r.fits && r.prefill_share > 0.3)
  return {
    rows, maxUsers, knee, weightsGb, kvPerSeqMb: kvPerSeq / 1e6,
    hint: heavyPrefill
      ? 'Prefill takes over 30% of each request: prefill is compute-bound and decode is bandwidth-bound, so separate prefill and decode machines (or a GPU for prefill) would raise goodput.'
      : 'Decode dominates: more memory bandwidth per replica, or more replicas, is the lever. Disaggregating prefill would not pay here.',
  }
}

// Roofline with the ceilings a CPU has: DRAM, L3, vector FMA and the matrix
// unit when present. Points are decode steps at growing batch; arithmetic
// intensity = 2·B / bytes per parameter (weights are read once per step).
export function roofline(d, model, w = {}, batches = [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
  const wl = { ...DEFAULT_WORKLOAD, ...w, efficiency: { ...DEFAULT_WORKLOAD.efficiency, ...(w.efficiency || {}) } }
  const pk = peak(d, wl.precision)
  const eb = effectiveBandwidth(d, wl.pinning)
  const dram = eb.gbs * wl.efficiency.bw
  const l3 = d.l3Gbs * d.dies * wl.efficiency.l3
  const hasMatrix = d.isa.amx && wl.precision !== 'fp32'
  const vector = pk.tflops * wl.efficiency.compute / (hasMatrix ? 4 : 1)
  const matrix = hasMatrix ? pk.tflops * wl.efficiency.compute : null
  const top = matrix ?? vector
  const bpp = BYTES_PER_PARAM[wl.precision]
  const points = batches.map((B) => {
    const bytes = model.active_b * 1e9 * bpp + B * wl.context * kvBytesPerToken(model, wl.kvBytes)
    const flops = 2 * model.active_b * 1e9 * B
    const intensity = flops / bytes
    return { batch: B, intensity, attainable_tflops: Math.min(top, intensity * dram / 1000), l3_tflops: Math.min(top, intensity * l3 / 1000) } // GB/s × FLOP/byte = GFLOP/s
  })
  return {
    ceilings: { dram_gbs: dram, l3_gbs: l3, vector_tflops: vector, matrix_tflops: matrix },
    ridge_intensity: top * 1000 / dram, points,
  }
}

// What each precision buys on this design: bytes moved, native support,
// dequantisation overhead and the projected speedup over fp32. Quantisation
// shrinks traffic, but a non-native format pays in compute, which is why
// int4 sometimes fails to speed anything up.
export function quantAdvice(d, model, w = {}) {
  const base = simulate(d, model, { ...w, precision: 'fp32' })
  return Object.keys(BYTES_PER_PARAM).map((precision) => {
    const s = simulate(d, model, { ...w, precision })
    const native = NATIVE[precision](d)
    const weightsGb = model.params_b * BYTES_PER_PARAM[precision]
    let note = native ? 'Native: fewer bytes and full-rate compute.' : 'Not native here: weights are unpacked in software, so compute per token roughly doubles.'
    if (!native && s.bound === 'compute') note += ' Projected compute-bound: expect little or no speedup from this format on this CPU.'
    if (precision === 'int4') note += ' Accuracy drop is model-dependent; keep an eval in the loop (the v1 tuner measures perplexity per config).'
    return { precision, native, weightsGb, bound: s.bound, per_sequence_tps: s.per_sequence_tps, speedup: s.per_sequence_tps / base.per_sequence_tps, memory_saving: 1 - weightsGb / (model.params_b * 4), note }
  })
}

// Cost per million tokens for a design serving `model` at the given
// utilisation, and the daily volume where owning beats an API price.
export function cost(d, model, w, { machineUsd = 15000, kwhUsd = 0.15, utilisation = 0.4, years = 3, apiUsdPerM = 0.6 } = {}) {
  const s = simulate(d, model, w)
  const secondsPerYear = 365 * 24 * 3600
  const tokensPerYear = s.aggregate_tps * utilisation * secondsPerYear
  const energyUsdPerYear = (s.watts / 1000) * 24 * 365 * kwhUsd
  const capexPerYear = machineUsd / years
  const usdPerYear = capexPerYear + energyUsdPerYear
  const usdPerM = tokensPerYear ? usdPerYear / (tokensPerYear / 1e6) : Infinity
  const breakEvenTokensPerDay = apiUsdPerM ? (usdPerYear / 365) / (apiUsdPerM / 1e6) : Infinity
  return { usdPerM, tokensPerYear, energyUsdPerYear, capexPerYear, usdPerYear, breakEvenTokensPerDay, apiUsdPerM, cheaperThanApi: usdPerM < apiUsdPerM, watts: s.watts, aggregate_tps: s.aggregate_tps }
}

// Two-parameter design space: metric at every (a, b) pair, with the best cell.
export function explore(d, model, w, keyA, valuesA, keyB, valuesB, metric = 'aggregate_tps') {
  const cells = []
  for (const a of valuesA) for (const b of valuesB) {
    const s = simulate({ ...d, [keyA]: a, [keyB]: b }, model, w)
    cells.push({ a, b, value: s[metric], fits: s.fits, watts: s.watts })
  }
  const best = cells.filter((c) => c.fits).reduce((x, y) => (y.value > (x?.value ?? -Infinity) ? y : x), null)
  const max = Math.max(...cells.map((c) => c.value))
  return { cells, best, max }
}

// Calibrate the model against measured runs. Each measured config moved
// `model_bytes` per decode step at `decode_tps`, so the bandwidth it really
// achieved is bytes × tok/s. Divided by the machine's measured copy bandwidth
// that is the efficiency the Designer should assume for this kind of machine.
export function calibrate(results, measuredGbs) {
  const rows = results.filter((r) => r.decode_tps && r.model_bytes).map((r) => {
    const achievedGbs = r.decode_tps * r.model_bytes / 1e9
    return { name: r.name, precision: r.precision, threads: r.threads, decode_tps: r.decode_tps, model_bytes: r.model_bytes, achievedGbs, efficiency: measuredGbs ? achievedGbs / measuredGbs : null }
  })
  const eff = rows.map((r) => r.efficiency).filter((x) => x != null && Number.isFinite(x))
  const sorted = [...eff].sort((a, b) => a - b)
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  return { rows, efficiency: { median: med, best: eff.length ? Math.max(...eff) : null, n: eff.length } }
}

// Projected tok/s for a run that moves `modelBytes` per step on a machine
// with `measuredGbs` copy bandwidth at a given efficiency.
export const projectTps = (modelBytes, measuredGbs, efficiency) => (measuredGbs * efficiency * 1e9) / modelBytes
