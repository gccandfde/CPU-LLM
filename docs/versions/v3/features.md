# CPU-LLM v3: stable

**Stable version.** Everything in [v2](/v2/features/) (tuning, fleet, compare,
Designer, Planner, Insights, AI advisor) plus the operations layer a team
needs to run it every day: benchmark campaigns with regression tracking,
exports, an audit trail, Prometheus metrics, an OpenAPI description, and a
rolling-window forecast on the live telemetry.

Data and machines are shared with v1 and v2.

## Campaigns: benchmark matrices in one click

- Pick machines and models, choose a preset, queue. Every machine × model
  becomes a run; machines work through their own queue oldest first (up to 20
  queued per machine), offline machines start when they connect.
- Progress per campaign; the **result matrix** shows the best decode tok/s and
  configuration per cell.
- **Regression tracking:** each cell is compared with the most recent earlier
  run of the same machine and model: ▲ improved / ▼ regressed / • unchanged,
  using a band equal to the larger of both runs' measured run-to-run noise
  (at least 3%). A nightly campaign is therefore a regression suite for a
  kernel, compiler, BIOS or firmware change.
- CSV export of the matrix; the API example in `docs/API.md` runs a nightly
  campaign from cron.

## Measure it (from the Planner)

On a connected machine the thread-count projection has a **Measure it**
button: one run with the recommended thread counts; measured points are drawn
over the projected curve with the measured ÷ projected ratio.

## Live forecast

Machines → live telemetry now draws the **next minute** of CPU and memory as a
dashed continuation of the live line with a confidence band (Holt
double-exponential smoothing over the rolling window), and says where each is
heading. The same forecast is the base for the power optimiser in v4.

## Exports and integration

- Run as JSON, every finished configuration as CSV (`/api/export/runs.csv`),
  campaign matrix as CSV, plus the Markdown report and reproducible bundle.
- `GET /api/openapi.json` (OpenAPI 3.0) and `docs/API.md`.
- `GET /metrics` for Prometheus: agents by state, jobs by status, campaigns,
  latest tok/s per machine and model, measured bandwidth per machine, AI
  advisor state. `GET /api/health` reports the version.

## Audit log

Every change made through the API (runs, campaigns, settings, agents) is
appended to `DATA_DIR/audit.log` with who made it (admin session, agent,
dashboard user), the result and a secret-free summary. Admin → Audit log.

## Agent

- Reports `usable_cores` (CPU affinity / cpuset) next to physical and logical
  cores; thread sweeps inside a pinned container or MachineForge machine use
  the cores it really has.
- Memory bandwidth = the better of a multi-threaded streaming read and a copy
  (since v2.0.0).

## Honest limits

Regression verdicts depend on the agent's noise estimate (two baseline
measurements); treat a ▼ inside a few percent on a noisy machine as a prompt
to re-run, not a verdict. Campaigns run with the same preset on every
machine; per-machine presets are a v4 item.
