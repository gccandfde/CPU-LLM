import React from 'react'
import TuneForm from '../components/TuneForm.jsx'
import AgentSetup from '../components/AgentSetup.jsx'
import { go } from '../lib/hooks.js'

export default function Tune({ agents, jobs, tuning, selectedId, onStarted }) {
  if (!agents || !tuning) return <p className="muted">Loading…</p>
  if (agents.length === 0) return <AgentSetup />
  const agent = agents.find((a) => a.id === selectedId) || agents.find((a) => a.online) || agents[0]
  const busy = (jobs || []).find((j) => j.agentId === agent.id && (j.status === 'running' || j.status === 'queued'))
  return (
    <div className="grid tune">
      <section className="card">
        <h2>New tuning run</h2>
        <label className="form inline-label">Machine
          <select value={agent.id} onChange={(e) => go(`tune/${e.target.value}`)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.online ? '● ' : '○ '}{a.name} — {a.hardware?.model_name}</option>)}
          </select>
        </label>
        {busy && <p className="warn-text">This machine is running <a href={`#/runs/${busy.id}`}>another job</a>; wait for it to finish.</p>}
        <TuneForm key={agent.id} agent={agent} tuning={tuning} busy={!!busy} onStarted={(id) => { onStarted(); go(`runs/${id}`) }} />
      </section>
      <aside className="card help">
        <h2>How a run works</h2>
        <ol>
          <li><strong>Profile</strong> the machine and measure per-layer redundancy.</li>
          <li><strong>Baseline</strong> fp32 speed, perplexity and task accuracy, measured at the start and the end to estimate noise.</li>
          <li><strong>Sweep</strong> every precision × pruning × thread combination.</li>
          <li><strong>Select</strong> the fastest configuration within your accuracy budget; optionally <code>torch.compile</code> it.</li>
          <li><strong>Trace</strong> operators and measure batch scaling for the winner.</li>
          <li><strong>Export</strong> a recipe that rebuilds the tuned model anywhere.</li>
        </ol>
        <p className="muted small">Benchmarks are only as good as the machine is quiet: stop other workloads on it while tuning.</p>
      </aside>
    </div>
  )
}
