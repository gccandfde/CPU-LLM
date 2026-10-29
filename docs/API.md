# CPU-LLM API

Machine-readable description: `GET /api/openapi.json` (OpenAPI 3.0). This page
is the short human version.

## Access

| Group | Auth | Notes |
|---|---|---|
| Dashboard (`/api/config`, agents, jobs, campaigns, exports, AI advisor) | Same as the dashboard: open by default, HTTP basic auth when the admin turns dashboard login on | Everything the UI does |
| Admin (`/api/admin/*`) | `Authorization: Bearer <session>` from `POST /api/admin/login {password}` (12 h) | Settings, agent token, machines, audit |
| Agent (`/api/agent/*`) | `Authorization: Bearer <agent token>` (Admin → Agents) | Used by the Python agent only |
| Ops (`/api/health`, `/metrics`, `/api/openapi.json`) | Open | Liveness, Prometheus, this spec |

Errors are JSON `{ "detail": "…" }` with 400 (invalid), 401 (auth), 404,
409 (state), 429 (rate), 502/503 (upstream / not configured).

## Runs

```
GET  /api/agents                      connected machines (hardware profile, online)
GET  /api/jobs?agent_id=              runs, newest first (summaries)
POST /api/jobs                        { agent_id, model_id, precisions[], prune_counts[], thread_counts|null,
                                        batch_sizes[], new_tokens, repeats, max_ppl_increase_pct,
                                        max_eval_drop_pts, run_eval, profile, compile, device }
GET  /api/jobs/{id}                   full run: params, progress, results, result (baseline, results, best,
                                        recipe, roofline, batch_scaling, op_profile, hardware)
DELETE /api/jobs/{id}
GET  /api/jobs/{id}/report.md         GET /api/jobs/{id}/bundle.zip        GET /api/jobs/{id}/export.json
GET  /api/export/runs.csv             every finished configuration: machine, model, config, precision,
                                        threads, tok/s, speedup, significance, ppl, accuracy, bytes, noise
```

Queues are per machine: several runs can be queued on one agent; it runs them
oldest first (at most 20 queued per agent).

## Campaigns (benchmark matrices)

```
POST /api/campaigns                   { name, agent_ids[], model_ids[], params }  → 201 campaign
GET  /api/campaigns                   with progress { total, done, error, running, queued, deleted }
GET  /api/campaigns/{id}              + matrix[]: { agentId, modelId, status, decode_tps, config, precision,
                                        threads, noise_pct, previous{jobId,decode_tps,created}, delta_pct,
                                        verdict: first|improved|regressed|same }
GET  /api/campaigns/{id}/export.csv
DELETE /api/campaigns/{id}?delete_jobs=true|false
```

The verdict compares the cell's best tok/s with the most recent earlier
finished run of the same machine and model; the band is the larger of the two
runs' measured run-to-run noise, at least 3%.

## Admin

```
POST /api/admin/login { password }    → { token }
GET/PUT /api/admin/settings           site, access, agents, tuning, retention, ai; PUT accepts a partial patch
                                        plus dashboardPassword / anthropicKey (string or null)
POST /api/admin/agent-token           rotate
POST /api/admin/password { current, next }
DELETE /api/admin/agents/{id}
GET  /api/admin/audit?limit=200       newest first: { ts, actor, ip, method, path, status, summary }
```

## Operations

- `GET /api/health` → `{ ok, version }`
- `GET /metrics` → Prometheus text: `cpullm_agents{state}`, `cpullm_jobs{status}`,
  `cpullm_campaigns`, `cpullm_latest_decode_tps{machine,model,config}`,
  `cpullm_agent_memory_bandwidth_gbs{machine}`, `cpullm_ai_advisor_enabled`.
- Audit log file: `DATA_DIR/audit.log` (JSON lines, append-only).

## Example: nightly regression campaign from a script

```bash
S=https://cpullm.example.com
AGENTS=$(curl -s $S/api/agents | jq -c '[.[] | select(.online) | .id]')
curl -s -X POST $S/api/campaigns -H 'Content-Type: application/json' -d "{
  \"name\": \"nightly $(date +%F)\", \"agent_ids\": $AGENTS,
  \"model_ids\": [\"HuggingFaceTB/SmolLM2-135M\", \"Qwen/Qwen2.5-0.5B\"],
  \"params\": { \"precisions\": [\"fp32\",\"bf16\",\"int8_dynamic\"], \"prune_counts\": [0], \"batch_sizes\": [1],
                \"new_tokens\": 32, \"repeats\": 3, \"run_eval\": true, \"profile\": false, \"compile\": false,
                \"max_ppl_increase_pct\": 10, \"max_eval_drop_pts\": 5 } }"
# later
curl -s $S/api/campaigns | jq '.[0] | {name, progress}'
curl -s $S/api/campaigns/<id> | jq '.matrix[] | select(.verdict=="regressed")'
```
