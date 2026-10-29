import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESIGNS, CHANNEL_GBS, peak, effectiveBandwidth, simulate, scaleOut, sweep } from './archmodel.js'
import { MODELS } from './perfmodel.js'

const design = (id) => DESIGNS.find((d) => d.id === id)
const model = (id) => MODELS.find((m) => m.id === id)
const ideal = { efficiency: { bw: 1, compute: 1, l3: 1 } }

test('peak bandwidth is nodes × channels × channel speed', () => {
  const p = peak(design('epyc-9654'))
  assert.equal(p.bandwidthGbs, 4 * 3 * CHANNEL_GBS['DDR5-4800'])
  assert.equal(p.cores, 96)
  assert.equal(p.l3Mb, 384)
})

test('bf16 has twice the lanes of fp32; non-native precision is halved', () => {
  const d = design('ryzen9-9950x')
  assert.equal(peak(d, 'bf16').tflops / peak(d, 'fp32').tflops, 2)
  const noBf16 = { ...d, isa: { ...d.isa, bf16: false } }
  assert.equal(peak(noBf16, 'bf16').tflops / peak(d, 'fp32').tflops, 1)
  assert.equal(peak(noBf16, 'bf16').native, false)
})

test('pinning: single uses one node, local replicates per node, interleave is capped by the fabric', () => {
  const d = design('epyc-9654') // 4 nodes × 115.2 GB/s, fabric 200 GB/s
  assert.ok(Math.abs(effectiveBandwidth(d, 'single').gbs - 115.2) < 1e-9)
  assert.equal(effectiveBandwidth(d, 'local').replicas, 4)
  const il = effectiveBandwidth(d, 'interleave')
  assert.ok(il.gbs < peak(d).bandwidthGbs, 'remote traffic limits interleaved bandwidth')
  assert.ok(Math.abs(il.gbs - Math.min(460.8, 200 / 0.75)) < 1e-9)
})

test('batch-1 decode on a single node is bandwidth / bytes', () => {
  const d = design('ryzen9-9950x')
  const r = simulate(d, model('llama3.1-8b'), { ...ideal, context: 1, pinning: 'single' })
  const expected = (2 * 44.8e9) / (8.03e9 * 2)
  assert.ok(Math.abs(r.per_sequence_tps - expected) / expected < 0.02, `${r.per_sequence_tps} vs ${expected}`)
  assert.equal(r.bound, 'memory')
})

test('local pinning multiplies aggregate throughput by the replica count and memory needed', () => {
  const d = design('epyc-9654')
  const single = simulate(d, model('llama3.1-8b'), { ...ideal, pinning: 'single' })
  const local = simulate(d, model('llama3.1-8b'), { ...ideal, pinning: 'local' })
  assert.ok(Math.abs(local.aggregate_tps / single.aggregate_tps - 4) < 0.01)
  assert.equal(local.replicas, 4)
})

test('cache residency flags follow L3 size', () => {
  const small = simulate(design('ryzen9-8940hx'), model('smollm2-135m'), ideal)
  assert.equal(small.cache.layerInL3, true)
  const big = simulate(design('ryzen9-8940hx'), model('llama3.1-70b'), ideal)
  assert.equal(big.cache.layerInL3, false)
  assert.equal(big.fits, false, '70B bf16 does not fit 64 GB')
})

test('scale-out rounds machines up and sums power and memory', () => {
  const d = design('ryzen9-9950x')
  const one = simulate(d, model('llama3.1-8b'), ideal)
  const so = scaleOut(d, model('llama3.1-8b'), { ...ideal, batch: 1 }, one.aggregate_tps * 2.5)
  assert.equal(so.machines, 3)
  assert.equal(so.total_watts, 3 * one.watts)
})

test('more memory channels never slows a memory-bound workload', () => {
  const rows = sweep(design('ryzen9-9950x'), model('llama3.1-8b'), { ...ideal, pinning: 'single' }, 'channelsPerNode', [1, 2, 4, 8])
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].aggregate_tps >= rows[i - 1].aggregate_tps)
  assert.ok(rows[3].aggregate_tps > rows[0].aggregate_tps)
})

