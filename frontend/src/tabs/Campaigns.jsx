import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { Kpi, Empty, StatusBadge } from '../components/Kpi.jsx'
import { ago, num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

const VERDICT = { improved: ['▲', 'ok'], regressed: ['▼', 'error'], same: ['•', 'muted'], first: ['', 'muted'] }

// A campaign is a benchmark matrix: machines × models with one set of
// tuning parameters, queued in one click. The detail view is the matrix
// with best tok/s per cell and a verdict against the previous run of the
// same cell, so a nightly campaign doubles as regression tracking.
export default function Campaigns({ agents, tuning, selectedId, onStarted }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const reload = () => api.campaigns().then(setList).catch((e) => setError(e.message))
  useEffect(() => { reload(); const t = setInterval(reload, 5000); return () => clearInterval(t) }, [])
  if (selectedId) return <CampaignDetail id={selectedId} agents={agents} />
  if (error) return <div className="card error">{error}</div>
  return (
    <>
      <div className="grid two">
        <NewCampaign agents={agents} tuning={tuning} onCreated={(c) => { reload(); onStarted?.(); go(`campaigns/${c.id}`) }} />
        <section className="card">
          <div className="head"><h2>Campaigns</h2><a className="ghost small button" href={api.runsCsvUrl()}>Export all runs (CSV)</a></div>
          {!list && <p className="muted">Loading…</p>}
          {list && !list.length && <Empty title="No campaigns yet">Pick machines and models on the left; every cell becomes a run and the results come back as a matrix.</Empty>}
          {list?.length > 0 && (
            <div className="table-wrap">
              <table className="clickable">
                <thead><tr><th>Name</th><th>Machines × models</th><th>Progress</th><th>When</th></tr></thead>
                <tbody>{list.map((c) => (
                  <tr key={c.id} onClick={() => go(`campaigns/${c.id}`)}>
                    <td><strong>{c.name}</strong></td><td>{c.agentIds.length} × {c.modelIds.length} = {c.jobs.length}</td>
                    <td><Progress p={c.progress} /></td><td className="muted small">{ago(c.created)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Progress({ p }) {
  const pct = p.total ? Math.round(((p.done + p.error) / p.total) * 100) : 0
  return (
    <div className="progress" title={`${p.done} done · ${p.running} running · ${p.queued} queued · ${p.error} failed`}>
      <div className="bar"><div style={{ width: `${pct}%` }} className={p.error ? 'warn' : ''} /></div>
      <span className="small muted">{p.done}/{p.total}{p.error ? ` · ${p.error} failed` : ''}{p.running ? ' · running' : ''}</span>
    </div>
  )
}

function NewCampaign({ agents, tuning, onCreated }) {
  const presets = tuning?.presets || {}
  const [name, setName] = useState('')
  const [agentIds, setAgentIds] = useState(() => new Set((agents || []).filter((a) => a.online).map((a) => a.id)))
  const [modelIds, setModelIds] = useState(() => new Set([tuning?.defaultModel].filter(Boolean)))
  const [preset, setPreset] = useState(tuning?.defaultPreset || Object.keys(presets)[0])
  const [device, setDevice] = useState('cpu')
  const [custom, setCustom] = useState('')
  const gpuOk = (a) => (a.hardware?.gpus || []).some((g) => g.torch_visible !== false)
  const anyGpu = (agents || []).some(gpuOk)
  // Switching to GPU drops machines that cannot run on one, so the matrix never queues runs that must fail.
  const pickDevice = (d) => { setDevice(d); if (d === 'cuda') setAgentIds(new Set([...agentIds].filter((id) => gpuOk(agents.find((a) => a.id === id) || {})))) }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { if (tuning && !modelIds.size) setModelIds(new Set([tuning.defaultModel])) }, [tuning]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (set, setter, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n) }
  const models = [...(tuning?.models || []), ...(custom.trim() && tuning?.allowCustomModels ? [{ id: custom.trim(), label: custom.trim() }] : [])]
  const total = agentIds.size * (modelIds.size + (custom.trim() ? 1 : 0))
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    const v = presets[preset]?.v || {}
    const ints = (s) => String(s ?? '').split(',').map((x) => parseInt(x, 10)).filter(Number.isFinite)
    try {
      const c = await api.createCampaign({
        name: name.trim(), agent_ids: [...agentIds], model_ids: [...modelIds, ...(custom.trim() ? [custom.trim()] : [])],
        params: { device, precisions: (v.precisions || ['fp32', 'bf16']).filter((p) => (device === 'cpu' ? p !== 'fp16' && p !== 'int4_weight_only' : p !== 'int8_dynamic')), prune_counts: ints(v.prune).length ? ints(v.prune) : [0], thread_counts: null, batch_sizes: ints(v.batch).length ? ints(v.batch) : [1], new_tokens: Number(v.tokens || 16), repeats: Number(v.repeats || 2), max_ppl_increase_pct: Number(v.ppl ?? 10), max_eval_drop_pts: Number(v.evalDrop ?? 5), run_eval: v.eval ?? true, profile: v.profile ?? false, compile: v.compile ?? false },
      })
      onCreated(c)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <section className="card">
      <h2>New campaign</h2>
      <p className="muted small">Every machine × model becomes a run with the chosen preset; machines work through their queue in order, offline machines start when they connect.</p>
      <form className="form" onSubmit={submit}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="nightly SmolLM2 across the fleet" /></label>
        <label>Device
          <select value={device} onChange={(e) => pickDevice(e.target.value)}><option value="cpu">CPU</option><option value="cuda" disabled={!anyGpu}>GPU (CUDA / ROCm){anyGpu ? '' : ' — no machine with a usable GPU'}</option></select>
        </label>
        <fieldset><legend>Machines ({agentIds.size})</legend>
          <div className="checks">{(agents || []).map((a) => <label key={a.id} className={`check ${device === 'cuda' && !gpuOk(a) ? 'disabled' : ''}`}><input type="checkbox" checked={agentIds.has(a.id)} disabled={device === 'cuda' && !gpuOk(a)} onChange={() => toggle(agentIds, setAgentIds, a.id)} />{a.name}{!a.online && <span className="muted"> (offline)</span>}{device === 'cuda' && !gpuOk(a) && <span className="muted"> (no GPU)</span>}</label>)}</div>
          {!agents?.length && <p className="muted small">No machines connected yet.</p>}
        </fieldset>
        <fieldset><legend>Models ({modelIds.size + (custom.trim() ? 1 : 0)})</legend>
          <div className="checks">{models.filter((m) => m.id !== custom.trim()).map((m) => <label key={m.id} className="check"><input type="checkbox" checked={modelIds.has(m.id)} onChange={() => toggle(modelIds, setModelIds, m.id)} />{m.label}</label>)}</div>
          {tuning?.allowCustomModels && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="+ any Hugging Face model id" />}
        </fieldset>
        <label>Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label} · {p.desc}</option>)}</select>
        </label>
        {err && <p className="error small">{err}</p>}
        <div className="actions sticky"><button type="submit" disabled={busy || !total}>{busy ? 'Queuing…' : `Queue ${total} run${total === 1 ? '' : 's'}`}</button></div>
      </form>
    </section>
  )
}

function CampaignDetail({ id, agents }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api.campaign(id).then(setC).catch((e) => setError(e.message))
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (aid) => agents?.find((a) => a.id === aid)?.name || aid
  const grid = useMemo(() => {
    if (!c) return null
    const byAgent = {}
    for (const m of c.matrix) (byAgent[m.agentId] ||= {})[m.modelId] = m
    return byAgent
  }, [c])
  if (error) return <div className="card error">{error}</div>
  if (!c) return <p className="muted">Loading…</p>
  const done = c.matrix.filter((m) => m.status === 'done')
  const verdicts = (v) => done.filter((m) => m.verdict === v).length
  const remove = async () => {
    if (!window.confirm(`Delete campaign "${c.name}"? Its runs stay unless you also confirm the next prompt.`)) return
    const withJobs = window.confirm('Also delete the runs it created?')
    await api.deleteCampaign(c.id, withJobs); go('campaigns')
  }
  return (
    <>
      <div className="head">
        <h2><a href="#/campaigns">Campaigns</a> › {c.name}</h2>
        <div className="actions"><a className="ghost small button" href={api.campaignCsvUrl(c.id)}>Export CSV</a><button className="ghost small danger" onClick={remove}>Delete</button></div>
      </div>
      <div className="kpis">
        <Kpi label="Progress" value={`${c.progress.done}/${c.progress.total}`} sub={`${c.progress.running} running · ${c.progress.queued} queued · ${c.progress.error} failed`} tone={c.progress.done === c.progress.total ? 'good' : ''} />
        <Kpi label="Improved" value={verdicts('improved')} sub="vs the previous run of the same cell" tone={verdicts('improved') ? 'good' : ''} />
        <Kpi label="Regressed" value={verdicts('regressed')} sub="beyond the noise band" />
        <Kpi label="Unchanged / first" value={`${verdicts('same')} / ${verdicts('first')}`} sub={`preset: ${c.params.precisions?.join(', ')} · ${c.params.new_tokens} tokens × ${c.params.repeats}`} />
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Machine</th>{c.modelIds.map((m) => <th key={m}>{m.split('/').pop()}</th>)}</tr></thead>
            <tbody>{c.agentIds.map((aid) => (
              <tr key={aid}><td><strong>{name(aid)}</strong></td>{c.modelIds.map((mid) => <td key={mid}><Cell m={grid[aid]?.[mid]} /></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted small">Each cell: best decode tok/s of the run, its configuration, and ▲ improved / ▼ regressed / • unchanged against the most recent earlier run of that machine and model (band = the larger of the two runs' noise, at least 3%). Click a cell to open the run.</p>
      </section>
    </>
  )
}

function Cell({ m }) {
  if (!m) return <span className="muted">—</span>
  if (m.status !== 'done') return <a href={`#/runs/${m.jobId}`}><StatusBadge status={m.status} /></a>
  const [mark, cls] = VERDICT[m.verdict] || VERDICT.first
  return (
    <a href={`#/runs/${m.jobId}`} className="cell">
      <strong>{num(m.decode_tps, 1)}</strong> tok/s {mark && <span className={cls} title={`${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}% vs ${num(m.previous?.decode_tps, 1)} (${ago(m.previous?.created)})`}>{mark} {m.delta_pct > 0 ? '+' : ''}{m.delta_pct}%</span>}
      <div className="muted small">{m.config}{m.noise_pct != null ? ` · ±${m.noise_pct}%` : ''}</div>
    </a>
  )
}
