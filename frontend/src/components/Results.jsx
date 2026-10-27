import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ScatterChart, Scatter, ZAxis, Cell, ReferenceLine,
} from 'recharts'
import { api } from '../api.js'

const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)' }

export default function Results({ job }) {
  const result = job.result
  const rows = job.results.filter((r) => !r.error)
  const best = result?.best
  const baseline = result?.baseline

  return (
    <section className="card">
      <div className="head">
        <h2>Tuning results</h2>
        {job.status === 'done' && (
          <div className="actions">
            <a className="button ghost" href={api.reportUrl(job.id)} target="_blank" rel="noreferrer">Report</a>
            <a className="button" href={api.bundleUrl(job.id)}>Download tuning bundle</a>
          </div>
        )}
      </div>
      <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
      <p className="muted">{job.status === 'error' ? <span className="error">{job.error}</span> : job.message}</p>

      {rows.length > 0 && (
        <div className="grid two">
          <div className="panel">
            <h3>Decode throughput (tokens/s)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={rows} margin={{ left: -12 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted)' }} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                {baseline && <ReferenceLine y={baseline.decode_tps} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'fp32 baseline', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />}
                <Bar dataKey="decode_tps" name="tok/s">
                  {rows.map((r) => <Cell key={r.name} fill={r.name === best ? 'var(--c2)' : r.within_budget ? 'var(--c1)' : 'var(--c5)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="panel">
            <h3>Speed vs accuracy (perplexity increase %)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ left: -12 }}>
                <CartesianGrid stroke="var(--grid)" />
                <XAxis type="number" dataKey="speedup" name="speedup" unit="×" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="number" dataKey="ppl_increase_pct" name="Δ ppl" unit="%" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <ZAxis range={[70, 70]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, n]} labelFormatter={() => ''} />
                <ReferenceLine y={job.result?.request.max_ppl_increase_pct} stroke="var(--c5)" strokeDasharray="4 4" />
                <Scatter data={rows} name="configs">
                  {rows.map((r) => <Cell key={r.name} fill={r.name === best ? 'var(--c2)' : 'var(--c1)'} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Config</th><th>tok/s</th><th>Speedup</th><th>TTFT ms</th><th>Perplexity</th><th>Δ ppl %</th><th>Agreement</th><th>Size MB</th><th>RSS GB</th></tr>
            </thead>
            <tbody>
              {baseline && (
                <tr className="muted"><td>baseline/fp32</td><td>{baseline.decode_tps}</td><td>1.0×</td><td>{baseline.ttft_ms}</td><td>{baseline.perplexity}</td><td>0</td><td>1.0</td><td>{(baseline.model_bytes / 1e6).toFixed(1)}</td><td>{baseline.rss_gb}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.name} className={r.name === best ? 'best' : r.within_budget ? '' : 'over'}>
                  <td>{r.name}{r.name === best && ' ★'}</td><td>{r.decode_tps}</td><td>{r.speedup}×</td><td>{r.ttft_ms}</td>
                  <td>{r.perplexity}</td><td>{r.ppl_increase_pct}</td><td>{r.token_agreement}</td>
                  <td>{(r.model_bytes / 1e6).toFixed(1)}</td><td>{r.rss_gb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result?.layer_redundancy && <LayerRedundancy values={result.layer_redundancy} recipe={result.recipe} />}

      {result && <Roofline roof={result.roofline} measured={rows.find((r) => r.name === best)?.decode_tps ?? baseline.decode_tps} />}
    </section>
  )
}

function Roofline({ roof, measured }) {
  const data = [
    { name: 'This machine (measured)', bound_tps: measured, kind: 'measured' },
    { name: 'This machine (bound)', bound_tps: roof.local_bound_tps, kind: 'local' },
    ...roof.platforms,
  ]
  const color = { measured: 'var(--c2)', local: 'var(--c3)', cpu: 'var(--c1)', gpu: 'var(--c4)' }
  return (
    <div className="panel">
      <h3>Roofline: batch-1 decode bound = memory bandwidth ÷ model size ({roof.model_mb} MB)</h3>
      <p className="muted">
        Bandwidth efficiency on this machine: {roof.bandwidth_efficiency != null ? `${Math.round(roof.bandwidth_efficiency * 100)}%` : 'n/a'}.
        Reference platforms use nominal spec-sheet bandwidth.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" scale="log" domain={[1, 'dataMax']} allowDataOverflow tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={220} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="bound_tps" name="tok/s">
            {data.map((d) => <Cell key={d.name} fill={color[d.kind]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function LayerRedundancy({ values, recipe }) {
  const dropped = new Set(recipe.transforms.find((t) => t.op === 'prune_layers')?.drop || [])
  const data = values.map((v, i) => ({ layer: i, redundancy: v }))
  return (
    <div className="panel">
      <h3>Per-layer redundancy (cosine similarity of block input vs output; higher = cheaper to remove)</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="layer" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
          <YAxis domain={[Math.max(0, Math.min(...values) - 0.05), 1]} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(v) => v.toFixed(2)} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="redundancy">
            {data.map((d) => <Cell key={d.layer} fill={dropped.has(d.layer) ? 'var(--c5)' : 'var(--c1)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {dropped.size > 0 && <p className="muted">Red: blocks removed in the selected configuration.</p>}
    </div>
  )
}
