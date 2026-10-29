import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LineChart, Line, ReferenceLine, Legend,
} from 'recharts'
import { Panel, tooltipStyle } from '../components/charts.jsx'
import { Kpi } from '../components/Kpi.jsx'
import { MODELS, BYTES_PER_PARAM } from '../lib/perfmodel.js'
import { DESIGNS, placements, threadSweep, serving, quantAdvice, cost } from '../lib/archmodel.js'
import { designFromAgent, loadSaved, defaultWorkload } from '../lib/designs.js'
import { num } from '../lib/format.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const USERS = [1, 2, 4, 8, 16, 32, 64, 128, 256]

// Answers to the questions that fill the forums: how to place a model on a
// NUMA machine, how many threads, how many users a box serves, whether a
// quantised format will pay off here, and what a token costs. Every number
// is a projection from the same model as the Designer, so it can be checked
// against a measured run on the Compare tab.
export default function Planner({ agents }) {
  const saved = useMemo(loadSaved, [])
  const fleet = useMemo(() => (agents || []).map(designFromAgent), [agents])
  const library = [...DESIGNS, ...fleet, ...saved]
  const [designId, setDesignId] = useState(DESIGNS[2].id)
  const [modelId, setModelId] = useState('llama3.1-8b')
  const [w, setW] = useState(defaultWorkload)
  const [money, setMoney] = useState({ machineUsd: 15000, kwhUsd: 0.15, utilisation: 40, years: 3, apiUsdPerM: 0.6 })

  const design = library.find((d) => d.id === designId) || DESIGNS[0]
  const model = MODELS.find((m) => m.id === modelId)
  const place = useMemo(() => placements(design, model, w), [design, model, w])
  const threads = useMemo(() => threadSweep(design, model, w), [design, model, w])
  const serve = useMemo(() => serving(design, model, w, USERS), [design, model, w])
  const quant = useMemo(() => quantAdvice(design, model, w), [design, model, w])
  const c = useMemo(() => cost(design, model, { ...w, batch: 16 }, { ...money, utilisation: money.utilisation / 100 }), [design, model, w, money])
  const setM = (k) => (e) => setMoney({ ...money, [k]: Number(e.target.value) })

  return (
    <>
      <p className="muted">
        Plan a deployment on a design or a connected machine: NUMA placement, thread count, serving concurrency, which precision pays off,
        and cost per million tokens. Projections, not measurements: use the Tune tab to measure the configuration this page recommends.
      </p>

      <section className="card">
        <div className="form row three">
          <label>Machine or design
            <select value={designId} onChange={(e) => setDesignId(e.target.value)}>
              <optgroup label="Reference parts">{DESIGNS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
              {fleet.length > 0 && <optgroup label="Connected machines (measured)">{fleet.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
              {saved.length > 0 && <optgroup label="Saved designs">{saved.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
            </select>
          </label>
          <label>Model<select value={modelId} onChange={(e) => setModelId(e.target.value)}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Weight precision
            <select value={w.precision} onChange={(e) => setW({ ...w, precision: e.target.value })}>{Object.keys(BYTES_PER_PARAM).map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </label>
          <label>Context: <strong>{w.context.toLocaleString()}</strong> tokens<input type="range" min="7" max="17" value={Math.log2(w.context)} onChange={(e) => setW({ ...w, context: 2 ** Number(e.target.value) })} /></label>
          <label>Prompt: <strong>{w.prompt}</strong> tokens<input type="range" min="5" max="14" value={Math.log2(w.prompt)} onChange={(e) => setW({ ...w, prompt: 2 ** Number(e.target.value) })} /></label>
          <label>Bandwidth efficiency: <strong>{Math.round(w.efficiency.bw * 100)}%</strong><input type="range" min="0.3" max="1" step="0.05" value={w.efficiency.bw} onChange={(e) => setW({ ...w, efficiency: { ...w.efficiency, bw: Number(e.target.value) } })} /></label>
        </div>
        <p className="muted small">{design.numaNodes} NUMA node{design.numaNodes > 1 ? 's' : ''} · {place.coresPerNode} cores per node · {design.capacityGbPerNode} GB per node · {design.channelsPerNode} × {design.channel} per node. Edit the design itself on the Designer tab.</p>
      </section>

      <div className="grid two">
        <Panel title="NUMA placement" note={`Recommended: ${place.recommended.pinning} with ${place.recommended.threads} threads per replica. ${place.recommended.why}`}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={place.rows.map((r) => ({ name: r.pinning, tps: r.aggregate_tps, usable: r.usable }))} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" tick={tick} />
              <YAxis type="category" dataKey="name" tick={tick} width={80} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 0)} tok/s aggregate`} />
              <Bar dataKey="tps" radius={[0, 4, 4, 0]} isAnimationActive={false}>{place.rows.map((r) => <Cell key={r.pinning} fill="var(--c1)" fillOpacity={r.usable ? 1 : 0.25} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Placement</th><th>Threads</th><th>tok/s per seq</th><th>Aggregate</th><th>Memory per replica</th><th>Why</th></tr></thead>
              <tbody>{place.rows.map((r) => (
                <tr key={r.pinning} className={r.usable ? '' : 'over'}><td>{r.pinning}</td><td>{r.threads}</td><td>{num(r.per_sequence_tps, 1)}</td><td>{num(r.aggregate_tps, 0)}</td><td>{num(r.memory_needed_gb, 1)} GB</td><td className="small muted wrap">{r.why}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Thread count for one replica" note={`Bandwidth saturates from ${threads.saturates} threads; use ${threads.best.threads} (all cores of the node) so prefill keeps its compute. Beyond that, SMT siblings add nothing to decode, and threads past the node's ${threads.node} cores pay barrier and remote-memory costs each layer. Measure it: start a tuning run with thread counts ${[Math.max(1, Math.round(threads.node / 2)), threads.node, threads.node * design.smt].join(', ')}.`}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={threads.rows} margin={{ left: -4, right: 12 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis dataKey="threads" type="number" domain={[1, 'dataMax']} tick={tick} />
              <YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 1)} tok/s`} labelFormatter={(v) => `${v} threads`} />
              <ReferenceLine x={threads.node} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'cores / node', fill: 'var(--muted)', fontSize: 11, position: 'insideTopRight' }} />
              <ReferenceLine x={threads.best.threads} stroke="var(--c2)" strokeDasharray="2 4" />
              <Line dataKey="tps" name="tok/s" stroke="var(--c1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <section className="card">
        <h2>Serving: how many users does this box take?</h2>
        <div className="kpis">
          <Kpi label="Users that fit in memory" value={serve.maxUsers >= 1e6 ? '∞' : serve.maxUsers} sub={`${num(serve.weightsGb, 1)} GB weights + ${num(serve.kvPerSeqMb, 0)} MB KV per ${w.context.toLocaleString()}-token user`} tone={serve.maxUsers > 0 ? 'good' : ''} />
          <Kpi label="Compute knee" value={serve.knee ? `${serve.knee} users` : 'not reached'} sub="batch where decode stops being bandwidth bound" />
          <Kpi label="At 32 users" value={`${num(serve.rows.find((r) => r.users === 32)?.aggregate_tps, 0)} tok/s`} sub={`${num(serve.rows.find((r) => r.users === 32)?.per_user_tps, 1)} tok/s each · TTFT ${num(serve.rows.find((r) => r.users === 32)?.ttft_ms, 0)} ms`} />
          <Kpi label="Prefill vs decode" value={`${Math.round((serve.rows[0]?.prefill_share || 0) * 100)}% prefill`} sub="of a 256-token answer at 1 user" />
        </div>
        <div className="grid two">
          <Panel title="Aggregate and per-user speed against concurrency" note={serve.hint}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={serve.rows} margin={{ left: -4, right: 12 }}>
                <CartesianGrid stroke="var(--grid)" />
                <XAxis dataKey="users" type="number" scale="log" domain={['dataMin', 'dataMax']} tick={tick} />
                <YAxis type="number" scale="log" domain={['auto', 'auto']} tick={tick} tickFormatter={(v) => num(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${num(v, 1)} tok/s`, n]} labelFormatter={(v) => `${v} users`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {serve.maxUsers < USERS.at(-1) && serve.maxUsers > 0 && <ReferenceLine x={serve.maxUsers} stroke="var(--c5)" strokeDasharray="4 4" label={{ value: 'memory full', fill: 'var(--muted)', fontSize: 11 }} />}
                <Line dataKey="aggregate_tps" name="aggregate tok/s" stroke="var(--c1)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
                <Line dataKey="per_user_tps" name="per user tok/s" stroke="var(--c3)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Users</th><th>Aggregate tok/s</th><th>Per user</th><th>TTFT ms</th><th>KV GB</th><th>Bound</th><th>tok/J</th><th>Fits</th></tr></thead>
              <tbody>{serve.rows.map((r) => (
                <tr key={r.users} className={r.fits ? '' : 'over'}><td>{r.users}</td><td>{num(r.aggregate_tps, 0)}</td><td>{num(r.per_user_tps, 1)}</td><td>{num(r.ttft_ms, 0)}</td><td>{num(r.kv_gb, 1)}</td><td>{r.bound}</td><td>{num(r.tokens_per_joule, 2)}</td><td>{r.fits ? '✓' : '✗'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="grid two">
        <section className="card">
          <h2>Will quantisation pay off here?</h2>
          <p className="muted small">Fewer bytes per weight always cut memory traffic; whether that becomes speed depends on native support (BF16, VNNI, AMX) and on whether the step is already compute bound. Measured answer: the v1 tuner runs every precision with perplexity and task accuracy.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Precision</th><th>Weights</th><th>Native</th><th>Bound</th><th>tok/s</th><th>vs fp32</th><th>Note</th></tr></thead>
              <tbody>{quant.map((q) => (
                <tr key={q.precision} className={q.precision === w.precision ? 'selected' : ''}><td>{q.precision}</td><td>{num(q.weightsGb, 1)} GB</td><td>{q.native ? '✓' : '✗'}</td><td>{q.bound}</td><td>{num(q.per_sequence_tps, 1)}</td><td>{num(q.speedup, 2)}×</td><td className="small muted wrap">{q.note}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h2>Cost per million tokens</h2>
          <div className="form row">
            <label>Machine price ($)<input type="number" min="0" value={money.machineUsd} onChange={setM('machineUsd')} /></label>
            <label>Electricity ($/kWh)<input type="number" min="0" step="0.01" value={money.kwhUsd} onChange={setM('kwhUsd')} /></label>
            <label>Utilisation (%)<input type="number" min="1" max="100" value={money.utilisation} onChange={setM('utilisation')} /></label>
            <label>Depreciation (years)<input type="number" min="1" max="10" value={money.years} onChange={setM('years')} /></label>
            <label>API price to beat ($/M output tokens)<input type="number" min="0" step="0.01" value={money.apiUsdPerM} onChange={setM('apiUsdPerM')} /></label>
          </div>
          <div className="kpis mt">
            <Kpi label="Your cost" value={Number.isFinite(c.usdPerM) ? `$${num(c.usdPerM, 2)} / M` : 'n/a'} sub={`${num(c.aggregate_tps, 0)} tok/s at batch 16 · ${num(c.watts, 0)} W`} tone={c.cheaperThanApi ? 'good' : ''} />
            <Kpi label="Break-even volume" value={`${num(c.breakEvenTokensPerDay / 1e6, 1)} M tok/day`} sub={`below this, the $${money.apiUsdPerM}/M API is cheaper`} />
            <Kpi label="Per year" value={`$${num(c.usdPerYear, 0)}`} sub={`$${num(c.capexPerYear, 0)} machine + $${num(c.energyUsdPerYear, 0)} energy`} />
          </div>
          <p className="muted small">Utilisation dominates: at 10% utilisation a token costs 10× what it costs at 100%. Batching raises tokens per watt until the compute knee above.</p>
        </section>
      </div>
    </>
  )
}
