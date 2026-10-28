import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LineChart, Line, Legend,
} from 'recharts'
import { Panel, tooltipStyle } from '../components/charts.jsx'
import { MODELS, PLATFORMS, BYTES_PER_PARAM, kvBytesPerToken, predict } from '../lib/perfmodel.js'
import { num } from '../lib/format.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', '#0891b2', '#be185d', '#65a30d', '#9333ea', '#ea580c']
const STORE_KEY = 'cpullm.lab.customPlatforms'

function loadCustom() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || [] } catch { return [] }
}
function saveCustom(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)) } catch { /* private mode: keep in memory only */ }
}

// Machines connected to this server become platforms with their *measured* bandwidth.
function fleetPlatforms(agents) {
  const out = []
  for (const a of agents || []) {
    const hw = a.hardware || {}
    if (hw.memory_bandwidth_gbs) {
      out.push({ id: `fleet-${a.id}`, name: `${a.name} (measured CPU)`, kind: 'cpu', bandwidth_gbs: hw.memory_bandwidth_gbs, tflops: null, memory_gb: hw.memory_total_gb, watts: null, fleet: true })
    }
    for (const g of hw.gpus || []) {
      if (g.memory_bandwidth_gbs) out.push({ id: `fleet-${a.id}-gpu${g.index}`, name: `${a.name} GPU${g.index} (measured)`, kind: 'gpu', bandwidth_gbs: g.memory_bandwidth_gbs, tflops: null, memory_gb: g.memory_gb, watts: null, fleet: true })
    }
  }
  return out
}

