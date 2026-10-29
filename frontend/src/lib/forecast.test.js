import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holt, forecast } from './forecast.js'

test('holt follows a linear trend', () => {
  const xs = Array.from({ length: 60 }, (_, i) => 10 + 0.5 * i)
  const m = holt(xs)
  assert.ok(Math.abs(m.trend - 0.5) < 0.05, `trend ${m.trend}`)
  assert.ok(m.residualSd < 0.5)
})

test('forecast projects a minute ahead and clamps to the valid range', () => {
  const samples = Array.from({ length: 120 }, (_, i) => ({ cpu_percent: Math.min(100, 40 + i * 0.4) }))
  const f = forecast(samples, 'cpu_percent', { horizon: 60, max: 100 })
  assert.equal(f.points.length, 60)
  assert.ok(f.at > 85 && f.at <= 100, `at ${f.at}`)
  assert.ok(f.hi <= 100 && f.lo >= 0)
  assert.ok(f.trendPerMin > 15 && f.trendPerMin < 30)
  assert.equal(forecast([{ x: 1 }], 'x'), null)
})
