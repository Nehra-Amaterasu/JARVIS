// Opens e2e/d03/rework.tsx in a Playwright page: built once in memory by Vite, served from a fake origin (nothing is written
// near app/ui/dist, no port is used). The query picks the entry, the width, the theme and the 1302 x 720 stage; see rework.tsx.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

let bundle: Promise<{ js: string; css: string }> | null = null
function buildRework() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/d03/rework.tsx'), formats: ['iife'], name: 'ReworkPage', fileName: 'rework' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the RD2 page build produced no script')
    return { js, css }
  })()
  return bundle
}

export async function openRework(page: Page, query: string) {
  const { js, css } = await buildRework()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RD2</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route('http://rd2.test/**', (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`http://rd2.test/?${query}`)
  await page.locator('[data-form]').first().waitFor()
  await page.waitForTimeout(500)
}
