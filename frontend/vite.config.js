import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, Vite proxies /api to the Node server; in production the Node server
// serves the built app itself (or set VITE_API_URL to host them separately).
// VITE_BASE (e.g. /v1/) builds the app for a versioned path; see scripts/build-site.mjs.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.BACKEND_URL || 'http://localhost:3000'
  return {
    base: env.VITE_BASE || '/',
    plugins: [react()],
    server: { proxy: { '/api': target } },
    build: { sourcemap: false },
  }
})
