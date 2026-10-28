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
