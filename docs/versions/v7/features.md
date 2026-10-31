# CPU-LLM v7: preview

**Preview version.** Everything in [v6](/v6/features/) plus what is being
built next, as it lands. Preview features may change.

## Planned

- **OIDC single sign-on** (Okta, Entra ID, Google) with group-to-role
  mapping; local admin password as break-glass.
- **Retention policies** per campaign and machine; legal hold on runs.
- **Fleet tab:** connect a MachineForge host, make sized machines (CPU or
  GPU) with the agent inside, launch a campaign across them.
- **GPU designs** in the Designer; CPU vs GPU at equal cost and power;
  multi-GPU tensor-parallel modelling.
- **Webhooks** (run / campaign finished, regression detected) and
  **scheduled campaigns**; a `cpullm` CLI generated from the OpenAPI document.
- **Measured placement sweeps** from the Planner; power alerts in the live
  forecast ("power above cap in 20 s").
- **ROCm telemetry and power limits** through `rocm-smi`; FP8 / NVFP4
  kernels in the benchmark suite.

Nothing in this list is live yet; the version bar tells you which version you
are using.
