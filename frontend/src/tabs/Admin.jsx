import React, { useEffect, useState } from 'react'
import { admin } from '../api.js'
import { ago } from '../lib/format.js'
import AgentSetup from '../components/AgentSetup.jsx'

const PRECISIONS = ['fp32', 'bf16', 'fp16', 'int8_dynamic', 'int8_weight_only', 'int4_weight_only']
const DEVICES = [['cpu', 'CPU'], ['cuda', 'GPU (CUDA / ROCm)']]
const LIMITS = [
  ['maxNewTokens', 'Max tokens to generate'], ['maxRepeats', 'Max repeats per config'], ['maxBatch', 'Max batch size'],
  ['maxThreads', 'Max thread count'], ['maxPrune', 'Max layers to prune'], ['maxListItems', 'Max values per list'],
]

export default function Admin({ agents, onChanged }) {
  const [signedIn, setSignedIn] = useState(admin.signedIn())
  const [s, setS] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!signedIn) return
    admin.settings().then(setS).catch((e) => { admin.logout(); setSignedIn(false); setError(e.message) })
  }, [signedIn])

  if (!signedIn) return <SignIn onDone={() => { setError(null); setSignedIn(true) }} error={error} />
  if (!s) return <p className="muted">Loading…</p>

  // Each card edits a draft and saves only its own part.
  const save = async (patch) => {
    const next = await admin.save(patch)
    setS(next)
    onChanged()
  }
  const signOut = () => { admin.logout(); setS(null); setSignedIn(false) }

  return (
    <div>
      <div className="head">
        <h2>Admin</h2>
        <button className="ghost small" onClick={signOut}>Sign out</button>
      </div>
      <div className="grid two admin">
        <Access s={s} save={save} />
        <Agents s={s} setS={setS} save={save} agents={agents} onChanged={onChanged} />
        <Tuning s={s} save={save} />
        <div>
          <Site s={s} save={save} />
          <Retention s={s} save={save} />
          <AiAdvisor s={s} save={save} />
          <AdminPassword />
          <ApiKeys s={s} save={save} />
          <Backup />
          <AuditLog />
          <AdminLinks />
        </div>
      </div>
    </div>
  )
}

function SignIn({ onDone, error }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(error)
  const submit = async (e) => {
    e.preventDefault()
    try { await admin.login(password); onDone() } catch (x) { setErr(x.message) }
  }
  return (
    <section className="card narrow">
      <h2>Admin sign-in</h2>
      <p className="muted small">Settings for access, machines, tuning options and data. The dashboard itself can stay public.</p>
      <form className="form" onSubmit={submit}>
        <label>Admin password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button>Sign in</button>
        {err && <p className="error">{err}</p>}
      </form>
    </section>
  )
}

// A card with its own draft copy, Save button and status line.
function Card({ title, children, onSave, hint }) {
  const [status, setStatus] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setStatus({ busy: true })
    try { await onSave(); setStatus({ ok: 'Saved' }) } catch (x) { setStatus({ error: x.message }) }
  }
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint && <p className="muted small">{hint}</p>}
      <form className="form" onSubmit={submit}>
        {children}
        {onSave && <div className="actions"><button disabled={status?.busy}>Save</button>
          {status?.ok && <span className="muted small">{status.ok}</span>}</div>}
        {status?.error && <p className="error">{status.error}</p>}
      </form>
    </section>
  )
}

const useDraft = (value) => {
  const [d, setD] = useState(value)
  useEffect(() => setD(value), [JSON.stringify(value)]) // eslint-disable-line react-hooks/exhaustive-deps
  return [d, setD]
}
const num = (v) => (v === '' ? '' : Number(v))

