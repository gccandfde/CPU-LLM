import React, { useState } from 'react'
import { api, nativePrecisions } from '../api.js'

const MODELS = [
  ['builtin:tiny-llama', 'Built-in tiny Llama (offline, random weights)'],
  ['HuggingFaceTB/SmolLM2-135M', 'SmolLM2 135M'],
  ['HuggingFaceTB/SmolLM2-360M', 'SmolLM2 360M'],
  ['Qwen/Qwen2.5-0.5B', 'Qwen2.5 0.5B'],
]
const PRECISIONS = ['fp32', 'int8_dynamic', 'bf16']

const csvInts = (s) => s.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n))

export default function TuneForm({ agent, running, onStart }) {
  const hw = agent.hardware
  const [model, setModel] = useState(MODELS[0][0])
  const [precisions, setPrecisions] = useState(["fp32", "bf16", "int8_dynamic"])
  const [prune, setPrune] = useState('0, 2')
  const [threads, setThreads] = useState('')
  const [budget, setBudget] = useState(10)
  const [tokens, setTokens] = useState(32)
  const [error, setError] = useState(null)

  const toggle = (p) => setPrecisions((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]))
  const native = nativePrecisions(hw)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const { id } = await api.startTune({
        agent_id: agent.id,
        model_id: model,
        precisions,
        prune_counts: csvInts(prune),
        thread_counts: threads.trim() ? csvInts(threads) : null,
        new_tokens: Number(tokens),
        max_ppl_increase_pct: Number(budget),
      })
      onStart(id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="card">
      <h2>Tune a model</h2>
      <form onSubmit={submit} className="form">
        <label>Base model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend>Precision</legend>
          {PRECISIONS.map((p) => (
            <label key={p} className="check">
              <input type="checkbox" checked={precisions.includes(p)} onChange={() => toggle(p)} />
              {p}{hw && !native.includes(p) && <span className="muted"> (emulated)</span>}
            </label>
          ))}
        </fieldset>
        <label>Layers to prune (comma list)<input value={prune} onChange={(e) => setPrune(e.target.value)} /></label>
        <label>Thread counts (blank = auto)<input value={threads} placeholder="e.g. 2, 4" onChange={(e) => setThreads(e.target.value)} /></label>
        <div className="row">
          <label>Max perplexity increase %<input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          <label>Tokens to generate<input type="number" min="2" max="256" value={tokens} onChange={(e) => setTokens(e.target.value)} /></label>
        </div>
        <button disabled={running || !agent.online || !precisions.length}>{running ? 'Tuning…' : 'Run tuning sweep'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  )
}
