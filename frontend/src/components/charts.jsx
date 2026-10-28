import React, { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ScatterChart, Scatter, ZAxis, Cell, ReferenceLine, ReferenceArea, LineChart, Line,
} from 'recharts'

export const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }
const tick = { fontSize: 11, fill: 'var(--muted)' }

export function Panel({ title, note, children, actions }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {actions}
      </div>
      {children}
      {note && <p className="muted small">{note}</p>}
    </div>
  )
}

export function ThroughputChart({ rows, baseline, best, noise }) {
  return (
    <Panel title="Decode throughput (tokens/s)" note={noise != null && `Grey band: ±${noise}% run-to-run noise around the baseline. Green = selected, blue = within budget, red = over budget.`}>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={rows} margin={{ left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="name" tick={{ ...tick, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
          <YAxis tick={tick} />
          <Tooltip contentStyle={tooltipStyle} />
          {baseline && <ReferenceLine y={baseline.decode_tps} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'baseline', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />}
          {baseline && noise > 0 && <ReferenceArea y1={baseline.decode_tps * (1 - noise / 100)} y2={baseline.decode_tps * (1 + noise / 100)} fill="var(--muted)" fillOpacity={0.15} ifOverflow="extendDomain" />}
          <Bar dataKey="decode_tps" name="tok/s">
            {rows.map((r) => <Cell key={r.name} fill={r.name === best ? 'var(--c2)' : r.within_budget ? 'var(--c1)' : 'var(--c5)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function SpeedAccuracyChart({ rows, best, request }) {
  const hasEval = rows.some((r) => r.eval_drop_pts != null)
  const [metric, setMetric] = useState(hasEval ? 'eval_drop_pts' : 'ppl_increase_pct')
  const limit = metric === 'eval_drop_pts' ? request?.max_eval_drop_pts : request?.max_ppl_increase_pct
  return (
    <Panel
      title="Speed vs accuracy cost"
      note="Each dot is a configuration; bottom-right is better. Dashed line: the budget for this metric. Red = over budget on either metric (perplexity or task accuracy), so a red dot can sit under this line."
      actions={hasEval && (
        <div className="seg">
          <button className={metric === 'eval_drop_pts' ? 'on' : ''} onClick={() => setMetric('eval_drop_pts')}>Task accuracy</button>
          <button className={metric === 'ppl_increase_pct' ? 'on' : ''} onClick={() => setMetric('ppl_increase_pct')}>Perplexity</button>
        </div>
      )}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ left: -8, right: 8 }}>
          <CartesianGrid stroke="var(--grid)" />
          <XAxis type="number" dataKey="speedup" name="speedup" unit="×" tick={tick} domain={['auto', 'auto']} />
          <YAxis type="number" dataKey={metric} name={metric === 'eval_drop_pts' ? 'accuracy drop (pts)' : 'Δ perplexity %'} tick={tick} />
          <ZAxis range={[80, 80]} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }}
            formatter={(v, n) => [v, n]} labelFormatter={() => ''}
            content={({ payload }) => payload?.[0] ? (
              <div style={{ ...tooltipStyle, padding: 8 }}>
                <strong>{payload[0].payload.name}</strong><br />
                {payload[0].payload.speedup}× · {metric === 'eval_drop_pts' ? `${payload[0].payload.eval_drop_pts} pts` : `${payload[0].payload.ppl_increase_pct}% ppl`}
              </div>
            ) : null} />
          {limit != null && <ReferenceLine y={limit} stroke="var(--c5)" strokeDasharray="4 4" ifOverflow="extendDomain" />}
          <ReferenceLine x={1} stroke="var(--muted)" strokeDasharray="2 4" />
          <Scatter data={rows}>
            {rows.map((r) => <Cell key={r.name} fill={r.name === best ? 'var(--c2)' : r.within_budget ? 'var(--c1)' : 'var(--c5)'} />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function BatchScalingChart({ data }) {
  const rows = data.baseline.map((b, i) => ({
    batch: `b=${b.batch}`, baseline: b.aggregate_tps, selected: data.selected[i]?.aggregate_tps,
    latency: data.selected[i]?.ms_per_step,
  }))
  return (
    <div className="grid two">
      <Panel title="Aggregate decode throughput vs batch size" note="Each weight read is reused across the batch, so throughput climbs until compute or cache becomes the limit. Where this curve flattens is the key CPU vs GPU serving difference.">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ left: -8, right: 8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="batch" tick={tick} />
            <YAxis tick={tick} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="baseline" name="fp32 baseline" stroke="var(--c3)" strokeWidth={2} />
            <Line dataKey="selected" name="selected config" stroke="var(--c2)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Per-step latency (selected config)" note="The cost of batching: every sequence waits for the whole batch's step.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ left: -8 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="batch" tick={tick} />
            <YAxis tick={tick} unit=" ms" />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="latency" name="ms/step" fill="var(--c1)" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

const CAT_COLORS = { matmul: 'var(--c1)', attention: 'var(--c4)', norm: 'var(--c3)', elementwise: 'var(--c2)', 'data movement': 'var(--c5)', other: 'var(--muted)' }

export function OpProfile({ selected, baseline }) {
  const cats = Object.keys(CAT_COLORS)
  const row = (name, p) => Object.fromEntries([['name', name], ...cats.map((c) => [c, p.categories.find((x) => x.category === c)?.ms_per_step || 0])])
  const data = [baseline && row('fp32 baseline', baseline), row('selected', selected)].filter(Boolean)
  return (
    <>
      <Panel title="Where each decode step's time goes (ms per step, by operator class)"
        note="matmul-dominated → bandwidth / matrix-unit bound; large data-movement or elementwise share → framework overhead that fusion (torch.compile) or custom kernels remove.">
        <ResponsiveContainer width="100%" height={80 + data.length * 40}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid stroke="var(--grid)" horizontal={false} />
            <XAxis type="number" tick={tick} unit=" ms" />
            <YAxis type="category" dataKey="name" tick={tick} width={100} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)} ms`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {cats.map((c) => <Bar key={c} dataKey={c} stackId="a" fill={CAT_COLORS[c]} />)}
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Operator (selected config)</th><th>Class</th><th>Calls/step</th><th>% of step</th><th>ms/step</th></tr></thead>
          <tbody>
            {selected.top_ops.map((o) => (
              <tr key={o.op}><td><code>{o.op}</code></td><td><span className="dot-label" style={{ '--c': CAT_COLORS[o.category] }}>{o.category}</span></td>
                <td>{o.calls_per_step}</td><td>{o.pct}</td><td>{o.ms_per_step}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function LayerRedundancy({ values, recipe }) {
  const dropped = new Set(recipe.transforms.find((t) => t.op === 'prune_layers')?.drop || [])
  const data = values.map((v, i) => ({ layer: i, redundancy: v }))
  return (
    <Panel title="Per-layer redundancy (cosine similarity of block input vs output)"
      note={`Higher = the block changes the representation less, so it is cheaper to remove. ${dropped.size ? 'Red: removed in the selected configuration.' : 'No layers removed in the selected configuration.'}`}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="layer" tick={{ ...tick, fontSize: 10 }} />
          <YAxis domain={[Math.max(0, Math.min(...values) - 0.05), 1]} tick={tick} tickFormatter={(v) => v.toFixed(2)} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="redundancy">
            {data.map((d) => <Cell key={d.layer} fill={dropped.has(d.layer) ? 'var(--c5)' : 'var(--c1)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function Roofline({ roof, measured }) {
  const data = [
    { name: 'This machine (measured)', bound_tps: measured, kind: 'measured' },
    { name: 'This machine (bound)', bound_tps: roof.local_bound_tps, kind: 'local' },
    ...roof.platforms,
  ]
  const color = { measured: 'var(--c2)', local: 'var(--c3)', cpu: 'var(--c1)', gpu: 'var(--c4)' }
  return (
    <Panel title={`Roofline: batch-1 decode bound = memory bandwidth ÷ model size (${roof.model_mb} MB)`}
      note={`Bandwidth efficiency on this machine: ${roof.bandwidth_efficiency != null ? `${Math.round(roof.bandwidth_efficiency * 100)}%` : 'n/a'}. Reference platforms use nominal spec-sheet bandwidth. Log scale.`}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis type="number" scale="log" domain={[1, 'dataMax']} allowDataOverflow tick={tick} />
          <YAxis type="category" dataKey="name" tick={tick} width={200} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="bound_tps" name="tok/s">
            {data.map((d) => <Cell key={d.name} fill={color[d.kind]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}
