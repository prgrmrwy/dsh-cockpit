import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function cockpitPort(): number {
  const configured = process.env.COCKPIT_PORT
  if (configured === undefined || configured.trim() === '') return 3090
  if (!/^\d+$/.test(configured.trim())) throw new Error(`invalid COCKPIT_PORT: ${configured}`)
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid COCKPIT_PORT: ${configured}`)
  return port
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${cockpitPort()}`, changeOrigin: false },
    },
  },
  build: { outDir: 'dist' },
})
