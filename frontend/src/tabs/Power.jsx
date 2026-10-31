import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Empty, StatusBadge } from '../components/Kpi.jsx'
import { PowerResult } from '../components/KindViews.jsx'
import { ago, num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

// Power optimiser. CPU: sweep active cores for a model, measure tok/s and
// watts (RAPL where readable, estimated otherwise), recommend an operating
// point. GPU: sweep the board power limit (nvidia-smi, root) and measure
// board power from the driver; without permission it measures the one
// point at the current limit and says so.
export default function Power({ agents, jobs, tuning, onStarted }) {
  const [f, setF] = useState({ agentId: '', device: 'cpu', model: '', precision: 'bf16', cores: '', limits: '', idle_w: 15, tdp_w: 65, new_tokens: 16, repeats: 2, hard_offline: false, governor: '' })
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
  const gpu = (agent?.hardware?.gpus || []).find((g) => g.torch_visible !== false)
  const driverOnly = !gpu && (agent?.hardware?.gpus || []).length > 0
  const isGpu = f.device === 'cuda' && !!gpu
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const ints = (s) => s.split(',').map((x) => parseInt(x, 10)).filter(Number.isFinite)
  const start = async () => {
    setBusy(true); setErr(null)
    try {
      const common = { agent_id: f.agentId, kind: 'power', device: isGpu ? 'cuda' : 'cpu', model_id: f.model, precision: f.precision, new_tokens: Number(f.new_tokens), repeats: Number(f.repeats) }
      const params = isGpu
        ? { ...common, power_limits: ints(f.limits).length ? ints(f.limits) : null, gpu_index: gpu.index ?? 0 }
        : { ...common, core_counts: ints(f.cores).length ? ints(f.cores) : null, idle_w: Number(f.idle_w), tdp_w: Number(f.tdp_w), hard_offline: f.hard_offline, governor: f.governor || null }
      const { id } = await api.startTune(params)
      onStarted?.(); go(`runs/${id}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const latest = mine.find((j) => j.status === 'done' && full[j.id]?.result)
  const linux = /linux/i.test(agent?.hardware?.os || '')
  const defaultLimits = gpu?.power_max_limit_w ? [1, 0.85, 0.7, 0.55].map((x) => Math.round(gpu.power_max_limit_w * x)).filter((w) => !gpu.power_min_limit_w || w >= gpu.power_min_limit_w).join(', ') : ''
  return (
    <>
      <p className="muted">Where should this model run? On a <strong>CPU</strong> the optimiser pins the agent to 1, 2, 4 … all physical cores, measures decode speed and package power at each point (RAPL on Linux hosts; estimated from idle/TDP elsewhere, and labelled), and recommends an operating point for performance, balance or efficiency; with permission on Linux it can also take the other cores offline and set the cpufreq governor. On a <strong>GPU</strong> it steps the board power limit down from the maximum and measures decode speed and board power from the driver at each step (changing the limit needs root; otherwise it reports the single point at the current limit).</p>
      <div className="grid two">
        <section className="card">
          <h2>Run the optimiser</h2>
          <div className="form">
            <div className="row three">
              <label>Machine<select value={f.agentId} onChange={set('agentId')}>{(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.online ? '' : ' (offline)'}</option>)}</select></label>
              <label>Device<select value={isGpu ? 'cuda' : 'cpu'} onChange={set('device')}><option value="cpu">CPU (active cores)</option><option value="cuda" disabled={!gpu}>GPU (power limit){gpu ? ` — ${gpu.name}` : driverOnly ? ' — needs the CUDA build' : ' — none on this machine'}</option></select></label>
              <label>Model<select value={f.model} onChange={set('model')}>{(tuning?.models || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            </div>
            {driverOnly && <p className="warn-text small">This machine has a GPU but its PyTorch is the CPU build: re-run the installer with CPULLM_DEVICE=cuda (<a href="/docs/gpu/">GPU guide</a>).</p>}
            {isGpu ? (
              <div className="row three">
                <label>Precision<select value={f.precision} onChange={set('precision')}>{['fp32', 'bf16', 'fp16'].map((p) => <option key={p}>{p}</option>)}</select></label>
                <label>Power limits W <span className="muted">(blank = max, 85 %, 70 %, 55 %)</span><input value={f.limits} onChange={set('limits')} placeholder={defaultLimits || 'e.g. 115, 95, 80, 65'} /></label>
                <label>Board limits<input value={gpu.power_limit_w != null ? `now ${gpu.power_limit_w} W · ${gpu.power_min_limit_w ?? '?'}–${gpu.power_max_limit_w ?? '?'} W` : 'not reported by the driver'} disabled /></label>
              </div>
            ) : (
              <>
                <div className="row three">
                  <label>Precision<select value={f.precision} onChange={set('precision')}>{['fp32', 'bf16', 'fp16'].map((p) => <option key={p}>{p}</option>)}</select></label>
                  <label>Core counts <span className="muted">(blank = 1,2,4,…,all)</span><input value={f.cores} onChange={set('cores')} placeholder={`e.g. 2,4,8,${agent?.hardware?.physical_cores || 16}`} /></label>
                  <label>Idle W (if no RAPL)<input type="number" min="0" value={f.idle_w} onChange={set('idle_w')} /></label>
                </div>
                <div className="row three">
                  <label>TDP W (if no RAPL)<input type="number" min="1" value={f.tdp_w} onChange={set('tdp_w')} /></label>
                  <label>cpufreq governor (Linux, root)<input value={f.governor} onChange={set('governor')} placeholder="performance / powersave / schedutil" disabled={!linux} /></label>
                  <label className="check mt"><input type="checkbox" checked={f.hard_offline} onChange={set('hard_offline')} disabled={!linux} />Really take unused cores offline (Linux, root; restored afterwards)</label>
                </div>
              </>
            )}
            <div className="row">
              <label>Tokens per step<input type="number" min="2" value={f.new_tokens} onChange={set('new_tokens')} /></label>
              <label>Repeats<input type="number" min="1" value={f.repeats} onChange={set('repeats')} /></label>
            </div>
            {err && <p className="error small">{err}</p>}
            <div className="actions sticky"><button type="button" disabled={busy || !f.agentId || !f.model} onClick={start}>{busy ? 'Queuing…' : agent?.online ? `Run optimiser on ${isGpu ? 'GPU' : 'CPU'}` : 'Queue (starts when online)'}</button></div>
          </div>
        </section>
        <section className="card">
          <h2>Recent optimiser runs</h2>
          {!mine.length && <Empty title="No power runs yet">Run the optimiser on a machine; the recommendation appears here.</Empty>}
          {mine.length > 0 && <div className="table-wrap"><table className="clickable"><thead><tr><th>When</th><th>Machine</th><th>Device</th><th>Model</th><th>Status</th><th>Recommendation</th><th>Energy</th></tr></thead>
            <tbody>{mine.slice(0, 12).map((j) => <tr key={j.id} onClick={() => go(`runs/${j.id}`)}><td>{ago(j.created)}</td><td>{name(j.agentId)}</td><td>{j.summary?.device || 'cpu'}</td><td>{j.model_id?.split('/').pop()}</td><td><StatusBadge status={j.status} /></td><td>{j.summary?.best || j.message}</td><td>{j.summary?.energy_source || ''}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {latest && <><h2>Latest: {name(latest.agentId)} · {latest.model_id?.split('/').pop()} <span className="muted small">{ago(latest.created)} · <a href={`#/runs/${latest.id}`}>open run</a></span></h2><PowerResult r={full[latest.id].result} /></>}
    </>
  )
}