function Access({ s, save }) {
  const [login, setLogin] = useDraft(s.access.dashboardLogin)
  const [password, setPassword] = useState('')
  return (
    <Card title="Dashboard access" hint="When login is on, the dashboard and its API ask for this password (any username). Agents and the Admin tab are not affected."
      onSave={async () => {
        const patch = { access: { dashboardLogin: login } }
        if (password) patch.dashboardPassword = password
        await save(patch)
        setPassword('')
      }}>
      <label className="check"><input type="checkbox" checked={login} onChange={(e) => setLogin(e.target.checked)} />Require login for the dashboard</label>
      <label>{s.hasDashboardPassword ? 'New dashboard password (leave empty to keep)' : 'Dashboard password (at least 8 characters)'}
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
      </label>
      {s.hasDashboardPassword && !login && (
        <button type="button" className="ghost small danger" onClick={() => save({ dashboardPassword: null }).catch((x) => window.alert(x.message))}>Remove saved dashboard password</button>
      )}
    </Card>
  )
}

function Agents({ s, setS, save, agents, onChanged }) {
  const [d, setD] = useDraft(s.agents)
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState(null)
  const token = show ? s.agentToken : '•'.repeat(24)
  const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => setMsg(`${what} copied`), () => setMsg('Copy failed'))
  const rotate = async () => {
    if (!window.confirm('Make a new agent token? Every running agent must be restarted with the new token.')) return
    try {
      const { agentToken } = await admin.rotateToken()
      setS({ ...s, agentToken })
      setShow(true)
      setMsg('New token made; restart agents with it')
    } catch (x) { setMsg(x.message) }
  }
  const remove = async (a) => {
    if (!window.confirm(`Remove ${a.name}? Its runs stay. It reappears if its agent connects again.`)) return
    try { await admin.removeAgent(a.id); onChanged() } catch (x) { setMsg(x.message) }
  }
  return (
    <Card title="Agents and machines" onSave={() => save({ agents: d })}>
      <div className="field">Agent token
        <span className="token"><code>{token}</code>
          <button type="button" className="ghost small" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          <button type="button" className="ghost small" onClick={() => copy(s.agentToken, 'Token')}>Copy</button>
          <button type="button" className="ghost small danger" onClick={rotate}>New token</button>
        </span>
      </div>
      <div className="field">Turn a machine on (paste on that machine)
        <AgentSetup compact token={s.agentToken} />
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <label className="check"><input type="checkbox" checked={d.allowRegistration} onChange={(e) => setD({ ...d, allowRegistration: e.target.checked })} />Accept new machines (known machines can always reconnect)</label>
      <div className="row">
        <label>Offline after (seconds)<input type="number" min="5" max="600" value={d.onlineTimeoutSec} onChange={(e) => setD({ ...d, onlineTimeoutSec: num(e.target.value) })} /></label>
        <label>Live telemetry kept (samples)<input type="number" min="30" max="3600" value={d.telemetryWindow} onChange={(e) => setD({ ...d, telemetryWindow: num(e.target.value) })} /></label>
      </div>
      <fieldset>
        <legend>Machines</legend>
        {!agents?.length && <p className="muted small">No machines yet.</p>}
        {agents?.map((a) => (
          <div key={a.id} className="admin-row">
            <span className={`dot ${a.online ? 'on' : ''}`} />
            <span><strong>{a.name}</strong> <span className="muted small">{a.hardware?.model_name} · {a.online ? 'online' : `seen ${ago(a.lastSeen)}`}</span></span>
            <button type="button" className="ghost small danger" onClick={() => remove(a)}>Remove</button>
          </div>
        ))}
      </fieldset>
    </Card>
  )
}

