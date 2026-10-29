import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mean, sd, median, summary, significant, ols, knn, powerFit, mape } from './stats.js'

test('mean, sd, median and summary', () => {
  const xs = [10, 12, 11, 13, 14]
  assert.equal(mean(xs), 12)
  assert.equal(median(xs), 12)
  assert.ok(Math.abs(sd(xs) - 1.5811) < 1e-3)
  const s = summary(xs)
  assert.equal(s.n, 5)
  assert.ok(s.ci95 > 0 && s.cv_pct > 10)
})

test('significance respects the noise band', () => {
  assert.ok(!significant([100, 102], [104, 103], 5))
  assert.ok(significant([100, 102], [130, 131], 5))
})

test('ols fits a line and knn interpolates', () => {
  const f = ols([1, 2, 3, 4], [2, 4, 6, 8])
  assert.ok(Math.abs(f.slope - 2) < 1e-9 && Math.abs(f.r2 - 1) < 1e-9)
  const k = knn([{ x: [1, 1], y: 10 }, { x: [2, 2], y: 20 }, { x: [10, 10], y: 100 }], [1.5, 1.5], 2)
  assert.ok(k.y > 10 && k.y < 20)
})

test('power fit recovers a bandwidth-bound exponent of -1', () => {
  const bytes = [1e9, 2e9, 4e9, 8e9]
  const f = powerFit(bytes, bytes.map((b) => 40e9 / b))
  assert.ok(Math.abs(f.exponent + 1) < 1e-9)
  assert.ok(mape([1, 2], [1, 4]) === 25)
})
