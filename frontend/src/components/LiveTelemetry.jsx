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

export default function LiveTelemetry() {
  const [data, setData] = useState([])
  const [cores, setCores] = useState([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let ws, retry, closed = false
    const connect = () => {
      ws = api.telemetrySocket()
      ws.onopen = () => setConnected(true)
      ws.onclose = () => { setConnected(false); if (!closed) retry = setTimeout(connect, 2000) }
      ws.onmessage = (ev) => {
        const s = JSON.parse(ev.data)
        setCores(s.cpu_per_core)
        setData((d) => [...d.slice(-(WINDOW - 1)), { ...s, t: new Date(s.ts * 1000).toLocaleTimeString() }])
      }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); ws?.close() }
  }, [])

  return (
    <section className="card">
      <h2>Live system telemetry <span className={`dot ${connected ? 'on' : ''}`} /></h2>
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
