import React, { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line,
} from 'recharts'
import { api } from '../api.js'
import { Panel, tooltipStyle } from '../components/charts.jsx'
import { Empty } from '../components/Kpi.jsx'
import { ago, mb, num, pct, transformLabel } from '../lib/format.js'
import { go } from '../lib/hooks.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', '#0891b2']
const CATS = ['matmul', 'attention', 'norm', 'elementwise', 'data movement', 'other']
const CAT_COLORS = ['var(--c1)', 'var(--c4)', 'var(--c3)', 'var(--c2)', 'var(--c5)', 'var(--muted)']
const MAX = 6

export default function Compare({ agents, jobs, ids }) {
  const [full, setFull] = useState({})
  const selected = (ids || []).slice(0, MAX)
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const done = (jobs || []).filter((j) => j.status === 'done' && !j.summary?.kind) // tuning runs only; suite/power runs have their own pages

  useEffect(() => {
    for (const id of selected) {
      if (!full[id]) api.job(id).then((j) => setFull((f) => ({ ...f, [id]: j }))).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join()])

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-MAX)
    go(`compare/${next.join(',')}`)
  }

  const runs = selected.map((id) => full[id]).filter((j) => j?.result)
  const label = (j) => `${name(j.agentId)} · ${j.params.model_id.split('/').pop()}`
  const best = (j) => j.result.results.find((r) => r.name === j.result.best) || j.result.baseline

  if (!jobs) return <p className="muted">Loading…</p>
  if (!done.length) return <Empty title="Nothing to compare yet">Finish at least one <a href="#/tune">tuning run</a>; compare runs across machines, models and devices here.</Empty>

  const speed = runs.map((j) => ({ name: label(j), baseline: j.result.baseline.decode_tps, tuned: best(j).decode_tps }))
  const batchSizes = [...new Set(runs.flatMap((j) => (j.result.batch_scaling?.selected || []).map((r) => r.batch)))].sort((a, b) => a - b)
  const batch = batchSizes.map((b) => Object.fromEntries([['batch', b], ...runs.map((j) => [j.id, j.result.batch_scaling?.selected.find((r) => r.batch === b)?.aggregate_tps])]))
  const ops = runs.filter((j) => j.result.op_profile).map((j) => Object.fromEntries([['name', label(j)], ...CATS.map((c) => [c, j.result.op_profile.categories.find((x) => x.category === c)?.pct || 0])]))

  return (
    <>
      <section className="card">
        <div className="head">
          <h2>Choose runs to compare <span className="muted small">(up to {MAX})</span></h2>
          {selected.length > 0 && <button className="ghost small" onClick={() => go('compare')}>Clear</button>}
        </div>
        <div className="table-wrap">
          <table className="clickable">
            <thead><tr><th /><th>Machine</th><th>Model</th><th>Device</th><th>Best config</th><th>tok/s</th><th>When</th></tr></thead>
            <tbody>
              {done.map((j) => (
                <tr key={j.id} onClick={() => toggle(j.id)} className={selected.includes(j.id) ? 'selected' : ''}>
                  <td><input type="checkbox" readOnly checked={selected.includes(j.id)} /></td>
                  <td>{name(j.agentId)}</td><td>{j.model_id}</td><td>{j.device}</td><td>{j.summary?.best}</td>
                  <td>{j.summary?.decode_tps}</td><td>{ago(j.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected.length > 0 && runs.length < selected.length && <p className="muted">Loading runs…</p>}
      {runs.length > 0 && (
        <>
          <section className="card">
            <h2>Side by side</h2>
            <div className="table-wrap">
              <table className="compare">
                <tbody>
                  <Row label="Machine" runs={runs} f={(j) => name(j.agentId)} />
                  <Row label="Processor" runs={runs} f={(j) => j.params.device === 'cuda' ? j.result.hardware.gpus?.[0]?.name : j.result.hardware.model_name} />
                  <Row label="Measured bandwidth" runs={runs} f={(j) => `${j.params.device === 'cuda' ? j.result.hardware.gpus?.[0]?.memory_bandwidth_gbs : j.result.hardware.memory_bandwidth_gbs} GB/s`} />
                  <Row label="Model" runs={runs} f={(j) => j.params.model_id} />
                  <Row label="Selected config" runs={runs} f={(j) => j.result.best} />
                  <Row label="Transforms" runs={runs} f={(j) => j.result.recipe.transforms.map(transformLabel).join(', ') || 'none'} />
                  <Row label="Baseline tok/s" runs={runs} f={(j) => j.result.baseline.decode_tps} />
                  <Row label="Tuned tok/s" runs={runs} f={(j) => <strong>{best(j).decode_tps}</strong>} />
                  <Row label="Speedup" runs={runs} f={(j) => `${best(j).speedup ?? 1}× (noise ±${j.result.baseline.noise_pct ?? '?'}%)`} />
                  <Row label="Time to first token" runs={runs} f={(j) => `${best(j).ttft_ms} ms`} />
                  <Row label="Model size" runs={runs} f={(j) => `${mb(best(j).model_bytes)} MB`} />
                  <Row label="Task accuracy" runs={runs} f={(j) => `${pct(best(j).eval?.accuracy)} (base ${pct(j.result.baseline.eval?.accuracy)})`} />
                  <Row label="Bandwidth efficiency" runs={runs} f={(j) => pct(j.result.roofline.bandwidth_efficiency)} />
                  <Row label="Energy" runs={runs} f={(j) => best(j).joules_per_token != null ? `${num(best(j).joules_per_token, 3)} J/tok` : 'n/a'} />
                  <Row label="Batch 16 tok/s" runs={runs} f={(j) => j.result.batch_scaling?.selected.find((r) => r.batch === 16)?.aggregate_tps ?? '—'} />
                </tbody>
              </table>
            </div>
            <p className="muted small">Bandwidth efficiency = measured batch-1 decode ÷ (bandwidth ÷ model bytes). It normalises away the memory system, so it compares how well each platform's software stack uses its hardware.</p>
          </section>

          <div className="grid two">
            <Panel title="Decode tokens/s: baseline vs tuned">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={speed} margin={{ left: -8 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="name" tick={{ ...tick, fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis tick={tick} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="baseline" name="fp32 baseline" fill="var(--c3)" />
                  <Bar dataKey="tuned" name="tuned" fill="var(--c2)" />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            {batch.length > 1 ? (
              <Panel title="Aggregate throughput vs batch (tuned configs)">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={batch} margin={{ left: -8, right: 8 }}>
                    <CartesianGrid stroke="var(--grid)" />
                    <XAxis dataKey="batch" tick={tick} />
                    <YAxis tick={tick} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {runs.map((j, i) => <Line key={j.id} dataKey={j.id} name={label(j)} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              </Panel>
            ) : <Panel title="Batch scaling"><Empty title="No batch data">Run with several batch sizes to compare scaling.</Empty></Panel>}
          </div>

          {ops.length > 0 && (
            <Panel title="Where decode time goes, by operator class (% of step)" note="Different hardware and kernels shift the balance: e.g. GPUs often spend proportionally more time in launch-bound elementwise ops, CPUs in GEMV.">
              <div className="card">
                <ResponsiveContainer width="100%" height={60 + ops.length * 40}>
                  <BarChart data={ops} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid stroke="var(--grid)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} unit="%" tick={tick} />
                    <YAxis type="category" dataKey="name" width={200} tick={tick} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {CATS.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={CAT_COLORS[i]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </>
      )}
      {selected.length === 0 && <Empty title="Select runs above">Pick runs from different machines, models or devices: for example the same model on an EPYC agent and a GPU agent.</Empty>}
    </>
  )
}

function Row({ label, runs, f }) {
  return (
    <tr>
      <th className="left">{label}</th>
      {runs.map((j) => <td key={j.id} className="left">{f(j)}</td>)}
    </tr>
  )
}
