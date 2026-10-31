import React from 'react'

export default function HardwareCard({ hw }) {
  if (!hw) return <section className="card"><h2>Hardware</h2><p className="muted">Profiling…</p></section>
  const isa = Object.entries(hw.isa || {})
  const gpus = hw.gpus || []
  const driverOnly = gpus.filter((g) => g.torch_visible === false)
  const windows = /windows/i.test(hw.os || '')
  return (
    <section className="card">
      <h2>Hardware</h2>
      <dl className="kv">
        <dt>CPU</dt><dd>{hw.model_name}</dd>
        <dt>Cores</dt><dd>{hw.physical_cores} physical / {hw.logical_cores} logical</dd>
        <dt>Memory</dt><dd>{hw.memory_total_gb} GB · ~{hw.memory_bandwidth_gbs} GB/s measured</dd>
        <dt>NUMA</dt><dd>{hw.numa_nodes?.length || 1} node(s)</dd>
        <dt>Caches</dt><dd>{hw.caches?.map((c) => `L${c.level}${c.type === 'Data' ? 'd' : c.type === 'Instruction' ? 'i' : ''} ${c.size}`).join(' · ') || 'n/a'}</dd>
        <dt>Kernel ISA</dt><dd>{hw.torch?.cpu_capability}</dd>
        <dt>GPU</dt><dd>{gpus.length ? `${gpus.length} (${gpus.length - driverOnly.length} usable by PyTorch)` : 'none detected'}</dd>
        <dt>Energy</dt><dd>{hw.energy_counters ? 'RAPL counters available (J/token measured)' : 'No RAPL counters (VM or no permission)'}{gpus.length ? ' · GPU board power from the driver' : ''}</dd>
        <dt>OS</dt><dd>{hw.os} · torch {hw.torch?.version}</dd>
      </dl>
      <div className="chips">
        {isa.map(([k, on]) => <span key={k} className={`chip ${on ? 'on' : ''}`}>{k}</span>)}
      </div>
      {gpus.length > 0 && (
        <>
          <h3 className="mt">GPUs</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Runtime</th><th>Memory GB</th><th>CUs/SMs</th><th>Bandwidth GB/s</th><th>Power limit W</th><th>Usable</th></tr></thead>
              <tbody>
                {gpus.map((g) => (
                  <tr key={g.index}><td>{g.index}</td><td>{g.name}</td><td>{g.runtime}</td><td>{g.memory_gb}</td><td>{g.compute_units ?? '—'}</td><td>{g.memory_bandwidth_gbs ?? '—'}</td><td>{g.power_limit_w != null ? `${g.power_limit_w}${g.power_max_limit_w ? ` / ${g.power_max_limit_w}` : ''}` : '—'}</td><td>{g.torch_visible === false ? <span className="warn-text">driver only</span> : <span className="ok">✓ runs, benchmarks, power</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {driverOnly.length > 0 && (
            <p className="warn-text small">The driver sees {driverOnly.length === 1 ? 'this GPU' : 'these GPUs'} but the installed PyTorch is the CPU build. Re-run the installer on the machine with {windows ? <code>$env:CPULLM_DEVICE='cuda'</code> : <code>CPULLM_DEVICE=cuda</code>} to enable GPU runs (installs the CUDA build, a few GB). <a href="/docs/gpu/">GPU guide</a>.</p>
          )}
        </>
      )}
    </section>
  )
}
