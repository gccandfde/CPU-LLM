# CPU-LLM

Accelerate LLM inference on CPUs (AMD first) through hardware-aware model
transformation and system tuning across CPU, memory, disk and network.

CPU-LLM takes a base model and a target machine, searches over model
transforms (precision, quantisation, layer pruning, …) and runtime settings
(threads, pinning, NUMA), measures speed **and** accuracy for each, and exports
a **recipe**: a small JSON file that rebuilds the tuned model on any other
machine and re-verifies the numbers.

```
backend/   Python · FastAPI · PyTorch — profiling, transforms, benchmarks, tuner, recipes
frontend/  React · Vite · Recharts   — live telemetry + tuning dashboard (separate app)
docs/      Architecture, roadmap and research-paper outline
```

## Quick start

```bash
# Backend (port 8000)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn cpullm.api:app --port 8000

# Frontend (port 5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, pick a model, and run a tuning sweep. When it
finishes, download the **tuning bundle** (`recipe.json`, `report.md`,
`results.json`, `REPRODUCE.md`) and rebuild the model anywhere with:

```bash
cd backend && python -m cpullm.reproduce /path/to/recipe.json
```

For a production deployment, serve `frontend/dist` (built with
`VITE_API_URL=https://your-backend`) from any static host and run the
backend on the machine you want to tune; set `CPULLM_CORS_ORIGINS` to the
frontend's origin.

## Tests

```bash
cd backend && python -m pytest -q
```

Tests use a built-in tiny model, so they need no downloads.

## What the POC does today

| Area | Implemented |
|---|---|
| Hardware profile | CPU model, cores, ISA (AVX2/AVX-512/VNNI/BF16/AMX), caches, NUMA, measured memory bandwidth |
| Transforms | bf16 cast, dynamic int8 (per-channel, `lm_head` kept in float), importance-based layer pruning |
| Metrics | TTFT (prefill), decode tok/s, perplexity, greedy token agreement vs fp32, model size, RSS |
| Analysis | Bandwidth roofline vs reference AMD/NVIDIA CPUs and GPUs, per-layer redundancy |
| Live telemetry | Per-core CPU, memory, disk and network over WebSocket |
| Output | Markdown report + portable recipe bundle, `cpullm.reproduce` CLI |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and roadmap and
[docs/RESEARCH_PAPER.md](docs/RESEARCH_PAPER.md) for the paper plan.
