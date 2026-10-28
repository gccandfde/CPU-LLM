import React from 'react'
import HardwareCard from '../components/HardwareCard.jsx'
import LiveTelemetry from '../components/LiveTelemetry.jsx'
import AgentSetup from '../components/AgentSetup.jsx'
import { ago } from '../lib/format.js'
import { go } from '../lib/hooks.js'

export default function Machines({ agents, selectedId }) {
  if (!agents) return <p className="muted">Loading…</p>
  if (agents.length === 0) return <AgentSetup />
  const agent = agents.find((a) => a.id === selectedId) || agents[0]
  return (
    <div className="split">
      <aside className="card list">
        <h2>Machines</h2>
        {agents.map((a) => (
          <button key={a.id} className={`list-item ${a.id === agent.id ? 'on' : ''}`} onClick={() => go(`machines/${a.id}`)}>
            <span className={`dot ${a.online ? 'on' : ''}`} />
            <span><strong>{a.name}</strong><br /><span className="muted small">{a.online ? 'online' : `seen ${ago(a.lastSeen)}`}</span></span>
          </button>
        ))}
        <details className="mt">
          <summary>Add a machine</summary>
          <AgentSetup compact />
        </details>
      </aside>
      <div>
        <div className="head">
          <h2>{agent.name}</h2>
          <a className="button" href={`#/tune/${agent.id}`}>Tune on this machine</a>
        </div>
        <HardwareCard hw={agent.hardware} />
        <LiveTelemetry agentId={agent.id} />
      </div>
    </div>
  )
}
