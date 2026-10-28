import React, { useState } from 'react'
import { api } from '../api.js'
import { transformLabel } from '../lib/format.js'

export function reproduceCommand(recipe) {
  const env = Object.entries(recipe.runtime.env || {}).map(([k, v]) => `${k}=${v}`).join(' ')
  return `${env} python -m cpullm.reproduce recipe.json`
}

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      window.prompt('Copy this:', text)
    }
  }
  return <button type="button" className="ghost small" onClick={copy}>{done ? 'Copied ✓' : label}</button>
}

export default function RecipeView({ recipe, jobId }) {
  const json = JSON.stringify(recipe, null, 2)
  const cmd = reproduceCommand(recipe)
  return (
    <section className="card">
      <div className="head">
        <h2>Recipe</h2>
        <div className="actions">
          <CopyButton text={json} label="Copy JSON" />
          <a className="button" href={api.bundleUrl(jobId)}>Download bundle</a>
        </div>
      </div>
      <h3>Transforms, applied in order</h3>
      <ol className="steps">
        {recipe.transforms.length === 0 && <li className="muted">None: the fp32 baseline was best.</li>}
        {recipe.transforms.map((t, i) => <li key={i}><strong>{transformLabel(t)}</strong> <code className="muted">{JSON.stringify(t)}</code></li>)}
      </ol>
      <h3>Rebuild on another machine</h3>
      <div className="cmd"><code>{cmd}</code><CopyButton text={cmd} /></div>
      <p className="muted small">Pinned to <code>{recipe.model.id}@{String(recipe.model.revision).slice(0, 12)}</code>. Accuracy and size reproduce exactly; speed is re-measured and compared with the expected numbers.</p>
      <details>
        <summary>Full recipe JSON</summary>
        <pre>{json}</pre>
      </details>
    </section>
  )
}
