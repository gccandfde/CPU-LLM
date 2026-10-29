import React, { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { api } from '../api.js'
import { forecast } from '../lib/forecast.js'
import { num } from '../lib/format.js'

const WINDOW = 180 // seconds of history kept (rolling window the forecast learns from)
const AHEAD = 60 // seconds projected ahead

function Panel({ title, data, lines, unit, forecastKey, note }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} unit={unit} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} formatter={(v, n) => [num(v, 1), n]} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {forecastKey && <ReferenceLine x="now" stroke="var(--muted)" strokeDasharray="2 4" />}
          {lines.map(([key, color, name]) => (
            <Line key={key} dataKey={key} name={name} stroke={color} dot={false} strokeWidth={2} isAnimationActive={false} />
          ))}
          {forecastKey && <Line dataKey={`${forecastKey}_hi`} name="band" stroke="var(--muted)" strokeOpacity={0.5} dot={false} strokeWidth={1} strokeDasharray="2 3" isAnimationActive={false} legendType="none" />}
          {forecastKey && <Line dataKey={`${forecastKey}_lo`} name="band" stroke="var(--muted)" strokeOpacity={0.5} dot={false} strokeWidth={1} strokeDasharray="2 3" isAnimationActive={false} legendType="none" />}
          {forecastKey && <Line dataKey={`${forecastKey}_fc`} name="next minute" stroke={lines[0][1]} dot={false} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false} legendType="none" />}
        </LineChart>
      </ResponsiveContainer>
      {note && <p className="muted small">{note}</p>}
    </div>
  )
}

export default function LiveTelemetry({ agentId, memoryTotalGb }) {
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

  // One-minute-ahead forecast from the rolling window, appended to the chart
  // as dashed points so the eye reads it as a continuation of the live line.
  const { rows, cpuF, memF } = useMemo(() => {
    const cpuF = forecast(data, 'cpu_percent', { horizon: AHEAD, max: 100 })
    const memF = forecast(data, 'mem_used_gb', { horizon: AHEAD, max: memoryTotalGb || Infinity })
    if (!cpuF || !memF || data.length < 10) return { rows: data, cpuF: null, memF: null }
    const last = data[data.length - 1]
    const future = cpuF.points.map((p, i) => ({
      t: i === 0 ? 'now' : `+${p.offsetSec}s`,
      cpu_percent_fc: p.value, cpu_percent_hi: p.hi, cpu_percent_lo: p.lo,
      mem_used_gb_fc: memF.points[i].value, mem_used_gb_hi: memF.points[i].hi, mem_used_gb_lo: memF.points[i].lo,
    }))
    // Join the dashed line to the live line.
    future.unshift({ t: 'now', cpu_percent_fc: last.cpu_percent, cpu_percent_hi: last.cpu_percent, cpu_percent_lo: last.cpu_percent, mem_used_gb_fc: last.mem_used_gb, mem_used_gb_hi: last.mem_used_gb, mem_used_gb_lo: last.mem_used_gb })
    return { rows: [...data, ...future.slice(0, -1)], cpuF, memF }
  }, [data, memoryTotalGb])

  const heading = (f, unit, digits) => f ? `Next minute: ${num(f.at, digits)}${unit} (${num(f.lo, digits)}–${num(f.hi, digits)}), ${f.trendPerMin >= 0 ? '+' : ''}${num(f.trendPerMin, digits)}${unit}/min` : 'Forecast after ~10 s of samples'

  return (
    <section className="card">
      <h2>Live system telemetry <span className={`dot ${live ? 'on' : ''}`} /> <span className="muted small">last {Math.min(data.length, WINDOW)} s, dashed = next {AHEAD} s</span></h2>
      <div className="cores">
        {cores.map((p, i) => (
          <div key={i} className="core" title={`core ${i}: ${p}%`}>
            <div style={{ height: `${p}%` }} />
          </div>
        ))}
      </div>
      <div className="grid four">
        <Panel title="CPU" data={rows} unit="%" lines={[['cpu_percent', 'var(--c1)', 'CPU %']]} forecastKey="cpu_percent" note={heading(cpuF, '%', 0)} />
        <Panel title="Memory" data={rows} unit="GB" lines={[['mem_used_gb', 'var(--c2)', 'Used GB']]} forecastKey="mem_used_gb" note={heading(memF, ' GB', 2)} />
        <Panel title="Disk MB/s" data={data} unit="" lines={[['disk_read_mbs', 'var(--c1)', 'read'], ['disk_write_mbs', 'var(--c3)', 'write']]} />
        <Panel title="Network MB/s" data={data} unit="" lines={[['net_recv_mbs', 'var(--c2)', 'recv'], ['net_sent_mbs', 'var(--c4)', 'sent']]} />
      </div>
    </section>
  )
}
