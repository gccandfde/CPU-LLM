import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../src/app.js'

let server, base, dir

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpullm-site-'))
  const site = path.join(dir, 'site')
  for (const v of ['v1', 'v2']) {
    fs.mkdirSync(path.join(site, v, 'features'), { recursive: true })
    fs.writeFileSync(path.join(site, v, 'index.html'), `<title>${v} app</title>`)
    fs.writeFileSync(path.join(site, v, 'features', 'index.html'), `<title>${v} features</title>`)
  }
  fs.mkdirSync(path.join(site, 'versions'))
  fs.writeFileSync(path.join(site, 'versions', 'index.html'), '<title>versions</title>')
  fs.writeFileSync(path.join(site, 'versions.json'), JSON.stringify({ stable: 'v1', versions: [{ name: 'v1' }, { name: 'v2' }] }))
  const { app } = createApp({ dataDir: path.join(dir, 'data'), agentToken: 't', siteDir: site })
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const get = (p) => fetch(base + p, { redirect: 'manual' })

test('root and unknown paths redirect to the stable version', async () => {
  for (const p of ['/', '/tune', '/old/link']) {
    const res = await get(p)
    assert.equal(res.status, 302, p)
    assert.equal(res.headers.get('location'), '/v1/')
  }
})

test('each version serves its app, deep links and features page', async () => {
  assert.match(await (await get('/v1/')).text(), /v1 app/)
  assert.match(await (await get('/v2/')).text(), /v2 app/)
  assert.match(await (await get('/v2/runs/abc')).text(), /v2 app/, 'deep link falls back to that version')
  assert.match(await (await get('/v1/features/')).text(), /v1 features/)
  assert.match(await (await get('/versions/')).text(), /versions/)
})

test('the API is untouched by the versioned site', async () => {
  assert.equal((await get('/api/health')).status, 200)
  assert.equal((await get('/api/nope')).status, 404)
})
