// Entry file for Hostinger (and local runs): node server/src/index.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'

const here = path.dirname(fileURLToPath(import.meta.url))

// The env vars below only seed a fresh DATA_DIR; afterwards the Admin tab
// owns these settings. ADMIN_PASSWORD_RESET is applied on every start (recovery).
const { app, settings } = createApp({
  dataDir: process.env.DATA_DIR || path.join(here, '..', 'data'),
  agentToken: process.env.AGENT_TOKEN,
  dashboardPassword: process.env.DASHBOARD_PASSWORD,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminPasswordReset: process.env.ADMIN_PASSWORD_RESET,
  staticDir: path.join(here, '..', '..', 'frontend', 'dist'),
  siteDir: path.join(here, '..', '..', 'site'),
})
if (!settings.adminConfigured) console.warn('No admin password: set ADMIN_PASSWORD to use the Admin tab')
if (process.env.ADMIN_PASSWORD_RESET) console.warn('ADMIN_PASSWORD_RESET is set: remove it once you have signed in')

const port = Number(process.env.PORT) || 3000
app.listen(port, () => console.log(`CPU-LLM server listening on :${port}`))
