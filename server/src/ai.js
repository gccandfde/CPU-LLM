// AI advisor: the dashboard asks a question with the numbers it is looking
// at (a design, a projection, measured runs) and Claude answers as a
// hardware/performance engineer. The API key is admin-configured and only
// ever used here, server-side; the browser never sees it.
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM = `You are the CPU-LLM advisor: a senior performance engineer who helps CPU, GPU, VLSI and ML-systems engineers reason about running and serving LLMs on their hardware.

You are given CONTEXT produced by the CPU-LLM platform: measured runs (ground truth from real machines), hardware profiles, and projections from a first-order analytical model (bandwidth = NUMA nodes × channels × channel speed scaled by pinning; compute = cores × clock × FMA units × lanes; decode step = max(bytes/bandwidth, FLOPs/compute)).

Rules:
- Be quantitative. Quote the numbers from the context and show the arithmetic that leads to a conclusion.
- Separate what was measured from what is projected, and say when a projection is outside what the model can know (kernel quality, frequency scaling, OS scheduling, thermal state).
- Decode is normally memory-bandwidth bound at small batch; prefill is compute bound. Quantisation reduces bytes but costs compute when the format is not native. More threads than cores of a NUMA node usually slows decode. Say so when it applies, with the reason.
- Prefer a short structured answer: the finding, why, what to change, and how to verify it with a measurement on the platform (a tuning run, a thread sweep, a compare).
- If the question cannot be answered from the context, say what measurement would answer it.`

export function aiRouter(settings, { ask = askClaude } = {}) {
  const router = express.Router()
  const recent = new Map() // ip -> timestamps, a soft rate limit so one tab cannot drain the key

  router.post('/ask', async (req, res) => {
    if (!settings.aiReady) return res.status(503).json({ detail: 'The AI advisor is not configured. An admin can add an Anthropic API key under Admin → AI advisor.' })
    const now = Date.now()
    const hits = (recent.get(req.ip) || []).filter((t) => now - t < 60_000)
    if (hits.length >= 20) return res.status(429).json({ detail: 'Too many questions in a minute; wait a moment' })
    recent.set(req.ip, [...hits, now])

    const question = String(req.body?.question || '').trim()
    const context = String(req.body?.context || '').trim()
    if (!question || question.length > 4000) return res.status(400).json({ detail: 'A question of up to 4000 characters is required' })
    if (context.length > 60_000) return res.status(400).json({ detail: 'Context is too long (60 000 characters max)' })

    try {
      const out = await ask({ apiKey: settings.anthropicKey, ai: settings.data.ai, question, context })
      res.json(out)
    } catch (e) {
      const status = e instanceof Anthropic.AuthenticationError ? 502
        : e instanceof Anthropic.RateLimitError ? 429
        : e instanceof Anthropic.APIError ? 502 : 500
      const detail = e instanceof Anthropic.AuthenticationError ? 'Anthropic rejected the API key; check it under Admin → AI advisor'
        : e instanceof Anthropic.RateLimitError ? 'Anthropic rate limit reached; try again shortly'
        : `Advisor error: ${e.message}`
      res.status(status).json({ detail })
    }
  })
  return router
}

async function askClaude({ apiKey, ai, question, context }) {
  const client = new Anthropic({ apiKey })
  const user = `${context ? `CONTEXT (from the CPU-LLM platform):\n${context}\n\n` : ''}QUESTION:\n${question}`
  const started = Date.now()
  const response = await client.beta.messages.create({
    model: ai.model,
    max_tokens: ai.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: ai.effort },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  })
  if (response.stop_reason === 'refusal') {
    return { answer: `The advisor declined to answer this question${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`, model: response.model, refused: true }
  }
  const answer = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
  return {
    answer, model: response.model, truncated: response.stop_reason === 'max_tokens',
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, cached: response.usage.cache_read_input_tokens || 0 },
    ms: Date.now() - started,
  }
}
