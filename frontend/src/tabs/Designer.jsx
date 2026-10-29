import React, { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, LineChart, Line, ReferenceLine,
} from 'recharts'
import { Panel, tooltipStyle } from '../components/charts.jsx'
import { Kpi } from '../components/Kpi.jsx'
import { MODELS, BYTES_PER_PARAM } from '../lib/perfmodel.js'
import { DESIGNS, CHANNEL_GBS, PINNING, FIELDS, peak, simulate, scaleOut, sweep, roofline, explore } from '../lib/archmodel.js'
import { designFromAgent, loadSaved, saveSaved, defaultWorkload } from '../lib/designs.js'
import { num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)']
const GROUPS = [
  ['Compute', ['dies', 'coresPerDie', 'smt', 'clockGhz', 'fmaUnits', 'fmaWidthBits']],
  ['Caches', ['l1dKb', 'l2Kb', 'l3MbPerDie', 'l3Gbs']],
  ['Memory and NUMA', ['numaNodes', 'channelsPerNode', 'capacityGbPerNode', 'fabricGbs', 'fabricNs']],
  ['Power', ['idleW', 'tdpW']],
]
const FIELD = Object.fromEntries(FIELDS.map(([k, label, min, max, step]) => [k, { label, min, max, step }]))

const EXPLORE_A = ['channelsPerNode', [1, 2, 4, 6, 8, 12]]
const EXPLORE_B = ['coresPerDie', [4, 8, 16, 32, 64]]

const sweepValues = ({ min, max, step }) => {
  const out = []
  for (let i = 0; i < 8; i++) out.push(Math.round((min * Math.pow(max / min, i / 7)) / step) * step || min)
  return [...new Set(out)].filter((v) => v >= min && v <= max)
}

