// File-backed store for agents and jobs. Small, dependency-free, and fine for
// a single Node process (which is what Hostinger runs).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const TELEMETRY_WINDOW = 300 // samples kept per agent (~5 min at 1 Hz)
const ONLINE_MS = 15_000

export class Store {
  constructor(dataDir) {
    this.dir = dataDir
    this.jobsDir = path.join(dataDir, 'jobs')
    fs.mkdirSync(this.jobsDir, { recursive: true })
    this.agentsFile = path.join(dataDir, 'agents.json')
    this.agents = readJson(this.agentsFile, {})
    this.jobs = {}
    for (const id of fs.readdirSync(this.jobsDir)) {
      const job = readJson(path.join(this.jobsDir, id, 'job.json'), null)
      if (job) this.jobs[id] = job
    }
    this.telemetry = {} // agentId -> samples (in memory only)
  }

  // ---- agents ----
  registerAgent({ name, hardware }) {
    const fp = hardware?.fingerprint || 'unknown'
    // Same name + same machine class re-registers as the same agent.
    const existing = Object.values(this.agents).find((a) => a.name === name && a.hardware?.fingerprint === fp)
    const agent = existing || { id: newId(), name, created: Date.now() }
    Object.assign(agent, { hardware, lastSeen: Date.now() })
    this.agents[agent.id] = agent
    this.saveAgents()
    // A (re)registering agent isn't running anything, so any job it had
    // claimed died with its previous process.
    for (const job of Object.values(this.jobs)) {
      if (job.agentId === agent.id && job.status === 'running') {
        Object.assign(job, { status: 'error', error: 'Agent restarted during the job', message: 'Failed' })
        this.saveJob(job)
      }
    }
    return agent
  }

  touchAgent(id) {
    const a = this.agents[id]
    if (a) a.lastSeen = Date.now()
    return a
  }

  listAgents() {
    return Object.values(this.agents).map((a) => ({ ...a, online: Date.now() - a.lastSeen < ONLINE_MS }))
  }

  addTelemetry(agentId, samples) {
    const buf = (this.telemetry[agentId] ||= [])
    buf.push(...samples)
    if (buf.length > TELEMETRY_WINDOW) buf.splice(0, buf.length - TELEMETRY_WINDOW)
  }

  getTelemetry(agentId, since = 0) {
    return (this.telemetry[agentId] || []).filter((s) => s.ts > since)
  }

  saveAgents() {
    writeJson(this.agentsFile, this.agents)
  }

  // ---- jobs ----
  createJob(agentId, params) {
    const job = {
      id: newId(), agentId, params, status: 'queued', created: Date.now(),
      progress: 0, message: 'Queued', results: [], result: null, error: null,
    }
    this.jobs[job.id] = job
    this.saveJob(job)
    return job
  }

  claimNextJob(agentId) {
    const job = Object.values(this.jobs)
      .filter((j) => j.agentId === agentId && j.status === 'queued')
      .sort((a, b) => a.created - b.created)[0]
    if (!job) return null
    Object.assign(job, { status: 'running', started: Date.now(), message: 'Starting' })
    this.saveJob(job)
    return job
  }

  // Events have the shape produced by the Python tuner's on_progress callback.
  applyEvent(job, e) {
    if (e.message) job.message = e.message
    if (e.stage === 'candidate') job.progress = e.index / e.total
    if (e.stage === 'result') job.results.push(e.result)
    this.saveJob(job)
  }

  completeJob(job, { result, reportMd, bundle, error }) {
    const dir = path.join(this.jobsDir, job.id)
    if (error) {
      Object.assign(job, { status: 'error', error, message: 'Failed' })
    } else {
      fs.writeFileSync(path.join(dir, 'report.md'), reportMd || '')
      fs.writeFileSync(path.join(dir, 'bundle.zip'), bundle)
      // The final results are re-scored against the re-measured baseline, so they
      // supersede the provisional ones streamed during the sweep.
      Object.assign(job, { status: 'done', result, results: result.results || job.results, progress: 1, message: 'Done' })
    }
    job.finished = Date.now()
    this.saveJob(job)
  }

  artifactPath(job, name) {
    return path.join(this.jobsDir, job.id, name)
  }

  listJobs(agentId) {
    return Object.values(this.jobs)
      .filter((j) => !agentId || j.agentId === agentId)
      .sort((a, b) => b.created - a.created)
      .map((j) => ({
        id: j.id, agentId: j.agentId, status: j.status, created: j.created, finished: j.finished,
        message: j.message, progress: j.progress, model_id: j.params.model_id, device: j.params.device || 'cpu',
        summary: summarize(j.result),
      }))
  }

  deleteJob(job) {
    delete this.jobs[job.id]
    fs.rmSync(path.join(this.jobsDir, job.id), { recursive: true, force: true })
  }

  saveJob(job) {
    const dir = path.join(this.jobsDir, job.id)
    fs.mkdirSync(dir, { recursive: true })
    writeJson(path.join(dir, 'job.json'), job)
  }
}

// The headline numbers of a finished run, so list views don't need full results.
function summarize(result) {
  if (!result) return null
  const best = result.results.find((r) => r.name === result.best) || result.baseline
  const base = result.baseline
  return {
    best: result.best,
    decode_tps: best.decode_tps,
    baseline_tps: base.decode_tps,
    speedup: best.speedup ?? 1,
    noise_pct: base.noise_pct ?? null,
    ttft_ms: best.ttft_ms,
    model_mb: Math.round(best.model_bytes / 1e5) / 10,
    baseline_mb: Math.round(base.model_bytes / 1e5) / 10,
    perplexity: best.perplexity,
    eval_accuracy: best.eval?.accuracy ?? null,
    baseline_eval_accuracy: base.eval?.accuracy ?? null,
    joules_per_token: best.joules_per_token ?? null,
    transforms: result.recipe.transforms,
    device: result.recipe.runtime.device || 'cpu',
    threads: result.recipe.runtime.threads,
    candidates: result.results.length,
  }
}

function newId() {
  return crypto.randomBytes(4).toString('hex')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  // Write-then-rename so a crash never leaves a half-written file.
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}
