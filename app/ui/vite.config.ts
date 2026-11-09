import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The UI is served by the JARVIS app server (app/jarvis_app) from dist/.
// During development, `npm run dev` proxies the API and both WebSockets to a
// server started with:  python -m jarvis_app.desktop --server-only --token dev
//
// WW_API_TARGET (Well Wisher tests): the proxy target, default unchanged (the live app on 8777).
// The Playwright config sets it to the sandbox on 8790 so a test run can never reach the real app.
const API_TARGET = process.env.WW_API_TARGET ?? 'http://127.0.0.1:8777'
const WS_TARGET = API_TARGET.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: WS_TARGET, ws: true, changeOrigin: true },
    },
  },
})
