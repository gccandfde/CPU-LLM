// Rolling-window forecast for live telemetry: Holt's double exponential
// smoothing (level + trend) over the last N samples, projected H steps
// ahead, with a band from the one-step residuals. Small, fast, honest: it
// says where the next minute is heading if the current trend continues.
import { sd } from './stats.js'

export function holt(values, { alpha = 0.5, beta = 0.1 } = {}) {
  const xs = values.filter((v) => Number.isFinite(v))
  if (xs.length < 3) return null
  let level = xs[0], trend = xs[1] - xs[0]
  const residuals = []
  for (let i = 1; i < xs.length; i++) {
    const predicted = level + trend
    residuals.push(xs[i] - predicted)
    const prevLevel = level
    level = alpha * xs[i] + (1 - alpha) * (level + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
  }
  return { level, trend, residualSd: sd(residuals.slice(-Math.min(30, residuals.length))) }
}

// Forecast `horizon` future points at `stepSec` spacing from samples with
// numeric `key`; clamps into [min, max]. Returns [{ offsetSec, value, lo, hi }].
export function forecast(samples, key, { horizon = 60, stepSec = 1, min = 0, max = Infinity, window = 180 } = {}) {
  const model = holt(samples.slice(-window).map((s) => s[key]))
  if (!model) return null
  const clamp = (v) => Math.min(max, Math.max(min, v))
  const points = []
  for (let h = 1; h <= horizon; h += stepSec) {
    const value = model.level + model.trend * h
    const band = model.residualSd * Math.sqrt(h) * 1.96
    points.push({ offsetSec: h, value: clamp(value), lo: clamp(value - band), hi: clamp(value + band) })
  }
  const last = points.at(-1)
  return { points, at: last.value, lo: last.lo, hi: last.hi, trendPerMin: model.trend * 60 / stepSec, horizon }
}
