const BASE = import.meta.env.VITE_API_URL || ''

async function req(path, opts) {
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText)
  return res.json()
}

// Admin session token, kept for this browser tab only.
const SESSION = 'cpullm-admin'
const adminToken = () => { try { return sessionStorage.getItem(SESSION) } catch { return null } }
const adminReq = (path, method = 'GET', body) => req(path, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken()}` },
  body: body && JSON.stringify(body),
})

export const admin = {
  signedIn: () => !!adminToken(),
  login: async (password) => {
    const { token } = await req('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    try { sessionStorage.setItem(SESSION, token) } catch { /* private mode */ }
  },
  logout: () => { try { sessionStorage.removeItem(SESSION) } catch { /* private mode */ } },
  settings: () => adminReq('/api/admin/settings'),
  save: (patch) => adminReq('/api/admin/settings', 'PUT', patch),
  rotateToken: () => adminReq('/api/admin/agent-token', 'POST'),
  changePassword: async (current, next) => {
    const { token } = await adminReq('/api/admin/password', 'POST', { current, next })
    try { sessionStorage.setItem(SESSION, token) } catch { /* private mode */ }
  },
  removeAgent: (id) => adminReq(`/api/admin/agents/${id}`, 'DELETE'),
}

export const api = {
  config: () => req('/api/config'),
  agents: () => req('/api/agents'),
  telemetry: (agentId, since) => req(`/api/agents/${agentId}/telemetry?since=${since}`),
  jobs: (agentId) => req(agentId ? `/api/jobs?agent_id=${agentId}` : '/api/jobs'),
  startTune: (body) =>
    req('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  job: (id) => req(`/api/jobs/${id}`),
  deleteJob: (id) => req(`/api/jobs/${id}`, { method: 'DELETE' }),
  reportUrl: (id) => `${BASE}/api/jobs/${id}/report.md`,
  bundleUrl: (id) => `${BASE}/api/jobs/${id}/bundle.zip`,
}

// Mirrors cpullm.hardware.native_precisions on the agent side.
export function nativePrecisions(hw) {
  const isa = hw?.isa || {}
  const out = ['fp32']
  if (isa.avx512_bf16 || isa.amx_bf16) out.push('bf16')
  if (isa.avx512_vnni || isa.avx_vnni || isa.amx_int8) out.push('int8_dynamic')
  return out
}
