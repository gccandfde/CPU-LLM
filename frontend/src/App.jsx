import React, { useEffect } from 'react'
import { api } from './api.js'
import { useHashRoute, usePoll } from './lib/hooks.js'
import Overview from './tabs/Overview.jsx'
import Machines from './tabs/Machines.jsx'
import Tune from './tabs/Tune.jsx'
import Runs from './tabs/Runs.jsx'
import RunDetail from './tabs/RunDetail.jsx'
import Recipes from './tabs/Recipes.jsx'
import Compare from './tabs/Compare.jsx'
import Lab from './tabs/Lab.jsx'
import Designer from './tabs/Designer.jsx'
import Planner from './tabs/Planner.jsx'
import Insights from './tabs/Insights.jsx'
import Campaigns from './tabs/Campaigns.jsx'
import Benchmarks from './tabs/Benchmarks.jsx'
import Guide, { PAGES } from './tabs/Guide.jsx'
import Power from './tabs/Power.jsx'
import Admin from './tabs/Admin.jsx'
import VersionBar from './components/VersionBar.jsx'

// Add a tab here and it appears in the navigation.
const TABS = [
  ['overview', 'Overview'],
  ['guide', 'Guide'],
  ['machines', 'Machines'],
  ['tune', 'Tune'],
  ['runs', 'Runs'],
  ['campaigns', 'Campaigns'],
  ['benchmarks', 'Benchmarks'],
  ['power', 'Power'],
  ['recipes', 'Recipes'],
  ['compare', 'Compare'],
  ['lab', 'Architecture Lab'],
  ['designer', 'Designer'],
  ['planner', 'Planner'],
  ['insights', 'Insights'],
  ['admin', 'Admin'],
]

export default function App() {
  const { tab, parts } = useHashRoute()
  const agents = usePoll(api.agents, 5000)
  const jobs = usePoll(() => api.jobs(), 3000)
  const config = usePoll(api.config, 60000)
  const site = config.data?.site || { title: 'CPU-LLM', tagline: 'Hardware-aware LLM tuning' }
  const shared = { agents: agents.data, jobs: jobs.data }
  useEffect(() => { document.title = site.title }, [site.title])
  const active = TABS.some(([k]) => k === tab) ? tab : 'overview'

  return (
    <div className="app">
      <VersionBar />
      <header className="top">
        <div className="brand">
          <span className="logo">▣</span>
          <div>
            <h1>{site.title}</h1>
            <p>{site.tagline}</p>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map(([k, label]) => (
            <a key={k} href={`#/${k}`} className={active === k ? 'on' : ''}>{label}</a>
          ))}
        </nav>
      </header>
      {(agents.error || jobs.error) && <div className="card error">Server unreachable: {agents.error || jobs.error}</div>}
      <main>
        {active === 'overview' && <Overview {...shared} />}
        {active === 'guide' && <Guide {...shared} />}
        {active === 'machines' && <Machines {...shared} selectedId={parts[0]} />}
        {active === 'tune' && <Tune {...shared} tuning={config.data?.tuning} selectedId={parts[0]} onStarted={jobs.reload} />}
        {active === 'runs' && (parts[0]
          ? <RunDetail id={parts[0]} section={parts[1]} agents={agents.data} onDeleted={jobs.reload} />
          : <Runs {...shared} reload={jobs.reload} />)}
        {active === 'campaigns' && <Campaigns {...shared} tuning={config.data?.tuning} selectedId={parts[0]} onStarted={jobs.reload} />}
        {active === 'benchmarks' && <Benchmarks {...shared} onStarted={jobs.reload} />}
        {active === 'power' && <Power {...shared} tuning={config.data?.tuning} onStarted={jobs.reload} />}
        {active === 'recipes' && <Recipes {...shared} />}
        {active === 'compare' && <Compare {...shared} ids={parts[0]?.split(',').filter(Boolean)} />}
        {active === 'lab' && <Lab {...shared} />}
        {active === 'designer' && <Designer {...shared} />}
        {active === 'planner' && <Planner {...shared} />}
        {active === 'insights' && <Insights {...shared} ai={config.data?.ai} section={parts[0]} />}
        {active === 'admin' && <Admin agents={agents.data} onChanged={() => { config.reload(); agents.reload() }} />}
      </main>
      {/* Every page and endpoint is one click away from every screen. */}
      <footer className="site-footer">
        <a href="#/guide">Guide</a>
        {PAGES.map(([href, label]) => <a key={href} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{label}</a>)}
      </footer>
    </div>
  )
}
