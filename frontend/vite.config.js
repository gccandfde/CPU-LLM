import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, Vite proxies /api to the Node server; in production the Node server
// serves the built app itself (or set VITE_API_URL to host them separately).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.BACKEND_URL || 'http://localhost:3000'
  return {
    plugins: [react()],
    server: { proxy: { '/api': target } },
  }
})