function Tuning({ s, save }) {
  const [t, setT] = useDraft(s.tuning)
  const [presets, setPresets] = useDraft(JSON.stringify(s.tuning.presets, null, 2))
  const toggle = (key, x) => setT({ ...t, [key]: t[key].includes(x) ? t[key].filter((y) => y !== x) : [...t[key], x] })
  const setModel = (i, k, v) => setT({ ...t, models: t.models.map((m, j) => (j === i ? { ...m, [k]: v } : m)) })
  let parsed = null, presetError = null
  try { parsed = JSON.parse(presets) } catch (x) { presetError = `Presets are not valid JSON: ${x.message}` }
  return (
    <Card title="Tuning options" hint="What people can choose on the Tune tab. The server enforces these limits too."
      onSave={() => { if (presetError) throw new Error(presetError); return save({ tuning: { ...t, presets: parsed } }) }}>
      <fieldset>
        <legend>Models</legend>
        {t.models.map((m, i) => (
          <div key={i} className="admin-row model">
            <input value={m.id} placeholder="org/model or builtin:name" onChange={(e) => setModel(i, 'id', e.target.value.trim())} />
            <input value={m.label} placeholder="Label" onChange={(e) => setModel(i, 'label', e.target.value)} />
            <button type="button" className="icon" title="Remove" onClick={() => setT({ ...t, models: t.models.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button type="button" className="ghost small" onClick={() => setT({ ...t, models: [...t.models, { id: '', label: '' }] })}>Add model</button>
        <label>Default model
          <select value={t.defaultModel} onChange={(e) => setT({ ...t, defaultModel: e.target.value })}>
            {t.models.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={t.allowCustomModels} onChange={(e) => setT({ ...t, allowCustomModels: e.target.checked })} />Allow any other Hugging Face model</label>
      </fieldset>
      <fieldset>
        <legend>Allowed precisions</legend>
        <div className="checks">
          {PRECISIONS.map((p) => <label key={p} className="check"><input type="checkbox" checked={t.precisions.includes(p)} onChange={() => toggle('precisions', p)} />{p}</label>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Allowed devices</legend>
        <div className="checks">
          {DEVICES.map(([d, label]) => <label key={d} className="check"><input type="checkbox" checked={t.devices.includes(d)} onChange={() => toggle('devices', d)} />{label}</label>)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Limits per run</legend>
        <div className="row three">
          {LIMITS.map(([k, label]) => (
            <label key={k}>{label}<input type="number" min="0" value={t.limits[k]} onChange={(e) => setT({ ...t, limits: { ...t.limits, [k]: num(e.target.value) } })} /></label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Presets</legend>
        <label>Default preset
          <select value={t.defaultPreset} onChange={(e) => setT({ ...t, defaultPreset: e.target.value })}>
            {Object.keys(parsed || s.tuning.presets).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <details>
          <summary>Edit presets (JSON)</summary>
          <p className="muted small">Each preset: <code>label</code>, <code>desc</code> and <code>v</code> with precisions, prune, batch, tokens, repeats, eval, profile, compile, ppl, evalDrop.</p>
          <textarea rows={14} spellCheck={false} value={presets} onChange={(e) => setPresets(e.target.value)} />
          {presetError && <p className="error small">{presetError}</p>}
        </details>
      </fieldset>
    </Card>
  )
}

function Site({ s, save }) {
  const [d, setD] = useDraft(s.site)
  return (
    <Card title="Site" onSave={() => save({ site: d })}>
      <label>Title<input value={d.title} maxLength={60} onChange={(e) => setD({ ...d, title: e.target.value })} required /></label>
      <label>Tagline<input value={d.tagline} maxLength={120} onChange={(e) => setD({ ...d, tagline: e.target.value })} /></label>
    </Card>
  )
}

function Retention({ s, save }) {
  const [d, setD] = useDraft(s.retention)
  return (
    <Card title="Data retention" hint="Finished runs beyond these limits are deleted with their reports and bundles. 0 keeps everything."
      onSave={() => save({ retention: d })}>
      <div className="row">
        <label>Keep newest runs<input type="number" min="0" value={d.maxRuns} onChange={(e) => setD({ ...d, maxRuns: num(e.target.value) })} /></label>
        <label>Delete runs older than (days)<input type="number" min="0" value={d.deleteAfterDays} onChange={(e) => setD({ ...d, deleteAfterDays: num(e.target.value) })} /></label>
      </div>
    </Card>
  )
}

const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

// Everything an admin can reach that is not a card above.
function AdminLinks() {
  const links = [
    ['/docs/admin/', 'Admin guide', 'every setting on this page explained'],
    ['/docs/operations/', 'Operations guide', 'backups, upgrades, alerts, hardening, HA'],
    ['/docs/api/', 'API guide', 'scripts, CI and the nightly campaign recipe'],
    ['/api/openapi.json', 'OpenAPI document', 'machine-readable API'],
    ['/metrics', 'Prometheus metrics', 'scrape target for Grafana'],
    ['/install/agent.ps1', 'Installer script (Windows)', 'what the one-liner runs'],
    ['/install/agent.sh', 'Installer script (Linux, macOS, WSL)', 'what the one-liner runs'],
    ['/versions/', 'Versions', 'stable, previous, archived and preview'],
    ['https://machineforge.gccandfde.com', 'MachineForge', 'make sized machines with the agent inside'],
  ]
  return (
    <section className="card">
      <h2>Admin links</h2>
      <div className="table-wrap"><table><tbody>
        {links.map(([href, label, text]) => <tr key={href}><td><a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"><strong>{label}</strong></a></td><td className="muted small">{text}</td></tr>)}
      </tbody></table></div>
    </section>
  )
}

// Named API keys with a role for scripts, CI and dashboards; shown once.
function ApiKeys({ s, save }) {
  const [keys, setKeys] = useState(s.apiKeys || [])
  const [name, setName] = useState('')
  const [role, setRole] = useState('engineer')
  const [made, setMade] = useState(null)
  const [requireKey, setRequireKey] = useState(!!s.access.requireKey)
  const [err, setErr] = useState(null)
  const reload = () => admin.keys().then(setKeys).catch(() => {})
  const create = async (e) => {
    e.preventDefault(); setErr(null)
    try { const r = await admin.createKey({ name: name.trim(), role }); setMade(r); setName(''); reload() } catch (x) { setErr(x.message) }
  }
  const revoke = async (k) => { if (!window.confirm(`Revoke key "${k.name}"? Scripts using it stop working at once.`)) return; await admin.revokeKey(k.id); reload() }
  return (
    <Card title="API keys" hint="Bearer keys (cpk_…) for scripts, CI and dashboards. viewer = read only · engineer = runs, campaigns, advisor · admin = settings too. Only a hash is stored; copy the key when it is shown."
      onSave={() => save({ access: { requireKey } })}>
      <label className="check"><input type="checkbox" checked={requireKey} onChange={(e) => setRequireKey(e.target.checked)} />Require an API key (or the dashboard password) for every dashboard API call</label>
      <div className="table-wrap">
        <table><thead><tr><th>Name</th><th>Role</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>{keys.map((k) => <tr key={k.id}><td>{k.name}</td><td><span className="badge">{k.role}</span></td><td className="muted small">{ago(k.created)}</td><td className="muted small">{k.lastUsed ? ago(k.lastUsed) : 'never'}</td><td><button type="button" className="icon" title="Revoke" onClick={() => revoke(k)}>✕</button></td></tr>)}
            {!keys.length && <tr><td colSpan={5} className="muted small">No keys yet.</td></tr>}</tbody></table>
      </div>
      <div className="row three">
        <label>New key name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="nightly-ci" maxLength={40} /></label>
        <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}>{['viewer', 'engineer', 'admin'].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label>&nbsp;<button type="button" className="ghost" disabled={!name.trim()} onClick={create}>Create key</button></label>
      </div>
      {err && <p className="error small">{err}</p>}
      {made && <div className="card warn small"><strong>Copy this key now; it will not be shown again.</strong><pre className="cmd">{made.key}</pre>Use it as <code>Authorization: Bearer {made.key.slice(0, 8)}…</code></div>}
    </Card>
  )
}

// One archive of everything in DATA_DIR; restoring restarts the server.
function Backup() {
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const download = async () => { setBusy(true); setMsg(null); try { setMsg(`Downloaded ${await admin.downloadBackup()}`) } catch (e) { setMsg(e.message) } finally { setBusy(false) } }
  const restore = async (e) => {
    const f = e.target.files?.[0]; if (!f) return
    if (!window.confirm(`Restore ${f.name}? Current settings, machines, runs and campaigns are replaced and the server restarts.`)) { e.target.value = ''; return }
    setBusy(true); setMsg(null)
    try {
      const buf = new Uint8Array(await f.arrayBuffer())
      const body = f.name.endsWith('.gz') ? { gzip_b64: btoa(Array.from(buf, (b) => String.fromCharCode(b)).join('')) } : { bundle: JSON.parse(new TextDecoder().decode(buf)) }
      const r = await admin.restore(body)
      setMsg(`Restored ${r.jobs} runs, ${r.agents} machines, ${r.campaigns} campaigns. The server is restarting; reload in a few seconds and sign in again.`)
    } catch (x) { setMsg(x.message) } finally { setBusy(false); e.target.value = '' }
  }
  return (
    <section className="card">
      <h2>Backup and restore</h2>
      <p className="muted small">The backup is one <code>.json.gz</code> with settings (including secrets), machines, runs with reports and bundles, campaigns and the audit log. Keep it where you keep other secrets. Restore into any install of the same or a newer version.</p>
      <div className="actions"><button type="button" className="ghost" disabled={busy} onClick={download}>Download backup</button>
        <label className="button ghost">Restore from file…<input type="file" accept=".gz,.json" style={{ display: 'none' }} disabled={busy} onChange={restore} /></label></div>
      {msg && <p className="small mt">{msg}</p>}
    </section>
  )
}

// Who changed what: every non-GET API call, newest first, secrets never logged.
function AuditLog() {
  const [rows, setRows] = useState(null)
  const [limit, setLimit] = useState(100)
  useEffect(() => { admin.audit(limit).then(setRows).catch(() => setRows([])) }, [limit])
  return (
    <section className="card">
      <div className="head"><h2>Audit log</h2>
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[100, 300, 1000].map((n) => <option key={n} value={n}>last {n}</option>)}</select></div>
      <p className="muted small">Every change made through the API (runs, campaigns, settings, agents), with who made it. File: <code>DATA_DIR/audit.log</code>.</p>
      {!rows && <p className="muted">Loading…</p>}
      {rows && !rows.length && <p className="muted small">Nothing yet.</p>}
      {rows?.length > 0 && (
        <div className="table-wrap audit">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Result</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}><td className="muted small">{new Date(r.ts).toLocaleString()}</td><td>{r.actor}<div className="muted small">{r.ip}</div></td><td><code>{r.method} {r.path}</code></td><td className={r.status < 400 ? 'ok' : 'error'}>{r.status}</td><td className="small muted">{r.summary ? Object.entries(r.summary).map(([k, v]) => `${k}=${v}`).join(' · ') : ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AiAdvisor({ s, save }) {
  const [d, setD] = useDraft(s.ai)
  const [key, setKey] = useState('')
  const [clear, setClear] = useState(false)
  return (
    <Card title="AI advisor" hint="Claude answers questions on the Insights and Designer tabs using the platform's measurements as context. The key is stored server-side, is never shown again and is only used for those questions."
      onSave={async () => { await save({ ai: d, ...(clear ? { anthropicKey: null } : key.trim() ? { anthropicKey: key.trim() } : {}) }); setKey(''); setClear(false) }}>
      <p className="small">{s.hasAnthropicKey ? <span className="ok">API key configured.</span> : <span className="warn-text">No API key yet: the advisor stays off.</span>} Get a key at console.anthropic.com; usage is billed to that account.</p>
      <label>{s.hasAnthropicKey ? 'Replace API key' : 'Anthropic API key'}<input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} disabled={clear} /></label>
      {s.hasAnthropicKey && <label className="check"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />Remove the stored key</label>}
      <label className="check"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />Enable the advisor for dashboard users</label>
      <div className="row three">
        <label>Model<input value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} placeholder="claude-opus-5-5" /></label>
        <label>Effort<select value={d.effort} onChange={(e) => setD({ ...d, effort: e.target.value })}>{AI_EFFORTS.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Max answer tokens<input type="number" min="256" max="16000" value={d.maxTokens} onChange={(e) => setD({ ...d, maxTokens: num(e.target.value) })} /></label>
      </div>
    </Card>
  )
}

function AdminPassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  return (
    <Card title="Admin password" hint="Changing it signs out every other admin session."
      onSave={async () => { await admin.changePassword(current, next); setCurrent(''); setNext('') }}>
      <div className="row">
        <label>Current<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>New (at least 10 characters)<input type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      </div>
    </Card>
  )
}
