import React from 'react'

export default function HardwareCard({ hw }) {
  if (!hw) return <section className="card"><h2>Hardware</h2><p className="muted">Profiling…</p></section>
  const isa = Object.entries(hw.isa || {})
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
        <dt>Energy</dt><dd>{hw.energy_counters ? 'RAPL counters available (J/token measured)' : 'No RAPL counters (VM or no permission)'}</dd>
        <dt>OS</dt><dd>{hw.os} · torch {hw.torch?.version}</dd>
      </dl>
      <div className="chips">
        {isa.map(([k, on]) => <span key={k} className={`chip ${on ? 'on' : ''}`}>{k}</span>)}
      </div>
      {hw.gpus?.length > 0 && (
        <>
          <h3 className="mt">GPUs</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Runtime</th><th>Memory GB</th><th>CUs/SMs</th><th>Bandwidth GB/s</th></tr></thead>
              <tbody>
                {hw.gpus.map((g) => (
                  <tr key={g.index}><td>{g.index}</td><td>{g.name}</td><td>{g.runtime}</td><td>{g.memory_gb}</td><td>{g.compute_units}</td><td>{g.memory_bandwidth_gbs}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
