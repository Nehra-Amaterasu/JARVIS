import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI is served by the JARVIS app server (app/jarvis_app) from dist/.
// During development, `npm run dev` proxies the API and both WebSockets to a
// server started with:  python -m jarvis_app.desktop --server-only --token dev
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8777', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8777', ws: true, changeOrigin: true },
    },
  },
})
