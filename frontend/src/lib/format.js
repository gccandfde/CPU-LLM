export const pct = (x, digits = 0) => (x == null ? 'n/a' : `${(x * 100).toFixed(digits)}%`)
export const num = (x, digits = 1) => (x == null ? 'n/a' : Number(x).toFixed(digits))
export const mb = (bytes) => (bytes == null ? 'n/a' : (bytes / 1e6).toFixed(1))
export const ago = (ts) => {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString()
}
export const transformLabel = (t) => {
  if (t.op === 'prune_layers') return `prune ${t.drop.length} layers`
  if (t.op === 'cast') return t.dtype
  if (t.op === 'quantize_dynamic') return 'int8 dynamic'
  if (t.op === 'quantize_weight_only') return `int${t.bits} weight-only`
  if (t.op === 'compile') return 'torch.compile'
  return t.op
}
