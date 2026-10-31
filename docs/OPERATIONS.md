# Operating CPU-LLM in production

For the team that runs the server. Installation and hosting specifics are in
`docs/DEPLOY_HOSTINGER.md`; settings in `docs/ADMIN.md`; the API in
`docs/API.md`.

## Architecture in one paragraph

One Node.js process serves the API and the versioned dashboard. All state is
files under `DATA_DIR`: `settings.json` (with secrets, mode 0600),
`agents.json`, `campaigns.json`, `audit.log`, `jobs/<id>/{job.json, report.md,
bundle.zip}`. Agents on the measured machines connect **outbound** with the
agent token; nothing connects into them. There is no database to run.

## Access model

| Who | How | Scope |
|---|---|---|
| People in a browser | open, or dashboard password (Admin → Dashboard access) | everything except Admin |
| Admins | admin password → 12-hour session | settings, keys, machines, audit, backup |
| Scripts, CI, dashboards | API key `cpk_…` with a role (Admin → API keys) | viewer: read · engineer: runs, campaigns, advisor · admin: settings too |
| Agents | agent token | register, claim jobs, upload results |

Turn on **Require an API key** to close the dashboard API to anonymous callers
(browsers then need the dashboard password). Keys are stored hashed; revoke
and re-issue rather than rotate in place. Every change through the API is in
the audit log with the key name.

## One app, one data folder

CPU-LLM owns `DATA_DIR` outright and shares it with nothing. The first start
writes `DATA_DIR/app-identity.json` (`{"app": "cpullm"}`); a later start
refuses to run when the folder is stamped by another app or already holds
files CPU-LLM did not write, and says which. Give every product on a host its
own folder (for example `~/cpullm-data`, `~/lawyerweb-data`) and its own
database where it uses one; never point two apps at the same place.

## Backups

- Admin → **Download backup**: one `.json.gz` with everything in `DATA_DIR`,
  secrets included. Store it like a secret.
- Scheduled: `curl -H "Authorization: Bearer $ADMIN_KEY" https://host/api/admin/backup -o backup-$(date +%F).json.gz`
  from cron with an admin-role API key.
- Restore: Admin → **Restore from file…** (or `POST /api/admin/restore` with
  `{ gzip_b64 }`). Files are written and the process exits with code 0 so the
  supervisor (Hostinger, systemd, pm2, Kubernetes) restarts it on the restored
  data. Sign in again afterwards.
- Alternatively, back up `DATA_DIR` with your file backup; it is the same data.

## Upgrades and rollback

- Deploy the new archive (`npm run build` is idempotent; the versioned site is
  prebuilt). Data files are forward-compatible; new fields get defaults.
- Rollback = redeploy the previous archive. Take a backup before an upgrade.
- Agents: re-run the one-line installer on each machine (keeps name and
  token); or create machines with the agent inside through MachineForge.

## Observability

- `GET /api/health` → `{ ok, version }` for liveness.
- `GET /metrics` for Prometheus: `cpullm_agents{state}`, `cpullm_jobs{status}`,
  `cpullm_campaigns`, `cpullm_latest_decode_tps{machine,model,config}`,
  `cpullm_agent_memory_bandwidth_gbs{machine}`, `cpullm_ai_advisor_enabled`.
  Suggested alerts: an agent offline for 10 minutes; a job queued for an hour;
  a campaign cell `regressed`.
- Audit log: Admin → Audit log or `DATA_DIR/audit.log` (JSON lines).

## Hardening checklist

- Serve over TLS (the host does); HSTS is sent when the request is secure.
- Security headers are on every response (`nosniff`, `DENY` framing,
  referrer policy, permissions policy).
- Set a strong admin password (≥ 10 chars) and rotate the agent token if a
  machine is lost (Admin → Agents).
- Turn on **Require an API key** for any installation reachable beyond a
  trusted network; hand out viewer keys by default.
- Keep `DATA_DIR` outside the web root with mode 0700; the server writes
  `settings.json` with 0600.
- Rate limits: admin login (10 failures / minute / IP), AI advisor
  (20 questions / minute / IP).

## High availability

The server is a single process over a directory. For HA run one active
instance against a replicated or network file system and a cold standby;
agents reconnect automatically (they only need the hostname to resolve to
the live instance). Restore-from-backup to a fresh host takes minutes.

## Service levels to promise

- Dashboard and API available while the host is; a restart takes ~2 s.
- Runs are durable once the agent uploads the result; a server restart during
  a run leaves the job `running` until the agent re-registers and claims the
  next job (the agent retries uploads).
- Backups contain everything needed to rebuild an installation.
