# CPU-LLM v2: preview

**Preview version.** Everything in [v1](/v1/features/) plus the features
below as they land. Preview features may change; data and machines are shared
with v1, so a run started here shows up there too.

## What is new

| Feature | Status |
|---|---|
| Versioned site: /v1 stable, /v2 preview, feature pages, version bar | Done |
| Queue a run on an offline machine; it starts when the agent connects | Done (also in v1.0.1) |

## Coming in the preview

The v2 theme is a **design and simulation lab** for people who build or
choose hardware for LLMs: CPU and GPU companies, performance engineers,
accelerator and VLSI engineers, simulation engineers.

- **Architecture designer:** dies, cores per die, vector units, L1/L2/L3
  sizes, NUMA nodes, memory channels and speed, node fabric, power. Start from
  a real part or a blank sheet.
- **Workload pinning:** one replica per NUMA node, interleaved, or single
  node; thread counts; cache residency of weights and KV cache.
- **Projected performance:** time to first token, tokens per second per
  sequence and in aggregate, memory and compute utilisation, tokens per joule.
- **Sweeps and comparisons:** vary one design parameter and watch the curve;
  compare designs side by side on the same workload; check projections
  against measured runs from v1.
- **Scale-out planner:** machines, memory, power and fabric needed to serve
  a target throughput, from one laptop to a cluster.
- **Analysis assistants:** statistical summaries of measured runs, learned
  corrections from measured-vs-projected gaps, and written reasoning about
  what a change buys and why.

Progress is tracked in the release notes.
