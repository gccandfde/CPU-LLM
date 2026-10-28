# CPU-LLM v2: preview

**Preview version.** Everything in [v1](/v1/features/) plus the features
below as they land. Preview features may change; data and machines are shared
with v1, so a run started here shows up there too.

## What is new

| Feature | Status |
|---|---|
| Versioned site: /v1 stable, /v2 preview, feature pages, version bar | Done |
| Queue a run on an offline machine; it starts when the agent connects | Done (also in v1.0.1) |
| One-line "turn a machine on" installer (Windows, Linux, macOS, WSL) | Done (also in v1.0.2) |
| **Designer tab** (below) | Done |

### Designer

Design a CPU and see what an LLM would do on it, before the silicon or the
purchase exists.

- **Start from** a reference part (Ryzen 9 8940HX, Ryzen 9 9950X, EPYC 9654,
  Xeon Platinum 8592+, an HBM-CPU concept), a **connected machine's measured
  profile** (cores, ISA, caches, NUMA nodes, measured bandwidth), or a saved design.
- **Edit at die level:** dies, cores per die, SMT, clock, FMA units and vector
  width, BF16/VNNI/AMX support; **cache level:** L1d, L2 per core, L3 per die,
  L3 bandwidth; **NUMA level:** nodes, memory channels per node and channel
  type (DDR4/DDR5/LPDDR5X/HBM3), capacity per node, node fabric bandwidth and
  latency; power envelope.
- **Pin the workload:** one replica per NUMA node, interleaved across nodes, or
  a single node; model, weight precision, batch, context and prompt length;
  bandwidth and compute efficiency factors.
- **Projected results:** decode tokens/s per sequence and aggregate, time to
  first token, tokens per joule, memory needed and whether it fits, memory vs
  compute bound with time shares, and **where the bytes live** (does a layer fit
  in L3, does the KV cache fit in L2/L3, L3 turnover per step).
- **Sweep** any design parameter and watch aggregate throughput respond.
- **Compare** designs on the same workload: chart, table, library with
  tick-to-compare, saved designs kept in your browser.
- **Scale-out planner:** machines, total power, energy per day, memory, cores
  and the fabric a tensor-parallel split would need for a target throughput.

The model is first-order and analytical (bandwidth = nodes × channels × channel
speed, scaled by pinning; compute = cores × clock × vector lanes, halved for
non-native precisions). It tells you the *shape* of the answer; measured runs on
the Compare tab are the ground truth to calibrate it against.

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
