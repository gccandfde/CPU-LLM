// Builds the versioned site into site/:
//   site/v1/          dashboard built from the ref in site-versions.json (base /v1/)
//   site/v1/features/ docs/versions/v1/features.md rendered to HTML
//   site/versions/    list of versions
//   site/versions.json
// A ref of "." means the current checkout; anything else is built in a
// temporary git worktree. Usage: node scripts/build-site.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'site')
const config = JSON.parse(fs.readFileSync(path.join(root, 'site-versions.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (cmd, args, cwd, env = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

for (const v of config.versions) {
  const others = config.versions.filter((o) => o.name !== v.name).map((o) => `${o.name}:${o.channel}`).join(',')
  let src = root, worktree = null
  if (v.ref !== '.') {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), `cpullm-${v.name}-`))
    run('git', ['worktree', 'add', '--detach', worktree, v.ref], root)
    run(npm, ['install', '--include=dev', '--no-audit', '--no-fund'], worktree)
    src = worktree
  }
  try {
    console.log(`\n== ${v.name} (${v.ref}) ==`)
    run(npm, ['run', 'build', '-w', 'frontend'], src, {
      VITE_BASE: `/${v.name}/`, VITE_VERSION: v.name, VITE_CHANNEL: v.channel, VITE_OTHER_VERSIONS: others,
    })
    fs.cpSync(path.join(src, 'frontend', 'dist'), path.join(out, v.name), { recursive: true })
    if (v.name === config.stable) packageAgent(src, path.join(out, 'install', 'agent.zip'))
  } finally {
    if (worktree) run('git', ['worktree', 'remove', '--force', worktree], root)
  }
  const md = path.join(root, 'docs', 'versions', v.name, 'features.md')
  if (fs.existsSync(md)) {
    page(path.join(out, v.name, 'features', 'index.html'), `${v.name} features`, marked.parse(fs.readFileSync(md, 'utf8')), v)
  }
}

const rows = config.versions.map((v) => `<tr><td><a href="/${v.name}/">${v.name}</a></td><td>${v.channel === 'stable' ? '<strong>stable</strong>' : v.channel}</td><td>${v.title}</td><td><a href="/${v.name}/features/">features</a></td></tr>`).join('')
// Docs rendered as site pages so nothing is reachable only through the repository.
const DOCS = [
  ['PROBLEMS.md', 'problems', 'problems and solutions'],
  ['API.md', 'docs/api', 'API guide'],
  ['OPERATIONS.md', 'docs/operations', 'operations guide'],
  ['ADMIN.md', 'docs/admin', 'admin guide'],
  ['GPU.md', 'docs/gpu', 'GPU guide'],
  ['ROADMAP.md', 'docs/roadmap', 'roadmap'],
]
for (const [file, slug, title] of DOCS) {
  const md = path.join(root, 'docs', file)
  if (fs.existsSync(md)) page(path.join(out, ...slug.split('/'), 'index.html'), title, marked.parse(fs.readFileSync(md, 'utf8')))
}
page(path.join(out, 'versions', 'index.html'), 'Versions',
  `<h1>Versions</h1><p><strong>Stable</strong> is for everyday use. <strong>Preview</strong> has the newest features and may change.</p><table><thead><tr><th>Version</th><th>Channel</th><th>What it is</th><th>Guide</th></tr></thead><tbody>${rows}</tbody></table>`)
fs.writeFileSync(path.join(out, 'versions.json'), JSON.stringify({ stable: config.stable, versions: config.versions.map(({ name, channel, title }) => ({ name, channel, title })) }, null, 2))
for (const f of walk(out)) if (f.endsWith('.map')) throw new Error(`Source map in site: ${f}`)
console.log(`\nSite ready in ${out}`)

// The one-line installers download backend/ (the Python agent) from /install/agent.zip.
function packageAgent(src, zip) {
  fs.mkdirSync(path.dirname(zip), { recursive: true })
  const backend = path.join(src, 'backend')
  const args = process.platform === 'win32'
    ? ['C:/Windows/System32/tar.exe', ['-a', '-cf', zip, '--exclude=__pycache__', '--exclude=.venv', '--exclude=tests', 'cpullm', 'requirements.txt']]
    : ['zip', ['-qr', zip, 'cpullm', 'requirements.txt', '-x', '*__pycache__*', '*.venv*', 'tests/*']]
  execFileSync(args[0], args[1], { cwd: backend, stdio: 'inherit' })
  console.log(`Agent package: ${zip}`)
}

function page(file, title, body, v) {
  const links = '<a href="/versions/">All versions</a> · <a href="/problems/">Problems we solve</a> · <a href="/docs/api/">API</a> · <a href="/docs/operations/">Operations</a> · <a href="/docs/admin/">Admin guide</a> · <a href="/docs/gpu/">GPU guide</a> · <a href="/docs/roadmap/">Roadmap</a>'
  const nav = v ? `<p class="nav"><a href="/${v.name}/">← Open ${v.name}</a> · <a href="/${v.name}/#/guide">Guide</a> · ${links}</p>` : `<p class="nav"><a href="/">← Open the dashboard</a> · <a href="/#/guide">Guide</a> · ${links}</p>`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CPU-LLM ${title}</title><style>
:root{--bg:#f6f7f9;--surface:#fff;--text:#16191d;--muted:#6b7280;--accent:#2563eb;--border:#e3e6ea}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#171a20;--text:#e6e8eb;--muted:#9aa3ae;--accent:#60a5fa;--border:#2a2f37}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}a{color:var(--accent)}
h1{font-size:28px;margin:8px 0 4px}h2{margin-top:32px;border-top:1px solid var(--border);padding-top:16px}h3{margin-top:24px}
.nav{font-size:13px;color:var(--muted)}code{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 4px}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}
blockquote{margin:0;padding:8px 16px;border-left:3px solid var(--accent);background:var(--surface)}
</style></head><body><main>${nav}${body}</main></body></html>`)
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}
