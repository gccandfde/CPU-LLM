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

// Forecast keys: CPU %, memory, and when the agent reports a GPU, its
// utilisation and board power too.
const FORECASTS = [
  ['cpu_percent', { max: 100 }],
  ['mem_used_gb', {}],
  ['gpu_percent', { max: 100 }],
  ['gpu_power_w', {}],
]

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

  const hasGpu = data.some((s) => s.gpu_percent != null)
  const last = data[data.length - 1]

  // One-minute-ahead forecast from the rolling window, appended to the chart
  // as dashed points so the eye reads it as a continuation of the live line.
  const { rows, fc } = useMemo(() => {
    if (data.length < 10) return { rows: data, fc: {} }
    const fc = {}
    for (const [key, opts] of FORECASTS) {
      if (key.startsWith('gpu') && !hasGpu) continue
      const max = key === 'mem_used_gb' ? (memoryTotalGb || Infinity) : key === 'gpu_power_w' ? Infinity : opts.max
      const f = forecast(data, key, { horizon: AHEAD, max })
      if (f) fc[key] = f
    }
    const keys = Object.keys(fc)
    if (!keys.length) return { rows: data, fc: {} }
    const last = data[data.length - 1]
    const n = fc[keys[0]].points.length
    const future = Array.from({ length: n }, (_, i) => {
      const row = { t: i === 0 ? 'now' : `+${fc[keys[0]].points[i].offsetSec}s` }
      for (const k of keys) { const p = fc[k].points[i]; row[`${k}_fc`] = p.value; row[`${k}_hi`] = p.hi; row[`${k}_lo`] = p.lo }
      return row
    })
    // Join the dashed line to the live line.
    const join = { t: 'now' }
    for (const k of keys) { join[`${k}_fc`] = last[k]; join[`${k}_hi`] = last[k]; join[`${k}_lo`] = last[k] }
    return { rows: [...data, join, ...future.slice(1, -1)], fc }
  }, [data, memoryTotalGb, hasGpu])

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
        <Panel title="CPU" data={rows} unit="%" lines={[['cpu_percent', 'var(--c1)', 'CPU %']]} forecastKey="cpu_percent" note={heading(fc.cpu_percent, '%', 0)} />
        <Panel title="Memory" data={rows} unit="GB" lines={[['mem_used_gb', 'var(--c2)', 'Used GB']]} forecastKey="mem_used_gb" note={heading(fc.mem_used_gb, ' GB', 2)} />
        {hasGpu && <Panel title={`GPU${last?.gpus?.length > 1 ? ` (${last.gpus.length}, average)` : last?.gpus?.[0]?.name ? ` · ${last.gpus[0].name}` : ''}`} data={rows} unit="%" lines={[['gpu_percent', 'var(--c4)', 'GPU %']]} forecastKey="gpu_percent" note={heading(fc.gpu_percent, '%', 0)} />}
        {hasGpu && <Panel title="GPU memory and power" data={rows} unit="" lines={[['gpu_mem_used_gb', 'var(--c2)', 'VRAM GB'], ['gpu_power_w', 'var(--c3)', 'board W']]} forecastKey={fc.gpu_power_w ? 'gpu_power_w' : undefined} note={last?.gpu_power_w != null ? `${heading(fc.gpu_power_w, ' W', 0)} · ${num(last.gpu_mem_used_gb, 2)} of ${num(last.gpu_mem_total_gb, 1)} GB VRAM${last.gpu_temp_c != null ? ` · ${last.gpu_temp_c} °C` : ''}` : 'Board power not reported by this driver'} />}
        <Panel title="Disk MB/s" data={data} unit="" lines={[['disk_read_mbs', 'var(--c1)', 'read'], ['disk_write_mbs', 'var(--c3)', 'write']]} />
        <Panel title="Network MB/s" data={data} unit="" lines={[['net_recv_mbs', 'var(--c2)', 'recv'], ['net_sent_mbs', 'var(--c4)', 'sent']]} />
      </div>
    </section>
  )
}
