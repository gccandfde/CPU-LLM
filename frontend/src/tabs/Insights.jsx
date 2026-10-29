import React, { useEffect, useMemo, useState } from 'react'
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ZAxis } from 'recharts'
import { api } from '../api.js'
import { Panel, tooltipStyle } from '../components/charts.jsx'
import { Kpi, Empty } from '../components/Kpi.jsx'
import { calibrate, projectTps } from '../lib/archmodel.js'
import { summary, percentile, knn } from '../lib/stats.js'
import { loadCalibration, saveCalibration } from '../lib/designs.js'
import { ago, num } from '../lib/format.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const MAX_JOBS = 40

// Measured runs are the ground truth. This tab turns them into: the
// bandwidth efficiency the projections should assume (calibration), noise
// bands and significance, a predictor for machines you have not measured, a
// machine × model benchmark matrix, and an AI advisor that reasons over all
// of it.
export default function Insights({ agents, jobs, ai, section }) {
  const [full, setFull] = useState({})
  const done = useMemo(() => (jobs || []).filter((j) => j.status === 'done').slice(0, MAX_JOBS), [jobs])
  useEffect(() => {
    for (const j of done) if (!full[j.id]) api.job(j.id).then((x) => setFull((f) => ({ ...f, [j.id]: x }))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done.map((j) => j.id).join()])

  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const runs = done.map((j) => full[j.id]).filter((j) => j?.result?.baseline)

  // Calibration rows: one per measured configuration across every run.
  const cal = useMemo(() => runs.flatMap((j) => {
    const hw = j.result.hardware || {}
    const c = calibrate([j.result.baseline, ...j.result.results.filter((r) => !r.error)], hw.memory_bandwidth_gbs)
    return c.rows.map((r) => ({ ...r, jobId: j.id, machine: name(j.agentId), model: j.params.model_id.split('/').pop(), measuredGbs: hw.memory_bandwidth_gbs, cores: hw.physical_cores, when: j.finishedAt || j.createdAt }))
  }), [runs, agents])
  const effs = cal.map((r) => r.efficiency).filter((x) => x != null && Number.isFinite(x))
  const stats = effs.length ? summary(effs) : null
  const [applied, setApplied] = useState(loadCalibration)

  if (!jobs) return <p className="muted">Loading…</p>

  return (
    <>
      <p className="muted">
        Everything here is derived from measured runs: how much of each machine's bandwidth the runs really achieved (the number the Designer and Planner should assume),
        how noisy each machine is, what a machine you have not measured would do, which machine × model cells are still unmeasured, and an advisor that reasons over the numbers.
      </p>

      {!done.length && <Empty title="No measured runs yet">Finish a <a href="#/tune">tuning run</a> on a connected machine; this tab fills in as results arrive.</Empty>}

      {done.length > 0 && (
        <>
          <div className="kpis">
            <Kpi label="Measured configurations" value={cal.length} sub={`${runs.length} runs on ${new Set(cal.map((r) => r.machine)).size} machine(s)`} />
            <Kpi label="Achieved bandwidth efficiency" value={stats ? `${Math.round(stats.median * 100)}%` : 'n/a'} sub={stats ? `median · p25 ${Math.round(percentile(effs, 0.25) * 100)}% · p75 ${Math.round(percentile(effs, 0.75) * 100)}% of measured copy bandwidth` : 'runs need a measured bandwidth'} />
            <Kpi label="Projection default" value={applied?.bw ? `${Math.round(applied.bw * 100)}%` : '70%'} sub={applied?.bw ? `calibrated from ${applied.n} configs ${ago(applied.at)}` : 'built-in assumption'} tone={applied?.bw ? 'good' : ''} />
            <Kpi label="Best single config" value={stats ? `${Math.round(stats.max * 100)}%` : 'n/a'} sub={stats ? cal.find((r) => r.efficiency === stats.max)?.name : ''} />
          </div>

          <div className="grid two">
            <Panel title="Projected vs measured" note="Each point is a measured configuration. x: tok/s the model projects at the calibrated efficiency; y: what the machine did. Points on the line mean the model is honest for that machine; a cloud below it means software (kernel, threads, frequency) is leaving bandwidth on the table. Efficiency above 100% means the agent's copy benchmark under-reads the machine; the achieved figure is then the better bandwidth estimate."
              actions={stats && <button type="button" className="ghost small" onClick={() => { const c = { bw: Math.round(stats.median * 100) / 100, n: effs.length, at: Date.now() }; saveCalibration(c); setApplied(c) }}>Use {Math.round(stats.median * 100)}% in Designer and Planner</button>}>
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ left: -4, right: 12 }}>
                  <CartesianGrid stroke="var(--grid)" />
                  <XAxis type="number" dataKey="projected" name="projected tok/s" tick={tick} domain={[0, 'auto']} />
                  <YAxis type="number" dataKey="decode_tps" name="measured tok/s" tick={tick} domain={[0, 'auto']} />
                  <ZAxis range={[60, 60]} />
                  <Tooltip contentStyle={tooltipStyle} content={({ payload }) => payload?.[0] ? (
                    <div style={{ ...tooltipStyle, padding: 8 }}><strong>{payload[0].payload.machine} · {payload[0].payload.model}</strong><br />{payload[0].payload.name}: measured {num(payload[0].payload.decode_tps, 1)} · projected {num(payload[0].payload.projected, 1)} tok/s<br />{Math.round(payload[0].payload.efficiency * 100)}% of {payload[0].payload.measuredGbs} GB/s</div>
                  ) : null} />
                  <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.max(...cal.map((r) => r.decode_tps), 1), y: Math.max(...cal.map((r) => r.decode_tps), 1) }]} stroke="var(--muted)" strokeDasharray="4 4" />
                  <Scatter data={cal.filter((r) => r.measuredGbs).map((r) => ({ ...r, projected: projectTps(r.model_bytes, r.measuredGbs, stats?.median || 0.7) }))} fill="var(--c1)" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Noise and significance per run" note="Run-to-run noise comes from the agent re-measuring the fp32 baseline at the end of each run. Speedups inside that band are not results; the agent already marks them, this shows how each machine behaves.">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Machine</th><th>Model</th><th>Noise</th><th>Configs</th><th>Significant</th><th>Best</th><th>When</th></tr></thead>
                  <tbody>{runs.map((j) => {
                    const ok = j.result.results.filter((r) => !r.error)
                    const sig = ok.filter((r) => r.significant && r.speedup > 1)
                    const best = ok.find((r) => r.name === j.result.best) || j.result.baseline
                    return (
                      <tr key={j.id}><td><a href={`#/runs/${j.id}`}>{name(j.agentId)}</a></td><td>{j.params.model_id.split('/').pop()}</td><td>±{j.result.baseline.noise_pct ?? 'n/a'}%</td><td>{ok.length}</td><td>{sig.length}</td><td>{best.name} · {num(best.speedup ?? 1, 2)}×</td><td className="muted small">{ago(j.finishedAt || j.createdAt)}</td></tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid two">
            <Predictor cal={cal} efficiency={stats?.median || 0.7} />
            <Matrix agents={agents} runs={runs} name={name} />
          </div>
        </>
      )}

      <Advisor ai={ai} agents={agents} cal={cal} stats={stats} focus={section === 'advisor'} />
    </>
  )
}

