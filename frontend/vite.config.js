import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The frontend is a separate app; in dev it proxies /api to the backend.
// In production set VITE_API_URL to the backend's public URL instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.BACKEND_URL || 'http://localhost:8000'
  return {
    plugins: [react()],
    server: { proxy: { '/api': { target, ws: true } } },
  }
})
