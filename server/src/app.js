// HTTP API: the dashboard talks to it, and Python agents running on the
// machines being tuned connect to it outbound (so they work behind NAT).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { Store } from './store.js'
import { Settings, MODEL_ID, safeEqual } from './settings.js'
import { installRouter } from './install.js'
import { aiRouter } from './ai.js'
import { Campaigns, runsCsv, MAX_QUEUED_PER_AGENT } from './campaigns.js'
import { Audit } from './audit.js'
import { metrics } from './metrics.js'
import { openapi } from './openapi.js'

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

export function createApp({ dataDir, agentToken, dashboardPassword, adminPassword, adminPasswordReset, staticDir, siteDir, ai } = {}) {
  const settings = new Settings(dataDir, { agentToken, dashboardPassword, adminPassword, adminPasswordReset })
  const store = new Store(dataDir, () => settings.data.agents)
  store.applyRetention(settings.data.retention)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // Hostinger serves the app behind one proxy; req.ip is the client
  app.use(express.json({ limit: '25mb' }))

  const campaigns = new Campaigns(dataDir, store)
  const audit = new Audit(dataDir)
  app.use(audit.middleware())
  app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION }))
  app.get('/metrics', (req, res) => res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics({ store, campaigns, settings })))
  app.get('/api/openapi.json', (req, res) => res.json(openapi(VERSION)))

  // ---------------- agent API (bearer token) ----------------
  const agent = express.Router()
  agent.use((req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '')
    if (!safeEqual(token, settings.agentToken)) return res.status(401).json({ detail: 'Bad agent token' })
    next()
  })

  agent.post('/register', (req, res) => {
    const { name, hardware } = req.body || {}
    if (!name || typeof hardware !== 'object') return res.status(400).json({ detail: 'name and hardware required' })
    const cleanName = String(name).slice(0, 80)
    if (!settings.data.agents.allowRegistration && !store.findAgent(cleanName, hardware))
      return res.status(403).json({ detail: 'New machines are not being accepted (Admin → Agents)' })
    const a = store.registerAgent({ name: cleanName, hardware })
    res.json({ agent_id: a.id })
  })

  agent.param('agentId', (req, res, next, id) => {
    req.agent = store.touchAgent(id)
    if (!req.agent) return res.status(404).json({ detail: 'Unknown agent; register again' })
    next()
  })

  agent.post('/:agentId/telemetry', (req, res) => {
    const samples = Array.isArray(req.body?.samples) ? req.body.samples : []
    store.addTelemetry(req.agent.id, samples)
    res.json({ ok: true })
  })

  agent.get('/:agentId/next-job', (req, res) => {
    const job = store.claimNextJob(req.agent.id)
    if (!job) return res.status(204).end()
    res.json({ id: job.id, params: job.params })
  })

  const agentJob = (req, res) => {
    const job = store.jobs[req.params.jobId]
    if (!job || job.agentId !== req.params.agentId) {
      res.status(404).json({ detail: 'No such job' })
      return null
    }
    return job
  }

  agent.post('/:agentId/jobs/:jobId/events', (req, res) => {
    const job = agentJob(req, res)
    if (!job) return
    for (const e of req.body?.events || []) store.applyEvent(job, e)
    res.json({ ok: true })
  })

  agent.post('/:agentId/jobs/:jobId/complete', (req, res) => {
    const job = agentJob(req, res)
    if (!job) return
    const { result, report_md: reportMd, bundle_b64: b64, error } = req.body || {}
    if (!error && (!result || !b64)) return res.status(400).json({ detail: 'result and bundle_b64 required' })
    store.completeJob(job, { result, reportMd, bundle: b64 && Buffer.from(b64, 'base64'), error })
    store.applyRetention(settings.data.retention)
    res.json({ ok: true })
  })

  app.use('/api/agent', agent)

  // One-line agent installers; public so a fresh machine can curl them.
  app.use('/install', installRouter(siteDir))

  // ---------------- admin API (admin password → session token) ----------------
  const admin = express.Router()
  const failures = failureLimit(10, 60_000)

  admin.post('/login', (req, res) => {
    if (failures.blocked(req)) return res.status(429).json({ detail: 'Too many wrong passwords; wait a minute' })
    if (!settings.adminConfigured)
      return res.status(409).json({ detail: 'No admin password yet: set ADMIN_PASSWORD on the server and restart' })
    if (!settings.checkAdmin(req.body?.password)) {
      failures.hit(req)
      return res.status(401).json({ detail: 'Wrong admin password' })
    }
    res.json({ token: settings.issueSession() })
  })

  admin.use((req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '')
    if (!settings.checkSession(token)) return res.status(401).json({ detail: 'Admin sign-in required' })
    next()
  })

  admin.get('/settings', (req, res) => res.json(settings.forAdmin()))

  admin.put('/settings', (req, res) => {
    const err = settings.update(req.body)
    if (err) return res.status(400).json({ detail: err })
    store.applyRetention(settings.data.retention)
    res.json(settings.forAdmin())
  })

  admin.post('/agent-token', (req, res) => res.json({ agentToken: settings.rotateAgentToken() }))
  admin.get('/audit', (req, res) => res.json(audit.tail(Math.min(1000, Number(req.query.limit) || 200))))

  admin.post('/password', (req, res) => {
    const { current, next } = req.body || {}
    if (failures.blocked(req)) return res.status(429).json({ detail: 'Too many wrong passwords; wait a minute' })
    if (!settings.checkAdmin(current)) {
      failures.hit(req)
      return res.status(401).json({ detail: 'Current password is wrong' })
    }
    if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ detail: 'New password must be at least 10 characters' })
    settings.setAdminPassword(next)
    res.json({ token: settings.issueSession() })
  })

  admin.delete('/agents/:id', (req, res) => {
    if (!store.agents[req.params.id]) return res.status(404).json({ detail: 'No such machine' })
    if (Object.values(store.jobs).some((j) => j.agentId === req.params.id && j.status === 'running'))
      return res.status(409).json({ detail: 'This machine is running a job' })
    store.deleteAgent(req.params.id)
    res.json({ ok: true })
  })

  app.use('/api/admin', admin)

  // ---------------- dashboard API ----------------
  const dashboardAuth = basicAuth(settings)
  const dash = express.Router()
  dash.use(dashboardAuth)
  // AI advisor: same access as the dashboard; the API key stays server-side.
  app.use('/api/ai', dashboardAuth, aiRouter(settings, ai))

  dash.get('/config', (req, res) => res.json(settings.forPublic()))

  dash.get('/agents', (req, res) => res.json(store.listAgents()))

  dash.get('/agents/:id/telemetry', (req, res) => {
    res.json(store.getTelemetry(req.params.id, Number(req.query.since) || 0))
  })

  dash.post('/jobs', (req, res) => {
    const { agent_id: agentId, ...params } = req.body || {}
    if (!store.agents[agentId]) return res.status(400).json({ detail: 'Unknown agent' })
    const err = validateParams(params, settings.data.tuning)
    if (err) return res.status(400).json({ detail: err })
    // Runs queue per machine and start oldest first; keep the queue bounded.
    const queued = Object.values(store.jobs).filter((j) => j.agentId === agentId && j.status === 'queued').length
    if (queued >= MAX_QUEUED_PER_AGENT) return res.status(409).json({ detail: `This machine already has ${queued} runs queued` })
    res.json({ id: store.createJob(agentId, params).id })
  })

  dash.get('/jobs', (req, res) => res.json(store.listJobs(req.query.agent_id)))
  dash.get('/export/runs.csv', (req, res) => res.type('text/csv').attachment('cpullm-runs.csv').send(runsCsv(store)))

  // ---- campaigns: machines × models in one click ----
  dash.post('/campaigns', (req, res) => {
    const { name, agent_ids: agentIds, model_ids: modelIds, params } = req.body || {}
    if (!Array.isArray(agentIds) || !agentIds.length || agentIds.some((a) => !store.agents[a])) return res.status(400).json({ detail: 'agent_ids must list connected machines' })
    if (!Array.isArray(modelIds) || !modelIds.length || modelIds.length > 16) return res.status(400).json({ detail: 'model_ids must list 1-16 models' })
    for (const m of modelIds) {
      const err = validateParams({ ...(params || {}), model_id: m }, settings.data.tuning)
      if (err) return res.status(400).json({ detail: `${m}: ${err}` })
    }
    try {
      res.status(201).json(campaigns.get(campaigns.create({ name, agentIds, modelIds, params: { ...(params || {}), model_id: undefined } }).id))
    } catch (e) { res.status(400).json({ detail: e.message }) }
  })
  dash.get('/campaigns', (req, res) => res.json(campaigns.list()))
  dash.get('/campaigns/:id', (req, res) => { const c = campaigns.get(req.params.id); c ? res.json(c) : res.status(404).json({ detail: 'No such campaign' }) })
  dash.get('/campaigns/:id/export.csv', (req, res) => {
    const c = campaigns.items[req.params.id]
    if (!c) return res.status(404).json({ detail: 'No such campaign' })
    res.type('text/csv').attachment(`cpullm-campaign-${c.id}.csv`).send(campaigns.csv(c))
  })
  dash.delete('/campaigns/:id', (req, res) => {
    campaigns.remove(req.params.id, { deleteJobs: req.query.delete_jobs === 'true' }) ? res.json({ ok: true }) : res.status(404).json({ detail: 'No such campaign' })
  })

  const getJob = (req, res) => {
    const job = store.jobs[req.params.id]
    if (!job) res.status(404).json({ detail: 'No such job' })
    return job
  }

  dash.get('/jobs/:id', (req, res) => {
    const job = getJob(req, res)
    if (job) res.json(job)
  })

  dash.delete('/jobs/:id', (req, res) => {
    const job = getJob(req, res)
    if (!job) return
    if (job.status === 'running') return res.status(409).json({ detail: 'Cannot delete a running job' })
    store.deleteJob(job)
    res.json({ ok: true })
  })

  const sendArtifact = (name, type, download) => (req, res) => {
    const job = getJob(req, res)
    if (!job) return
    if (job.status !== 'done') return res.status(409).json({ detail: `Job is ${job.status}` })
    res.type(type)
    if (download) res.attachment(`cpullm-tuning-${job.id}.zip`)
    res.sendFile(store.artifactPath(job, name))
  }
  dash.get('/jobs/:id/export.json', (req, res) => {
    const job = getJob(req, res)
    if (job) res.attachment(`cpullm-run-${job.id}.json`).json(job)
  })
  dash.get('/jobs/:id/report.md', sendArtifact('report.md', 'text/markdown; charset=utf-8', false))
  dash.get('/jobs/:id/bundle.zip', sendArtifact('bundle.zip', 'application/zip', true))

  app.use('/api', dash)
  app.use('/api', (req, res) => res.status(404).json({ detail: 'Not found' }))

  // ---------------- built React app ----------------
  // A versioned site (site/versions.json + site/v1, site/v2, …) from
  // scripts/build-site.mjs wins; otherwise serve the plain frontend build.
  const manifest = siteDir && readManifest(path.join(siteDir, 'versions.json'))
  if (manifest) {
    app.use(dashboardAuth)
    app.get('/', (req, res) => res.redirect(302, `/${manifest.stable}/`))
    app.use(express.static(siteDir, { redirect: true }))
    for (const { name } of manifest.versions) {
      // Deep links inside a version fall back to that version's app.
      app.get(new RegExp(`^/${name}/(?!features/|assets/).*`), (req, res) => res.sendFile(path.join(siteDir, name, 'index.html')))
    }
    app.use((req, res) => res.redirect(302, `/${manifest.stable}/`))
  } else if (staticDir && fs.existsSync(staticDir)) {
    app.use(dashboardAuth)
    app.use(express.static(staticDir))
    app.get(/.*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  }

  return { app, store, settings }
}

