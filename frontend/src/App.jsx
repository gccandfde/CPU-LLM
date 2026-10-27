import React, { useEffect, useState } from 'react'
import { api } from './api.js'
import HardwareCard from './components/HardwareCard.jsx'
import LiveTelemetry from './components/LiveTelemetry.jsx'
import TuneForm from './components/TuneForm.jsx'
import Results from './components/Results.jsx'

export default function App() {
  const [hw, setHw] = useState(null)
  const [hwError, setHwError] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)

  useEffect(() => {
    api.hardware().then(setHw).catch((e) => setHwError(e.message))
  }, [])

  useEffect(() => {
    if (!jobId) return
    let stop = false
    const poll = async () => {
      try {
        const j = await api.job(jobId)
        if (stop) return
        setJob(j)
        if (j.status === 'running') setTimeout(poll, 1000)
      } catch {
        if (!stop) setTimeout(poll, 2000)
      }
    }
    poll()
    return () => { stop = true }
  }, [jobId])

  return (
    <div className="app">
      <header>
        <h1>CPU-LLM</h1>
        <p>Hardware-aware LLM tuning for CPUs: transform, benchmark, export a reproducible recipe.</p>
      </header>
      {hwError && <div className="card error">Backend unreachable: {hwError}</div>}
      <div className="grid two">
        <HardwareCard hw={hw} />
        <TuneForm hw={hw} running={job?.status === 'running'} onStart={(id) => { setJob(null); setJobId(id) }} />
      </div>
      <LiveTelemetry />
      {job && <Results job={job} />}
    </div>
  )
}
