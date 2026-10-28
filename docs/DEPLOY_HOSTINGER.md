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

## 3. Connect a machine

On the machine you want to tune (ideally an AMD Ryzen/EPYC box that does
nothing else while benchmarking):

```bash
git clone https://github.com/gccandfde/CPU-LLM && cd CPU-LLM/backend
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m cpullm.agent --server https://YOUR-SITE --token "$AGENT_TOKEN" --name epyc-1
```

The machine appears in the dashboard's **Machine** picker within a few
seconds. Keep the agent running (e.g. with `systemd` or `tmux`).

**Windows:** use `.venv\Scripts\activate` and the CPU wheel above. With Smart
App Control on, the CUDA wheel fails to import (`WinError 4551`, blocked
`caffe2_nvrtc.dll`); run the GPU agent under WSL 2 instead, where the NVIDIA
driver is passed through. On Windows, CPU details come from `py-cpuinfo`,
which cannot see `avx512_bf16`/AMX, so those show as absent (bf16 is still tried).

## 4. Auto-deploy

Hostinger redeploys on every push to the selected branch. With the repo's
flow (feature branch → PR into `dev` → merge), point a staging app at `dev`
and production at `main`.
