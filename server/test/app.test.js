import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

const TOKEN = 'test-token'
let server, base, dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-'))
  const { app } = createApp({ dataDir, agentToken: TOKEN })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const call = (method, url, body, token) =>
  fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  })

const PARAMS = { model_id: 'builtin:tiny-llama', precisions: ['fp32'], prune_counts: [0], new_tokens: 8, max_ppl_increase_pct: 10 }

test('agent endpoints reject a wrong token', async () => {
  const res = await call('POST', '/api/agent/register', { name: 'x', hardware: {} }, 'nope')
  assert.equal(res.status, 401)
})

test('full job lifecycle: register, queue, claim, events, complete, download', async () => {
  const { agent_id: agentId } = await (await call('POST', '/api/agent/register',
    { name: 'epyc-1', hardware: { fingerprint: 'abc', model_name: 'AMD EPYC' } }, TOKEN)).json()

  await call('POST', `/api/agent/${agentId}/telemetry`, { samples: [{ ts: 1, cpu_percent: 50 }] }, TOKEN)
  const tele = await (await call('GET', `/api/agents/${agentId}/telemetry?since=0`)).json()
  assert.equal(tele[0].cpu_percent, 50)

  const agents = await (await call('GET', '/api/agents')).json()
  assert.equal(agents[0].online, true)

  assert.equal((await call('GET', `/api/agent/${agentId}/next-job`, null, TOKEN)).status, 204)

  const { id: jobId } = await (await call('POST', '/api/jobs', { agent_id: agentId, ...PARAMS })).json()
  assert.equal((await call('POST', '/api/jobs', { agent_id: agentId, ...PARAMS })).status, 409, 'one job per agent')

  const claimed = await (await call('GET', `/api/agent/${agentId}/next-job`, null, TOKEN)).json()
  assert.equal(claimed.id, jobId)
  assert.equal(claimed.params.model_id, 'builtin:tiny-llama')

  await call('POST', `/api/agent/${agentId}/jobs/${jobId}/events`, {
    events: [{ stage: 'candidate', index: 1, total: 2, message: 'Benchmarking' }, { stage: 'result', result: { name: 'fp32' } }],
  }, TOKEN)
  let job = await (await call('GET', `/api/jobs/${jobId}`)).json()
  assert.equal(job.status, 'running')
  assert.equal(job.progress, 0.5)
  assert.equal(job.results.length, 1)

  assert.equal((await call('GET', `/api/jobs/${jobId}/bundle.zip`)).status, 409)
  await call('POST', `/api/agent/${agentId}/jobs/${jobId}/complete`, {
    result: { best: 'fp32' }, report_md: '# report', bundle_b64: Buffer.from('PKzip').toString('base64'),
  }, TOKEN)
  job = await (await call('GET', `/api/jobs/${jobId}`)).json()
  assert.equal(job.status, 'done')
  assert.equal(await (await call('GET', `/api/jobs/${jobId}/report.md`)).text(), '# report')
  const zip = await call('GET', `/api/jobs/${jobId}/bundle.zip`)
  assert.match(zip.headers.get('content-disposition'), /attachment/)
  assert.equal(Buffer.from(await zip.arrayBuffer()).toString(), 'PKzip')

  // Jobs survive a restart.
  const { store } = createApp({ dataDir, agentToken: TOKEN })
  assert.equal(store.jobs[jobId].status, 'done')
})

test('job parameters are validated', async () => {
  const { agent_id: agentId } = await (await call('POST', '/api/agent/register',
    { name: 'v', hardware: { fingerprint: 'v' } }, TOKEN)).json()
  for (const bad of [{ model_id: '../etc' }, { model_id: '/abs/path' }, { model_id: 'a/..' }, { precisions: ['fp64'] }, { new_tokens: 9999 }, { prune_counts: [-1] }]) {
    const res = await call('POST', '/api/jobs', { agent_id: agentId, ...PARAMS, ...bad })
    assert.equal(res.status, 400, JSON.stringify(bad))
  }
})

test('dashboard password protects the dashboard API but not agents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-'))
  const { app } = createApp({ dataDir: dir, agentToken: TOKEN, dashboardPassword: 'pw' })
  const s = app.listen(0)
  await new Promise((r) => s.once('listening', r))
  const url = `http://127.0.0.1:${s.address().port}`
  try {
    assert.equal((await fetch(`${url}/api/agents`)).status, 401)
    const ok = await fetch(`${url}/api/agents`, { headers: { Authorization: `Basic ${Buffer.from('u:pw').toString('base64')}` } })
    assert.equal(ok.status, 200)
    const reg = await fetch(`${url}/api/agent/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'a', hardware: {} }),
    })
    assert.equal(reg.status, 200)
  } finally {
    s.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
