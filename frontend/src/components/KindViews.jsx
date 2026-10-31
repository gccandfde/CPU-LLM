import React from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts'
import { api } from '../api.js'
import { Kpi, StatusBadge } from './Kpi.jsx'
import { Panel, tooltipStyle } from './charts.jsx'
import { ago, num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }

// Detail page for benchmark-suite and power-optimiser runs.
export function KindRun({ job, kind, agents, onDeleted }) {
  const machine = agents?.find((a) => a.id === job.agentId)
  const remove = async () => {
    if (!window.confirm('Delete this run, its report and bundle?')) return
    await api.deleteJob(job.id); onDeleted(); go(kind === 'power' ? 'power' : 'benchmarks')
  }
  return (
    <>
      <div className="head">
        <h2><a href={`#/${kind === 'power' ? 'power' : 'benchmarks'}`}>{kind === 'power' ? 'Power' : 'Benchmarks'}</a> › {machine?.name || job.agentId} <StatusBadge status={job.status} /></h2>
        <div className="actions">
          {job.status === 'done' && <><a className="ghost small button" href={api.reportUrl(job.id)}>Report</a><a className="ghost small button" href={api.jobJsonUrl(job.id)}>JSON</a></>}
          {job.status !== 'running' && <button className="ghost small danger" onClick={remove}>Delete</button>}
        </div>
      </div>
      {job.status !== 'done' && <div className="card"><StatusBadge status={job.status} /> {job.message} {job.status === 'running' && `· ${Math.round(job.progress * 100)}%`}{job.error && <p className="error">{job.error}</p>}
        {job.results?.length > 0 && <ul className="small muted">{job.results.map((r, i) => <li key={i}>{r.name || (r.limit_w ? `${r.limit_w} W limit` : r.cores ? `${r.cores} cores` : 'current limit')}: {JSON.stringify(r.summary || { tps: r.decode_tps, watts: r.watts })}</li>)}</ul>}</div>}
      {job.status === 'done' && (kind === 'power' ? <PowerResult r={job.result} /> : <BenchmarkResult r={job.result} />)}
      <p className="muted small">Run {job.id} · {ago(job.created)}</p>
    </>
  )
}

