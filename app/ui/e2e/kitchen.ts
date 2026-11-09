// The kitchen sink in a real browser (chunk 1b).
//
// The row for chunk 1b does not own a route file, so the sink is not served by the app. It is built in
// memory by Vite (a library build of src/ww/kit/_kitchen.tsx, nothing written to disk, nothing near
// app/ui/dist) and loaded into the same static page the chunk 1a lab uses: the flattened design CSS
// from fixtures.ts plus the kit's stylesheet plus the bundle. No server, no data, no network.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { designCss } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface Built {
  js: string
  css: string
}
let cached: Promise<Built> | null = null

/** One build per test run. */
export function buildKitchen(): Promise<Built> {
  cached ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      esbuild: { jsx: 'automatic' },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        write: false,
        minify: false,
        target: 'es2022',
        cssCodeSplit: false,
        lib: { entry: resolve(ROOT, 'src/ww/kit/_kitchen.tsx'), formats: ['iife'], name: 'WWKitchenBundle', fileName: 'kitchen' },
      },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the kitchen build produced no script')
    return { js, css }
  })()
  return cached
}

export interface KitchenOpts {
  /** attributes on <html>: data-theme ('paper' | 'indigo'; none is Ash), data-motion, data-motion-load */
  html?: Record<string, string>
  overlay?: 'drawer' | 'sheet' | 'popover' | 'toast'
}

/** Load the sink. Resolves when React has painted the first block. */
export async function openKitchen(page: Page, opts: KitchenOpts = {}): Promise<void> {
  const { js, css } = await buildKitchen()
  const attrs = Object.entries({ 'data-ww': '', 'data-motion': 'calm', ...opts.html })
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  // count requestAnimationFrame callbacks so the carcass spec can prove "0 callbacks at rest"
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__raf++
      return orig(cb)
    }
  })
  await page.goto('about:blank')
  await page.setContent(
    `<!doctype html><html ${attrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${designCss()}</style><style>${css}</style></head><body style="margin:0"><div id="root"></div></body></html>`,
  )
  await page.addScriptTag({ content: js })
  await page.evaluate((overlay) => (window as unknown as { WWKitchen: { mount(el: HTMLElement, o: object): void } }).WWKitchen.mount(document.getElementById('root')!, { overlay }), opts.overlay ?? null)
  await page.waitForSelector('[data-kitchen="Button"]')
}

export interface Box {
  w: number
  h: number
}

/**
 * The effective box of an element: probe elementFromPoint on a 2 px grid over it grown by 12 px each side
 * (the helper from chunk 1a's hit-areas.spec, tightened from 4 px so a 4 px gap between two controls is seen).
 */
export function effectiveBox(page: Page, selector: string, nth = 0): Promise<Box | null> {
  return page.evaluate(
    ([sel, n]) => {
      const el = document.querySelectorAll(sel as string)[n as number]
      if (!el) return null
      const r = el.getBoundingClientRect()
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let x = Math.max(0, r.left - 12); x <= r.right + 12; x += 2) {
        for (let y = Math.max(0, r.top - 12); y <= r.bottom + 12; y += 2) {
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === el || el.contains(hit))) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
          }
        }
      }
      return minX === Infinity ? null : { w: maxX - minX + 2, h: maxY - minY + 2 }
    },
    [selector, nth] as const,
  )
}
