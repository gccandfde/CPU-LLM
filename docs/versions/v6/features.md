# CPU-LLM v6: preview

**Preview version.** Everything in [v5](/v5/features/) plus what is being
built next, as it lands. Preview features may change.

## Planned

- **OIDC single sign-on** (Okta, Entra ID, Google) with group-to-role
  mapping; local admin password as break-glass.
- **Retention policies** per campaign and machine; legal hold on runs.
- **Fleet tab:** connect a MachineForge host, make sized machines with the
  agent inside, launch a campaign across them.
- **GPU designs** in the Designer; CPU vs GPU at equal cost and power.
- **Webhooks** (run / campaign finished, regression detected) and
  **scheduled campaigns**; a `cpullm` CLI generated from the OpenAPI document.
- **Measured placement sweeps** from the Planner; power in the live
  forecast with alerts.

Nothing in this list is live yet; the version bar tells you which version you
are using.
