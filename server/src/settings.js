// Admin-controlled settings, persisted as DATA_DIR/settings.json.
// Environment variables only seed a fresh install; after that the Admin tab
// is the source of truth (except ADMIN_PASSWORD_RESET, a recovery hatch).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const ALL_PRECISIONS = ['fp32', 'bf16', 'fp16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only']
export const ALL_DEVICES = ['cpu', 'cuda']
// Hub ids only: each part must start alphanumeric, so "../x" or "/abs" (local paths) are rejected.
export const MODEL_ID = /^(builtin:[\w-]+|[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)$/

const ALL_PREC = ['fp32', 'bf16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only', 'fp16']

export const DEFAULTS = {
  site: { title: 'CPU-LLM', tagline: 'Hardware-aware LLM tuning' },
  access: { dashboardLogin: false },
  agents: { allowRegistration: true, onlineTimeoutSec: 15, telemetryWindow: 300 },
  tuning: {
    models: [
      { id: 'builtin:tiny-llama', label: 'Built-in tiny Llama (offline, random weights)' },
      { id: 'HuggingFaceTB/SmolLM2-135M', label: 'SmolLM2 135M' },
      { id: 'HuggingFaceTB/SmolLM2-360M', label: 'SmolLM2 360M' },
      { id: 'Qwen/Qwen2.5-0.5B', label: 'Qwen2.5 0.5B' },
      { id: 'meta-llama/Llama-3.2-1B', label: 'Llama 3.2 1B (gated: needs HF login on the agent)' },
    ],
    defaultModel: 'HuggingFaceTB/SmolLM2-135M',
    allowCustomModels: true,
    precisions: [...ALL_PRECISIONS],
    devices: [...ALL_DEVICES],
    limits: { maxNewTokens: 256, maxRepeats: 10, maxBatch: 256, maxThreads: 1024, maxPrune: 64, maxListItems: 16 },
    defaultPreset: 'full',
    presets: {
      quick: { label: 'Quick check', desc: '~1 min', v: { precisions: ['fp32', 'bf16'], prune: '0', batch: '1', eval: true, profile: false, compile: false, tokens: 16, repeats: 2 } },
      full: { label: 'Full sweep', desc: 'all precisions, pruning, batching', v: { precisions: ALL_PREC, prune: '0, 2', batch: '1, 4, 16', eval: true, profile: true, compile: false, tokens: 32, repeats: 3 } },
      accuracy: { label: 'Accuracy-first', desc: 'tight budgets, no pruning', v: { precisions: ['fp32', 'bf16', 'int8_weight_only'], prune: '0', batch: '1', eval: true, profile: true, compile: false, tokens: 32, repeats: 3, ppl: 2, evalDrop: 1 } },
      max: { label: 'Max speed', desc: 'adds torch.compile (slow to tune)', v: { precisions: ['bf16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only', 'fp16'], prune: '0, 2, 4', batch: '1, 8', eval: true, profile: true, compile: true, tokens: 32, repeats: 3, ppl: 15, evalDrop: 5 } },
    },
  },
  retention: { maxRuns: 0, deleteAfterDays: 0 },
  // AI advisor (Claude). The API key lives in secrets and never leaves the server.
  ai: { enabled: false, model: 'claude-opus-5-5', effort: 'medium', maxTokens: 4000 },
}

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const AI_MODEL = /^claude-[a-z0-9.-]{2,60}$/

export class Settings {
  constructor(dataDir, { agentToken, dashboardPassword, adminPassword, adminPasswordReset } = {}) {
    this.file = path.join(dataDir, 'settings.json')
    const saved = readJson(this.file)
    this.data = merge(structuredClone(DEFAULTS), saved || {})
    const s = this.data.secrets ||= {}
    // Seed a fresh install from the environment.
    if (!s.agentToken) s.agentToken = agentToken || randomToken()
    if (!saved && dashboardPassword) {
      s.dashboardHash = hashPassword(dashboardPassword)
      this.data.access.dashboardLogin = true
    }
    if (!s.adminHash && adminPassword) s.adminHash = hashPassword(adminPassword)
    if (adminPasswordReset) s.adminHash = hashPassword(adminPasswordReset)
    if (!s.sessionKey) s.sessionKey = randomToken()
    this.save()
  }

  get agentToken() { return this.data.secrets.agentToken }
  get adminConfigured() { return !!this.data.secrets.adminHash }
  get dashboardLoginOn() { return this.data.access.dashboardLogin && !!this.data.secrets.dashboardHash }
  get aiReady() { return this.data.ai.enabled && !!this.data.secrets.anthropicKey }
  get anthropicKey() { return this.data.secrets.anthropicKey }

  checkAdmin(password) { return verifyPassword(password, this.data.secrets.adminHash) }
  checkDashboard(password) { return verifyPassword(password, this.data.secrets.dashboardHash) }

  setAdminPassword(password) {
    this.data.secrets.adminHash = hashPassword(password)
    this.data.secrets.sessionKey = randomToken() // signs everyone out
    this.save()
  }

  rotateAgentToken() {
    this.data.secrets.agentToken = randomToken()
    this.save()
    return this.data.secrets.agentToken
  }

  // Admin sessions: "<expiry>.<hmac>", signed with a key that changes with the admin password.
  issueSession(ttlMs = 12 * 3600_000) {
    const exp = String(Date.now() + ttlMs)
    return `${exp}.${this.#sign(exp)}`
  }

  checkSession(token) {
    const [exp, mac] = String(token || '').split('.')
    return !!exp && Number(exp) > Date.now() && safeEqual(mac || '', this.#sign(exp))
  }

  #sign(v) { return crypto.createHmac('sha256', this.data.secrets.sessionKey).update(v).digest('hex') }

  // Everything an admin may see (password hashes and the session key stay hidden).
  forAdmin() {
    const { secrets, ...rest } = this.data
    return { ...rest, agentToken: secrets.agentToken, hasDashboardPassword: !!secrets.dashboardHash, hasAnthropicKey: !!secrets.anthropicKey }
  }

  // What the dashboard needs, safe to show without the admin password.
  forPublic() {
    const { site, tuning, ai } = this.data
    return { site, tuning, ai: { enabled: this.aiReady, model: ai.model } }
  }

  // Apply a partial update from the Admin tab. Returns an error string or null.
  update(patch) {
    const next = merge(structuredClone(this.data), pick(patch, ['site', 'access', 'agents', 'tuning', 'retention', 'ai']))
    if (patch && 'anthropicKey' in patch) {
      const k = patch.anthropicKey
      if (k === null) delete next.secrets.anthropicKey
      else if (typeof k !== 'string' || !/^sk-ant-[\w-]{20,}$/.test(k.trim())) return 'That does not look like an Anthropic API key (sk-ant-…)'
      else next.secrets.anthropicKey = k.trim()
    }
    if (Array.isArray(patch?.tuning?.models)) next.tuning.models = patch.tuning.models
    if (patch?.tuning?.presets) next.tuning.presets = patch.tuning.presets
    const err = validate(next)
    if (err) return err
    if (patch && 'dashboardPassword' in patch) {
      const p = patch.dashboardPassword
      if (p === null) delete next.secrets.dashboardHash
      else if (typeof p !== 'string' || p.length < 8) return 'Dashboard password must be at least 8 characters'
      else next.secrets.dashboardHash = hashPassword(p)
    }
    if (next.access.dashboardLogin && !next.secrets.dashboardHash) return 'Set a dashboard password before turning login on'
    this.data = next
    this.save()
    return null
  }

  save() { writeJson(this.file, this.data) }
}

function validate(d) {
  const t = d.tuning, L = t.limits
  if (!str(d.site.title, 1, 60) || !str(d.site.tagline, 0, 120)) return 'Site title (1-60) and tagline (0-120 characters) are required'
  if (typeof d.access.dashboardLogin !== 'boolean') return 'dashboardLogin must be true or false'
  if (typeof d.agents.allowRegistration !== 'boolean') return 'allowRegistration must be true or false'
  if (!int(d.agents.onlineTimeoutSec, 5, 600)) return 'Online timeout must be 5-600 seconds'
  if (!int(d.agents.telemetryWindow, 30, 3600)) return 'Telemetry window must be 30-3600 samples'
  if (!Array.isArray(t.models) || t.models.length > 100) return 'Models must be a list of up to 100'
  for (const m of t.models)
    if (!MODEL_ID.test(m?.id || '') || !str(m.label, 1, 120)) return `Invalid model entry: ${m?.id || '(empty)'}`
  if (!t.models.some((m) => m.id === t.defaultModel) && !(t.allowCustomModels && MODEL_ID.test(t.defaultModel || '')))
    return 'Default model must be one of the listed models'
  if (typeof t.allowCustomModels !== 'boolean') return 'allowCustomModels must be true or false'
  if (!t.models.length && !t.allowCustomModels) return 'List at least one model or allow custom models'
  if (!subset(t.precisions, ALL_PRECISIONS)) return `Precisions must be a non-empty subset of ${ALL_PRECISIONS.join(', ')}`
  if (!subset(t.devices, ALL_DEVICES)) return `Devices must be a non-empty subset of ${ALL_DEVICES.join(', ')}`
  const bounds = { maxNewTokens: [2, 4096], maxRepeats: [1, 50], maxBatch: [1, 4096], maxThreads: [1, 4096], maxPrune: [0, 256], maxListItems: [1, 64] }
  for (const [k, [lo, hi]] of Object.entries(bounds)) if (!int(L[k], lo, hi)) return `${k} must be ${lo}-${hi}`
  if (!t.presets || typeof t.presets !== 'object' || !Object.keys(t.presets).length) return 'At least one preset is required'
  for (const [k, p] of Object.entries(t.presets)) {
    if (!/^[\w-]{1,32}$/.test(k) || !str(p?.label, 1, 40) || !str(p?.desc ?? '', 0, 80) || typeof p?.v !== 'object')
      return `Preset "${k}" needs a label, a description and settings (v)`
    if (!Array.isArray(p.v.precisions) || p.v.precisions.some((x) => !ALL_PRECISIONS.includes(x)))
      return `Preset "${k}" has unknown precisions`
  }
  if (!t.presets[t.defaultPreset]) return 'Default preset must be one of the presets'
  if (!int(d.retention.maxRuns, 0, 100000) || !int(d.retention.deleteAfterDays, 0, 3650))
    return 'Retention values must be whole numbers (0 = keep everything)'
  if (typeof d.ai.enabled !== 'boolean') return 'ai.enabled must be true or false'
  if (!AI_MODEL.test(d.ai.model || '')) return 'AI model must be a Claude model id such as claude-opus-5-5'
  if (!AI_EFFORTS.includes(d.ai.effort)) return `AI effort must be one of ${AI_EFFORTS.join(', ')}`
  if (!int(d.ai.maxTokens, 256, 16000)) return 'AI max tokens must be 256-16000'
  return null
}

// ---- helpers ----
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(password), salt, 32).toString('hex')}`
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false
  const [, salt, hash] = stored.split('$')
  return safeEqual(crypto.scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex'), hash)
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const randomToken = () => crypto.randomBytes(32).toString('hex')
const str = (v, lo, hi) => typeof v === 'string' && v.trim().length >= lo && v.length <= hi
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const subset = (v, all) => Array.isArray(v) && v.length > 0 && v.every((x) => all.includes(x))
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]))

// Deep merge of plain objects; arrays and scalars from `src` replace those in `dst`.
function merge(dst, src) {
  for (const [k, v] of Object.entries(src || {})) {
    dst[k] = v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])
      ? merge(dst[k], v) : v
  }
  return dst
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}
