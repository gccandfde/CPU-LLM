// Design library shared by the v2 tabs: reference parts, connected machines
// as measured designs, designs saved in this browser, and the calibration
// the Insights tab derives from measured runs.
import { DESIGNS, CHANNEL_GBS, DEFAULT_WORKLOAD } from './archmodel.js'

const STORE_KEY = 'cpullm.designer.designs'
const CAL_KEY = 'cpullm.calibration'

export function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || [] } catch { return [] } }
export function saveSaved(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)) } catch { /* private mode */ } }
export function loadCalibration() { try { return JSON.parse(localStorage.getItem(CAL_KEY)) } catch { return null } }
export function saveCalibration(c) { try { if (c) localStorage.setItem(CAL_KEY, JSON.stringify(c)); else localStorage.removeItem(CAL_KEY) } catch { /* private mode */ } }

// A connected machine's measured profile as a starting design. Unknown
// fields (clock, fabric, power) get defaults; channels are inferred from the
// measured bandwidth so the model reproduces what was measured.
export function designFromAgent(a) {
  const hw = a.hardware || {}
  const isa = hw.isa || {}
  const cacheMb = (level) => {
    const c = (hw.caches || []).find((x) => x.level === level)
    if (!c) return null
    const m = /^(\d+)\s*([KM])/i.exec(c.size || '')
    return m ? Number(m[1]) / (m[2].toUpperCase() === 'K' ? 1024 : 1) : null
  }
  const physical = hw.physical_cores || hw.logical_cores || 8
  const nodes = Math.max(1, (hw.numa_nodes || []).length || 1)
  const measured = hw.memory_bandwidth_gbs || 40
  return {
    id: `machine-${a.id}`, name: `${a.name} (measured)`, fromMachine: true, agentId: a.id, measuredGbs: hw.memory_bandwidth_gbs || null,
    dies: nodes, coresPerDie: Math.max(1, Math.round(physical / nodes)), smt: Math.max(1, Math.round((hw.logical_cores || physical) / physical)),
    clockGhz: 3.5, fmaUnits: 1, fmaWidthBits: isa.avx512f ? 512 : 256,
    isa: { bf16: !!(isa.avx512_bf16 || isa.amx_bf16), vnni: !!(isa.avx512_vnni || isa.avx_vnni || isa.amx_int8), amx: !!isa.amx_tile },
    l1dKb: cacheMb(1) ? cacheMb(1) * 1024 : 32, l2Kb: cacheMb(2) ? cacheMb(2) * 1024 : 1024, l3MbPerDie: cacheMb(3) || 16, l3Gbs: 600,
    numaNodes: nodes, channelsPerNode: Math.max(1, Math.round(measured / DEFAULT_WORKLOAD.efficiency.bw / CHANNEL_GBS['DDR5-5600'] / nodes)), channel: 'DDR5-5600',
    capacityGbPerNode: Math.max(8, Math.round((hw.memory_total_gb || 32) / nodes)), fabricGbs: 64, fabricNs: 90, idleW: 20, tdpW: 120,
  }
}

export function library(agents, saved) {
  return [...DESIGNS, ...(agents || []).map(designFromAgent), ...(saved || [])]
}

// Workload defaults, with the calibrated bandwidth efficiency when the
// Insights tab has derived one from measured runs.
export function defaultWorkload() {
  const cal = loadCalibration()
  const efficiency = { ...DEFAULT_WORKLOAD.efficiency, ...(cal?.bw ? { bw: cal.bw } : {}) }
  return { precision: 'bf16', kvBytes: 2, batch: 1, context: 2048, prompt: 512, pinning: 'local', threadsPerCore: 1, efficiency }
}
