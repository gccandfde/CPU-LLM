# CPU-LLM v3: preview

**Preview version.** Everything in [v2](/v2/features/) plus what is being
built next, as it lands. Preview features may change; data and machines are
shared with v2 and v1.

## In the preview now

- **Measure it (Planner → Thread count):** on a connected machine, one click
  queues the tuning run for the recommended thread counts (half a node, a
  node, a node with SMT) for the chosen model and precision; finished runs are
  drawn as measured points over the projected curve, with the measured ÷
  projected ratio so the efficiency assumption can be corrected.

## Planned for the preview

- **Measured placement sweeps** (replica per node vs interleaved) the same way.
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