// Predicts decode tok/s for a machine you have not measured: the calibrated
// bandwidth model, cross-checked by nearest measured neighbours when there
// are enough of them.
function Predictor({ cal, efficiency }) {
  const [q, setQ] = useState({ gbs: 60, gb: 2, threads: 16 })
  const bytes = q.gb * 1e9
  const model = projectTps(bytes, q.gbs, efficiency)
  const points = cal.filter((r) => r.measuredGbs).map((r) => ({ x: [Math.log(r.model_bytes), r.measuredGbs, r.threads || 8], y: r.decode_tps, name: `${r.machine} ${r.name}` }))
  const near = points.length >= 3 ? knn(points, [Math.log(bytes), q.gbs, q.threads], 3) : null
  const lo = projectTps(bytes, q.gbs, percentile(cal.map((r) => r.efficiency).filter(Number.isFinite), 0.25) || efficiency * 0.8)
  const hi = projectTps(bytes, q.gbs, percentile(cal.map((r) => r.efficiency).filter(Number.isFinite), 0.75) || efficiency * 1.1)
  return (
    <section className="card">
      <h2>Predict an unmeasured machine</h2>
      <div className="form row three">
        <label>Memory bandwidth (GB/s)<input type="number" min="1" value={q.gbs} onChange={(e) => setQ({ ...q, gbs: Number(e.target.value) })} /></label>
        <label>Model size in memory (GB)<input type="number" min="0.01" step="0.1" value={q.gb} onChange={(e) => setQ({ ...q, gb: Number(e.target.value) })} /></label>
        <label>Threads<input type="number" min="1" value={q.threads} onChange={(e) => setQ({ ...q, threads: Number(e.target.value) })} /></label>
      </div>
      <div className="kpis mt">
        <Kpi label="Calibrated model" value={`${num(model, 1)} tok/s`} sub={`${num(lo, 1)}–${num(hi, 1)} across the p25–p75 efficiency band`} tone="good" />
        <Kpi label="Nearest measured runs" value={near ? `${num(near.y, 1)} tok/s` : 'need 3+ runs'} sub={near ? `±${num(near.spread, 1)} · ${near.neighbours.map((n) => n.name).join(', ')}` : 'distance-weighted 3-NN over size, bandwidth, threads'} />
      </div>
      <p className="muted small">Decode at batch 1 is bandwidth ÷ bytes per step; the calibration from your fleet says how much of the spec bandwidth real runs get. The neighbour estimate catches what the formula misses (kernel quality, thread scaling) when similar machines were measured.</p>
    </section>
  )
}

