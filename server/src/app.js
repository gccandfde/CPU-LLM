// HTTP API: the dashboard talks to it, and Python agents running on the
// machines being tuned connect to it outbound (so they work behind NAT).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { Store } from './store.js'

const PRECISIONS = ['fp32', 'bf16', 'int8_dynamic']
// Hub ids only: each part must start alphanumeric, so "../x" or "/abs" (local paths) are rejected.
const MODEL_ID = /^(builtin:[\w-]+|[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)$/

export function createApp({ dataDir, agentToken, dashboardPassword, staticDir } = {}) {
  if (!agentToken) throw new Error('AGENT_TOKEN must be set')
  const store = new Store(dataDir)
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '25mb' }))

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  // ---------------- agent API (bearer token) ----------------
  const agent = express.Router()
  agent.use((req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '')
    if (!safeEqual(token, agentToken)) return res.status(401).json({ detail: 'Bad agent token' })
    next()
  })

  agent.post('/register', (req, res) => {
    const { name, hardware } = req.body || {}
    if (!name || typeof hardware !== 'object') return res.status(400).json({ detail: 'name and hardware required' })
    const a = store.registerAgent({ name: String(name).slice(0, 80), hardware })
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
    res.json({ ok: true })
  })

  app.use('/api/agent', agent)

  // ---------------- dashboard API ----------------
  const dash = express.Router()
  if (dashboardPassword) dash.use(basicAuth(dashboardPassword))

  dash.get('/agents', (req, res) => res.json(store.listAgents()))

  dash.get('/agents/:id/telemetry', (req, res) => {
    res.json(store.getTelemetry(req.params.id, Number(req.query.since) || 0))
  })

  dash.post('/jobs', (req, res) => {
    const { agent_id: agentId, ...params } = req.body || {}
    if (!store.agents[agentId]) return res.status(400).json({ detail: 'Unknown agent' })
    const err = validateParams(params)
    if (err) return res.status(400).json({ detail: err })
    const busy = Object.values(store.jobs).some((j) => j.agentId === agentId && ['queued', 'running'].includes(j.status))
    if (busy) return res.status(409).json({ detail: 'This agent already has a tuning job queued or running' })
    res.json({ id: store.createJob(agentId, params).id })
  })

  dash.get('/jobs', (req, res) => res.json(store.listJobs(req.query.agent_id)))

  const getJob = (req, res) => {
    const job = store.jobs[req.params.id]
    if (!job) res.status(404).json({ detail: 'No such job' })
    return job
  }

  dash.get('/jobs/:id', (req, res) => {
    const job = getJob(req, res)
    if (job) res.json(job)
  })

  const sendArtifact = (name, type, download) => (req, res) => {
    const job = getJob(req, res)
    if (!job) return
    if (job.status !== 'done') return res.status(409).json({ detail: `Job is ${job.status}` })
    res.type(type)
    if (download) res.attachment(`cpullm-tuning-${job.id}.zip`)
    res.sendFile(store.artifactPath(job, name))
  }
  dash.get('/jobs/:id/report.md', sendArtifact('report.md', 'text/markdown; charset=utf-8', false))
  dash.get('/jobs/:id/bundle.zip', sendArtifact('bundle.zip', 'application/zip', true))

  app.use('/api', dash)
  app.use('/api', (req, res) => res.status(404).json({ detail: 'Not found' }))

  // ---------------- built React app ----------------
  if (staticDir && fs.existsSync(staticDir)) {
    if (dashboardPassword) app.use(basicAuth(dashboardPassword))
    app.use(express.static(staticDir))
    app.get(/.*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html')))
  }

  return { app, store }
}

export function validateParams(p) {
  if (!MODEL_ID.test(p.model_id || '')) return 'model_id must be a Hugging Face id (org/name) or builtin:*'
  if (!Array.isArray(p.precisions) || !p.precisions.length || p.precisions.some((x) => !PRECISIONS.includes(x)))
    return `precisions must be a non-empty subset of ${PRECISIONS.join(', ')}`
  if (!intList(p.prune_counts, 0, 64)) return 'prune_counts must be integers 0-64'
  if (p.thread_counts != null && !intList(p.thread_counts, 1, 1024)) return 'thread_counts must be integers 1-1024'
  if (!Number.isInteger(p.new_tokens) || p.new_tokens < 2 || p.new_tokens > 256) return 'new_tokens must be 2-256'
  if (p.repeats != null && (!Number.isInteger(p.repeats) || p.repeats < 1 || p.repeats > 10)) return 'repeats must be 1-10'
  if (typeof p.max_ppl_increase_pct !== 'number' || p.max_ppl_increase_pct < 0) return 'max_ppl_increase_pct must be >= 0'
  return null
}

function intList(v, min, max) {
  return Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every((n) => Number.isInteger(n) && n >= min && n <= max)
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function basicAuth(password) {
  return (req, res, next) => {
    const [, b64 = ''] = (req.get('authorization') || '').split(' ')
    const pass = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':')
    if (safeEqual(pass, password)) return next()
    res.set('WWW-Authenticate', 'Basic realm="CPU-LLM"').status(401).send('Authentication required')
  }
}
