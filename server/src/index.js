// Entry file for Hostinger (and local runs): node server/src/index.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const { app } = createApp({
  dataDir: process.env.DATA_DIR || path.join(here, '..', 'data'),
  agentToken: process.env.AGENT_TOKEN,
  dashboardPassword: process.env.DASHBOARD_PASSWORD,
  staticDir: path.join(here, '..', '..', 'frontend', 'dist'),
})

const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`CPU-LLM server listening on :${port}`))