export function BenchmarkResult({ r }) {
  const k = r.kernels || {}
  const gemm = (k.gemm || []).filter((x) => x.tflops != null)
  return (
    <>
      <div className="kpis">
        <Kpi label="Memory bandwidth" value={`${num(r.peak?.bandwidth_gbs, 1)} GB/s`} sub={`STREAM best of copy/triad on ${r.device}${r.gpu ? ` · ${r.gpu.name}` : ''}`} tone="good" />
        <Kpi label="Peak GEMM" value={`${num(r.peak?.tflops, 2)} TFLOPS`} sub={gemm.length ? `${gemm.reduce((a, b) => (b.tflops > a.tflops ? b : a)).dtype} at n=${gemm.reduce((a, b) => (b.tflops > a.tflops ? b : a)).n}` : 'n/a'} />
        <Kpi label="Attention decode @4k" value={r.peak?.attention_decode_tokens_s_4k ? `${num(r.peak.attention_decode_tokens_s_4k, 0)} tok/s` : 'n/a'} sub="SDPA, 1 query token vs 4096 KV" />
        <Kpi label="Embedding gather" value={`${num(k.gather?.gbs, 1)} GB/s`} sub={`${k.gather?.lookups_per_s?.toLocaleString?.() ?? ''} lookups/s`} />
      </div>
      <div className="grid two">
        <Panel title="STREAM (GB/s)" note={`${k.stream?.size_mb} MB arrays, best of ${r.params?.repeats} runs, ${r.threads} threads.`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={['copy', 'scale', 'add', 'triad'].map((n) => ({ name: n, gbs: k.stream?.[`${n}_gbs`] }))} margin={{ left: -8, right: 8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 1)} GB/s`} />
              <Bar dataKey="gbs" fill="var(--c1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="GEMM (TFLOPS) by size and dtype" note="Square matmul; the matrix/vector unit at its best. bf16 above fp32 means native BF16 (AVX512_BF16 / AMX / tensor cores).">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[...new Set(gemm.map((x) => x.n))].map((n) => Object.fromEntries([['n', n], ...gemm.filter((x) => x.n === n).map((x) => [x.dtype, x.tflops])]))} margin={{ left: -8, right: 8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="n" tick={tick} /><YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 2)} TFLOPS`} /><Legend wrapperStyle={{ fontSize: 12 }} />
              {[...new Set(gemm.map((x) => x.dtype))].map((d, i) => <Bar key={d} dataKey={d} fill={['var(--c1)', 'var(--c2)', 'var(--c3)'][i]} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <section className="card">
        <h3>Attention (SDPA, {r.params?.heads} heads × {r.params?.head_dim})</h3>
        <div className="table-wrap"><table>
          <thead><tr><th>Context</th><th>Decode tok/s</th><th>Decode ms</th><th>KV read GB/s</th><th>Prefill tok/s</th><th>Prefill ms</th></tr></thead>
          <tbody>{(k.attention || []).map((a) => <tr key={a.ctx}><td>{a.ctx?.toLocaleString()}</td><td>{a.error ? <span className="error small">{a.error}</span> : num(a.decode_tokens_s, 0)}</td><td>{num(a.decode_ms, 3)}</td><td>{num(a.kv_read_gbs, 1)}</td><td>{num(a.prefill_tokens_s, 0)}</td><td>{num(a.prefill_ms, 1)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  )
}

export function PowerResult({ r }) {
  const rec = r.recommendation || {}
  const gpu = r.device === 'cuda'
  const est = gpu ? r.energy_source === 'unavailable' : r.energy_source !== 'rapl'
  const key = gpu ? 'limit_w' : 'cores'
  const label = (p) => gpu ? (p.limit_w ? `${p.limit_w} W` : 'current limit') : `${p.cores}c`
  const pts = (r.points || []).map((p) => ({ ...p, label: label(p) }))
  const headline = (p) => gpu ? (p.limit_w ? `${p.limit_w} W limit` : 'current limit') : `${p.cores} core${p.cores > 1 ? 's' : ''}`
  const source = gpu ? (est ? 'no reading' : 'driver') : (est ? 'estimated' : 'RAPL')
  const sourceSub = gpu ? (est ? 'the driver reported no board power' : `board power from nvidia-smi on ${r.gpu?.name || 'the GPU'}`) : (est ? `idle ${r.idle_w} W, TDP ${r.tdp_w} W, linear in active cores` : 'package counters, Linux powercap')
  const chartNote = gpu
    ? `${r.model_id} in ${r.precision} on ${r.gpu?.name || 'GPU'}${r.gpu?.driver ? ` (driver ${r.gpu.driver})` : ''}; ${r.control === 'power_limit' ? 'board power limit set per point with nvidia-smi and restored afterwards' : 'power limit left as is'}. ${r.note || ''}`
    : `${r.model_id} in ${r.precision}; cores pinned by affinity${r.hard_offline ? ' and taken offline' : ''}${r.governor ? `, governor ${r.governor}` : ''}. ${est ? 'Watts are estimated: install on a Linux host with readable RAPL for measured power.' : ''}`
  return (
    <>
      <div className="kpis">
        {['performance', 'balanced', 'efficiency'].map((k) => rec[k] && (
          <Kpi key={k} label={k[0].toUpperCase() + k.slice(1)} value={headline(rec[k])} sub={`${num(rec[k].decode_tps, 1)} tok/s · ${rec[k].watts != null ? `${num(rec[k].watts, 0)} W · ${num(rec[k].tokens_per_joule, 2)} tok/J` : 'no power reading'}`} tone={k === 'balanced' ? 'good' : ''} />
        ))}
        <Kpi label="Energy source" value={source} sub={sourceSub} />
      </div>
      <div className="grid two">
        <Panel title={gpu ? 'Decode speed and board power against the power limit' : 'Decode speed and power against active cores'} note={chartNote}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={pts} margin={{ left: -8, right: 8 }}>
              <CartesianGrid stroke="var(--grid)" /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [num(v, 1), n]} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="decode_tps" name="tok/s" stroke="var(--c1)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              <Line dataKey="watts" name={est ? 'W (est.)' : 'W'} stroke="var(--c3)" strokeWidth={2} dot={{ r: 4 }} strokeDasharray={est ? '5 4' : undefined} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Tokens per joule" note="The efficiency curve: where it peaks is where a watt buys the most tokens.">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={pts} margin={{ left: -8, right: 8 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} /><XAxis dataKey="label" tick={tick} /><YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 3)} tok/J`} />
              <Bar dataKey="tokens_per_joule" radius={[4, 4, 0, 0]} isAnimationActive={false}>{pts.map((p) => <Cell key={p.label} fill={rec.efficiency && rec.efficiency[key] === p[key] ? 'var(--c2)' : 'var(--c1)'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
      <section className="card"><div className="table-wrap"><table>
        <thead><tr><th>{gpu ? 'Power limit' : 'Cores'}</th><th>{gpu ? 'GPU' : 'CPUs'}</th><th>tok/s</th><th>TTFT ms</th><th>Watts</th><th>tok/J</th><th>Seconds</th></tr></thead>
        <tbody>{pts.map((p) => <tr key={p.label}><td>{p.label}</td><td>{gpu ? `cuda:${r.gpu?.index ?? 0}` : p.cpus}</td><td>{num(p.decode_tps, 1)}</td><td>{num(p.ttft_ms, 0)}</td><td>{p.watts != null ? num(p.watts, 1) : '—'}{p.estimated && !gpu ? '*' : ''}</td><td>{p.tokens_per_joule != null ? num(p.tokens_per_joule, 3) : '—'}</td><td>{p.elapsed_s}</td></tr>)}</tbody>
      </table></div>{est && !gpu && <p className="muted small">* estimated</p>}</section>
    </>
  )
}