export default function Lab({ agents }) {
  const [modelId, setModelId] = useState('llama3.1-8b')
  const [custom, setCustom] = useState({ params_b: 3, active_b: 3, layers: 28, kv_heads: 8, head_dim: 128 })
  const [precision, setPrecision] = useState('bf16')
  const [kvPrecision, setKvPrecision] = useState('bf16')
  const [batch, setBatch] = useState(1)
  const [context, setContext] = useState(2048)
  const [customPlatforms, setCustomPlatforms] = useState(loadCustom)
  const [hidden, setHidden] = useState(new Set())
  const [draft, setDraft] = useState({ name: '', kind: 'cpu', bandwidth_gbs: '', tflops: '', memory_gb: '', watts: '' })

  const model = modelId === 'custom' ? { id: 'custom', name: 'Custom model', ...custom } : MODELS.find((m) => m.id === modelId)
  const platforms = [...PLATFORMS, ...fleetPlatforms(agents), ...customPlatforms]
  const shown = platforms.filter((p) => !hidden.has(p.id))
  const opts = { precision, context, kvBytes: kvPrecision === 'int8' ? 1 : 2 }
  const color = (p) => PALETTE[platforms.indexOf(p) % PALETTE.length]

  const rows = useMemo(() => shown.map((p) => ({ p, ...predict(model, p, { ...opts, batch }) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown.map((p) => p.id).join(), model, precision, kvPrecision, batch, context])

  const batches = [1, 2, 4, 8, 16, 32, 64, 128, 256]
  const sweep = batches.map((b) => Object.fromEntries([['batch', b], ...shown.map((p) => [p.id, predict(model, p, { ...opts, batch: b }).aggregate_tps])]))

  const toggle = (id) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n })
  const addPlatform = (e) => {
    e.preventDefault()
    const p = { id: `custom-${Date.now()}`, name: draft.name || 'My platform', kind: draft.kind,
      bandwidth_gbs: Number(draft.bandwidth_gbs), tflops: Number(draft.tflops) || null,
      memory_gb: Number(draft.memory_gb) || null, watts: Number(draft.watts) || null, custom: true }
    if (!p.bandwidth_gbs) return
    const next = [...customPlatforms, p]
    setCustomPlatforms(next); saveCustom(next)
    setDraft({ name: '', kind: 'cpu', bandwidth_gbs: '', tflops: '', memory_gb: '', watts: '' })
  }
  const removePlatform = (id) => { const next = customPlatforms.filter((p) => p.id !== id); setCustomPlatforms(next); saveCustom(next) }

  const fastestCpu = rows.filter((r) => r.p.kind === 'cpu' && r.fits).sort((a, b) => b.aggregate_tps - a.aggregate_tps)[0]
  const fastestGpu = rows.filter((r) => r.p.kind === 'gpu' && r.fits).sort((a, b) => b.aggregate_tps - a.aggregate_tps)[0]

  return (
    <>
      <p className="muted">
        What-if model of LLM decode across CPU and GPU memory systems. Each step reads the active weights once plus every
        sequence's KV cache, and does 2 FLOPs per parameter per sequence; the slower of memory and compute sets the speed.
        Specs are nominal and editable; efficiency assumes 70% (CPU) / 85% (GPU) of peak bandwidth.
      </p>
      <div className="grid lab">
        <section className="card">
          <h2>Workload</h2>
          <div className="form">
            <label>Model
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {modelId === 'custom' && (
              <div className="row three">
                {[['params_b', 'Total params (B)'], ['active_b', 'Active params (B)'], ['layers', 'Layers'], ['kv_heads', 'KV heads'], ['head_dim', 'Head dim']].map(([k, label]) => (
                  <label key={k}>{label}<input type="number" min="0" step="any" value={custom[k]} onChange={(e) => setCustom((c) => ({ ...c, [k]: Number(e.target.value) }))} /></label>
                ))}
              </div>
            )}
            <label>Weight precision
              <div className="seg">
                {Object.keys(BYTES_PER_PARAM).map((p) => <button type="button" key={p} className={precision === p ? 'on' : ''} onClick={() => setPrecision(p)}>{p}</button>)}
              </div>
            </label>
            <label>KV-cache precision
              <div className="seg">
                {['bf16', 'int8'].map((p) => <button type="button" key={p} className={kvPrecision === p ? 'on' : ''} onClick={() => setKvPrecision(p)}>{p}</button>)}
              </div>
            </label>
            <label>Batch size: <strong>{batch}</strong>
              <input type="range" min="0" max="8" value={Math.log2(batch)} onChange={(e) => setBatch(2 ** Number(e.target.value))} />
            </label>
            <label>Context length: <strong>{context.toLocaleString()}</strong> tokens
              <input type="range" min="7" max="17" value={Math.log2(context)} onChange={(e) => setContext(2 ** Number(e.target.value))} />
            </label>
            <dl className="kv compact">
              <dt>Weights</dt><dd>{num(model.params_b * BYTES_PER_PARAM[precision], 1)} GB ({num(model.active_b * BYTES_PER_PARAM[precision], 1)} GB read per step)</dd>
              <dt>KV / token</dt><dd>{num(kvBytesPerToken(model, opts.kvBytes) / 1024, 0)} KiB · {num(batch * context * kvBytesPerToken(model, opts.kvBytes) / 1e9, 2)} GB per step</dd>
            </dl>
          </div>
        </section>

        <section className="card">
          <h2>Platforms</h2>
          <div className="platforms">
            {platforms.map((p) => (
              <label key={p.id} className="check platform">
                <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="swatch" style={{ background: color(p) }} />
                <span>{p.name} <span className="muted small">{p.kind} · {p.bandwidth_gbs} GB/s{p.tflops ? ` · ${p.tflops} TFLOPS` : ''}{p.memory_gb ? ` · ${p.memory_gb} GB` : ''}</span></span>
                {p.custom && <button type="button" className="icon" onClick={() => removePlatform(p.id)} title="Remove">✕</button>}
              </label>
            ))}
          </div>
          <details className="mt">
            <summary>Add a platform (e.g. a new SKU, CXL memory, HBM CPU)</summary>
            <form className="form mt" onSubmit={addPlatform}>
              <div className="row">
                <label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="EPYC + CXL" /></label>
                <label>Kind<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}><option value="cpu">CPU</option><option value="gpu">GPU</option><option value="other">Other</option></select></label>
              </div>
              <div className="row">
                <label>Bandwidth GB/s *<input type="number" required min="1" value={draft.bandwidth_gbs} onChange={(e) => setDraft({ ...draft, bandwidth_gbs: e.target.value })} /></label>
                <label>bf16 TFLOPS<input type="number" min="0" step="any" value={draft.tflops} onChange={(e) => setDraft({ ...draft, tflops: e.target.value })} /></label>
              </div>
              <div className="row">
                <label>Memory GB<input type="number" min="0" value={draft.memory_gb} onChange={(e) => setDraft({ ...draft, memory_gb: e.target.value })} /></label>
                <label>Power W<input type="number" min="0" value={draft.watts} onChange={(e) => setDraft({ ...draft, watts: e.target.value })} /></label>
              </div>
              <button>Add platform</button>
            </form>
          </details>
        </section>
      </div>

      {fastestCpu && fastestGpu && (
        <section className="card insight">
          At batch {batch}, the fastest CPU that fits ({fastestCpu.p.name}) reaches <strong>{num(fastestCpu.aggregate_tps / fastestGpu.aggregate_tps * 100, 0)}%</strong> of
          the fastest GPU that fits ({fastestGpu.p.name}): {num(fastestCpu.aggregate_tps, 0)} vs {num(fastestGpu.aggregate_tps, 0)} tok/s.
          {fastestCpu.tokens_per_joule && fastestGpu.tokens_per_joule && <> Per joule: {num(fastestCpu.tokens_per_joule, 2)} vs {num(fastestGpu.tokens_per_joule, 2)} tok/J.</>}
          {rows.some((r) => !r.fits) && <> Platforms where the model + KV cache don't fit in memory are marked ✗.</>}
        </section>
      )}

      <div className="grid two">
        <Panel title={`Aggregate decode throughput at batch ${batch} (tok/s, log scale)`}>
          <ResponsiveContainer width="100%" height={40 + rows.length * 30}>
            <BarChart data={rows.map((r) => ({ name: r.p.name + (r.fits ? '' : ' ✗'), tps: r.aggregate_tps, p: r.p, fits: r.fits }))} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" scale="log" domain={[(min) => Math.max(0.01, min / 2), 'auto']} allowDataOverflow tick={tick} />
              <YAxis type="category" dataKey="name" tick={tick} width={200} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 1)} tok/s`} />
              <Bar dataKey="tps">
                {rows.map((r) => <Cell key={r.p.id} fill={color(r.p)} fillOpacity={r.fits ? 1 : 0.3} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Throughput vs batch size (log–log)" note="Flat start = bandwidth bound; the bend is the compute knee. CPUs bend early; GPUs keep scaling.">
          <ResponsiveContainer width="100%" height={Math.max(260, 40 + rows.length * 30)}>
            <LineChart data={sweep} margin={{ left: -4, right: 8 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis dataKey="batch" scale="log" domain={[1, 256]} type="number" ticks={batches} tick={tick} />
              <YAxis scale="log" domain={[(min) => Math.max(0.01, min / 2), 'auto']} tick={tick} allowDataOverflow />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 0)} tok/s`} labelFormatter={(b) => `batch ${b}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {shown.map((p) => <Line key={p.id} dataKey={p.id} name={p.name} stroke={color(p)} dot={false} strokeWidth={2} />)}
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Platform</th><th>Fits?</th><th>Memory needed GB</th><th>Bound</th><th>Step ms</th><th>tok/s per sequence</th><th>Aggregate tok/s</th><th>Compute knee (batch)</th><th>tok/J</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p.id} className={r.fits ? '' : 'over'}>
                  <td><span className="swatch" style={{ background: color(r.p) }} /> {r.p.name}</td>
                  <td>{r.fits ? '✓' : `✗ (${r.p.memory_gb} GB)`}</td><td>{num(r.memory_needed_gb, 1)}</td>
                  <td>{r.bound}</td><td>{num(r.step_ms, 2)}</td><td>{num(r.per_sequence_tps, 1)}</td><td>{num(r.aggregate_tps, 0)}</td>
                  <td>{Number.isFinite(r.knee_batch) ? num(r.knee_batch, 0) : r.p.tflops ? 'never (KV-bound)' : 'n/a'}</td>
                  <td>{r.tokens_per_joule != null ? num(r.tokens_per_joule, 2) : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Measured fleet machines have no compute figure, so they are modelled as purely bandwidth-bound. Validate predictions against real runs in the Compare tab.</p>
      </section>
    </>
  )
}
