import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Empty, StatusBadge } from '../components/Kpi.jsx'
import { ago, num } from '../lib/format.js'
import { go } from '../lib/hooks.js'

// Open-source workload suite (STREAM, GEMM, attention, gather) on CPU or
// GPU, run by the agent; finished runs compared across machines here.
export default function Benchmarks({ agents, jobs, onStarted }) {
  const [agentId, setAgentId] = useState('')
  const [device, setDevice] = useState('cpu')
  const [size, setSize] = useState('standard')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [full, setFull] = useState({})
  const mine = (jobs || []).filter((j) => j.summary?.kind === 'benchmark' || (j.status !== 'done' && j.model_id == null))
  useEffect(() => { if (!agentId && agents?.length) setAgentId((agents.find((a) => a.online) || agents[0]).id) }, [agents, agentId])
  useEffect(() => {
    for (const j of mine.filter((x) => x.status === 'done').slice(0, 20)) if (!full[j.id]) api.job(j.id).then((x) => setFull((f) => ({ ...f, [j.id]: x }))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((j) => j.id + j.status).join()])
  const agent = agents?.find((a) => a.id === agentId)
  const hasGpu = (agent?.hardware?.gpus || []).length > 0
  const name = (id) => agents?.find((a) => a.id === id)?.name || id
  const SIZES = {
    quick: { stream_mb: 128, gemm_sizes: [1024, 2048], attention_ctx: [1024, 4096], gather_mb: 128, repeats: 2 },
    standard: { stream_mb: 256, gemm_sizes: [1024, 2048, 4096], attention_ctx: [1024, 4096, 16384], gather_mb: 512, repeats: 3 },
    large: { stream_mb: 1024, gemm_sizes: [2048, 4096, 8192], attention_ctx: [4096, 16384, 65536], gather_mb: 2048, repeats: 3 },
  }
  const start = async () => {
    setBusy(true); setErr(null)
    try {
      const { id } = await api.startTune({ agent_id: agentId, kind: 'benchmark', device, gemm_dtypes: device === 'cpu' ? ['fp32', 'bf16'] : ['fp32', 'fp16', 'bf16'], ...SIZES[size] })
      onStarted?.(); go(`runs/${id}`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const rows = mine.filter((j) => j.status === 'done' && full[j.id]?.result).map((j) => ({ j, r: full[j.id].result }))
  const gemmBest = (r, dt) => Math.max(0, ...(r.kernels?.gemm || []).filter((x) => x.dtype === dt && x.tflops).map((x) => x.tflops))
  return (
    <>
      <p className="muted">The kernels every LLM stack spends its time in, in plain PyTorch so the same suite runs on any CPU and on CUDA/ROCm GPUs: STREAM bandwidth, GEMM TFLOPS per dtype, attention decode and prefill, embedding gather. Compare machines, CPUs against GPUs, and firmware or kernel changes over time (campaigns can queue it too).</p>
      <div className="grid two">
        <section className="card">
          <h2>Run the suite</h2>
          <div className="form">
            <div className="row three">
              <label>Machine<select value={agentId} onChange={(e) => setAgentId(e.target.value)}>{(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.online ? '' : ' (offline)'}</option>)}</select></label>
              <label>Device<select value={device} onChange={(e) => setDevice(e.target.value)}><option value="cpu">CPU</option><option value="cuda" disabled={!hasGpu}>GPU (CUDA / ROCm){hasGpu ? '' : ' — none on this machine'}</option></select></label>
              <label>Size<select value={size} onChange={(e) => setSize(e.target.value)}><option value="quick">Quick (~1 min)</option><option value="standard">Standard</option><option value="large">Large (needs memory)</option></select></label>
            </div>
            {err && <p className="error small">{err}</p>}
            <div className="actions sticky"><button type="button" disabled={busy || !agentId} onClick={start}>{busy ? 'Queuing…' : agent?.online ? 'Run benchmarks' : 'Queue (starts when online)'}</button></div>
          </div>
        </section>
        <section className="card">
          <h2>Recent suite runs</h2>
          {!mine.length && <Empty title="No benchmark runs yet">Run the suite on a machine; results appear here and in Runs.</Empty>}
          {mine.length > 0 && <div className="table-wrap"><table className="clickable"><thead><tr><th>When</th><th>Machine</th><th>Device</th><th>Status</th><th>Headline</th></tr></thead>
            <tbody>{mine.slice(0, 12).map((j) => <tr key={j.id} onClick={() => go(`runs/${j.id}`)}><td>{ago(j.created)}</td><td>{name(j.agentId)}</td><td>{j.summary?.device || j.device}</td><td><StatusBadge status={j.status} /></td><td>{j.summary?.best || j.message}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      {rows.length > 0 && (
        <section className="card">
          <h2>Compare machines</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Machine</th><th>Device</th><th>STREAM triad GB/s</th><th>Copy GB/s</th><th>GEMM fp32 TFLOPS</th><th>GEMM bf16</th><th>GEMM fp16</th><th>Attention decode @4k tok/s</th><th>Prefill @4k tok/s</th><th>Gather GB/s</th><th>When</th></tr></thead>
            <tbody>{rows.map(({ j, r }) => {
              const a4 = (r.kernels?.attention || []).find((x) => x.ctx === 4096)
              return <tr key={j.id} className="clickable" onClick={() => go(`runs/${j.id}`)}><td><strong>{name(j.agentId)}</strong></td><td>{r.device}{r.gpu ? ` · ${r.gpu.name}` : ''}</td><td>{num(r.kernels?.stream?.triad_gbs, 1)}</td><td>{num(r.kernels?.stream?.copy_gbs, 1)}</td><td>{num(gemmBest(r, 'fp32'), 2)}</td><td>{num(gemmBest(r, 'bf16'), 2)}</td><td>{gemmBest(r, 'fp16') ? num(gemmBest(r, 'fp16'), 2) : '—'}</td><td>{num(a4?.decode_tokens_s, 0)}</td><td>{num(a4?.prefill_tokens_s, 0)}</td><td>{num(r.kernels?.gather?.gbs, 1)}</td><td className="muted small">{ago(j.created)}</td></tr>
            })}</tbody>
          </table></div>
          <p className="muted small">Same sizes and dtypes on every machine, so the columns compare directly. Decode speed tracks the STREAM column; prefill and batched serving track GEMM.</p>
        </section>
      )}
    </>
  )
}
