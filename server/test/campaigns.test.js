import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

const TOKEN = 'seed-token'
const ADMIN = 'admin-password-1'
let server, base, dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-camp-'))
  const { app } = createApp({ dataDir, agentToken: TOKEN, adminPassword: ADMIN })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

const call = async (method, url, body, auth) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${auth}` }) }, body: body && JSON.stringify(body) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* csv or text */ }
  return { status: res.status, body: json, text, type: res.headers.get('content-type') }
}
const register = (name) => call('POST', '/api/agent/register', { name, hardware: { fingerprint: name, memory_bandwidth_gbs: 50 } }, TOKEN)
const PARAMS = { precisions: ['fp32'], prune_counts: [0], new_tokens: 8, repeats: 1, run_eval: false, profile: false, compile: false, batch_sizes: [1], max_ppl_increase_pct: 10, max_eval_drop_pts: 5 }

// Drive one job to "done" through the agent API with a tiny fake result.
async function finish(agentId, tps) {
  const { body: job } = await call('GET', `/api/agent/${agentId}/next-job`, null, TOKEN)
  assert.ok(job?.id, 'a queued job to claim')
  const baseline = { name: 'baseline/fp32', precision: 'fp32', threads: 8, pruned_layers: 0, decode_tps: tps, ttft_ms: 50, perplexity: 10, model_bytes: 1e9, noise_pct: 2 }
  const r = await call('POST', `/api/agent/${agentId}/jobs/${job.id}/complete`, { result: { hardware: { memory_bandwidth_gbs: 50 }, baseline, results: [{ ...baseline, name: 'fp32/prune0/t8', speedup: 1, within_budget: true }], best: 'fp32/prune0/t8' }, report_md: '# r', bundle_b64: Buffer.from('zip').toString('base64') }, TOKEN)
  assert.equal(r.status, 200)
  return job.id
}

test('a campaign queues machines × models, reports progress, matrix, regressions and CSV', async () => {
  const a = (await register('box-a')).body.agent_id
  const b = (await register('box-b')).body.agent_id
  const bad = await call('POST', '/api/campaigns', { agent_ids: [a], model_ids: ['../evil'], params: PARAMS })
  assert.equal(bad.status, 400)

  const created = await call('POST', '/api/campaigns', { name: 'nightly', agent_ids: [a, b], model_ids: ['builtin:tiny-llama', 'HuggingFaceTB/SmolLM2-135M'], params: PARAMS })
  assert.equal(created.status, 201)
  const c = created.body
  assert.equal(c.jobs.length, 4)
  assert.equal((await call('GET', '/api/jobs')).body.length, 4)
  assert.deepEqual((await call('GET', '/api/campaigns')).body[0].progress, { total: 4, done: 0, error: 0, running: 0, queued: 4, deleted: 0 })

  // The queue is per agent: box-a runs its two jobs one after the other.
  await finish(a, 100)
  await finish(a, 120)
  await finish(b, 80)
  const detail = (await call('GET', `/api/campaigns/${c.id}`)).body
  assert.equal(detail.progress.done, 3)
  assert.equal(detail.progress.queued, 1)
  assert.equal(detail.matrix.filter((m) => m.status === 'done').length, 3)
  assert.ok(detail.matrix.every((m) => m.status !== 'done' || m.verdict === 'first'))

  // A second campaign on the same cell is compared with the first: 100 -> 130 is an improvement, 120 -> 100 a regression.
  const again = (await call('POST', '/api/campaigns', { name: 'again', agent_ids: [a], model_ids: ['builtin:tiny-llama', 'HuggingFaceTB/SmolLM2-135M'], params: PARAMS })).body
  await finish(a, 130)
  await finish(a, 100)
  const m2 = (await call('GET', `/api/campaigns/${again.id}`)).body.matrix
  assert.deepEqual(m2.map((m) => m.verdict), ['improved', 'regressed'])
  assert.equal(m2[0].delta_pct, 30)

  const csv = await call('GET', `/api/campaigns/${again.id}/export.csv`)
  assert.match(csv.type, /text\/csv/)
  assert.ok(csv.text.split('\n')[0].startsWith('campaign,machine,model'))
  assert.ok(csv.text.includes('box-a,builtin:tiny-llama,done'))
  const all = await call('GET', '/api/export/runs.csv')
  assert.equal(all.text.trim().split('\n').length - 1, 5 * 2, 'baseline + one config per finished run')
  const one = await call('GET', `/api/jobs/${m2[0].jobId}/export.json`)
  assert.equal(one.body.id, m2[0].jobId)

  const del = await call('DELETE', `/api/campaigns/${again.id}?delete_jobs=true`)
  assert.equal(del.status, 200, del.text)
  const leftRes = await call('GET', '/api/jobs')
  assert.ok(Array.isArray(leftRes.body), `${leftRes.status} ${leftRes.text.slice(0, 300)}`)
  assert.equal(leftRes.body.length, 4, JSON.stringify(leftRes.body.map((j) => j.status)))
})

test('metrics, openapi and the audit trail', async () => {
  const m = await call('GET', '/metrics')
  assert.match(m.text, /cpullm_jobs\{status="done"\} \d+/)
  assert.match(m.text, /cpullm_latest_decode_tps\{machine="box-a"/)
  const spec = (await call('GET', '/api/openapi.json')).body
  assert.equal(spec.openapi, '3.0.3')
  assert.ok(spec.paths['/api/campaigns'].post)

  const token = (await call('POST', '/api/admin/login', { password: ADMIN })).body.token
  assert.equal((await call('GET', '/api/admin/audit')).status, 401)
  const audit = (await call('GET', '/api/admin/audit?limit=50', null, token)).body
  assert.ok(audit.length >= 5)
  const campaign = audit.filter((e) => e.path === '/api/campaigns' && e.method === 'POST' && e.status === 201).at(-1) // oldest = "nightly"
  assert.equal(campaign.actor, 'dashboard')
  assert.equal(campaign.summary.name, 'nightly')
  assert.ok(audit.some((e) => e.actor.startsWith('agent:') && /complete$/.test(e.path)))
  assert.ok(!JSON.stringify(audit).includes(TOKEN), 'tokens never reach the audit log')
})
