# CPU-LLM v5: stable

**Stable version.** Everything in [v4](/v4/features/) (tuning, design lab,
campaigns, benchmark suite, power optimiser) plus the enterprise layer:
**API keys with roles, an API-key-only mode, backup and restore, hardening
headers and an operations guide.** Data and machines are shared with the
earlier versions.

## API keys and roles

- Admin → **API keys**: named bearer keys (`cpk_…`) with a role:
  **viewer** (read everything, change nothing), **engineer** (runs,
  campaigns, benchmark and power jobs, AI advisor), **admin** (settings,
  machines, keys, audit, backup through the API too).
- Keys are shown once and stored as a hash; last-used is tracked; revoking is
  immediate. Every call made with a key is in the audit log as `key:<name>`.
- **Require an API key** closes the dashboard API to anonymous callers
  (browsers use the dashboard password); `/api/health` and `/metrics` stay
  open, agents are unaffected.

## Backup and restore

- One `.json.gz` of everything: settings with secrets, machines, runs with
  reports and bundles, campaigns, audit log. Download from Admin or with an
  admin key from cron.
- Restore from Admin or `POST /api/admin/restore`; the server writes the
  files and restarts on them. Verified by restoring into a fresh install and
  registering an agent with the restored token.

## Hardening

`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy` on every response; HSTS on TLS; rate-limited admin
login and advisor; secrets never logged or listed.

## Operations guide

[docs/OPERATIONS.md](https://github.com/gccandfde/CPU-LLM/blob/main/docs/OPERATIONS.md):
access model, backups and schedules, upgrade and rollback, observability
with suggested alerts, hardening checklist, HA pattern, service levels.

## Carried to v6

OIDC single sign-on with group-to-role mapping, retention policies per
campaign and machine, Fleet tab (MachineForge), GPU designs, webhooks,
scheduled campaigns, CLI, measured placement sweeps. See `/v6/features/`.
