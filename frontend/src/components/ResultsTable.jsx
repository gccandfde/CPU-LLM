import React from 'react'
import { mb, num, pct } from '../lib/format.js'

export default function ResultsTable({ rows, baseline, best }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Config</th><th>tok/s</th><th>Speedup</th><th>TTFT ms</th><th>Perplexity</th><th>Δ ppl %</th>
            <th>Task acc</th><th>Agreement</th><th>Size MB</th><th>J/token</th><th>RSS GB</th>
          </tr>
        </thead>
        <tbody>
          {baseline && (
            <tr className="muted">
              <td>baseline/fp32</td><td>{baseline.decode_tps}</td><td>1.0×</td><td>{baseline.ttft_ms}</td>
              <td>{baseline.perplexity}</td><td>0</td><td>{pct(baseline.eval?.accuracy)}</td><td>1.0</td>
              <td>{mb(baseline.model_bytes)}</td><td>{num(baseline.joules_per_token, 3)}</td><td>{baseline.rss_gb}</td>
            </tr>
          )}
          {rows.map((r) =>
            r.error ? (
              <tr key={r.name} className="over"><td>{r.name}</td><td colSpan={10} className="error left">{r.error}</td></tr>
            ) : (
              <tr key={r.name} className={r.name === best ? 'best' : r.within_budget ? '' : 'over'}>
                <td>{r.name}{r.name === best && ' ★'}</td>
                <td>{r.decode_tps}</td>
                <td title={r.significant === false ? 'Within run-to-run noise' : ''}>{r.speedup}×{r.significant === false && <sup className="muted"> ~</sup>}</td>
                <td>{r.ttft_ms}</td><td>{r.perplexity}</td><td>{r.ppl_increase_pct}</td>
                <td>{pct(r.eval?.accuracy)}</td><td>{r.token_agreement}</td><td>{mb(r.model_bytes)}</td>
                <td>{num(r.joules_per_token, 3)}</td><td>{r.rss_gb}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p className="muted small">★ selected · grey rows exceed the accuracy budget · ~ speedup is within run-to-run noise</p>
    </div>
  )
}