import { placements, threadSweep, serving, roofline, quantAdvice, cost, explore, calibrate, projectTps } from './archmodel.js'

test('placements: a model larger than one node can only be interleaved', () => {
  const r = placements(design('epyc-9654'), model('llama3.1-8b'), { precision: 'bf16' })
  assert.equal(r.rows.length, 3)
  assert.ok(r.rows.every((x) => x.usable))
  const small = placements({ ...design('epyc-9654'), capacityGbPerNode: 64 }, model('llama3.1-70b'), { precision: 'bf16' })
  assert.equal(small.recommended.pinning, 'interleave')
  assert.ok(!small.rows.find((x) => x.pinning === 'local').usable)
})

test('thread sweep peaks at or before the physical cores of a node', () => {
  const r = threadSweep(design('epyc-9654'), model('llama3.1-8b'), { precision: 'bf16', pinning: 'local' })
  assert.ok(r.best.threads <= r.node, `best ${r.best.threads} node ${r.node}`)
  assert.ok(r.rows.at(-1).tps < r.best.tps, 'SMT threads should not beat the best physical count')
})

test('serving: more users raise aggregate throughput; memory caps users', () => {
  const r = serving(design('ryzen9-9950x'), model('llama3.1-8b'), { precision: 'bf16', context: 4096 })
  assert.ok(r.rows[3].aggregate_tps > r.rows[0].aggregate_tps)
  assert.ok(r.maxUsers > 0)
  assert.ok(r.rows.some((x) => !x.fits) || r.maxUsers >= 128)
})

test('roofline: attainable performance never exceeds the top ceiling', () => {
  const r = roofline(design('xeon-8592plus'), model('llama3.1-8b'), { precision: 'bf16' })
  assert.ok(r.ceilings.matrix_tflops > r.ceilings.vector_tflops)
  for (const p of r.points) assert.ok(p.attainable_tflops <= r.ceilings.matrix_tflops + 1e-9)
})

test('quantisation advice: int8 is native with VNNI and moves fewer bytes', () => {
  const rows = quantAdvice(design('ryzen9-9950x'), model('llama3.1-8b'))
  const int8 = rows.find((x) => x.precision === 'int8')
  assert.ok(int8.native && int8.speedup > 1.5)
  const noVnni = quantAdvice({ ...design('ryzen9-9950x'), isa: { bf16: true, vnni: false, amx: false } }, model('llama3.1-8b'))
  assert.ok(!noVnni.find((x) => x.precision === 'int8').native)
})

test('cost: higher utilisation lowers the price per million tokens', () => {
  const d = design('epyc-9654'), m = model('llama3.1-8b'), w = { precision: 'bf16', batch: 16 }
  const low = cost(d, m, w, { utilisation: 0.1 }), high = cost(d, m, w, { utilisation: 0.8 })
  assert.ok(high.usdPerM < low.usdPerM / 4)
  assert.ok(Number.isFinite(low.breakEvenTokensPerDay))
})

test('explore returns a full grid with a best fitting cell', () => {
  const r = explore(design('ryzen9-9950x'), model('llama3.1-8b'), { precision: 'bf16' }, 'channelsPerNode', [2, 4], 'coresPerDie', [8, 16])
  assert.equal(r.cells.length, 4)
  assert.equal(r.best.a, 4)
})

test('calibrate recovers the bandwidth efficiency behind measured runs', () => {
  const measuredGbs = 50
  const results = [
    { name: 'bf16/t16', precision: 'bf16', threads: 16, model_bytes: 2e9, decode_tps: 50 * 0.6 * 1e9 / 2e9 },
    { name: 'fp32/t16', precision: 'fp32', threads: 16, model_bytes: 4e9, decode_tps: 50 * 0.7 * 1e9 / 4e9 },
  ]
  const c = calibrate(results, measuredGbs)
  assert.ok([0.6, 0.7].some((e) => Math.abs(c.efficiency.median - e) < 1e-9))
  assert.ok(Math.abs(projectTps(2e9, measuredGbs, 0.6) - results[0].decode_tps) < 1e-9)
})
