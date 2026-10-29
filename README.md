# CPU-LLM

Accelerate LLM inference on CPUs (AMD first) through hardware-aware model
transformation and system tuning across CPU, memory, disk and network.

CPU-LLM takes a base model and a target machine, searches over model
transforms (precision, quantisation, layer pruning, …) and runtime settings
(threads, pinning, NUMA), measures speed **and** accuracy for each, and exports
a **recipe**: a small JSON file that rebuilds the tuned model on any other
machine and re-verifies the numbers.

```
server/    Node.js · Express — API + serves the dashboard (deploys to Hostinger)
frontend/  React · Vite · Recharts — live telemetry + tuning dashboard
backend/   Python · PyTorch — agent that runs on the machine being tuned:
           profiling, transforms, benchmarks, tuner, recipes
docs/      Architecture, Hostinger deployment, research-paper plan
```

The web app is pure Node.js, so it runs on Hostinger's Node.js hosting. The
tuning itself must run on the hardware being measured, so it lives in a
Python agent that connects out to the server. See
[docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md).

## Local quick start

```bash
# 1. Web app (Node server on :3000 + Vite dev server on :5173)
npm install
npm run dev:server          # uses AGENT_TOKEN=dev-token unless set
npm run dev:frontend        # in another terminal; open http://localhost:5173

# 2. Agent (on the machine to tune; here, the same machine)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m cpullm.agent --server http://localhost:3000 --token dev-token
```

Pick a model and run a tuning sweep. When it finishes, download the
**tuning bundle** (`recipe.json`, `report.md`, `results.json`,
`REPRODUCE.md`) and rebuild the model anywhere with:

```bash
cd backend && python -m cpullm.reproduce /path/to/recipe.json
```

Production-style run (what Hostinger does): `npm run build && ADMIN_PASSWORD=... DATA_DIR=... npm start`.
Settings are then managed in the **Admin** tab ([docs/ADMIN.md](docs/ADMIN.md)).

## Tests

```bash
npm test                                 # Node server + dashboard perf model
cd backend && python -m pytest -q        # Python agent + tuner (no downloads)
```

## Dashboard tabs

| Tab | What it is for |
|---|---|
| **Overview** | Fleet KPIs, connected machines, recent runs |
| **Machines** | Per-machine hardware profile (CPU, ISA, caches, NUMA, GPUs, energy counters) and live telemetry |
| **Tune** | Start a run with presets (Quick check, Full sweep, Accuracy-first, Max speed) or custom options |
| **Runs** | History with filters; each run has Summary, Configurations, Batch scaling, Operator trace, Layers, Roofline and Recipe views |
| **Recipes** | Every tuned configuration, ready to download and reproduce |
| **Compare** | Up to 6 runs side by side (machines, models, CPU vs GPU): speed, accuracy, bandwidth efficiency, batch scaling, operator mix |
| **Architecture Lab** | What-if model of decode on any CPU/GPU memory system: model size, MoE, precision, KV cache, batch, context; capacity, compute knee, tok/J. Add your own SKUs; connected machines appear with measured bandwidth |
| **Benchmarks** (v4) | Open-source workload suite on CPU and GPU: STREAM, GEMM per dtype, attention decode/prefill, embedding gather; compare machines |
| **Power** (v4) | Power optimiser: active-core sweep with RAPL energy (or labelled estimates), optional core offlining and governor on Linux, performance / balanced / efficiency operating points |
| **Campaigns** (v3) | Machines × models in one click, per-machine queues, result matrix with ▲/▼ regression verdicts against earlier runs, CSV export |
| **Designer** (v2) | Design a CPU at die, cache and NUMA level, pin a model, read projected speed, roofline with every ceiling, design-space grid, sweeps, comparisons, scale-out |
| **Planner** (v2) | NUMA placement, thread count, serving concurrency and KV memory, quantisation pay-off, cost per million tokens |
| **Insights** (v2) | Calibration of projections against measured runs, noise and significance, predictor for unmeasured machines, benchmark matrix, Claude advisor |
| **Admin** | Password-protected settings: dashboard login, API keys with roles (v5), agent token and machines, tuning models/precisions/limits/presets, retention, site title, AI advisor key, backup and restore (v5), audit log (v3). See [docs/ADMIN.md](docs/ADMIN.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md) |

Tabs live in `frontend/src/tabs/` and are registered in one list in `App.jsx`, so new ones are a single file each.

## What the POC does today

| Area | Implemented |
|---|---|
| Hardware profile | CPU model, cores, ISA (AVX2/AVX-512/VNNI/BF16/AMX), caches, NUMA, measured memory bandwidth |
| Transforms | bf16/fp16, dynamic int8 (torch.ao), int8/int4 weight-only (torchao), importance-based layer pruning, `torch.compile` |
| Metrics | TTFT, decode tok/s, batch scaling, perplexity, 30-item task eval, token agreement, size, RSS, J/token (RAPL), run-to-run noise |
| Tracing | Operator-level decode trace grouped into matmul / attention / norm / elementwise / data movement |
| Devices | CPU, plus CUDA/ROCm GPUs via the same agent |
| Analysis | Bandwidth roofline vs reference AMD/NVIDIA CPUs and GPUs, per-layer redundancy |
| Live telemetry | Per-core CPU, memory, disk and network from each agent |
| Fleet | Multiple machines (agents) per server, job queue, persisted history |
| Output | Markdown report + portable recipe bundle, `cpullm.reproduce` CLI |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap and
[docs/RESEARCH_PAPER.md](docs/RESEARCH_PAPER.md) for the paper plan.

## Contributing

Feature branches → pull request into `dev` → merge. `dev` is promoted to `main`.