function readManifest(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'))
    return m.stable && Array.isArray(m.versions) && m.versions.every((v) => /^v\d+$/.test(v.name)) ? m : null
  } catch {
    return null
  }
}

// `tuning` is the admin-controlled tuning section of the settings.
export function validateParams(p, tuning) {
  const L = tuning.limits
  if (!MODEL_ID.test(p.model_id || '')) return 'model_id must be a Hugging Face id (org/name) or builtin:*'
  if (!tuning.allowCustomModels && !tuning.models.some((m) => m.id === p.model_id))
    return 'Only the models listed by the admin can be tuned'
  if (!Array.isArray(p.precisions) || !p.precisions.length || p.precisions.some((x) => !tuning.precisions.includes(x)))
    return `precisions must be a non-empty subset of ${tuning.precisions.join(', ')}`
  const list = (v, min, max) => intList(v, min, max, L.maxListItems)
  if (!list(p.prune_counts, 0, L.maxPrune)) return `prune_counts must be integers 0-${L.maxPrune}`
  if (p.thread_counts != null && !list(p.thread_counts, 1, L.maxThreads)) return `thread_counts must be integers 1-${L.maxThreads}`
  if (!Number.isInteger(p.new_tokens) || p.new_tokens < 2 || p.new_tokens > L.maxNewTokens) return `new_tokens must be 2-${L.maxNewTokens}`
  if (p.repeats != null && (!Number.isInteger(p.repeats) || p.repeats < 1 || p.repeats > L.maxRepeats)) return `repeats must be 1-${L.maxRepeats}`
  if (typeof p.max_ppl_increase_pct !== 'number' || p.max_ppl_increase_pct < 0) return 'max_ppl_increase_pct must be >= 0'
  if (p.device != null && !tuning.devices.includes(p.device)) return `device must be one of ${tuning.devices.join(', ')}`
  if ((p.device ?? 'cpu') === 'cpu' && !tuning.devices.includes('cpu')) return 'CPU runs are turned off by the admin'
  if (p.batch_sizes != null && !list(p.batch_sizes, 1, L.maxBatch)) return `batch_sizes must be integers 1-${L.maxBatch}`
  if (p.max_eval_drop_pts != null && (typeof p.max_eval_drop_pts !== 'number' || p.max_eval_drop_pts < 0))
    return 'max_eval_drop_pts must be >= 0'
  for (const flag of ['run_eval', 'compile', 'profile'])
    if (p[flag] != null && typeof p[flag] !== 'boolean') return `${flag} must be true or false`
  return null
}

