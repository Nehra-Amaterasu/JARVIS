// B03: the clay roles under forced-colors: active (spec 6.5.1), in a real Chromium.
// The clay entry is not imported by the app yet, so this spec inlines the real files (imports resolved
// in order) into a blank page; nothing here touches the sandbox or the built UI.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const CLAY = resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/design/clay')

/** Inline @import 'x' chains, depth first, relative to each file. */
function inline(file: string): string {
  const css = readFileSync(file, 'utf8')
  const dir = dirname(file)
  return css.replace(/@import\s+'([^']+)'\s*;/g, (_m, p: string) => inline(resolve(dir, p)))
}

const BODY = `
<div data-section="focus" style="padding:16px;background:var(--surface-ground);color:var(--ink-1)">
  <p id="ink" style="color:var(--ink-1)">text</p>
  <button id="sel" style="background:var(--selected-fill);color:var(--selected-ink);border:2px solid var(--edge-ui)">Selected</button>
  <button id="plain" style="outline:2px solid var(--focus-ring)">Plain</button>
  <div id="scene" data-scene="immersive" style="background:var(--surface-ground)">scene</div>
</div>`

async function open(page: import('@playwright/test').Page, theme: string) {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.setContent(
    `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${inline(resolve(CLAY, 'index.css'))}</style></head><body style="margin:0">${BODY}</body></html>`,
  )
}

for (const theme of ['clay-light', 'clay-dark']) {
  test.describe(theme, () => {
    test('forced colours is reported and the roles resolve to system colours, not hues', async ({ page }) => {
      await open(page, theme)
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
      const r = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement)
        const sc = getComputedStyle(document.getElementById('scene')!)
        return {
          ink: cs.getPropertyValue('--ink-1').trim(),
          edge: cs.getPropertyValue('--edge-ui').trim(),
          sel: cs.getPropertyValue('--selected-fill').trim(),
          ring: cs.getPropertyValue('--focus-ring').trim(),
          fault: cs.getPropertyValue('--state-fault').trim(),
          measured: cs.getPropertyValue('--state-measured').trim(),
          raised: cs.getPropertyValue('--elev-raised').trim(),
          sceneGround: sc.getPropertyValue('--surface-ground').trim(),
        }
      })
      expect(r.ink).toBe('CanvasText')
      expect(r.edge).toBe('CanvasText')
      expect(r.sel).toBe('Highlight')
      expect(r.ring).toBe('Highlight')
      // meaning is in shape and words: fault and measured must not differ by colour
      expect(r.fault).toBe(r.measured)
      expect(r.raised).toBe('none')
      // the immersive scene stops being charcoal
      expect(r.sceneGround).toBe('Canvas')
    })

    test('selection renders as Highlight and keeps its border', async ({ page }) => {
      await open(page, theme)
      const s = await page.evaluate(() => {
        const cs = getComputedStyle(document.getElementById('sel')!)
        return { bw: cs.borderTopWidth, bs: cs.borderTopStyle }
      })
      expect(s.bs).toBe('solid')
      expect(s.bw).toBe('2px')
    })
  })
}
