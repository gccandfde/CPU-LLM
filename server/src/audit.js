// Append-only audit log of every change made through the API: who (admin
// session, agent, dashboard user), what (method + path), result, when.
// One JSON object per line in DATA_DIR/audit.log; admins read the tail.
import fs from 'node:fs'
import path from 'node:path'

const SKIP = [/\/telemetry$/, /\/jobs\/[^/]+\/events$/, /\/next-job$/, /\/api\/ai\/ask$/]

export class Audit {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'audit.log')
    fs.mkdirSync(dataDir, { recursive: true })
  }

  write(entry) {
    fs.appendFileSync(this.file, JSON.stringify({ ts: Date.now(), ...entry }) + '\n')
  }

  // Last `limit` entries, newest first.
  tail(limit = 200) {
    let text = ''
    try { text = fs.readFileSync(this.file, 'utf8') } catch { return [] }
    const lines = text.trim().split('\n').filter(Boolean)
    return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }

  // Express middleware: records every non-GET API call once the response is
  // finished (so the status code is known). Who made it is read from the
  // request after the routers have authenticated it.
  middleware() {
    return (req, res, next) => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || !req.path.startsWith('/api/') || SKIP.some((re) => re.test(req.path))) return next()
      res.on('finish', () => {
        const url = req.originalUrl.split('?')[0]
        const actor = req.apiKey ? `key:${req.apiKey.name}`
          : req.agent ? `agent:${req.agent.name || req.agent.id}`
            : url.startsWith('/api/agent/') ? 'agent'
              : url.startsWith('/api/admin') ? (res.statusCode < 400 ? 'admin' : 'admin?')
                : req.dashboardUser ? `user:${req.dashboardUser}` : 'dashboard'
        this.write({ actor, ip: req.ip, method: req.method, path: url, status: res.statusCode, summary: summarize(req) })
      })
      next()
    }
  }
}

// A short, secret-free description of what the request changed.
function summarize(req) {
  const b = req.body
  if (!b || typeof b !== 'object') return undefined
  const keys = Object.keys(b).filter((k) => !/password|token|key|secret/i.test(k))
  const out = {}
  for (const k of keys.slice(0, 8)) {
    const v = b[k]
    out[k] = typeof v === 'string' ? v.slice(0, 80) : Array.isArray(v) ? `[${v.length}]` : typeof v === 'object' && v ? '{…}' : v
  }
  return out
}
