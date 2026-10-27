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

Production-style run (what Hostinger does): `npm run build && AGENT_TOKEN=... npm start`.

## Tests

```bash
npm test                                 # Node server
cd backend && python -m pytest -q        # Python agent + tuner (no downloads)
```

## What the POC does today

| Area | Implemented |
|---|---|
| Hardware profile | CPU model, cores, ISA (AVX2/AVX-512/VNNI/BF16/AMX), caches, NUMA, measured memory bandwidth |
| Transforms | bf16 cast, dynamic int8 (per-channel, `lm_head` kept in float), importance-based layer pruning |
| Metrics | TTFT (prefill), decode tok/s, perplexity, greedy token agreement vs fp32, model size, RSS |
| Analysis | Bandwidth roofline vs reference AMD/NVIDIA CPUs and GPUs, per-layer redundancy |
| Live telemetry | Per-core CPU, memory, disk and network from each agent |
| Fleet | Multiple machines (agents) per server, job queue, persisted history |
| Output | Markdown report + portable recipe bundle, `cpullm.reproduce` CLI |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap and
[docs/RESEARCH_PAPER.md](docs/RESEARCH_PAPER.md) for the paper plan.

## Contributing

Feature branches → pull request into `dev` → merge. `dev` is promoted to `main`.
