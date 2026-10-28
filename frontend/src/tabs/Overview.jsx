import React from 'react'
import { Kpi, Kpis, StatusBadge, Empty } from '../components/Kpi.jsx'
import AgentSetup from '../components/AgentSetup.jsx'
import { ago, num, pct } from '../lib/format.js'
import { go } from '../lib/hooks.js'

export default function Overview({ agents, jobs }) {
  if (!agents) return <p className="muted">Loading…</p>
  const done = (jobs || []).filter((j) => j.status === 'done' && j.summary)
  const online = agents.filter((a) => a.online).length
  // Only runs that actually changed the model count; a no-op winner is just the baseline again.
  const tuned = done.filter((j) => j.summary.transforms.length > 0)
  const bestRun = tuned.reduce((b, j) => (!b || j.summary.speedup > b.summary.speedup ? j : b), null)
  const bestShrink = done.reduce((b, j) => Math.max(b, j.summary.baseline_mb / j.summary.model_mb), 0)
  const active = (jobs || []).filter((j) => j.status === 'running' || j.status === 'queued')
  const name = (id) => agents.find((a) => a.id === id)?.name || id

  return (
    <>
      <Kpis>
        <Kpi label="Machines online" value={`${online} / ${agents.length}`} sub={agents.length ? 'agents connected to this server' : 'connect one below'} tone={online ? 'good' : ''} />
        <Kpi label="Tuning runs" value={done.length} sub={active.length ? `${active.length} in progress` : 'completed'} />
        <Kpi label="Best decode speedup" value={bestRun ? `${bestRun.summary.speedup}×` : '—'} sub={bestRun ? `${bestRun.summary.best} on ${name(bestRun.agentId)}` : done.length ? 'no run beat its baseline yet' : 'vs fp32 baseline'} tone={bestRun ? 'good' : ''} />
        <Kpi label="Best size reduction" value={bestShrink ? `${num(bestShrink, 1)}×` : '—'} sub="fewer bytes per token" />
      </Kpis>

      {agents.length === 0 && <AgentSetup />}

      {agents.length > 0 && (
        <section className="card">
          <div className="head"><h2>Fleet</h2><a href="#/machines">All machines →</a></div>
          <div className="fleet">
            {agents.map((a) => {
              const last = (jobs || []).find((j) => j.agentId === a.id)
              return (
                <button key={a.id} className="machine" onClick={() => go(`machines/${a.id}`)}>
                  <div className="machine-top"><span className={`dot ${a.online ? 'on' : ''}`} /> <strong>{a.name}</strong></div>
                  <div className="muted small">{a.hardware?.model_name}</div>
                  <div className="small">{a.hardware?.logical_cores} threads · {a.hardware?.memory_total_gb} GB · {a.hardware?.memory_bandwidth_gbs} GB/s{a.hardware?.gpus?.length ? ` · ${a.hardware.gpus.length} GPU` : ''}</div>
                  <div className="muted small">{last ? `Last run ${ago(last.created)}: ${last.summary ? `${last.summary.speedup}×` : last.status}` : 'No runs yet'}</div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="card">
        <div className="head"><h2>Recent runs</h2><a href="#/runs">All runs →</a></div>
        {(jobs || []).length === 0 ? (
          <Empty title="No tuning runs yet">Start one from the <a href="#/tune">Tune</a> tab.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="clickable">
              <thead><tr><th>When</th><th>Machine</th><th>Model</th><th>Status</th><th>Best config</th><th>tok/s</th><th>Speedup</th><th>Task acc</th></tr></thead>
              <tbody>
                {jobs.slice(0, 6).map((j) => (
                  <tr key={j.id} onClick={() => go(`runs/${j.id}`)}>
                    <td>{ago(j.created)}</td><td>{name(j.agentId)}</td><td>{j.model_id}</td><td><StatusBadge status={j.status} /></td>
                    <td>{j.summary?.best || '—'}</td><td>{j.summary?.decode_tps ?? '—'}</td>
                    <td>{j.summary ? `${j.summary.speedup}×` : '—'}</td><td>{pct(j.summary?.eval_accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
