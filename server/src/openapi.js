// OpenAPI 3.0 description of the public API, served at /api/openapi.json.
// Hand-maintained: keep it in step with app.js. Full prose in docs/API.md.
export function openapi(version) {
  const json = (schema) => ({ 'application/json': { schema } })
  const ok = (schema, description = 'OK') => ({ 200: { description, content: json(schema) } })
  const id = { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
  const obj = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) })
  const S = {
    Agent: obj({ id: { type: 'string' }, name: { type: 'string' }, online: { type: 'boolean' }, lastSeen: { type: 'integer' }, hardware: { type: 'object' } }),
    JobSummary: obj({ id: { type: 'string' }, agentId: { type: 'string' }, status: { type: 'string', enum: ['queued', 'running', 'done', 'error'] }, created: { type: 'integer' }, finished: { type: 'integer' }, progress: { type: 'number' }, model_id: { type: 'string' }, device: { type: 'string' }, summary: { type: 'object', nullable: true } }),
    TuneParams: obj({
      model_id: { type: 'string', example: 'HuggingFaceTB/SmolLM2-135M' }, device: { type: 'string', enum: ['cpu', 'cuda'] },
      precisions: { type: 'array', items: { type: 'string' } }, prune_counts: { type: 'array', items: { type: 'integer' } },
      thread_counts: { type: 'array', items: { type: 'integer' }, nullable: true }, batch_sizes: { type: 'array', items: { type: 'integer' } },
      new_tokens: { type: 'integer' }, repeats: { type: 'integer' }, max_ppl_increase_pct: { type: 'number' }, max_eval_drop_pts: { type: 'number' },
      run_eval: { type: 'boolean' }, profile: { type: 'boolean' }, compile: { type: 'boolean' },
      kind: { type: 'string', enum: ['tune', 'benchmark', 'power'], description: 'benchmark: stream_mb, gemm_sizes, gemm_dtypes, attention_ctx, gather_mb, repeats. power: precision, core_counts (CPU) or power_limits in watts + gpu_index (device cuda), new_tokens, repeats, idle_w, tdp_w, hard_offline, governor.' },
    }, ['model_id', 'precisions', 'new_tokens']),
    Campaign: obj({ id: { type: 'string' }, name: { type: 'string' }, created: { type: 'integer' }, agentIds: { type: 'array', items: { type: 'string' } }, modelIds: { type: 'array', items: { type: 'string' } }, params: { type: 'object' }, jobs: { type: 'array', items: { type: 'object' } }, progress: { type: 'object' }, matrix: { type: 'array', items: { type: 'object' } } }),
    Error: obj({ detail: { type: 'string' } }, ['detail']),
  }
  return {
    openapi: '3.0.3',
    info: { title: 'CPU-LLM API', version, description: 'Hardware-aware LLM tuning, benchmarking campaigns and the design/planning lab. Dashboard endpoints share the dashboard\'s access (basic auth when the admin turns it on); admin endpoints need a session from POST /api/admin/login; agent endpoints need the agent token.' },
    servers: [{ url: '/' }],
    tags: [{ name: 'dashboard' }, { name: 'campaigns' }, { name: 'exports' }, { name: 'admin' }, { name: 'agent' }, { name: 'ops' }],
    components: { schemas: S, securitySchemes: { adminSession: { type: 'http', scheme: 'bearer', description: 'Token from POST /api/admin/login' }, agentToken: { type: 'http', scheme: 'bearer', description: 'The agent token from Admin → Agents' } } },
    paths: {
      '/api/health': { get: { tags: ['ops'], summary: 'Liveness', responses: ok(obj({ ok: { type: 'boolean' }, version: { type: 'string' } })) } },
      '/metrics': { get: { tags: ['ops'], summary: 'Prometheus metrics', responses: { 200: { description: 'text/plain exposition' } } } },
      '/api/openapi.json': { get: { tags: ['ops'], summary: 'This document', responses: { 200: { description: 'OpenAPI 3.0' } } } },
      '/api/config': { get: { tags: ['dashboard'], summary: 'Public settings (site, tuning options, AI advisor state)', responses: ok({ type: 'object' }) } },
      '/api/agents': { get: { tags: ['dashboard'], summary: 'Connected machines', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/Agent' } }) } },
      '/api/agents/{id}/telemetry': { get: { tags: ['dashboard'], parameters: [id, { name: 'since', in: 'query', schema: { type: 'integer' } }], summary: 'Telemetry samples newer than `since` (unix ms)', responses: ok({ type: 'array', items: { type: 'object' } }) } },
      '/api/jobs': {
        get: { tags: ['dashboard'], parameters: [{ name: 'agent_id', in: 'query', schema: { type: 'string' } }], summary: 'Runs, newest first', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/JobSummary' } }) },
        post: { tags: ['dashboard'], summary: 'Queue a tuning run on a machine', requestBody: { content: json({ allOf: [{ $ref: '#/components/schemas/TuneParams' }, obj({ agent_id: { type: 'string' } }, ['agent_id'])] }) }, responses: { ...ok(obj({ id: { type: 'string' } })), 400: { description: 'Invalid parameters', content: json(S.Error) } } },
      },
      '/api/jobs/{id}': { get: { tags: ['dashboard'], parameters: [id], summary: 'Full run with results', responses: ok({ type: 'object' }) }, delete: { tags: ['dashboard'], parameters: [id], summary: 'Delete a finished run', responses: ok(obj({ ok: { type: 'boolean' } })) } },
      '/api/jobs/{id}/report.md': { get: { tags: ['exports'], parameters: [id], summary: 'Markdown report', responses: { 200: { description: 'text/markdown' } } } },
      '/api/jobs/{id}/bundle.zip': { get: { tags: ['exports'], parameters: [id], summary: 'Reproducible bundle (recipe + report + raw results)', responses: { 200: { description: 'application/zip' } } } },
      '/api/jobs/{id}/export.json': { get: { tags: ['exports'], parameters: [id], summary: 'Run as JSON download', responses: { 200: { description: 'application/json' } } } },
      '/api/export/runs.csv': { get: { tags: ['exports'], summary: 'Every finished configuration on the server as CSV', responses: { 200: { description: 'text/csv' } } } },
      '/api/campaigns': {
        get: { tags: ['campaigns'], summary: 'Campaigns with progress', responses: ok({ type: 'array', items: { $ref: '#/components/schemas/Campaign' } }) },
        post: { tags: ['campaigns'], summary: 'Queue a machines × models matrix', requestBody: { content: json(obj({ name: { type: 'string' }, agent_ids: { type: 'array', items: { type: 'string' } }, model_ids: { type: 'array', items: { type: 'string' } }, params: { $ref: '#/components/schemas/TuneParams' } }, ['agent_ids', 'model_ids', 'params'])) }, responses: { 201: { description: 'Created', content: json(S.Campaign) }, 400: { description: 'Invalid', content: json(S.Error) } } },
      },
      '/api/campaigns/{id}': { get: { tags: ['campaigns'], parameters: [id], summary: 'Campaign with result matrix and regression verdicts', responses: ok(S.Campaign) }, delete: { tags: ['campaigns'], parameters: [id, { name: 'delete_jobs', in: 'query', schema: { type: 'boolean' } }], summary: 'Remove a campaign (optionally its runs)', responses: ok(obj({ ok: { type: 'boolean' } })) } },
      '/api/campaigns/{id}/export.csv': { get: { tags: ['exports'], parameters: [id], summary: 'Campaign matrix as CSV', responses: { 200: { description: 'text/csv' } } } },
      '/api/ai/ask': { post: { tags: ['dashboard'], summary: 'Ask the AI advisor (when configured)', requestBody: { content: json(obj({ question: { type: 'string' }, context: { type: 'string' } }, ['question'])) }, responses: { ...ok(obj({ answer: { type: 'string' }, model: { type: 'string' } })), 503: { description: 'Not configured', content: json(S.Error) } } } },
      '/api/admin/login': { post: { tags: ['admin'], summary: 'Admin session from the admin password', requestBody: { content: json(obj({ password: { type: 'string' } }, ['password'])) }, responses: ok(obj({ token: { type: 'string' } })) } },
      '/api/admin/settings': { get: { tags: ['admin'], security: [{ adminSession: [] }], summary: 'All settings', responses: ok({ type: 'object' }) }, put: { tags: ['admin'], security: [{ adminSession: [] }], summary: 'Partial update', requestBody: { content: json({ type: 'object' }) }, responses: ok({ type: 'object' }) } },
      '/api/admin/agent-token': { post: { tags: ['admin'], security: [{ adminSession: [] }], summary: 'Rotate the agent token', responses: ok(obj({ agentToken: { type: 'string' } })) } },
      '/api/admin/agents/{id}': { delete: { tags: ['admin'], security: [{ adminSession: [] }], parameters: [id], summary: 'Forget a machine', responses: ok(obj({ ok: { type: 'boolean' } })) } },
      '/api/admin/audit': { get: { tags: ['admin'], security: [{ adminSession: [] }], parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 200 } }], summary: 'Audit log, newest first', responses: ok({ type: 'array', items: { type: 'object' } }) } },
      '/api/agent/register': { post: { tags: ['agent'], security: [{ agentToken: [] }], summary: 'Register (or re-register) a machine', requestBody: { content: json(obj({ name: { type: 'string' }, hardware: { type: 'object' } }, ['name', 'hardware'])) }, responses: ok(obj({ agent_id: { type: 'string' } })) } },
      '/api/agent/{id}/next-job': { get: { tags: ['agent'], security: [{ agentToken: [] }], parameters: [id], summary: 'Claim the oldest queued job', responses: ok({ type: 'object', nullable: true }) } },
    },
  }
}
