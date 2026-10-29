// Campaigns: one click queues a benchmark matrix (machines × models) with
// the same tuning parameters, tracks progress, and reads the results back as
// a matrix with regression verdicts against earlier runs of the same cell.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const MAX_QUEUED_PER_AGENT = 20

export class Campaigns {
  constructor(dataDir, store) {
    this.file = path.join(dataDir, 'campaigns.json')
    this.store = store
    this.items = readJson(this.file, {})
  }

  create({ name, agentIds, modelIds, params }) {
    const jobs = []
    for (const agentId of agentIds) {
      const queued = Object.values(this.store.jobs).filter((j) => j.agentId === agentId && j.status === 'queued').length
      if (queued + modelIds.length > MAX_QUEUED_PER_AGENT) throw new Error(`Agent ${agentId} would have more than ${MAX_QUEUED_PER_AGENT} queued runs`)
    }
    for (const agentId of agentIds) for (const model_id of modelIds) {
      const job = this.store.createJob(agentId, { ...params, model_id })
      jobs.push({ jobId: job.id, agentId, modelId: model_id })
    }
    const c = { id: crypto.randomBytes(4).toString('hex'), name: String(name || '').trim() || `Campaign ${new Date().toISOString().slice(0, 16)}`, created: Date.now(), params, agentIds, modelIds, jobs }
    this.items[c.id] = c
    this.save()
    return c
  }

  list() {
    return Object.values(this.items).sort((a, b) => b.created - a.created).map((c) => ({ ...c, progress: this.progress(c) }))
  }

  get(id) {
    const c = this.items[id]
    return c ? { ...c, progress: this.progress(c), matrix: this.matrix(c) } : null
  }

  remove(id, { deleteJobs = false } = {}) {
    const c = this.items[id]
    if (!c) return false
    if (deleteJobs) for (const { jobId } of c.jobs) { const j = this.store.jobs[jobId]; if (j && j.status !== 'running') this.store.deleteJob(j) }
    delete this.items[id]
    this.save()
    return true
  }

  progress(c) {
    const states = c.jobs.map(({ jobId }) => this.store.jobs[jobId]?.status || 'deleted')
    const count = (s) => states.filter((x) => x === s).length
    return { total: states.length, done: count('done'), error: count('error'), running: count('running'), queued: count('queued'), deleted: count('deleted') }
  }

  // One cell per (agent, model): best measured tok/s in this campaign and
  // the verdict against the most recent earlier finished run of that cell.
  matrix(c) {
    return c.jobs.map(({ jobId, agentId, modelId }) => {
      const job = this.store.jobs[jobId]
      const cell = { jobId, agentId, modelId, status: job?.status || 'deleted' }
      if (job?.status !== 'done' || !job.result) return cell
      const best = bestOf(job)
      const noise = job.result.baseline?.noise_pct ?? null
      const previous = Object.values(this.store.jobs)
        .filter((j) => j.id !== jobId && j.agentId === agentId && j.params.model_id === modelId && j.status === 'done' && j.result && j.created < job.created)
        .sort((a, b) => b.created - a.created)[0]
      const prevBest = previous ? bestOf(previous) : null
      const delta = prevBest ? (best.decode_tps / prevBest.decode_tps - 1) * 100 : null
      const band = Math.max(noise ?? 0, previous?.result?.baseline?.noise_pct ?? 0, 3)
      return {
        ...cell, decode_tps: best.decode_tps, config: best.name, precision: best.precision, threads: best.threads, noise_pct: noise,
        previous: prevBest ? { jobId: previous.id, decode_tps: prevBest.decode_tps, created: previous.created } : null,
        delta_pct: delta == null ? null : Math.round(delta * 10) / 10,
        verdict: delta == null ? 'first' : delta > band ? 'improved' : delta < -band ? 'regressed' : 'same',
      }
    })
  }

  csv(c) {
    const rows = [['campaign', 'machine', 'model', 'status', 'best_config', 'precision', 'threads', 'decode_tps', 'noise_pct', 'previous_tps', 'delta_pct', 'verdict', 'job_id']]
    for (const m of this.matrix(c)) {
      rows.push([c.name, this.store.agents[m.agentId]?.name || m.agentId, m.modelId, m.status, m.config, m.precision, m.threads, m.decode_tps, m.noise_pct, m.previous?.decode_tps, m.delta_pct, m.verdict, m.jobId])
    }
    return toCsv(rows)
  }

  save() { writeJson(this.file, this.items) }
}

// Flat CSV of every finished configuration on the server, for spreadsheets
// and notebooks.
export function runsCsv(store) {
  const rows = [['job_id', 'machine', 'model', 'device', 'finished', 'config', 'precision', 'threads', 'pruned_layers', 'decode_tps', 'speedup', 'significant', 'ttft_ms', 'perplexity', 'ppl_increase_pct', 'eval_accuracy', 'model_bytes', 'within_budget', 'selected', 'noise_pct', 'measured_bandwidth_gbs']]
  for (const j of Object.values(store.jobs).filter((x) => x.status === 'done' && x.result).sort((a, b) => a.created - b.created)) {
    const hw = j.result.hardware || {}
    const machine = store.agents[j.agentId]?.name || j.agentId
    for (const r of [j.result.baseline, ...(j.result.results || [])].filter((r) => r && !r.error)) {
      rows.push([j.id, machine, j.params.model_id, j.params.device || 'cpu', j.finished ? new Date(j.finished).toISOString() : '', r.name, r.precision, r.threads, r.pruned_layers, r.decode_tps, r.speedup ?? 1, r.significant ?? '', r.ttft_ms, r.perplexity, r.ppl_increase_pct ?? 0, r.eval_accuracy ?? '', r.model_bytes, r.within_budget ?? true, r.name === j.result.best, j.result.baseline?.noise_pct, hw.memory_bandwidth_gbs])
    }
  }
  return toCsv(rows)
}

function bestOf(job) {
  return (job.result.results || []).find((r) => r.name === job.result.best) || job.result.baseline
}

export function toCsv(rows) {
  const cell = (v) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n'
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}
