import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The UI is served by the JARVIS app server (app/jarvis_app) from dist/.
// During development, `npm run dev` proxies the API and both WebSockets to a
// server started with:  python -m jarvis_app.desktop --server-only --token dev
//
// WW_API_TARGET (Well Wisher tests): the proxy target, default unchanged (the live app on 8777).
// The Playwright config sets it to the sandbox on 8790 so a test run can never reach the real app.
const API_TARGET = process.env.WW_API_TARGET ?? 'http://127.0.0.1:8777'
const WS_TARGET = API_TARGET.replace(/^http/, 'ws')

// Writes the id of every module that reached the bundle to product-modules.json, next to index.html.
// scripts/bundle-budget.mjs reads it to prove a VITE_PRODUCT build holds none of the other product's
// modules; a string search over minified chunks could not tell a module from a word that happens to match.
const moduleList = (): Plugin => ({
  name: 'product-module-list',
  apply: 'build',
  generateBundle(_o, bundle) {
    const ids = new Set<string>()
    for (const c of Object.values(bundle)) if (c.type === 'chunk') for (const id of Object.keys(c.modules)) ids.add(id.split(String.fromCharCode(92)).join('/'))
    this.emitFile({ type: 'asset', fileName: 'product-modules.json', source: JSON.stringify({ product: process.env.VITE_PRODUCT ?? 'both', modules: [...ids].sort() }) })
  },
})

// App.tsx imports CorePage statically (it is the entry chunk), and a static import of a module the bundler
// cannot prove side-effect free is kept even when the `import.meta.env.VITE_PRODUCT !== 'ww'` test in front of
// its only use has folded to false. For the ww build the JARVIS-only trees are therefore declared pure, so an
// unused import of them is dropped; a module that IS used (a lazy page, which the ww build has none of) is unaffected.
const jarvisOnly = (id: string) => /\/src\/(pages|galaxy|twin|components\/(Reactor|MediaCard|Staff))\//.test(id.split(String.fromCharCode(92)).join('/'))

export default defineConfig({
  plugins: [react(), moduleList()],
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    sourcemap: false,
    rollupOptions: process.env.VITE_PRODUCT === 'ww' ? { treeshake: { moduleSideEffects: (id: string) => !jarvisOnly(id) } } : {},
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: WS_TARGET, ws: true, changeOrigin: true },
    },
  },
})
