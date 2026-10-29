// Prometheus text exposition for the fleet: agents, jobs, campaigns, and the
// best measured decode speed per machine and model. Scrape /metrics.
export function metrics({ store, campaigns, settings }) {
  const lines = []
  const gauge = (name, help, rows) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`)
    for (const [labels, value] of rows) {
      const l = Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',')
      lines.push(`${name}${l ? `{${l}}` : ''} ${value}`)
    }
  }
  const agents = store.listAgents()
  gauge('cpullm_agents', 'Registered agents by online state', [[{ state: 'online' }, agents.filter((a) => a.online).length], [{ state: 'offline' }, agents.filter((a) => !a.online).length]])
  const jobs = Object.values(store.jobs)
  gauge('cpullm_jobs', 'Tuning jobs by status', ['queued', 'running', 'done', 'error'].map((s) => [{ status: s }, jobs.filter((j) => j.status === s).length]))
  gauge('cpullm_campaigns', 'Campaigns on this server', [[{}, campaigns.list().length]])
  gauge('cpullm_ai_advisor_enabled', 'Whether the AI advisor is configured and on', [[{}, settings.aiReady ? 1 : 0]])
  const best = {}
  for (const j of jobs.filter((x) => x.status === 'done' && x.result)) {
    const r = (j.result.results || []).find((x) => x.name === j.result.best) || j.result.baseline
    const key = `${j.agentId}|${j.params.model_id}`
    if (!best[key] || j.finished > best[key].finished) best[key] = { finished: j.finished, tps: r.decode_tps, machine: store.agents[j.agentId]?.name || j.agentId, model: j.params.model_id, config: r.name }
  }
  gauge('cpullm_latest_decode_tps', 'Latest best decode tokens/s per machine and model', Object.values(best).map((b) => [{ machine: b.machine, model: b.model, config: b.config }, b.tps]))
  gauge('cpullm_agent_memory_bandwidth_gbs', 'Measured memory bandwidth per agent', agents.map((a) => [{ machine: a.name }, a.hardware?.memory_bandwidth_gbs ?? 0]))
  return lines.join('\n') + '\n'
}
