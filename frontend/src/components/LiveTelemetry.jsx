import React, { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { api } from '../api.js'

const WINDOW = 60

function Panel({ title, data, lines, unit }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit={unit} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {lines.map(([key, color, name]) => (
            <Line key={key} dataKey={key} name={name} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function LiveTelemetry({ agentId }) {
  const [data, setData] = useState([])
  const [cores, setCores] = useState([])
  const [live, setLive] = useState(false)

  useEffect(() => {
    setData([])
    setCores([])
    // `since` is in the agent's clock; liveness uses ours, so clock skew doesn't matter.
    let stop = false, timer, since = 0, lastRecv = 0
    const poll = async () => {
      try {
        const samples = await api.telemetry(agentId, since)
        if (stop) return
        if (samples.length) {
          since = samples[samples.length - 1].ts
          lastRecv = Date.now()
          setCores(samples[samples.length - 1].cpu_per_core)
          const rows = samples.map((s) => ({ ...s, t: new Date(s.ts * 1000).toLocaleTimeString() }))
          setData((d) => [...d, ...rows].slice(-WINDOW))
        }
        setLive(Date.now() - lastRecv < 5000)
      } catch {
        if (!stop) setLive(false)
      }
      if (!stop) timer = setTimeout(poll, 1000)
    }
    poll()
    return () => { stop = true; clearTimeout(timer) }
  }, [agentId])

  return (
    <section className="card">
      <h2>Live system telemetry <span className={`dot ${live ? 'on' : ''}`} /></h2>
      <div className="cores">
        {cores.map((p, i) => (
          <div key={i} className="core" title={`core ${i}: ${p}%`}>
            <div style={{ height: `${p}%` }} />
          </div>
        ))}
      </div>
      <div className="grid four">
        <Panel title="CPU" data={data} unit="%" lines={[['cpu_percent', 'var(--c1)', 'CPU %']]} />
        <Panel title="Memory" data={data} unit="GB" lines={[['mem_used_gb', 'var(--c2)', 'Used GB']]} />
        <Panel title="Disk MB/s" data={data} unit="" lines={[['disk_read_mbs', 'var(--c1)', 'read'], ['disk_write_mbs', 'var(--c3)', 'write']]} />
        <Panel title="Network MB/s" data={data} unit="" lines={[['net_recv_mbs', 'var(--c2)', 'recv'], ['net_sent_mbs', 'var(--c4)', 'sent']]} />
      </div>
    </section>
  )
}
