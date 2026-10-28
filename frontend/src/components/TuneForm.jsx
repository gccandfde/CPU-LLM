import React, { useState } from 'react'
import { api, nativePrecisions } from '../api.js'

const MODELS = [
  ['builtin:tiny-llama', 'Built-in tiny Llama (offline, random weights)'],
  ['HuggingFaceTB/SmolLM2-135M', 'SmolLM2 135M'],
  ['HuggingFaceTB/SmolLM2-360M', 'SmolLM2 360M'],
  ['Qwen/Qwen2.5-0.5B', 'Qwen2.5 0.5B'],
  ['meta-llama/Llama-3.2-1B', 'Llama 3.2 1B (gated: needs HF login on the agent)'],
  ['custom', 'Other Hugging Face model…'],
]

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

const PRESETS = {
  quick: { label: 'Quick check', desc: '~1 min', v: { precisions: ['fp32', 'bf16'], prune: '0', batch: '1', eval: true, profile: false, compile: false, tokens: 16, repeats: 2 } },
  full: { label: 'Full sweep', desc: 'all precisions, pruning, batching', v: { precisions: ['fp32', 'bf16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only', 'fp16'], prune: '0, 2', batch: '1, 4, 16', eval: true, profile: true, compile: false, tokens: 32, repeats: 3 } },
  accuracy: { label: 'Accuracy-first', desc: 'tight budgets, no pruning', v: { precisions: ['fp32', 'bf16', 'int8_weight_only'], prune: '0', batch: '1', eval: true, profile: true, compile: false, tokens: 32, repeats: 3, ppl: 2, evalDrop: 1 } },
  max: { label: 'Max speed', desc: 'adds torch.compile (slow to tune)', v: { precisions: ['bf16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only', 'fp16'], prune: '0, 2, 4', batch: '1, 8', eval: true, profile: true, compile: true, tokens: 32, repeats: 3, ppl: 15, evalDrop: 5 } },
}

const csvInts = (s) => s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n))

export default function TuneForm({ agent, busy, onStarted }) {
  const hw = agent.hardware
  const hasGpu = hw?.gpus?.length > 0
  const [model, setModel] = useState(MODELS[1][0])
  const [custom, setCustom] = useState('')
  const [device, setDevice] = useState('cpu')
  const [v, setV] = useState({ ...PRESETS.full.v, ppl: 10, evalDrop: 5, threads: '' })
  const [preset, setPreset] = useState('full')
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const native = nativePrecisions(hw)
  const supported = (p) => (device === 'cpu' ? !GPU_ONLY.includes(p) : !CPU_ONLY.includes(p))
  const togglePrec = (p) => setV((s) => ({ ...s, precisions: s.precisions.includes(p) ? s.precisions.filter((x) => x !== p) : [...s.precisions, p] }))
  const applyPreset = (k) => { setPreset(k); setV((s) => ({ ...s, ppl: 10, evalDrop: 5, ...PRESETS[k].v })) }
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
        {Object.entries(PRESETS).map(([k, p]) => (
          <button type="button" key={k} className={`preset ${preset === k ? 'on' : ''}`} onClick={() => applyPreset(k)}>
            <strong>{p.label}</strong><span>{p.desc}</span>
          </button>
        ))}
      </div>

      <div className="row">
        <label>Base model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>Device
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="cpu">CPU</option>
            <option value="cuda" disabled={!hasGpu}>GPU (CUDA / ROCm){hasGpu ? ` — ${hw.gpus[0].name}` : ' — none detected'}</option>
          </select>
        </label>
      </div>
      {model === 'custom' && (
        <label>Hugging Face model id<input value={custom} placeholder="org/model-name" onChange={(e) => setCustom(e.target.value)} required /></label>
      )}

      <fieldset>
        <legend>Precision / quantisation</legend>
        <div className="checks">
          {PRECISIONS.map(([p, label, hint]) => (
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
          <label>Tokens to generate<input type="number" min="2" max="256" value={v.tokens} onChange={set('tokens')} /></label>
          <label>Repeats per config<input type="number" min="1" max="10" value={v.repeats} onChange={set('repeats')} /></label>
        </div>
      </details>

      <button disabled={busy || !agent.online || !chosen.length}>
        {busy ? 'This machine is busy…' : !agent.online ? 'Machine offline' : `Run ${configs} configuration${configs === 1 ? '' : 's'}`}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
