# CPU-LLM v3: preview

**Preview version.** Everything in [v2](/v2/features/) plus what is being
built next, as it lands. Preview features may change; data and machines are
shared with v2 and v1.

## Planned for the preview

- **Measured thread and placement sweeps from the Planner:** one click queues
  the tuning run that measures the recommended thread counts and placements,
  and the Planner shows measured next to projected.
- **GPU designs:** SMs/CUs, HBM stacks, tensor-core rates and NVLink in the
  Designer, with CPU vs GPU comparisons at equal cost and power.
- **Training projections:** tokens per second and time to train for a model
  and cluster size, data-parallel and tensor-parallel communication on the
  fabric the Designer describes.
- **Calibration per machine class** instead of one fleet-wide efficiency, and
  the advisor citing which measured runs it reasoned from.
- **MachineForge integration:** make differently-sized machines from one host
  and run benchmark matrices across them automatically.

Nothing in this list is live yet; the version bar tells you which version you
are using.
