import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import AgentSetup from './components/AgentSetup.jsx'
import HardwareCard from './components/HardwareCard.jsx'
import LiveTelemetry from './components/LiveTelemetry.jsx'
import TuneForm from './components/TuneForm.jsx'
import Results from './components/Results.jsx'

export default function App() {
  const [agents, setAgents] = useState(null)
  const [agentId, setAgentId] = useState(null)
  const [error, setError] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)

  useEffect(() => {
    let stop = false, timer
    const load = async () => {
      try {
        const list = await api.agents()
        if (stop) return
        setAgents(list)
        setError(null)
        setAgentId((cur) => cur ?? (list.find((a) => a.online) || list[0])?.id ?? null)
      } catch (e) {
        if (!stop) setError(e.message)
      }
      if (!stop) timer = setTimeout(load, 5000)
    }
    load()
    return () => { stop = true; clearTimeout(timer) }
  }, [])

  // Show the most recent job for the selected agent.
  useEffect(() => {
    setJob(null)
    setJobId(null)
    if (agentId) api.jobs(agentId).then((js) => js[0] && setJobId(js[0].id)).catch(() => {})
  }, [agentId])

  useEffect(() => {
    if (!jobId) return
    let stop = false, timer
    const poll = async () => {
      try {
        const j = await api.job(jobId)
        if (stop) return
        setJob(j)
        if (j.status === 'running' || j.status === 'queued') timer = setTimeout(poll, 1000)
      } catch {
        if (!stop) timer = setTimeout(poll, 2000)
      }
    }
    poll()
    return () => { stop = true; clearTimeout(timer) }
  }, [jobId])

  const agent = agents?.find((a) => a.id === agentId)

  return (
    <div className="app">
      <header>
        <div>
          <h1>CPU-LLM</h1>
          <p>Hardware-aware LLM tuning for CPUs: transform, benchmark, export a reproducible recipe.</p>
        </div>
        {agents?.length > 0 && (
          <label className="agent-pick">Machine
            <select value={agentId || ''} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.online ? '● ' : '○ '}{a.name} — {a.hardware?.model_name}</option>
              ))}
            </select>
          </label>
        )}
      </header>
      {error && <div className="card error">Server unreachable: {error}</div>}
      {agents && agents.length === 0 && <AgentSetup />}
      {agent && (
        <>
          {!agent.online && <div className="card warn">This agent is offline. Start it on the machine to run jobs and see telemetry.</div>}
          <div className="grid two">
            <HardwareCard hw={agent.hardware} />
            <TuneForm
              agent={agent}
              running={job?.status === 'running' || job?.status === 'queued'}
              onStart={(id) => { setJob(null); setJobId(id) }}
            />
          </div>
          <LiveTelemetry agentId={agent.id} />
          {job && <Results job={job} />}
        </>
      )}
    </div>
  )
}
