import React, { useState } from 'react'
import { api, nativePrecisions } from '../api.js'

const PRECISIONS = [
  ['fp32', 'fp32', 'Reference precision.'],
  ['bf16', 'bf16', 'Half the bytes; native with AVX512_BF16 / AMX.'],
  ['int8_dynamic', 'int8 dynamic', 'int8 weights + activations (torch.ao). Fast on VNNI, can cost accuracy.'],
  ['int8_weight_only', 'int8 weight-only', 'int8 weights, float activations (torchao). Accurate; pair with compile.'],
  ['int4_weight_only', 'int4 weight-only', 'GPU only today (torchao).'],
  ['fp16', 'fp16', 'GPU only.'],
]
const CPU_ONLY = ['int8_dynamic']
const GPU_ONLY = ['fp16', 'int4_weight_only']

// Fields a preset may leave out (admins can write partial presets).
const BASE = { precisions: ['fp32'], prune: '0', batch: '1', eval: true, profile: false, compile: false, tokens: 16, repeats: 2, ppl: 10, evalDrop: 5 }

const csvInts = (s) => String(s ?? '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n))

// Models, presets, allowed precisions/devices and limits come from the
// admin settings (`tuning`, served by /api/config).
export default function TuneForm({ agent, tuning, busy, onStarted }) {
  const hw = agent.hardware
  const hasGpu = hw?.gpus?.length > 0
  const { presets, limits: L } = tuning
  const models = [...tuning.models.map((m) => [m.id, m.label]), ...(tuning.allowCustomModels ? [['custom', 'Other Hugging Face model…']] : [])]
  const listed = tuning.models.some((m) => m.id === tuning.defaultModel)
  const [model, setModel] = useState(listed ? tuning.defaultModel : tuning.allowCustomModels ? 'custom' : models[0]?.[0])
  const [custom, setCustom] = useState(listed ? '' : tuning.defaultModel)
  const [device, setDevice] = useState(tuning.devices.includes('cpu') ? 'cpu' : 'cuda')
  const [v, setV] = useState({ ...BASE, threads: '', ...presets[tuning.defaultPreset].v })
  const [preset, setPreset] = useState(tuning.defaultPreset)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const native = nativePrecisions(hw)
  const supported = (p) => tuning.precisions.includes(p) && (device === 'cpu' ? !GPU_ONLY.includes(p) : !CPU_ONLY.includes(p))
  const togglePrec = (p) => setV((s) => ({ ...s, precisions: s.precisions.includes(p) ? s.precisions.filter((x) => x !== p) : [...s.precisions, p] }))
  const applyPreset = (k) => { setPreset(k); setV((s) => ({ ...BASE, threads: s.threads, ...presets[k].v })) }
  const chosen = v.precisions.filter(supported)
  const configs = chosen.length * Math.max(1, csvInts(v.prune).length) * (device === 'cpu' ? Math.max(1, csvInts(v.threads).length || 2) : 1)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const { id } = await api.startTune({
        agent_id: agent.id,
        model_id: model === 'custom' ? custom.trim() : model,
        device,
        precisions: chosen,
        prune_counts: csvInts(v.prune).length ? csvInts(v.prune) : [0],
        thread_counts: v.threads.trim() ? csvInts(v.threads) : null,
        batch_sizes: csvInts(v.batch).length ? csvInts(v.batch) : [1],
        new_tokens: Number(v.tokens),
        repeats: Number(v.repeats),
        max_ppl_increase_pct: Number(v.ppl),
        max_eval_drop_pts: Number(v.evalDrop),
        run_eval: v.eval,
        profile: v.profile,
        compile: v.compile,
      })
      onStarted(id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <div className="presets">
        {Object.entries(presets).map(([k, p]) => (
          <button type="button" key={k} className={`preset ${preset === k ? 'on' : ''}`} onClick={() => applyPreset(k)}>
            <strong>{p.label}</strong><span>{p.desc}</span>
          </button>
        ))}
      </div>

      <div className="row">
        <label>Base model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>Device
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="cpu" disabled={!tuning.devices.includes('cpu')}>CPU</option>
            <option value="cuda" disabled={!hasGpu || !tuning.devices.includes('cuda')}>GPU (CUDA / ROCm){hasGpu ? ` — ${hw.gpus[0].name}` : ' — none detected'}</option>
          </select>
        </label>
      </div>
      {model === 'custom' && (
        <label>Hugging Face model id<input value={custom} placeholder="org/model-name" onChange={(e) => setCustom(e.target.value)} required /></label>
      )}

      <fieldset>
        <legend>Precision / quantisation</legend>
        <div className="checks">
          {PRECISIONS.filter(([p]) => tuning.precisions.includes(p)).map(([p, label, hint]) => (
            <label key={p} className={`check ${supported(p) ? '' : 'disabled'}`} title={hint}>
              <input type="checkbox" checked={v.precisions.includes(p) && supported(p)} disabled={!supported(p)} onChange={() => togglePrec(p)} />
              {label}
              {device === 'cpu' && supported(p) && ['bf16', 'int8_dynamic'].includes(p) && !native.includes(p) && <span className="muted"> (emulated)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="row three">
        <label>Layers to prune<input value={v.prune} onChange={set('prune')} placeholder="0, 2" /></label>
        <label>Thread counts<input value={v.threads} onChange={set('threads')} placeholder="auto" disabled={device !== 'cpu'} /></label>
        <label>Batch sizes<input value={v.batch} onChange={set('batch')} placeholder="1, 4, 16" /></label>
      </div>

      <fieldset>
        <legend>Accuracy budget</legend>
        <div className="row">
          <label>Max perplexity increase %<input type="number" min="0" step="0.5" value={v.ppl} onChange={set('ppl')} /></label>
          <label>Max task-accuracy drop (points)<input type="number" min="0" step="0.5" value={v.evalDrop} onChange={set('evalDrop')} disabled={!v.eval} /></label>
        </div>
      </fieldset>

      <div className="checks">
        <label className="check"><input type="checkbox" checked={v.eval} onChange={set('eval')} />Task eval (30 multiple-choice items)</label>
        <label className="check"><input type="checkbox" checked={v.profile} onChange={set('profile')} />Operator trace</label>
        <label className="check"><input type="checkbox" checked={v.compile} onChange={set('compile')} />torch.compile the winner <span className="muted">(+minutes)</span></label>
      </div>

      <details>
        <summary>Measurement settings</summary>
        <div className="row">
          <label>Tokens to generate<input type="number" min="2" max={L.maxNewTokens} value={v.tokens} onChange={set('tokens')} /></label>
          <label>Repeats per config<input type="number" min="1" max={L.maxRepeats} value={v.repeats} onChange={set('repeats')} /></label>
        </div>
      </details>

      <button disabled={busy || !agent.online || !chosen.length}>
        {busy ? 'This machine is busy…' : !agent.online ? 'Machine offline' : `Run ${configs} configuration${configs === 1 ? '' : 's'}`}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
