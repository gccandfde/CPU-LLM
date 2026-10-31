import React from 'react'
import AgentSetup from '../components/AgentSetup.jsx'

// On-screen guide: the steps to use the platform, what every tab does, and
// a map of every page and endpoint so nothing is reachable only by URL.
const STEPS = [
  ['Connect a machine', 'Paste the one-line installer on the machine you want to measure (Windows, Linux, macOS, WSL, or a MachineForge machine). It appears under Machines within a minute with its hardware profile and live telemetry.', 'machines'],
  ['Run a Quick check', 'Tune → pick the machine and a model → Quick check. The agent measures the fp32 baseline and the bf16 variant with run-to-run noise; the run shows up under Runs with a report and a reproducible recipe bundle.', 'tune'],
  ['Read the result', 'Runs → the run: Summary (best configuration, speedup, accuracy), Configurations, Batch scaling, Operator trace, Layers, Roofline, Recipe. Speedups inside the noise band are marked as not significant.', 'runs'],
  ['Compare machines and models', 'Compare up to six finished runs side by side; Recipes lists every tuned configuration ready to download and reproduce.', 'compare'],
  ['Make it routine', 'Campaigns → pick machines × models × preset → Queue. The result matrix marks each cell ▲ improved / ▼ regressed / • unchanged against the previous run of that cell. Export CSV, or drive it from cron with the API.', 'campaigns'],
  ['Benchmark the hardware itself', 'Benchmarks runs the open-source workload suite (STREAM, GEMM, attention, gather) on CPU or GPU with identical sizes everywhere; Power sweeps active cores on a CPU, or the board power limit on a GPU, and reports tok/s, watts and tok/J with a recommended operating point.', 'benchmarks'],
  ['Use the GPU too', 'A machine with a GPU shows it under Machines (driver, memory, power limit, whether PyTorch can use it). Pick GPU as the device in Tune, Benchmarks, Power and Campaigns; live telemetry adds GPU utilisation, VRAM and board power with the same one-minute forecast. If the GPU is listed as "driver only", re-run the installer with CPULLM_DEVICE=cuda.', 'machines'],
  ['Design, plan, calibrate', 'Designer: a CPU at die, cache and NUMA level with projected speed and a roofline. Planner: NUMA placement, thread count (Measure it), serving concurrency, quantisation pay-off, cost per million tokens. Insights: calibration of projections against measured runs, noise, predictor, benchmark matrix, AI advisor.', 'designer'],
  ['Set up the admin side', 'Admin: dashboard access, API keys with roles, agent token and machines, tuning models and presets, AI advisor key, retention, backup and restore, audit log.', 'admin'],
]

const TABS = [
  ['overview', 'Overview', 'fleet KPIs, connected machines, recent runs, the installer line'],
  ['machines', 'Machines', 'hardware profile per machine, live telemetry with a one-minute forecast'],
  ['tune', 'Tune', 'start a tuning run with a preset or custom options'],
  ['runs', 'Runs', 'every run with filters, exports, detail pages'],
  ['campaigns', 'Campaigns', 'machines × models matrices with regression verdicts'],
  ['benchmarks', 'Benchmarks', 'open-source workload suite on CPU and GPU, compare machines'],
  ['power', 'Power', 'power optimiser: cores vs tok/s, watts, tok/J, operating points'],
  ['recipes', 'Recipes', 'every tuned configuration, download and reproduce'],
  ['compare', 'Compare', 'up to six runs side by side'],
  ['lab', 'Architecture Lab', 'what-if model of decode on any CPU/GPU memory system'],
  ['designer', 'Designer', 'die/cache/NUMA-level CPU design with projections and roofline'],
  ['planner', 'Planner', 'NUMA placement, threads, serving, quantisation, cost'],
  ['insights', 'Insights', 'calibration, noise, predictor, benchmark matrix, AI advisor'],
  ['admin', 'Admin', 'all settings; password protected'],
]

export const PAGES = [
  ['/problems/', 'Problems we solve', 'industry-by-industry problems, what the platform does today, what is missing'],
  ['/versions/', 'Versions', 'every version with its channel and feature page'],
  ['/docs/api/', 'API guide', 'endpoints, job kinds, campaigns, an example cron script'],
  ['/api/openapi.json', 'OpenAPI document', 'machine-readable API description'],
  ['/docs/operations/', 'Operations guide', 'access model, backups, upgrades, observability, hardening, HA'],
  ['/docs/admin/', 'Admin guide', 'every setting explained'],
  ['/docs/gpu/', 'GPU guide', 'installing the CUDA build, what runs on the GPU, telemetry, power limits, MachineForge GPU machines'],
  ['/docs/roadmap/', 'Roadmap', 'v1 → v6'],
  ['/metrics', 'Prometheus metrics', 'agents, jobs, campaigns, latest tok/s per machine and model'],
  ['/api/health', 'Health', 'liveness and version'],
  ['/install/agent.ps1', 'Installer (Windows)', 'the one-line installer script'],
  ['/install/agent.sh', 'Installer (Linux, macOS, WSL)', 'the one-line installer script'],
  ['https://machineforge.gccandfde.com', 'MachineForge', 'make pinned-core machines on one host, each with the agent inside'],
]

export default function Guide({ agents }) {
  const version = import.meta.env.VITE_VERSION
  return (
    <>
      <p className="muted">How to use the platform, step by step, and where everything is. Nothing lives only behind a URL: every page below is one click from here.</p>
      <section className="card">
        <h2>Steps to use</h2>
        <ol className="steps">
          {STEPS.map(([title, text, tab], i) => (
            <li key={i}><strong><a href={`#/${tab}`}>{title}</a></strong><div className="muted">{text}</div>
              {i === 0 && <div className="mt"><AgentSetup compact /></div>}
              {i === 0 && agents?.length > 0 && <p className="small ok">✓ {agents.length} machine{agents.length > 1 ? 's' : ''} connected already.</p>}
            </li>
          ))}
        </ol>
      </section>
      <div className="grid two">
        <section className="card">
          <h2>Tabs</h2>
          <div className="table-wrap"><table className="links"><tbody>
            {TABS.map(([k, label, text]) => <tr key={k}><td><a href={`#/${k}`}><strong>{label}</strong></a></td><td className="muted">{text}</td></tr>)}
          </tbody></table></div>
        </section>
        <section className="card">
          <h2>Pages, docs and endpoints</h2>
          <div className="table-wrap"><table className="links"><tbody>
            {PAGES.map(([href, label, text]) => <tr key={href}><td><a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"><strong>{label}</strong></a></td><td className="muted">{text}</td></tr>)}
            {version && <tr><td><a href={`/${version}/features/`}><strong>What is in {version}</strong></a></td><td className="muted">this version's feature page</td></tr>}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}
