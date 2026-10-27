const BASE = import.meta.env.VITE_API_URL || ''

async function req(path, opts) {
  const res = await fetch(BASE + path, opts)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText)
  return res.json()
}

export const api = {
  hardware: () => req('/api/hardware'),
  startTune: (body) =>
    req('/api/tune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  job: (id) => req(`/api/jobs/${id}`),
  reportUrl: (id) => `${BASE}/api/jobs/${id}/report.md`,
  bundleUrl: (id) => `${BASE}/api/jobs/${id}/bundle.zip`,
  telemetrySocket: () => {
    const http = BASE || window.location.origin
    return new WebSocket(http.replace(/^http/, 'ws') + '/api/telemetry')
  },
}