function intList(v, min, max, maxItems) {
  return Array.isArray(v) && v.length > 0 && v.length <= maxItems && v.every((n) => Number.isInteger(n) && n >= min && n <= max)
}

// HTTP basic auth against the dashboard password, only while login is on.
// Verified headers are cached per password hash, so polling doesn't re-run scrypt.
function basicAuth(settings) {
  const ok = new Map()
  return (req, res, next) => {
    if (!settings.dashboardLoginOn) return next()
    const header = req.get('authorization') || ''
    const key = `${settings.data.secrets.dashboardHash}|${crypto.createHash('sha256').update(header).digest('hex')}`
    if (ok.has(key)) return next()
    const [scheme, b64 = ''] = header.split(' ')
    const pass = scheme === 'Basic' ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : ''
    if (settings.checkDashboard(pass)) {
      if (ok.size > 1000) ok.clear()
      ok.set(key, true)
      return next()
    }
    res.set('WWW-Authenticate', 'Basic realm="CPU-LLM"').status(401).send('Authentication required')
  }
}

// Blocks a client IP after `max` failed attempts within the window.
function failureLimit(max, windowMs) {
  const hits = new Map()
  const live = (req) => {
    const h = hits.get(req.ip)
    return h && h.reset > Date.now() ? h : null
  }
  return {
    blocked: (req) => (live(req)?.n ?? 0) >= max,
    hit: (req) => {
      const h = live(req)
      if (h) h.n++
      else hits.set(req.ip, { n: 1, reset: Date.now() + windowMs })
    },
  }
}
