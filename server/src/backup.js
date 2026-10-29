// Backup and restore of everything in DATA_DIR as one JSON bundle (gzipped
// on the wire): settings with secrets, machines, campaigns, the audit log and
// every run with its report and bundle. Restoring writes the files and the
// process restarts so the in-memory stores reload.
import fs from 'node:fs'
import path from 'node:path'

export const BUNDLE_VERSION = 1

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const readText = (f) => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }
const readB64 = (f) => { try { return fs.readFileSync(f).toString('base64') } catch { return null } }

export function backupBundle(dataDir) {
  const jobsDir = path.join(dataDir, 'jobs')
  const jobs = []
  for (const id of fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : []) {
    const job = readJson(path.join(jobsDir, id, 'job.json'))
    if (job) jobs.push({ job, report_md: readText(path.join(jobsDir, id, 'report.md')), bundle_b64: readB64(path.join(jobsDir, id, 'bundle.zip')) })
  }
  return {
    version: BUNDLE_VERSION, created: Date.now(),
    settings: readJson(path.join(dataDir, 'settings.json')),
    agents: readJson(path.join(dataDir, 'agents.json')) || {},
    campaigns: readJson(path.join(dataDir, 'campaigns.json')) || {},
    audit: readText(path.join(dataDir, 'audit.log')) || '',
    jobs,
  }
}

// Returns what was written, or throws on a bundle that is not ours.
export function restoreBundle(dataDir, b) {
  if (!b || b.version !== BUNDLE_VERSION || !b.settings || typeof b.settings !== 'object') throw new Error('Not a CPU-LLM backup bundle (version 1 with settings)')
  if (!Array.isArray(b.jobs)) throw new Error('Bundle has no jobs list')
  for (const j of b.jobs) if (!j.job?.id || !/^[a-f0-9]{8}$/.test(j.job.id)) throw new Error('Bundle contains a job with an invalid id')
  fs.mkdirSync(path.join(dataDir, 'jobs'), { recursive: true })
  const write = (name, data) => fs.writeFileSync(path.join(dataDir, name), data)
  write('settings.json', JSON.stringify(b.settings, null, 2))
  write('agents.json', JSON.stringify(b.agents || {}, null, 2))
  write('campaigns.json', JSON.stringify(b.campaigns || {}, null, 2))
  write('audit.log', b.audit || '')
  for (const { job, report_md, bundle_b64 } of b.jobs) {
    const dir = path.join(dataDir, 'jobs', job.id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job))
    if (report_md != null) fs.writeFileSync(path.join(dir, 'report.md'), report_md)
    if (bundle_b64 != null) fs.writeFileSync(path.join(dir, 'bundle.zip'), Buffer.from(bundle_b64, 'base64'))
  }
  return { jobs: b.jobs.length, agents: Object.keys(b.agents || {}).length, campaigns: Object.keys(b.campaigns || {}).length }
}
