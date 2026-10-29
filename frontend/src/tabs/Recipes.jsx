import React, { useState } from 'react'
import { api } from '../api.js'
import { Empty } from '../components/Kpi.jsx'
import { CopyButton } from '../components/RecipeView.jsx'
import { ago, num, pct, transformLabel } from '../lib/format.js'

export default function Recipes({ agents, jobs }) {
  const [q, setQ] = useState('')
  if (!jobs) return <p className="muted">Loading…</p>
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const done = jobs.filter((j) => j.status === 'done' && j.summary && !j.summary.kind) // tuning runs produce recipes; suite/power runs do not
    .filter((j) => !q || `${j.model_id} ${name(j.agentId)} ${j.summary.best}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="head">
        <p className="muted">Every finished run produces a recipe: the exact transforms and runtime settings that rebuild its tuned model on any machine.</p>
        <input className="search" placeholder="Filter by model, machine or config" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {done.length === 0 ? (
        <Empty title="No recipes yet">Recipes appear here when a <a href="#/tune">tuning run</a> finishes.</Empty>
      ) : (
        <div className="recipes">
          {done.map((j) => {
            const s = j.summary
            return (
              <article key={j.id} className="card recipe">
                <div className="head">
                  <div>
                    <h3 className="recipe-title">{j.model_id}</h3>
                    <div className="muted small">{name(j.agentId)} · {s.device} · {s.threads} threads · {ago(j.finished || j.created)}</div>
                  </div>
                  <a href={`#/runs/${j.id}/recipe`} className="small">Details →</a>
                </div>
                <div className="chips">
                  {s.transforms.length === 0 && <span className="chip on">fp32 baseline</span>}
                  {s.transforms.map((t, i) => <span key={i} className="chip on">{transformLabel(t)}</span>)}
                </div>
                <dl className="kv compact">
                  <dt>Decode</dt><dd>{s.decode_tps} tok/s <span className="muted">({s.speedup}×)</span></dd>
                  <dt>Size</dt><dd>{s.baseline_mb} → {s.model_mb} MB <span className="muted">({num(s.baseline_mb / s.model_mb, 1)}×)</span></dd>
                  <dt>Task acc</dt><dd>{pct(s.eval_accuracy)} <span className="muted">(baseline {pct(s.baseline_eval_accuracy)})</span></dd>
                </dl>
                <div className="actions">
                  <a className="button small" href={api.bundleUrl(j.id)}>Bundle</a>
                  <CopyButton text={`python -m cpullm.reproduce recipe.json`} label="Copy reproduce cmd" />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
