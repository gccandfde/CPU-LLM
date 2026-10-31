import React, { useEffect, useState } from 'react'
import { admin } from '../api.js'
import { installCommands, TOKEN_PLACEHOLDER, OS, guessOs } from '../lib/install.js'

// "Turn a machine on": one line to paste on the machine. It downloads the
// agent, sets up Python, registers a background service and starts it.
// The token is filled in when the viewer is signed in as admin (or passed in).
export default function AgentSetup({ compact, name = '', token: given }) {
  const server = window.location.origin
  const [os, setOs] = useState(guessOs)
  const [token, setToken] = useState(given || null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (given || !admin.signedIn()) return
    admin.settings().then((s) => setToken(s.agentToken)).catch(() => {})
  }, [given])
  const cmds = installCommands(server, token || TOKEN_PLACEHOLDER, name)
  const cmd = os === 'windows' ? cmds.windows : cmds.linux
  const copy = () => navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })

  const body = (
    <div className="agent-setup">
      <div className="actions">
        <div className="seg">{OS.map(([k, label]) => <button type="button" key={k} className={os === k ? 'on' : ''} onClick={() => setOs(k)}>{label}</button>)}</div>
        <button type="button" className="ghost small" onClick={copy} disabled={!token}>{copied ? 'Copied' : 'Copy command'}</button>
      </div>
      <pre className="cmd">{cmd}</pre>
      {!token && <p className="warn-text small">Replace {TOKEN_PLACEHOLDER} with the agent token, or <a href="#/admin">sign in to Admin</a> and this line fills itself in.</p>}
      <ol className="steps small">
        <li>Open {os === 'windows' ? 'PowerShell or Command Prompt' : 'a terminal'} on the machine you want to tune and paste the line.</li>
        <li>First run installs Python packages (a few hundred MB, a few minutes). The agent then starts and restarts at every {os === 'windows' ? 'logon' : 'boot'}.</li>
        <li>The machine appears under Machines within seconds{name ? ` as "${name}"` : ''}.</li>
        <li>Has a GPU? {os === 'windows' ? <>Add <code>$env:CPULLM_DEVICE='cuda';</code> before <code>irm</code> to install the CUDA build of PyTorch (a few GB).</> : <>The CUDA build of PyTorch is installed automatically when <code>nvidia-smi</code> is present (<code>CPULLM_DEVICE=cpu</code> to skip it).</>} Then Tune, Benchmarks and Power offer the GPU. <a href="/docs/gpu/">GPU guide</a>.</li>
      </ol>
      {!compact && (
        <details><summary>Remove the agent from a machine</summary>
          <pre className="cmd">{os === 'windows' ? cmds.removeWindows : cmds.removeLinux}</pre>
        </details>
      )}
    </div>
  )
  if (compact) return body
  return (
    <section className="card">
      <h2>Turn a machine on</h2>
      <p>
        Tuning runs on the CPU or GPU you want to optimise, not on this web server. A machine is "on" while its agent runs;
        the agent connects out to this site over HTTPS, so no inbound ports or firewall changes are needed.
      </p>
      {body}
    </section>
  )
}
