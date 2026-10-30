import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Empty, StatusBadge } from '../components/Kpi.jsx'
import { PowerResult } from '../components/KindViews.jsx'
import { ago, num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

// Power optimiser: sweep active cores for a model, measure tok/s and watts
// (RAPL where readable, estimated otherwise), recommend an operating point.
export default function Power({ agents, jobs, tuning, onStarted }) {
  const [f, setF] = useState({ agentId: '', model: '', precision: 'bf16', cores: '', idle_w: 15, tdp_w: 65, new_tokens: 16, repeats: 2, hard_offline: false, governor: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [full, setFull] = useState({})
  const mine = (jobs || []).filter((j) => j.summary?.kind === 'power')
  useEffect(() => { if (!f.agentId && agents?.length) setF((x) => ({ ...x, agentId: (agents.find((a) => a.online) || agents[0]).id })) }, [agents]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!f.model && tuning?.defaultModel) setF((x) => ({ ...x, model: tuning.defaultModel })) }, [tuning]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const j of mine.filter((x) => x.status === 'done').slice(0, 10)) if (!full[j.id]) api.job(j.id).then((x) => setFull((f2) => ({ ...f2, [j.id]: x }))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((j) => j.id + j.status).join()])
  const agent = agents?.find((a) => a.id === f.agentId)
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const start = async () => {
    setBusy(true); setErr(null)
    const cores = f.cores.split(',').map((x) => parseInt(x, 10)).filter(Number.isFinite)
    try {
      const { id } = await api.startTune({ agent_id: f.agentId, kind: 'power', model_id: f.model, precision: f.precision, core_counts: cores.length ? cores : null, idle_w: Number(f.idle_w), tdp_w: Number(f.tdp_w), new_tokens: Number(f.new_tokens), repeats: Number(f.repeats), hard_offline: f.hard_offline, governor: f.governor || null })
      onStarted?.(); go(`runs/${id}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const latest = mine.find((j) => j.status === 'done' && full[j.id]?.result)
  const linux = /linux/i.test(agent?.hardware?.os || '')
  return (
    <>
      <p className="muted">How many cores should this model run on? The optimiser pins the agent to 1, 2, 4 … all physical cores, measures decode speed and package power at each point (RAPL on Linux hosts; estimated from idle/TDP elsewhere, and labelled), and recommends an operating point for performance, balance or efficiency. With permission on Linux it can also take the other cores offline and set the cpufreq governor for the run.</p>
      <div className="grid two">
        <section className="card">
          <h2>Run the optimiser</h2>
          <div className="form">
            <div className="row three">
              <label>Machine<select value={f.agentId} onChange={set('agentId')}>{(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.online ? '' : ' (offline)'}</option>)}</select></label>
              <label>Model<select value={f.model} onChange={set('model')}>{(tuning?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
              <label>Precision<select value={f.precision} onChange={set('precision')}>{['fp32', 'bf16', 'fp16'].map((p) => <option key={p}>{p}</option>)}</select></label>
            </div>
            <div className="row three">
              <label>Core counts <span className="muted">(blank = 1,2,4,…,all)</span><input value={f.cores} onChange={set('cores')} placeholder={`e.g. 2,4,8,${agent?.hardware?.physical_cores || 16}`} /></label>
              <label>Idle W (if no RAPL)<input type="number" min="0" value={f.idle_w} onChange={set('idle_w')} /></label>
              <label>TDP W (if no RAPL)<input type="number" min="1" value={f.tdp_w} onChange={set('tdp_w')} /></label>
            </div>
            <div className="row three">
              <label>Tokens per step<input type="number" min="2" value={f.new_tokens} onChange={set('new_tokens')} /></label>
              <label>Repeats<input type="number" min="1" value={f.repeats} onChange={set('repeats')} /></label>
              <label>cpufreq governor (Linux, root)<input value={f.governor} onChange={set('governor')} placeholder="performance / powersave / schedutil" disabled={!linux} /></label>
            </div>
            <label className="check"><input type="checkbox" checked={f.hard_offline} onChange={set('hard_offline')} disabled={!linux} />Really take unused cores offline (Linux host, agent running as root; restored afterwards)</label>
            {err && <p className="error small">{err}</p>}
            <div className="actions sticky"><button type="button" disabled={busy || !f.agentId || !f.model} onClick={start}>{busy ? 'Queuing…' : agent?.online ? 'Run optimiser' : 'Queue (starts when online)'}</button></div>
          </div>
        </section>
        <section className="card">
          <h2>Recent optimiser runs</h2>
          {!mine.length && <Empty title="No power runs yet">Run the optimiser on a machine; the recommendation appears here.</Empty>}
          {mine.length > 0 && <div className="table-wrap"><table className="clickable"><thead><tr><th>When</th><th>Machine</th><th>Model</th><th>Status</th><th>Recommendation</th><th>Energy</th></tr></thead>
            <tbody>{mine.slice(0, 12).map((j) => <tr key={j.id} onClick={() => go(`runs/${j.id}`)}><td>{ago(j.created)}</td><td>{name(j.agentId)}</td><td>{j.model_id?.split('/').pop()}</td><td><StatusBadge status={j.status} /></td><td>{j.summary?.best || j.message}</td><td>{j.summary?.energy_source || ''}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {latest && <><h2>Latest: {name(latest.agentId)} · {latest.model_id?.split('/').pop()} <span className="muted small">{ago(latest.created)} · <a href={`#/runs/${latest.id}`}>open run</a></span></h2><PowerResult r={full[latest.id].result} /></>}
    </>
  )
}
