import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'
import { installCommands } from '../src/install.js'

let server, base, dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-install-'))
  fs.mkdirSync(path.join(dir, 'site', 'install'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'site', 'install', 'agent.zip'), 'PK-fake')
  const { app } = createApp({ dataDir: path.join(dir, 'data'), agentToken: 'secret-token', dashboardPassword: 'dash-pw', siteDir: path.join(dir, 'site') })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('installer scripts are public, carry the server URL and never the token', async () => {
  for (const [file, marker] of [['agent.ps1', 'schtasks'], ['agent.sh', 'systemctl']]) {
    const res = await fetch(`${base}/install/${file}`)
    assert.equal(res.status, 200, `${file} must not sit behind the dashboard login`)
    const text = await res.text()
    assert.ok(text.includes(`'${base}'`) && text.includes('/install/agent.zip'), `${file} downloads the agent from this server`)
    assert.ok(text.includes(marker), `${file} registers a service`)
    assert.equal(text.includes('secret-token'), false)
  }
})

test('agent package is served when built', async () => {
  const res = await fetch(`${base}/install/agent.zip`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-disposition'), /cpullm-agent\.zip/)
  assert.equal(await res.text(), 'PK-fake')
})

test('install commands embed server, token and name', () => {
  const c = installCommands('https://x.example', 'tok', 'box-1')
  assert.ok(c.windows.includes("CPULLM_TOKEN='tok'") && c.windows.includes('https://x.example/install/agent.ps1'))
  assert.ok(c.linux.startsWith("CPULLM_TOKEN='tok' CPULLM_NAME='box-1' curl"))
})
