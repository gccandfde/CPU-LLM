import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createApp } from '../src/app.js'

const TOKEN = 'agent-t'
const ADMIN = 'admin-password-1'
let server, base, dataDir

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-keys-'))
  const { app } = createApp({ dataDir, agentToken: TOKEN, adminPassword: ADMIN })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

const call = async (method, url, body, token, b = base) => {
  const res = await fetch(b + url, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers, raw: res }
}
const PARAMS = { model_id: 'builtin:tiny-llama', precisions: ['fp32'], prune_counts: [0], new_tokens: 8, max_ppl_increase_pct: 10 }

test('API keys carry roles; requireKey closes the dashboard API to anonymous callers', async () => {
  const session = (await call('POST', '/api/admin/login', { password: ADMIN })).body.token
  const agentId = (await call('POST', '/api/agent/register', { name: 'box', hardware: { fingerprint: 'k' } }, TOKEN)).body.agent_id
  assert.equal((await call('POST', '/api/admin/keys', { name: 'ci', role: 'root' }, session)).status, 400)
  const viewer = (await call('POST', '/api/admin/keys', { name: 'grafana', role: 'viewer' }, session)).body
  const engineer = (await call('POST', '/api/admin/keys', { name: 'ci', role: 'engineer' }, session)).body
  const adminKey = (await call('POST', '/api/admin/keys', { name: 'ops', role: 'admin' }, session)).body
  assert.match(viewer.key, /^cpk_[a-f0-9]{48}$/)
  assert.equal(viewer.entry.role, 'viewer')
  const listed = (await call('GET', '/api/admin/keys', null, session)).body
  assert.equal(listed.length, 3)
  assert.ok(!JSON.stringify(listed).includes('cpk_') && !JSON.stringify(listed).includes('hash'), 'keys and hashes are never listed')

  assert.equal((await call('GET', '/api/jobs', null, viewer.key)).status, 200)
  assert.equal((await call('POST', '/api/jobs', { agent_id: agentId, ...PARAMS }, viewer.key)).status, 403)
  assert.equal((await call('POST', '/api/ai/ask', { question: 'x' }, viewer.key)).status, 403)
  assert.equal((await call('POST', '/api/jobs', { agent_id: agentId, ...PARAMS }, engineer.key)).status, 200)
  assert.equal((await call('GET', '/api/admin/settings', null, engineer.key)).status, 401)
  assert.equal((await call('GET', '/api/admin/settings', null, adminKey.key)).status, 200)
  assert.equal((await call('GET', '/api/jobs', null, 'cpk_nope')).status, 401)

  // Close the dashboard API: anonymous callers are refused, keys still work, agents unaffected.
  assert.equal((await call('PUT', '/api/admin/settings', { access: { requireKey: true } }, session)).status, 200)
  assert.equal((await call('GET', '/api/config')).status, 401)
  assert.equal((await call('GET', '/api/jobs', null, viewer.key)).status, 200)
  assert.equal((await call('GET', `/api/agent/${agentId}/next-job`, null, TOKEN)).status, 200)
  assert.equal((await call('GET', '/api/health')).status, 200, 'liveness stays open')
  assert.equal((await call('DELETE', `/api/admin/keys/${viewer.entry.id}`, null, session)).status, 200)
  assert.equal((await call('GET', '/api/jobs', null, viewer.key)).status, 401)
  assert.equal((await call('PUT', '/api/admin/settings', { access: { requireKey: false } }, session)).status, 200)

  const audit = (await call('GET', '/api/admin/audit?limit=50', null, session)).body
  assert.ok(audit.some((e) => e.actor === 'key:ci' && e.path === '/api/jobs' && e.status === 200))
  const h = (await call('GET', '/api/health')).headers
  assert.equal(h.get('x-content-type-options'), 'nosniff')
  assert.equal(h.get('x-frame-options'), 'DENY')
})

test('backup is a gzip JSON bundle that restores into a fresh install', async () => {
  const session = (await call('POST', '/api/admin/login', { password: ADMIN })).body.token
  const res = await fetch(base + '/api/admin/backup', { headers: { Authorization: `Bearer ${session}` } })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition'), /cpullm-backup-.*\.json\.gz/)
  const bundle = JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'))
  assert.equal(bundle.version, 1)
  assert.ok(bundle.settings.secrets.agentToken === TOKEN && bundle.jobs.length === 1 && Object.keys(bundle.agents).length === 1)

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-restore-'))
  let restored = null
  const second = createApp({ dataDir: dir2, agentToken: 'other', adminPassword: 'another-password-1', onRestore: (c) => { restored = c } })
  const srv2 = second.app.listen(0)
  await new Promise((r) => srv2.once('listening', r))
  const base2 = `http://127.0.0.1:${srv2.address().port}`
  try {
    const s2 = (await call('POST', '/api/admin/login', { password: 'another-password-1' }, null, base2)).body.token
    assert.equal((await call('POST', '/api/admin/restore', { bundle: { version: 7 } }, s2, base2)).status, 400)
    const ok = await call('POST', '/api/admin/restore', { gzip_b64: zlib.gzipSync(JSON.stringify(bundle)).toString('base64') }, s2, base2)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.jobs, 1)
    await new Promise((r) => setTimeout(r, 400))
    assert.deepEqual(restored, { jobs: 1, agents: 1, campaigns: 0 })
    // A third instance over the restored directory sees the data and the original agent token.
    const third = createApp({ dataDir: dir2 })
    const srv3 = third.app.listen(0)
    await new Promise((r) => srv3.once('listening', r))
    const base3 = `http://127.0.0.1:${srv3.address().port}`
    assert.equal((await call('GET', '/api/jobs', null, null, base3)).body.length, 1)
    assert.equal((await call('POST', '/api/agent/register', { name: 'box', hardware: { fingerprint: 'k' } }, TOKEN, base3)).status, 200)
    srv3.close()
  } finally {
    srv2.close()
    fs.rmSync(dir2, { recursive: true, force: true })
  }
})