// Which machine × model cells have been measured, with the best tok/s, and
// a link to queue the missing ones.
function Matrix({ agents, runs, name }) {
  const models = [...new Set(runs.map((j) => j.params.model_id))]
  const machines = agents || []
  const cell = (agentId, modelId) => {
    const rs = runs.filter((j) => j.agentId === agentId && j.params.model_id === modelId)
    if (!rs.length) return null
    const best = rs.map((j) => j.result.results.filter((r) => !r.error).concat(j.result.baseline).reduce((a, b) => (b.decode_tps > a.decode_tps ? b : a))).reduce((a, b) => (b.decode_tps > a.decode_tps ? b : a))
    return { tps: best.decode_tps, cfg: best.name, id: rs[0].id }
  }
  if (!models.length) return null
  return (
    <section className="card">
      <h2>Benchmark matrix</h2>
      <p className="muted small">Best measured decode tok/s per machine and model. Empty cells link to the Tune tab for that machine.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Machine</th>{models.map((m) => <th key={m}>{m.split('/').pop()}</th>)}</tr></thead>
          <tbody>{machines.map((a) => (
            <tr key={a.id}><td>{name(a.id)}</td>{models.map((m) => { const c = cell(a.id, m); return <td key={m}>{c ? <a href={`#/runs/${c.id}`} title={c.cfg}>{num(c.tps, 1)}</a> : <a className="muted" href={`#/tune/${a.id}`}>measure →</a>}</td> })}</tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  )
}

// Asks the server-side advisor with the numbers on this page (and the design
// handed over from the Designer tab) as context.
function Advisor({ ai, agents, cal, stats, focus }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [err, setErr] = useState(null)
  const design = useMemo(() => { try { return JSON.parse(sessionStorage.getItem('cpullm.advisor.design')) } catch { return null } }, [])
  useEffect(() => { if (focus && design && !q) setQ('Review this design for the chosen model: what bounds it, what single change would help most, and how should I verify it with a measurement?') }, [focus, design]) // eslint-disable-line react-hooks/exhaustive-deps

  const context = () => {
    const fleet = (agents || []).map((a) => { const h = a.hardware || {}; return `${a.name}: ${h.cpu_model || 'cpu'} · ${h.physical_cores}c/${h.logical_cores}t · ${h.memory_total_gb} GB · measured ${h.memory_bandwidth_gbs} GB/s · ISA ${Object.entries(h.isa || {}).filter(([, v]) => v).map(([k]) => k).join(' ')}` })
    const rows = cal.slice(0, 40).map((r) => `${r.machine} · ${r.model} · ${r.name}: ${r.decode_tps} tok/s moving ${(r.model_bytes / 1e9).toFixed(2)} GB/step = ${r.achievedGbs.toFixed(1)} GB/s (${Math.round((r.efficiency || 0) * 100)}% of ${r.measuredGbs} GB/s measured)`)
    return [
      fleet.length ? `Connected machines:\n${fleet.join('\n')}` : 'No machines connected.',
      rows.length ? `Measured configurations (ground truth):\n${rows.join('\n')}` : 'No measured runs yet.',
      stats ? `Achieved bandwidth efficiency across runs: median ${Math.round(stats.median * 100)}%, min ${Math.round(stats.min * 100)}%, max ${Math.round(stats.max * 100)}%, n=${stats.n}.` : '',
      design ? `Design under review (projection from the analytical model):\n${JSON.stringify(design, null, 1)}` : '',
    ].filter(Boolean).join('\n\n')
  }
  const ask = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null); setOut(null)
    try { setOut(await api.ask({ question: q, context: context() })) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <section className="card advisor" id="advisor">
      <h2>Advisor</h2>
      {ai?.enabled
        ? <p className="muted small">Asks {ai.model} with this page's measurements{design ? ' and the design you brought from the Designer' : ''} as context. Answers separate what was measured from what is projected. The API key never leaves the server.</p>
        : <p className="muted small">Not enabled. An admin can add an Anthropic API key under <a href="#/admin">Admin → AI advisor</a>; until then, the numbers above are the analysis.</p>}
      {design && <p className="small">Design in context: <strong>{design.design?.name}</strong> running {design.model?.name} at {design.workload?.precision} → {num(design.projection?.per_sequence_tps, 1)} tok/s per sequence ({design.projection?.bound} bound). <button type="button" className="icon" onClick={() => { try { sessionStorage.removeItem('cpullm.advisor.design') } catch { /* ignore */ } window.location.reload() }} title="Remove from context">✕</button></p>}
      <form className="form" onSubmit={ask}>
        <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Why does my 16-core machine only reach 55% of its measured bandwidth in bf16, and what should I try next?" disabled={!ai?.enabled} />
        <div><button type="submit" disabled={!ai?.enabled || busy || !q.trim()}>{busy ? 'Thinking…' : 'Ask'}</button></div>
      </form>
      {err && <p className="error small">{err}</p>}
      {out && (
        <div className="advisor-answer">
          <div>{out.answer}</div>
          <p className="muted small">{out.model}{out.usage ? ` · ${out.usage.input} in / ${out.usage.output} out tokens${out.usage.cached ? ` (${out.usage.cached} cached)` : ''}` : ''}{out.ms ? ` · ${(out.ms / 1000).toFixed(1)} s` : ''}{out.truncated ? ' · answer was cut at the token limit (raise it in Admin)' : ''}</p>
        </div>
      )}
    </section>
  )
}
