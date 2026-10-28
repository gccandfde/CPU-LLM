import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODELS, PLATFORMS, predict, kneeBatch, kvBytesPerToken, sweepBatch } from './perfmodel.js'

const model = (id) => MODELS.find((m) => m.id === id)
const platform = (id) => PLATFORMS.find((p) => p.id === id)
const ideal = { bw: 1, compute: 1 }

test('batch-1 decode is bandwidth / bytes when the KV cache is negligible', () => {
  const r = predict(model('llama3.1-8b'), platform('epyc-9654'), { precision: 'bf16', context: 1, efficiency: ideal })
  const expected = 461e9 / (8.03e9 * 2)
  assert.ok(Math.abs(r.per_sequence_tps - expected) / expected < 0.01, `${r.per_sequence_tps} vs ${expected}`)
  assert.equal(r.bound, 'memory')
})

test('halving bytes per parameter roughly doubles bandwidth-bound decode', () => {
  const opts = { context: 1, efficiency: ideal }
  const bf16 = predict(model('llama3.1-8b'), platform('epyc-9654'), { ...opts, precision: 'bf16' })
  const int8 = predict(model('llama3.1-8b'), platform('epyc-9654'), { ...opts, precision: 'int8' })
  assert.ok(int8.per_sequence_tps / bf16.per_sequence_tps > 1.9)
})

test('MoE reads only active experts per token but must hold all of them', () => {
  const r = predict(model('mixtral-8x7b'), platform('epyc-9654'), { precision: 'bf16', context: 1, efficiency: ideal })
  assert.ok(Math.abs(r.per_sequence_tps - 461e9 / (12.9e9 * 2)) < 0.5)
  assert.ok(r.memory_needed_gb > 90) // 46.7B × 2 bytes
})

test('memory capacity: 70B bf16 does not fit a 24 GB GPU but fits an EPYC', () => {
  assert.equal(predict(model('llama3.1-70b'), platform('rtx-4090')).fits, false)
  assert.equal(predict(model('llama3.1-70b'), platform('epyc-9654')).fits, true)
})

test('the compute knee arrives at a much smaller batch on CPUs than on GPUs', () => {
  const m = model('llama3.1-8b')
  const cpu = kneeBatch(m, platform('epyc-9654'), { context: 1 })
  const gpu = kneeBatch(m, platform('h100-sxm'), { context: 1 })
  assert.ok(cpu < gpu, `cpu knee ${cpu} should be below gpu knee ${gpu}`)
  const sweep = sweepBatch(m, platform('epyc-9654'), { context: 1 }, [1, 1024])
  assert.equal(sweep[0].bound, 'memory')
  assert.equal(sweep[1].bound, 'compute')
})

test('KV bytes per token follow the architecture', () => {
  // Llama 3.1 8B: 2 (K,V) × 32 layers × 8 kv heads × 128 dims × 2 bytes = 128 KiB
  assert.equal(kvBytesPerToken(model('llama3.1-8b')), 131072)
})
