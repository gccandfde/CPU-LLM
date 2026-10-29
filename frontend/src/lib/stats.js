// Small, dependency-free statistics for measured runs: noise bands,
// confidence intervals, least squares and a nearest-neighbour predictor.
// Everything takes plain arrays and returns plain numbers so it can run in
// the browser and in node tests alike.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

// Sample standard deviation (n − 1).
export function sd(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export function percentile(xs, p) {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
export const median = (xs) => percentile(xs, 0.5)

// Two-sided 95% t critical values for small samples; 1.96 beyond 30.
const T95 = { 2: 12.71, 3: 4.30, 4: 3.18, 5: 2.78, 6: 2.57, 7: 2.45, 8: 2.36, 9: 2.31, 10: 2.26, 15: 2.14, 20: 2.09, 30: 2.05 }
export function tCrit(n) {
  if (n <= 2) return T95[2]
  const keys = Object.keys(T95).map(Number)
  return T95[keys.find((k) => k >= n) ?? 30] ?? 1.96
}

// Mean with its 95% confidence half-width and relative spread.
export function summary(xs) {
  const m = mean(xs), s = sd(xs), n = xs.length
  const half = n > 1 ? tCrit(n) * s / Math.sqrt(n) : 0
  return { n, mean: m, sd: s, median: median(xs), min: Math.min(...xs), max: Math.max(...xs), ci95: half, cv_pct: m ? (s / m) * 100 : 0 }
}

// Is `b` different from `a` beyond their combined spread? A speedup inside
// the noise band is not a result; this is the same rule the agent applies.
export function significant(aRuns, bRuns, noisePct = 0) {
  const a = mean(aRuns), b = mean(bRuns)
  const band = Math.max(noisePct, sd(aRuns) / a * 100 || 0, sd(bRuns) / b * 100 || 0)
  return Math.abs(b / a - 1) * 100 > band
}

// Ordinary least squares y = slope·x + intercept with r².
export function ols(xs, ys) {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return { n, slope: 0, intercept: mean(ys) || 0, r2: 0, predict: () => mean(ys) || 0 }
  const mx = mean(xs), my = mean(ys)
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2 }
  const slope = sxx ? sxy / sxx : 0
  const intercept = my - slope * mx
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 0
  return { n, slope, intercept, r2, predict: (x) => slope * x + intercept }
}

export function pearson(xs, ys) {
  const { r2, slope } = ols(xs, ys)
  return Math.sign(slope) * Math.sqrt(r2)
}

// Mean absolute percentage error of predictions against measurements.
export function mape(pred, meas) {
  const pairs = pred.map((p, i) => [p, meas[i]]).filter(([, m]) => m)
  return pairs.length ? mean(pairs.map(([p, m]) => Math.abs(p - m) / m)) * 100 : NaN
}

// Distance-weighted k nearest neighbours over standardised features.
// points: [{ x: [f1, f2, …], y }]. Returns the prediction and the spread of
// the neighbours that produced it (a cheap uncertainty estimate).
export function knn(points, x, k = 3) {
  if (!points.length) return { y: NaN, spread: NaN, neighbours: [] }
  const dims = x.length
  const scale = Array.from({ length: dims }, (_, j) => sd(points.map((p) => p.x[j])) || 1)
  const ranked = points
    .map((p) => ({ ...p, d: Math.sqrt(p.x.reduce((a, v, j) => a + ((v - x[j]) / scale[j]) ** 2, 0)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
  const w = ranked.map((p) => 1 / (p.d + 1e-6))
  const y = ranked.reduce((a, p, i) => a + p.y * w[i], 0) / w.reduce((a, b) => a + b, 0)
  return { y, spread: sd(ranked.map((p) => p.y)), neighbours: ranked }
}

// Simple linear regression on log scale: y = a · x^b. Good for tok/s vs
// model bytes, which is a power law in a bandwidth-bound regime (b ≈ −1).
export function powerFit(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x > 0 && y > 0)
  const fit = ols(ok.map(([x]) => Math.log(x)), ok.map(([, y]) => Math.log(y)))
  return { ...fit, exponent: fit.slope, predict: (x) => Math.exp(fit.intercept) * x ** fit.slope }
}
