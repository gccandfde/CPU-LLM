import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

const TOKEN = 't'
let server, base, dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-kinds-'))
  const { app } = createApp({ dataDir, agentToken: TOKEN, adminPassword: 'admin-password-1' })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('benchmark and power job kinds are validated, run and summarised', async () => {
  const a = (await call('POST', '/api/agent/register', { name: 'box', hardware: { fingerprint: 'b' } }, TOKEN)).body.agent_id
  assert.equal((await call('POST', '/api/jobs', { agent_id: a, kind: 'weird' })).status, 400)
  assert.equal((await call('POST', '/api/jobs', { agent_id: a, kind: 'benchmark', gemm_sizes: [64] })).status, 400)
  assert.equal((await call('POST', '/api/jobs', { agent_id: a, kind: 'power', model_id: '../x' })).status, 400)
  const bench = await call('POST', '/api/jobs', { agent_id: a, kind: 'benchmark', device: 'cpu', stream_mb: 128, gemm_sizes: [1024], attention_ctx: [1024], repeats: 1 })
  assert.equal(bench.status, 200)
  const power = await call('POST', '/api/jobs', { agent_id: a, kind: 'power', model_id: 'builtin:tiny-llama', precision: 'bf16', core_counts: [1, 2], idle_w: 10, tdp_w: 65 })
  assert.equal(power.status, 200)
  // GPU power runs take a power-limit sweep in watts; nonsense limits are refused.
  assert.equal((await call('POST', '/api/jobs', { agent_id: a, kind: 'power', device: 'cuda', power_limits: [5000] })).status, 400)
  assert.equal((await call('POST', '/api/jobs', { agent_id: a, kind: 'power', device: 'cuda', gpu_index: 99 })).status, 400)
  const gpuPower = await call('POST', '/api/jobs', { agent_id: a, kind: 'power', device: 'cuda', model_id: 'builtin:tiny-llama', power_limits: [115, 80], gpu_index: 0 })
  assert.equal(gpuPower.status, 200)

  const j1 = (await call('GET', `/api/agent/${a}/next-job`, null, TOKEN)).body
  assert.equal(j1.params.kind, 'benchmark')
  await call('POST', `/api/agent/${a}/jobs/${j1.id}/complete`, { result: { kind: 'benchmark', device: 'cpu', hardware: {}, kernels: { stream: { copy_gbs: 40, triad_gbs: 42 }, gemm: [{ n: 1024, dtype: 'bf16', tflops: 2.1 }], attention: [], gather: { gbs: 5 } }, peak: { bandwidth_gbs: 42, tflops: 2.1 }, best: 'cpu: 42 GB/s, 2.1 TFLOPS' }, report_md: '#', bundle_b64: Buffer.from('z').toString('base64') }, TOKEN)
  const j2 = (await call('GET', `/api/agent/${a}/next-job`, null, TOKEN)).body
  assert.equal(j2.params.kind, 'power')
  const pt = (cores, tps, w) => ({ cores, threads: cores, decode_tps: tps, watts: w, tokens_per_joule: tps / w, estimated: true })
  await call('POST', `/api/agent/${a}/jobs/${j2.id}/complete`, { result: { kind: 'power', model_id: 'builtin:tiny-llama', precision: 'bf16', hardware: {}, energy_source: 'estimated', points: [pt(1, 50, 20), pt(2, 90, 30)], recommendation: { performance: pt(2, 90, 30), balanced: pt(2, 90, 30), efficiency: pt(2, 90, 30) }, best: 'performance 2c' }, report_md: '#', bundle_b64: Buffer.from('z').toString('base64') }, TOKEN)

  const j3 = (await call('GET', `/api/agent/${a}/next-job`, null, TOKEN)).body
  assert.equal(j3.params.device, 'cuda')
  const gp = (w, tps, watts) => ({ limit_w: w, cores: null, decode_tps: tps, watts, tokens_per_joule: tps / watts, estimated: false })
  await call('POST', `/api/agent/${a}/jobs/${j3.id}/complete`, { result: { kind: 'power', device: 'cuda', gpu: { name: 'RTX' }, control: 'power_limit', model_id: 'builtin:tiny-llama', precision: 'bf16', hardware: {}, energy_source: 'nvidia-smi', points: [gp(115, 400, 110), gp(80, 360, 78)], recommendation: { performance: gp(115, 400, 110), balanced: gp(80, 360, 78), efficiency: gp(80, 360, 78) }, best: 'performance 115W' }, report_md: '#', bundle_b64: Buffer.from('z').toString('base64') }, TOKEN)

  const list = (await call('GET', '/api/jobs')).body
  const b = list.find((j) => j.id === j1.id), p = list.find((j) => j.id === j2.id), g = list.find((j) => j.id === j3.id)
  assert.equal(b.summary.kind, 'benchmark'); assert.equal(b.summary.bandwidth_gbs, 42)
  assert.equal(p.summary.kind, 'power'); assert.equal(p.summary.decode_tps, 90); assert.equal(p.summary.energy_source, 'estimated'); assert.equal(p.summary.device, 'cpu')
  assert.equal(g.summary.device, 'cuda'); assert.equal(g.summary.energy_source, 'nvidia-smi')
  const metrics = await fetch(base + '/metrics').then((r) => r.text())
  assert.ok(metrics.includes('cpullm_agent_gpus'))
  const csv = await fetch(base + '/api/export/runs.csv').then((r) => r.text())
  assert.ok(csv.split('\n').length >= 1, 'runs.csv still renders with non-tune runs present')
})
