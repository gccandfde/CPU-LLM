// Every app has its own data store. The first start stamps DATA_DIR as
// CPU-LLM's; any later start refuses to run on a folder stamped by, or
// holding the files of, another app, so data never mixes even if DATA_DIR is
// set wrong on the host where several apps live.
import fs from 'node:fs'
import path from 'node:path'

export const APP_ID = 'cpullm'
export const IDENTITY_FILE = 'app-identity.json'

// Everything CPU-LLM itself writes into DATA_DIR.
const OURS = [/^agents\.json$/, /^settings\.json$/, /^campaigns\.json$/, /^audit\.log$/, /^jobs$/, /^app-identity\.json$/, /^.*\.tmp$/]

export function claimDataDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const stampFile = path.join(dir, IDENTITY_FILE)
  if (fs.existsSync(stampFile)) {
    let owner = ''
    try { owner = JSON.parse(fs.readFileSync(stampFile, 'utf8')).app } catch {}
    if (owner !== APP_ID) throw new Error(`DATA_DIR ${dir} belongs to "${owner || 'an unknown app'}". CPU-LLM uses only its own data folder: set DATA_DIR to CPU-LLM's folder.`)
    return 'owned'
  }
  const foreign = fs.readdirSync(dir).filter((n) => !OURS.some((re) => re.test(n)))
  if (foreign.length) {
    throw new Error(`DATA_DIR ${dir} already holds another app's files (${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? '…' : ''}). Give CPU-LLM its own empty folder.`)
  }
  const agentsFile = path.join(dir, 'agents.json')
  if (fs.existsSync(agentsFile)) {
    let ok = false
    try {
      const agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'))
      ok = agents && typeof agents === 'object' && Object.values(agents).every((a) => a && typeof a.id === 'string' && 'hardware' in a)
    } catch {}
    if (!ok) throw new Error(`DATA_DIR ${dir} holds an agents.json that is not CPU-LLM's. Give CPU-LLM its own empty folder.`)
  }
  fs.writeFileSync(stampFile, JSON.stringify({ app: APP_ID, claimedAt: new Date().toISOString() }, null, 1))
  return 'claimed'
}
