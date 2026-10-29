import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

const ADMIN = 'admin-password-1'
let server, base, dataDir, asked = []

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-ai-'))
  const ask = async (q) => { asked.push(q); return { answer: `echo: ${q.question}`, model: q.ai.model } }
  const { app } = createApp({ dataDir, agentToken: 't', adminPassword: ADMIN, ai: { ask } })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) })

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('advisor is off until an admin adds a key and turns it on', async () => {
  assert.equal((await call('GET', '/api/config')).body.ai.enabled, false)
  assert.equal((await call('POST', '/api/ai/ask', { question: 'why slow?' })).status, 503)

  const token = (await call('POST', '/api/admin/login', { password: ADMIN })).body.token
  assert.equal((await call('PUT', '/api/admin/settings', { anthropicKey: 'nope' }, token)).status, 400)
  const saved = await call('PUT', '/api/admin/settings', { anthropicKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', ai: { enabled: true, effort: 'high' } }, token)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.hasAnthropicKey, true)
  assert.equal(saved.body.ai.effort, 'high')
  assert.ok(!JSON.stringify(saved.body).includes('sk-ant-'), 'the key must never be sent back')

  assert.equal((await call('GET', '/api/config')).body.ai.enabled, true)
  const r = await call('POST', '/api/ai/ask', { question: 'why slow?', context: 'tok/s 12' })
  assert.equal(r.status, 200)
  assert.equal(r.body.answer, 'echo: why slow?')
  assert.equal(asked[0].apiKey, 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
  assert.equal(asked[0].ai.effort, 'high')

  assert.equal((await call('POST', '/api/ai/ask', { question: '' })).status, 400)
  assert.equal((await call('PUT', '/api/admin/settings', { ai: { model: 'gpt-4' } }, token)).status, 400)
  const off = await call('PUT', '/api/admin/settings', { anthropicKey: null }, token)
  assert.equal(off.body.hasAnthropicKey, false)
  assert.equal((await call('POST', '/api/ai/ask', { question: 'x' })).status, 503)
})
