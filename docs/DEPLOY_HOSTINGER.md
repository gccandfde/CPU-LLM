# Deploying to Hostinger (Node.js web app)

The Node server (`server/`) serves both the API and the built React dashboard,
so a single Hostinger Node.js app is enough. The heavy ML work never runs on
Hostinger: it runs in the **agent** on the machine you are tuning, which
connects out to your site.

```
 Browser ──HTTPS──► Hostinger: Node server (API + dashboard, stores jobs/reports)
                          ▲
                          │ HTTPS, outbound only (works behind NAT)
                          │
               Agent on the AMD machine being tuned (Python + PyTorch)
```

## 1. Create the app

hPanel → **Websites → Add Website → Node.js Apps → Import Git repository**,
connect GitHub, and pick `gccandfde/CPU-LLM`.

| Setting | Value |
|---|---|
| Branch | `main` (production) or `dev` (staging) |
| Framework | Express (or "Other") |
| Node.js version | 22 |
| Root directory | `/` (repo root) |
| Build command | `npm run build` |
| Entry file | `server/src/index.js` |

`npm run build` installs both workspaces (including dev dependencies, which
Vite needs) and builds `frontend/dist`. Hostinger provides `PORT`, and the
server listens on it.

## 2. Environment variables

From v1.0.0 most settings live in the **Admin** tab and are saved in
`DATA_DIR/settings.json`. The variables marked *seed* are read only when that
file does not exist yet; after that, change them in the Admin tab. See
[ADMIN.md](ADMIN.md).

| Variable | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Seed: password for the Admin tab. Use a long random string. |
| `DATA_DIR` | yes | Where settings, jobs, reports and bundles are stored. Point it outside the deployed app folder (e.g. a folder in your home directory) so redeploys don't wipe them. Defaults to `server/data`. |
| `AGENT_TOKEN` | optional | Seed: shared secret agents use to connect. If unset, a random one is made; see it in Admin → Agents. |
| `DASHBOARD_PASSWORD` | optional | Seed: turns dashboard login on with this password. Without it the dashboard starts public; turn login on later in Admin → Dashboard access. |
| `ADMIN_PASSWORD_RESET` | recovery only | Replaces the admin password on every start. Set it, restart, sign in, change the password in the Admin tab, then remove it. |

## 3. Connect a machine ("turn it on")

A machine is on while its agent runs. Open the dashboard, go to **Machines →
Add a machine** (or Admin → Agents, where the token is filled in), pick
Windows or Linux/macOS, copy the one line and paste it on the machine:

```
Windows:  powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CPULLM_SERVER='https://YOUR-SITE'; $env:CPULLM_TOKEN='<AGENT_TOKEN>'; irm https://YOUR-SITE/install/agent.ps1 | iex"
Linux:    CPULLM_TOKEN='<AGENT_TOKEN>' curl -fsSL https://YOUR-SITE/install/agent.sh | bash
```

The installer downloads the agent from your site (`/install/agent.zip`, built
by `scripts/build-site.mjs`), creates a Python environment with CPU PyTorch,
registers the agent as a background service (Windows logon task, systemd
user service, or launchd) and starts it. The machine appears under Machines
within seconds and reconnects after reboots.

- Needs Python 3.10+ on the machine (Windows: installed via winget if missing;
  Debian/Ubuntu: `sudo apt install python3 python3-venv`).
- `CPULLM_NO_SERVICE=1` installs and runs the agent until logout without
  registering autostart. `CPULLM_UNINSTALL=1` removes everything.
- Windows with Smart App Control: the CPU PyTorch build is used (the CUDA
  build is blocked); run a GPU agent under WSL 2 instead.
- Advanced: `python -m cpullm.agent --server https://YOUR-SITE --token …`
  from `backend/` with your own environment still works.

## 4. Auto-deploy

Hostinger redeploys on every push to the selected branch. With the repo's
flow (feature branch → PR into `dev` → merge), point a staging app at `dev`
and production at `main`.
