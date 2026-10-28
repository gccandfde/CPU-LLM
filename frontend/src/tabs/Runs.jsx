import React, { useState } from 'react'
import { api } from '../api.js'
import { StatusBadge, Empty } from '../components/Kpi.jsx'
import { ago, pct } from '../lib/format.js'
import { go } from '../lib/hooks.js'

export default function Runs({ agents, jobs, reload }) {
  const [machine, setMachine] = useState('')
  const [status, setStatus] = useState('')
  const [model, setModel] = useState('')
  if (!jobs) return <p className="muted">Loading…</p>
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const models = [...new Set(jobs.map((j) => j.model_id))]
  const rows = jobs.filter((j) => (!machine || j.agentId === machine) && (!status || j.status === status) && (!model || j.model_id === model))

  const remove = async (e, j) => {
    e.stopPropagation()
    if (!window.confirm(`Delete run ${j.id} (${j.model_id})? Its report and bundle are removed too.`)) return
    await api.deleteJob(j.id).catch((err) => alert(err.message))
    reload()
  }

  return (
    <section className="card">
      <div className="head">
        <h2>Runs</h2>
        <div className="filters">
          <select value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">All machines</option>
            {(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {['queued', 'running', 'done', 'error'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title={jobs.length ? 'No runs match these filters' : 'No runs yet'}>
          {!jobs.length && <>Start one from the <a href="#/tune">Tune</a> tab.</>}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="clickable">
            <thead>
              <tr><th>When</th><th>Machine</th><th>Model</th><th>Device</th><th>Status</th><th>Best config</th><th>tok/s</th><th>Speedup</th><th>Size MB</th><th>Task acc</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const s = j.summary
                return (
                  <tr key={j.id} onClick={() => go(`runs/${j.id}`)}>
                    <td>{ago(j.created)}</td><td>{name(j.agentId)}</td><td>{j.model_id}</td><td>{j.device}</td>
                    <td><StatusBadge status={j.status} />{j.status === 'running' && <span className="muted small"> {Math.round(j.progress * 100)}%</span>}</td>
                    <td>{s?.best || '—'}</td><td>{s?.decode_tps ?? '—'}</td><td>{s ? `${s.speedup}×` : '—'}</td>
                    <td>{s ? `${s.baseline_mb} → ${s.model_mb}` : '—'}</td><td>{pct(s?.eval_accuracy)}</td>
                    <td>{j.status !== 'running' && <button className="icon" title="Delete run" onClick={(e) => remove(e, j)}>✕</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