export default function Designer({ agents }) {
  const [saved, setSaved] = useState(loadSaved)
  const [design, setDesign] = useState(() => ({ ...DESIGNS[0] }))
  const [baseId, setBaseId] = useState(DESIGNS[0].id)
  const [modelId, setModelId] = useState('llama3.1-8b')
  const [custom, setCustom] = useState({ params_b: 3, active_b: 3, layers: 28, kv_heads: 8, head_dim: 128 })
  const [w, setW] = useState(defaultWorkload)
  const [sweepKey, setSweepKey] = useState('channelsPerNode')
  const [compareIds, setCompareIds] = useState(() => new Set(DESIGNS.slice(0, 3).map((d) => d.id)))
  const [target, setTarget] = useState('')

  const fleet = useMemo(() => (agents || []).map(designFromAgent), [agents])
  const library = [...DESIGNS, ...fleet, ...saved]
  const model = modelId === 'custom' ? { id: 'custom', name: 'Custom model', ...custom } : MODELS.find((m) => m.id === modelId)
  const set = (k, v) => setDesign((d) => ({ ...d, [k]: v }))
  const pick = (id) => { const d = library.find((x) => x.id === id); if (d) { setDesign({ ...d, isa: { ...d.isa } }); setBaseId(id) } }

  const r = useMemo(() => simulate(design, model, w), [design, model, w])
  const sweepRows = useMemo(() => sweep(design, model, w, sweepKey, sweepValues(FIELD[sweepKey])), [design, model, w, sweepKey])
  const compared = [{ ...design, id: 'current', name: `${design.name} (editing)` }, ...library.filter((d) => compareIds.has(d.id) && d.id !== baseId)]
  const compareRows = compared.map((d, i) => ({ d, color: PALETTE[i % PALETTE.length], ...simulate(d, model, w) }))
  const targetTps = Number(target) || Math.ceil(r.aggregate_tps * 10)
  const so = scaleOut(design, model, w, targetTps)
  const roof = useMemo(() => roofline(design, model, w), [design, model, w])
  const grid = useMemo(() => explore(design, model, w, EXPLORE_A[0], EXPLORE_A[1], EXPLORE_B[0], EXPLORE_B[1]), [design, model, w])
  // Hand the design and its projection to the advisor on the Insights tab.
  const askAdvisor = () => {
    try { sessionStorage.setItem('cpullm.advisor.design', JSON.stringify({ design, model, workload: w, projection: { per_sequence_tps: r.per_sequence_tps, aggregate_tps: r.aggregate_tps, ttft_ms: r.ttft_ms, bound: r.bound, memory_needed_gb: r.memory_needed_gb, fits: r.fits, watts: r.watts, cache: r.cache, bandwidthEffectiveGbs: r.bandwidthEffectiveGbs, tflopsEffective: r.tflopsEffective } })) } catch { /* private mode */ }
    go('insights/advisor')
  }

  const save = () => {
    const name = window.prompt('Save design as', design.fromMachine || DESIGNS.some((d) => d.id === baseId) ? `${design.name} variant` : design.name)
    if (!name) return
    const d = { ...design, id: `saved-${Date.now()}`, name, fromMachine: false, measuredGbs: null }
    const next = [...saved.filter((x) => x.name !== name), d]
    setSaved(next); saveSaved(next); setBaseId(d.id); setDesign(d)
  }
  const remove = (id) => { const next = saved.filter((x) => x.id !== id); setSaved(next); saveSaved(next); compareIds.delete(id); setCompareIds(new Set(compareIds)) }
  const toggleCompare = (id) => setCompareIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const field = (k) => {
    const f = FIELD[k]
    return (
      <label key={k}>{f.label}: <strong>{design[k]}</strong>
        <input type="range" min={f.min} max={f.max} step={f.step} value={design[k]} onChange={(e) => set(k, Number(e.target.value))} />
      </label>
    )
  }

  return (
    <>
      <p className="muted">
        Design a CPU at die, cache and NUMA level, pin a model to it and read the projected speed, fit, energy and what it
        takes to scale out. First-order analytical model: bandwidth = nodes × channels × channel speed (scaled by pinning),
        compute = cores × clock × vector lanes, halved for non-native precisions. Check projections against measured runs in Compare.
      </p>

      <div className="grid lab">
        <section className="card">
          <div className="head"><h2>Design</h2>
            <div className="actions"><button type="button" className="ghost small" onClick={save}>Save design</button>
              <button type="button" className="ghost small" onClick={() => pick(baseId)}>Reset</button>
              <button type="button" className="ghost small" onClick={askAdvisor}>Ask the advisor</button></div>
          </div>
          <div className="form">
            <label>Start from
              <select value={baseId} onChange={(e) => pick(e.target.value)}>
                <optgroup label="Reference parts">{DESIGNS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
                {fleet.length > 0 && <optgroup label="Connected machines (measured)">{fleet.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
                {saved.length > 0 && <optgroup label="Saved designs">{saved.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
              </select>
            </label>
            <label>Name<input value={design.name} onChange={(e) => set('name', e.target.value)} /></label>
            {design.fromMachine && design.measuredGbs && <p className="muted small">Measured bandwidth {design.measuredGbs} GB/s; channels inferred to match. Clock, fabric and power are defaults: edit them.</p>}
            {GROUPS.map(([title, keys]) => (
              <fieldset key={title}><legend>{title}</legend>
                <div className="row">{keys.map(field)}</div>
                {title === 'Compute' && (
                  <div className="checks">
                    {[['bf16', 'BF16 (AVX512_BF16)'], ['vnni', 'VNNI int8'], ['amx', 'AMX tiles']].map(([k, label]) => (
                      <label key={k} className="check"><input type="checkbox" checked={!!design.isa[k]} onChange={(e) => set('isa', { ...design.isa, [k]: e.target.checked })} />{label}</label>
                    ))}
                  </div>
                )}
                {title === 'Memory and NUMA' && (
                  <label>Channel type
                    <select value={design.channel} onChange={(e) => set('channel', e.target.value)}>
                      {Object.entries(CHANNEL_GBS).map(([k, v]) => <option key={k} value={k}>{k} ({v} GB/s)</option>)}
                    </select>
                  </label>
                )}
              </fieldset>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Workload and pinning</h2>
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
              <div className="seg">{Object.keys(BYTES_PER_PARAM).map((p) => <button type="button" key={p} className={w.precision === p ? 'on' : ''} onClick={() => setW({ ...w, precision: p })}>{p}</button>)}</div>
            </label>
            <label>Pinning
              <select value={w.pinning} onChange={(e) => setW({ ...w, pinning: e.target.value })}>
                {Object.keys(PINNING).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <span className="muted small">{PINNING[w.pinning]}</span>
            </label>
            <label>Batch size: <strong>{w.batch}</strong><input type="range" min="0" max="8" value={Math.log2(w.batch)} onChange={(e) => setW({ ...w, batch: 2 ** Number(e.target.value) })} /></label>
            <label>Context: <strong>{w.context.toLocaleString()}</strong> tokens<input type="range" min="7" max="17" value={Math.log2(w.context)} onChange={(e) => setW({ ...w, context: 2 ** Number(e.target.value) })} /></label>
            <label>Prompt length: <strong>{w.prompt}</strong> tokens<input type="range" min="5" max="14" value={Math.log2(w.prompt)} onChange={(e) => setW({ ...w, prompt: 2 ** Number(e.target.value) })} /></label>
            <div className="row">
              <label>Bandwidth efficiency: <strong>{Math.round(w.efficiency.bw * 100)}%</strong><input type="range" min="0.3" max="1" step="0.05" value={w.efficiency.bw} onChange={(e) => setW({ ...w, efficiency: { ...w.efficiency, bw: Number(e.target.value) } })} /></label>
              <label>Compute efficiency: <strong>{Math.round(w.efficiency.compute * 100)}%</strong><input type="range" min="0.1" max="1" step="0.05" value={w.efficiency.compute} onChange={(e) => setW({ ...w, efficiency: { ...w.efficiency, compute: Number(e.target.value) } })} /></label>
            </div>
          </div>
          <h3>Peak from this design</h3>
          <dl className="kv compact">
            <dt>Cores / threads</dt><dd>{r.peak.cores} / {r.peak.threads}</dd>
            <dt>{w.precision} compute</dt><dd>{num(r.peak.tflops, 1)} TFLOPS peak{r.peak.native ? '' : ' (emulated: halved)'} · {num(r.tflopsEffective, 1)} effective</dd>
            <dt>Memory bandwidth</dt><dd>{num(r.peak.bandwidthGbs, 0)} GB/s peak · {num(r.bandwidthEffectiveGbs, 0)} GB/s effective ({r.bandwidth.note})</dd>
            <dt>Caches</dt><dd>L2 {num(r.peak.l2Mb, 0)} MB total · L3 {num(r.peak.l3Mb, 0)} MB total</dd>
            <dt>Memory</dt><dd>{num(r.peak.capacityGb, 0)} GB</dd>
          </dl>
        </section>
      </div>

      <div className="kpis">
        <Kpi label="Decode per sequence" value={`${num(r.per_sequence_tps, 1)} tok/s`} sub={`${num(r.step_ms, 2)} ms per step · ${r.bound} bound`} tone={(r.fits) ? 'good' : ''} />
        <Kpi label="Aggregate" value={`${num(r.aggregate_tps, 0)} tok/s`} sub={`batch ${w.batch} × ${r.replicas} replica${r.replicas > 1 ? 's' : ''}`} />
        <Kpi label="Time to first token" value={`${num(r.ttft_ms, 0)} ms`} sub={`${w.prompt}-token prompt`} />
        <Kpi label="Energy" value={`${num(r.tokens_per_joule, 2)} tok/J`} sub={`${num(r.watts, 0)} W estimated`} />
        <Kpi label="Memory" value={`${num(r.memory_needed_gb, 1)} GB`} sub={r.fits ? 'fits per replica' : `does not fit (${design.capacityGbPerNode} GB per node)`} tone={(r.fits) ? 'good' : ''} />
      </div>

      <section className="card">
        <h2>Where the bytes live</h2>
        <div className="grid two">
          <dl className="kv compact">
            <dt>Memory time share</dt><dd>{Math.round(r.utilisation.memory * 100)}% of the step</dd>
            <dt>Compute time share</dt><dd>{Math.round(r.utilisation.compute * 100)}% of the step</dd>
            <dt>One layer's weights</dt><dd>{num(r.cache.layerWeightsMb, 1)} MB · {r.cache.layerInL3 ? 'fits in L3' : 'streams from DRAM'}</dd>
            <dt>KV read per step</dt><dd>{num(r.cache.kvStepMb, 1)} MB · {r.cache.kvInL2 ? 'fits in L2' : r.cache.kvInL3 ? 'fits in L3' : 'streams from DRAM'}</dd>
            <dt>L3 turnover per step</dt><dd>{num(r.cache.l3Turnover, 1)}× (weights read ÷ total L3)</dd>
          </dl>
          <p className="muted small">
            Decode reads every active weight once per step, so a bigger L3 only helps when a layer fits in it and the batch re-uses it;
            otherwise bandwidth decides. KV cache that fits in L2/L3 keeps long contexts from eating bandwidth. {r.bound === 'compute' ? 'This configuration is compute bound: more cores, clock or a native precision would help more than memory.' : 'This configuration is memory bound: channels, faster memory, fewer bytes per weight (lower precision) or local pinning help most.'}
          </p>
        </div>
      </section>

      <div className="grid two">
        <Panel title={`Sweep: ${FIELD[sweepKey].label}`} note="Aggregate tok/s as one design parameter changes, everything else fixed. The marker is the current value."
          actions={<select value={sweepKey} onChange={(e) => setSweepKey(e.target.value)}>{FIELDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={sweepRows} margin={{ left: -4, right: 12 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis dataKey="value" type="number" domain={['dataMin', 'dataMax']} tick={tick} />
              <YAxis tick={tick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 0)} tok/s`} labelFormatter={(v) => `${FIELD[sweepKey].label}: ${v}`} />
              <ReferenceLine x={design[sweepKey]} stroke="var(--muted)" strokeDasharray="4 4" />
              <Line dataKey="aggregate_tps" name="aggregate tok/s" stroke="var(--c1)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Compare designs on this workload" note="Tick designs in the library below. The design you are editing is always included.">
          <ResponsiveContainer width="100%" height={Math.max(200, 40 + compareRows.length * 32)}>
            <BarChart data={compareRows.map((x) => ({ name: x.d.name + (x.fits ? '' : ' ✗'), tps: x.aggregate_tps, color: x.color, fits: x.fits }))} layout="vertical" margin={{ left: 0, right: 16 }}>
              <CartesianGrid stroke="var(--grid)" horizontal={false} />
              <XAxis type="number" tick={tick} />
              <YAxis type="category" dataKey="name" tick={tick} width={210} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${num(v, 0)} tok/s`} />
              <Bar dataKey="tps" radius={[0, 4, 4, 0]} isAnimationActive={false}>{compareRows.map((x) => <Cell key={x.d.id} fill={x.color} fillOpacity={x.fits ? 1 : 0.3} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Design</th><th>Cores</th><th>Peak GB/s</th><th>{w.precision} TFLOPS</th><th>L3 MB</th><th>Bound</th><th>tok/s per seq</th><th>Aggregate tok/s</th><th>TTFT ms</th><th>tok/J</th><th>Fits</th></tr></thead>
            <tbody>
              {compareRows.map((x) => (
                <tr key={x.d.id} className={x.fits ? '' : 'over'}>
                  <td><span className="swatch" style={{ background: x.color }} /> {x.d.name}</td>
                  <td>{x.peak.cores}</td><td>{num(x.peak.bandwidthGbs, 0)}</td><td>{num(x.peak.tflops, 1)}</td><td>{num(x.peak.l3Mb, 0)}</td>
                  <td>{x.bound}</td><td>{num(x.per_sequence_tps, 1)}</td><td>{num(x.aggregate_tps, 0)}</td><td>{num(x.ttft_ms, 0)}</td><td>{num(x.tokens_per_joule, 2)}</td><td>{x.fits ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt"><summary>Design library (tick to compare)</summary>
          <div className="platforms mt">
            {library.filter((d) => d.id !== baseId).map((d) => (
              <label key={d.id} className="check platform">
                <input type="checkbox" checked={compareIds.has(d.id)} onChange={() => toggleCompare(d.id)} />
                <span>{d.name} <span className="muted small">{peak(d).cores} cores · {num(peak(d).bandwidthGbs, 0)} GB/s · L3 {peak(d).l3Mb} MB</span></span>
                {saved.some((s) => s.id === d.id) && <button type="button" className="icon" title="Delete" onClick={() => remove(d.id)}>✕</button>}
              </label>
            ))}
          </div>
        </details>
      </section>

      <div className="grid two">
        <Panel title="Roofline with every ceiling this design has" note={`DRAM ${num(roof.ceilings.dram_gbs, 0)} GB/s · L3 ${num(roof.ceilings.l3_gbs, 0)} GB/s · vector ${num(roof.ceilings.vector_tflops, 1)} TFLOPS${roof.ceilings.matrix_tflops ? ` · matrix unit ${num(roof.ceilings.matrix_tflops, 1)} TFLOPS` : ''} (all after efficiency). Points are decode steps at batch 1…256; the ridge sits at ${num(roof.ridge_intensity, 0)} FLOP/byte, so batches left of it are bandwidth bound. A classic 2-D roofline hides the gap between vector and matrix units; both are drawn here.`}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={roof.points} margin={{ left: -4, right: 12 }}>
              <CartesianGrid stroke="var(--grid)" />
              <XAxis dataKey="intensity" type="number" scale="log" domain={['dataMin', 'dataMax']} tick={tick} tickFormatter={(v) => num(v, 0)} label={{ value: 'FLOP per byte', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis type="number" scale="log" domain={['auto', 'auto']} tick={tick} tickFormatter={(v) => num(v, 1)} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${num(v, 2)} TFLOPS`, n]} labelFormatter={(v, p) => `batch ${p?.[0]?.payload.batch} · ${num(v, 1)} FLOP/byte`} />
              <ReferenceLine y={roof.ceilings.vector_tflops} stroke="var(--c3)" strokeDasharray="4 4" label={{ value: 'vector', fill: 'var(--muted)', fontSize: 11, position: 'insideTopLeft' }} />
              {roof.ceilings.matrix_tflops && <ReferenceLine y={roof.ceilings.matrix_tflops} stroke="var(--c4)" strokeDasharray="4 4" label={{ value: 'matrix', fill: 'var(--muted)', fontSize: 11, position: 'insideTopLeft' }} />}
              <Line dataKey="attainable_tflops" name="from DRAM" stroke="var(--c1)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
              <Line dataKey="l3_tflops" name="if served from L3" stroke="var(--c2)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Design space: memory channels × cores per die" note={`Aggregate tok/s for this workload at every combination (darker = faster; ✗ = model does not fit). Best fitting cell: ${grid.best ? `${grid.best.a} channels × ${grid.best.b} cores → ${num(grid.best.value, 0)} tok/s at ${num(grid.best.watts, 0)} W` : 'none fits'}. Decode is bandwidth-first, so rows (channels) usually matter more than columns.`}>
          <div className="table-wrap">
            <table className="heat">
              <thead><tr><th>channels \ cores</th>{EXPLORE_B[1].map((b) => <th key={b}>{b}</th>)}</tr></thead>
              <tbody>
                {EXPLORE_A[1].map((a) => (
                  <tr key={a}><th>{a}</th>{EXPLORE_B[1].map((b) => {
                    const c = grid.cells.find((x) => x.a === a && x.b === b)
                    const on = design[EXPLORE_A[0]] === a && design[EXPLORE_B[0]] === b
                    return <td key={b} className={on ? 'on' : ''} style={{ '--heat': c.fits ? Math.max(0.08, c.value / grid.max) : 0 }}>{c.fits ? num(c.value, 0) : '✗'}</td>
                  })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <section className="card">
        <h2>Scale-out planner</h2>
        <div className="form"><label className="inline-label">Target aggregate throughput (tok/s)
          <input type="number" min="1" placeholder={String(targetTps)} value={target} onChange={(e) => setTarget(e.target.value)} /></label></div>
        <div className="kpis mt">
          <Kpi label="Machines of this design" value={so.machines} sub={`${num(so.per_machine_tps, 0)} tok/s each → ${num(so.total_tps, 0)} tok/s`} tone={(so.fits) ? 'good' : ''} />
          <Kpi label="Total power" value={`${num(so.total_watts / 1000, 2)} kW`} sub={`${num(so.total_watts * 24 / 1000, 0)} kWh per day`} />
          <Kpi label="Total memory" value={`${num(so.total_memory_gb, 0)} GB`} sub={`${so.total_cores} cores in total`} />
          <Kpi label="Fabric for tensor-parallel split" value={so.tp_fabric_gbs_hint < 1 ? `${num(so.tp_fabric_gbs_hint * 1000, 0)} MB/s` : `${num(so.tp_fabric_gbs_hint, 1)} GB/s`} sub="per machine, if one model were split instead of replicated" />
        </div>
        <p className="muted small">Replication is assumed (one full copy of the model per replica). {so.fits ? '' : 'The model does not fit one replica of this design, so replication is not possible: increase memory per node or lower the precision.'}</p>
      </section>
    </>
  )
}
