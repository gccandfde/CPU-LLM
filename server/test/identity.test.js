import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claimDataDir, IDENTITY_FILE } from '../src/identity.js'
import { createApp } from '../src/app.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-id-'))

test('a fresh or own data folder is claimed and reused', () => {
  const dir = tmp()
  assert.equal(claimDataDir(dir), 'claimed')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, IDENTITY_FILE), 'utf8')).app, 'cpullm')
  assert.equal(claimDataDir(dir), 'owned')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a folder stamped by another app is refused', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, IDENTITY_FILE), JSON.stringify({ app: 'lawyerweb' }))
  assert.throws(() => claimDataDir(dir), /belongs to "lawyerweb"/)
  assert.throws(() => createApp({ dataDir: dir, agentToken: 't', adminPassword: 'admin-password-1' }), /belongs to "lawyerweb"/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a folder holding another app\'s files is refused, our own files are fine', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'db.json'), '{"sites":[],"users":[]}')
  assert.throws(() => claimDataDir(dir), /another app's files \(db\.json\)/)
  fs.rmSync(dir, { recursive: true, force: true })
  const ours = tmp()
  fs.mkdirSync(path.join(ours, 'jobs'))
  fs.writeFileSync(path.join(ours, 'agents.json'), JSON.stringify({ a1: { id: 'a1', name: 'box', hardware: {} } }))
  fs.writeFileSync(path.join(ours, 'settings.json'), '{}')
  assert.equal(claimDataDir(ours), 'claimed')
  fs.rmSync(ours, { recursive: true, force: true })
})
