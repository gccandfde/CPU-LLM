# CPU-LLM v5: preview

**Preview version.** Everything in [v4](/v4/features/) plus what is being
built next, as it lands. Preview features may change; data and machines are
shared with the stable versions.

## Planned for v5: enterprise readiness

- **Roles and API keys:** admin / engineer / viewer; named API keys with a
  role, rotation and last-used; every key in the audit log.
- **SSO-ready sign-in:** OIDC (Okta, Entra ID, Google) mapping groups to
  roles, with the local admin password as break-glass.
- **Backup and restore:** one archive of settings, machines, runs, campaigns
  and audit; restore into a fresh install; scheduled backups.
- **Retention policies** per campaign and per machine; legal hold on runs.
- **Hardening:** security headers, per-key rate limits, CSRF for the
  dashboard, secrets at rest with a key file, dependency scanning and SBOM.
- **Operations guide:** HA notes, upgrade and rollback, Grafana dashboards for
  `/metrics`, SLOs.
- **Fleet tab (MachineForge), GPU designs, webhooks, scheduled campaigns,
  CLI** carried from the v4 plan.

Nothing in this list is live yet; the version bar tells you which version you
are using.
