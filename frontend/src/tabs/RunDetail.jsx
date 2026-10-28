import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Kpi, Kpis, StatusBadge, Empty } from '../components/Kpi.jsx'
import ResultsTable from '../components/ResultsTable.jsx'
import { ThroughputChart, SpeedAccuracyChart, BatchScalingChart, OpProfile, LayerRedundancy, Roofline } from '../components/charts.jsx'
import RecipeView from '../components/RecipeView.jsx'
import { ago, num, pct } from '../lib/format.js'
import { go, usePoll } from '../lib/hooks.js'

const SECTIONS = [
  ['summary', 'Summary'],
  ['configs', 'Configurations'],
  ['batch', 'Batch scaling'],
  ['trace', 'Operator trace'],
  ['layers', 'Layers'],
  ['roofline', 'Roofline'],
  ['recipe', 'Recipe'],
]

export default function RunDetail({ id, section = 'summary', agents, onDeleted }) {
  const live = (j) => !j || j.status === 'running' || j.status === 'queued'
  const [finished, setFinished] = useState(null) // id of a run known to be finished: stop polling it
  const { data: job, error } = usePoll(() => api.job(id), 1000, [id], finished !== id)
  useEffect(() => {
    if (job && job.id === id && !live(job)) setFinished(id)
  }, [job, id])
  if (error && !job) return <Empty title="Run not found">{error}</Empty>
  if (!job) return <p className="muted">Loading…</p>

  const result = job.result
  const rows = result?.results || job.results || []
  const ok = rows.filter((r) => !r.error)
  const baseline = result?.baseline
  const best = result?.best
  const sel = result ? (rows.find((r) => r.name === best) || baseline) : null
  const machine = agents?.find((a) => a.id === job.agentId)
  const available = {
    summary: true, configs: rows.length > 0, batch: !!result?.batch_scaling, trace: !!result?.op_profile,
    layers: !!result?.layer_redundancy, roofline: !!result, recipe: !!result,
  }

  const remove = async () => {
    if (!window.confirm('Delete this run, its report and bundle?')) return
    await api.deleteJob(job.id)
    onDeleted()
    go('runs')
  }

  return (
    <>
      <div className="head run-head">
        <div>
          <a href="#/runs" className="muted small">← Runs</a>
          <h2>{job.params.model_id} <StatusBadge status={job.status} /></h2>
          <p className="muted small">
            on <a href={`#/machines/${job.agentId}`}>{machine?.name || job.agentId}</a> · {job.params.device || 'cpu'} · started {ago(job.started || job.created)} · run {job.id}
          </p>
        </div>
        <div className="actions">
          {job.status === 'done' && <a className="button ghost" href={api.reportUrl(job.id)} target="_blank" rel="noreferrer">Report</a>}
          {job.status === 'done' && <a className="button" href={api.bundleUrl(job.id)}>Download bundle</a>}
          {!live(job) && <button className="ghost danger" onClick={remove}>Delete</button>}
        </div>
      </div>

      {live(job) && (
        <section className="card">
          <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
          <p className="muted">{job.status === 'queued' ? 'Waiting for the agent to pick up the job…' : job.message}</p>
        </section>
      )}
      {job.status === 'error' && <section className="card error">{job.error}</section>}

      <nav className="subtabs">
        {SECTIONS.map(([k, label]) => (
          <a key={k} href={`#/runs/${job.id}/${k}`} className={`${section === k ? 'on' : ''} ${available[k] ? '' : 'disabled'}`}>{label}</a>
        ))}
      </nav>

      {section === 'summary' && (
        <>
          {result && sel && (
            <Kpis>
              <Kpi label="Selected config" value={best} sub={result.recipe.transforms.length ? `${result.recipe.transforms.length} transforms` : 'no change beat the baseline'} />
              <Kpi label="Decode speed" value={`${sel.decode_tps} tok/s`} sub={`${sel.speedup ?? 1}× vs ${baseline.decode_tps} baseline · noise ±${baseline.noise_pct ?? '?'}%`} tone={(sel.speedup ?? 1) > 1 && sel.significant !== false ? 'good' : ''} />
              <Kpi label="Time to first token" value={`${sel.ttft_ms} ms`} sub={`baseline ${baseline.ttft_ms} ms`} />
              <Kpi label="Model size" value={`${num(sel.model_bytes / 1e6)} MB`} sub={`${num(baseline.model_bytes / sel.model_bytes, 2)}× smaller`} />
              <Kpi label="Task accuracy" value={pct(sel.eval?.accuracy)} sub={baseline.eval ? `baseline ${pct(baseline.eval.accuracy)}` : 'eval not run'} />
              <Kpi label="Energy" value={sel.joules_per_token != null ? `${num(sel.joules_per_token, 3)} J/tok` : 'n/a'} sub={sel.avg_power_w ? `${sel.avg_power_w} W avg` : 'no RAPL counters'} />
            </Kpis>
          )}
          {ok.length > 0 && (
            <div className="grid two">
              <ThroughputChart rows={ok} baseline={baseline} best={best} noise={baseline?.noise_pct} />
              <SpeedAccuracyChart rows={ok} best={best} request={result?.request || job.params} />
            </div>
          )}
          {!ok.length && !live(job) && <Empty title="No results" />}
        </>
      )}

      {section === 'configs' && <section className="card"><ResultsTable rows={rows} baseline={baseline} best={best} /></section>}
      {section === 'batch' && (result?.batch_scaling ? <BatchScalingChart data={result.batch_scaling} /> : <Empty title="No batch-scaling data">Run with more than one batch size.</Empty>)}
      {section === 'trace' && (result?.op_profile ? <section className="card"><OpProfile selected={result.op_profile} baseline={result.op_profile_baseline} /></section> : <Empty title="No operator trace">Enable “Operator trace” when tuning.</Empty>)}
      {section === 'layers' && result && <section className="card"><LayerRedundancy values={result.layer_redundancy} recipe={result.recipe} /></section>}
      {section === 'roofline' && result && <section className="card"><Roofline roof={result.roofline} measured={sel?.decode_tps} /></section>}
      {section === 'recipe' && result && <RecipeView recipe={result.recipe} jobId={job.id} />}
    </>
  )
}
