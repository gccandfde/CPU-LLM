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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-admin-'))
  const { app } = createApp({ dataDir, agentToken: TOKEN, adminPassword: ADMIN })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

const call = async (method, url, body, auth) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: auth }) },
    body: body && JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const bearer = (t) => `Bearer ${t}`
const login = async (password = ADMIN) => (await call('POST', '/api/admin/login', { password })).body?.token
const register = (name, token = TOKEN) => call('POST', '/api/agent/register', { name, hardware: { fingerprint: name } }, bearer(token))
const PARAMS = { model_id: 'builtin:tiny-llama', precisions: ['fp32'], prune_counts: [0], new_tokens: 8, max_ppl_increase_pct: 10 }

test('admin API needs a session from the admin password', async () => {
  assert.equal((await call('GET', '/api/admin/settings')).status, 401)
  assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401)
  const token = await login()
  const res = await call('GET', '/api/admin/settings', null, bearer(token))
  assert.equal(res.status, 200)
  assert.equal(res.body.agentToken, TOKEN, 'env token seeds the settings')
  assert.equal(res.body.secrets, undefined, 'password hashes never leave the server')
  assert.equal((await call('GET', '/api/admin/settings', null, bearer('123.forged'))).status, 401)
})

test('public config exposes tuning and site, not secrets', async () => {
  const { body } = await call('GET', '/api/config')
  assert.equal(body.site.title, 'CPU-LLM')
  assert.ok(body.tuning.models.length > 0)
  assert.equal(JSON.stringify(body).includes(TOKEN), false)
})

test('tuning limits and lists from settings are enforced', async () => {
  const token = await login()
  const { body: agent } = await register('lim')
  const job = (extra) => call('POST', '/api/jobs', { agent_id: agent.agent_id, ...PARAMS, ...extra })
  assert.equal((await call('PUT', '/api/admin/settings', {
    tuning: { allowCustomModels: false, precisions: ['fp32', 'bf16'], devices: ['cpu'], limits: { maxNewTokens: 16 } },
  }, bearer(token))).status, 200)
  assert.equal((await job({ new_tokens: 17 })).status, 400)
  assert.equal((await job({ precisions: ['int8_dynamic'] })).status, 400)
  assert.equal((await job({ device: 'cuda' })).status, 400)
  assert.equal((await job({ model_id: 'someone/unlisted' })).status, 400)
  assert.equal((await job({})).status, 200)
  // Restore defaults for other tests.
  await call('PUT', '/api/admin/settings', {
    tuning: { allowCustomModels: true, precisions: ['fp32', 'bf16', 'fp16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only'], devices: ['cpu', 'cuda'], limits: { maxNewTokens: 256 } },
  }, bearer(token))
})

test('invalid settings are rejected and nothing is saved', async () => {
  const token = await login()
  for (const bad of [
    { agents: { onlineTimeoutSec: 1 } },
    { tuning: { models: [{ id: '../x', label: 'x' }] } },
    { tuning: { defaultPreset: 'nope' } },
    { access: { dashboardLogin: true } }, // no dashboard password yet
    { dashboardPassword: 'short' },
  ]) assert.equal((await call('PUT', '/api/admin/settings', bad, bearer(token))).status, 400, JSON.stringify(bad))
  const { body } = await call('GET', '/api/admin/settings', null, bearer(token))
  assert.equal(body.agents.onlineTimeoutSec, 15)
  assert.equal(body.access.dashboardLogin, false)
})

test('dashboard login can be switched on and off from admin', async () => {
  const token = await login()
  assert.equal((await call('PUT', '/api/admin/settings', { dashboardPassword: 'dash-pass-1', access: { dashboardLogin: true } }, bearer(token))).status, 200)
  assert.equal((await call('GET', '/api/agents')).status, 401)
  assert.equal((await call('GET', '/api/agents', null, `Basic ${Buffer.from('x:dash-pass-1').toString('base64')}`)).status, 200)
  assert.equal((await call('GET', '/api/admin/settings', null, bearer(token))).status, 200, 'admin is not behind the dashboard login')
  assert.equal((await call('PUT', '/api/admin/settings', { access: { dashboardLogin: false } }, bearer(token))).status, 200)
  assert.equal((await call('GET', '/api/agents')).status, 200)
})

test('rotating the agent token locks out old agents', async () => {
  const token = await login()
  const { body } = await call('POST', '/api/admin/agent-token', null, bearer(token))
  assert.notEqual(body.agentToken, TOKEN)
  assert.equal((await register('old')).status, 401)
  assert.equal((await register('new', body.agentToken)).status, 200)
})

test('new registrations can be closed, known machines still reconnect; machines can be removed', async () => {
  const token = await login()
  const agentToken = (await call('GET', '/api/admin/settings', null, bearer(token))).body.agentToken
  const { body: known } = await register('known', agentToken)
  await call('PUT', '/api/admin/settings', { agents: { allowRegistration: false } }, bearer(token))
  assert.equal((await register('stranger', agentToken)).status, 403)
  assert.equal((await register('known', agentToken)).status, 200)
  await call('PUT', '/api/admin/settings', { agents: { allowRegistration: true } }, bearer(token))
  assert.equal((await call('DELETE', `/api/admin/agents/${known.agent_id}`, null, bearer(token))).status, 200)
  assert.equal((await call('GET', '/api/agents')).body.some((a) => a.id === known.agent_id), false)
})

test('changing the admin password signs out old sessions', async () => {
  const old = await login()
  assert.equal((await call('POST', '/api/admin/password', { current: 'nope', next: 'new-admin-pass' }, bearer(old))).status, 401)
  const { body } = await call('POST', '/api/admin/password', { current: ADMIN, next: 'new-admin-pass' }, bearer(old))
  assert.equal((await call('GET', '/api/admin/settings', null, bearer(old))).status, 401)
  assert.equal((await call('GET', '/api/admin/settings', null, bearer(body.token))).status, 200)
  await call('POST', '/api/admin/password', { current: 'new-admin-pass', next: ADMIN }, bearer(body.token))
})

test('settings survive a restart and ADMIN_PASSWORD_RESET recovers access', () => {
  const { settings } = createApp({ dataDir, agentToken: 'ignored-now', adminPasswordReset: 'recovered-pass' })
  assert.notEqual(settings.agentToken, 'ignored-now', 'env token only seeds a fresh install')
  assert.equal(settings.checkAdmin('recovered-pass'), true)
})

test('retention keeps only the newest finished runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-ret-'))
  try {
    const { store } = createApp({ dataDir: dir, agentToken: TOKEN })
    for (let i = 0; i < 3; i++) {
      const j = store.createJob('a', PARAMS)
      Object.assign(j, { status: 'done', created: i })
    }
    assert.equal(store.applyRetention({ maxRuns: 1, deleteAfterDays: 0 }), 2)
    assert.equal(Object.keys(store.jobs).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('wrong admin passwords are throttled per client', async () => {
  for (let i = 0; i < 10; i++) await call('POST', '/api/admin/login', { password: `wrong-${i}` })
  assert.equal((await call('POST', '/api/admin/login', { password: ADMIN })).status, 429)
})
