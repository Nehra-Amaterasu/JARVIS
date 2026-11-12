// Planned plates and the "What is coming" overlay in a real Chromium (spec 12.4, 12.5; A.B02).
//   - a plate carries no value and no toggle, is reachable by Tab, and is aria-disabled while staying focusable;
//   - activating a plate (Enter, Space, click) opens the overlay on that entry, one deep, and Esc returns focus;
//   - Tab and Shift+Tab never leave the overlay (the focus trap);
//   - a built-not-verified row shows the half disc and the words BUILT, NOT VERIFIED, a plain plate the dashed ring.
// The page is built in memory by Vite from the real shared/planned components and the real JARVIS registry
// (nothing is written near app/ui/dist) and served from a fake origin, so no server and no token are involved
// and port 8790 is only needed because the shared config starts the sandbox for every spec.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const URL_ = 'http://planned-lab.test/'

// A plain plate (jarvis.agents, not built) and a built-not-verified one (jarvis.library), the way a page mounts them.
const PLAIN = 'jarvis.agents'
const WAITING = 'jarvis.library'

const ENTRY = `
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlannedControl } from '${posix(resolve(ROOT, 'src/shared/planned/PlannedControl.tsx'))}'
import { setPlannedOpener } from '${posix(resolve(ROOT, 'src/shared/planned/open.ts'))}'
import { WhatIsComing } from '${posix(resolve(ROOT, 'src/shared/overlays/WhatIsComing.tsx'))}'
import { jarvisRegistry } from '${posix(resolve(ROOT, 'src/jarvis/planned.ts'))}'
const h = React.createElement
function Lab() {
  const [open, setOpen] = useState(null)
  useEffect(() => setPlannedOpener((id) => setOpen(id)), [])
  return h('div', { style: { padding: 24, display: 'grid', gap: 16, width: 420 } },
    h('button', { id: 'before', type: 'button' }, 'Before'),
    h(PlannedControl, { registry: jarvisRegistry, id: '${PLAIN}' }),
    h(PlannedControl, { registry: jarvisRegistry, id: '${WAITING}' }),
    h('button', { id: 'after', type: 'button' }, 'After'),
    open !== null && h(WhatIsComing, { registries: [jarvisRegistry], focusId: open, onClose: () => setOpen(null) }))
}
createRoot(document.getElementById('root')).render(h(Lab))
`

let bundle: Promise<{ js: string; css: string }> | null = null
function buildLab() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_planned-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'PlannedLab', fileName: 'planned' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the planned lab build produced no script')
    return { js, css }
  })()
  return bundle
}

async function openLab(page: Page) {
  const { js, css } = await buildLab()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  // The two tokens the plate CSS reads and the focus ring colour; the rest falls back inside planned.css.
  const tokens = ':root{--focus-ring:#1a73e8;--pl-ink:#444;--pl-edge:#888;color-scheme:light}'
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${tokens}</style><style>${css}</style></head><body style="margin:0;background:#fff"><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(URL_)
  await page.locator(`[data-planned="${PLAIN}"]`).waitFor()
}

const plate = (page: Page, id: string) => page.locator(`[data-planned="${id}"]`)

test.describe('planned plates', () => {
  test.beforeEach(async ({ page }) => {
    await openLab(page)
  })

  test('a plate holds no value and no toggle, and is not a switch, input, slider or meter', async ({ page }) => {
    for (const id of [PLAIN, WAITING]) {
      const p = plate(page, id)
      await expect(p).toHaveCount(1)
      await expect(p.locator('input, select, textarea, [role="switch"], [role="checkbox"], [role="slider"], [role="meter"], [role="progressbar"], [aria-checked], [aria-pressed], [aria-valuenow]')).toHaveCount(0)
      // No digit anywhere on it: a count on a planned thing reads as measured (T5).
      expect(await p.innerText(), id).not.toMatch(/\d/)
      await expect(p).not.toHaveAttribute('aria-checked', /.*/)
      await expect(p).not.toHaveAttribute('aria-pressed', /.*/)
    }
  })

  test('a plate is in the tab order, aria-disabled, and announces what it is', async ({ page }) => {
    await page.locator('#before').focus()
    for (const [id, name] of [[PLAIN, /not built yet/], [WAITING, /built, not verified yet/]] as const) {
      await page.keyboard.press('Tab')
      const p = plate(page, id)
      await expect(p, `Tab reaches ${id}`).toBeFocused()
      await expect(p).toHaveAttribute('aria-disabled', 'true')
      await expect(p).toHaveAttribute('aria-haspopup', 'dialog')
      await expect(p).toHaveAttribute('aria-label', name)
      // aria-disabled, never the disabled attribute, so it stays focusable (checked by the toBeFocused above).
      expect(await p.evaluate((el) => (el as HTMLButtonElement).disabled === true)).toBe(false)
    }
    await page.keyboard.press('Tab')
    await expect(page.locator('#after')).toBeFocused()
  })

  test('a built-not-verified row shows the half disc and WAITING wording; a plain plate the dashed ring', async ({ page }) => {
    const waiting = plate(page, WAITING)
    await expect(waiting).toHaveAttribute('data-state', 'unverified')
    await expect(waiting).toContainText('BUILT, NOT VERIFIED')
    // Two shapes, so greyscale tells them apart: the half disc is a filled path, the dashed ring has a dash array.
    await expect(waiting.locator('svg.pl-glyph path')).toHaveCount(1)
    await expect(waiting.locator('svg.pl-glyph circle[stroke-dasharray]')).toHaveCount(0)
    const plain = plate(page, PLAIN)
    await expect(plain).toHaveAttribute('data-state', 'planned')
    await expect(plain).toContainText('PLANNED')
    await expect(plain.locator('svg.pl-glyph path')).toHaveCount(0)
    await expect(plain.locator('svg.pl-glyph circle[stroke-dasharray]')).toHaveCount(1)
  })

  for (const how of ['click', 'Enter', 'Space'] as const) {
    test(`activating a plate by ${how} opens "What is coming" on that entry, and Esc returns focus to it`, async ({ page }) => {
      for (const id of [PLAIN, WAITING]) {
        const p = plate(page, id)
        // aria-disabled reads as not enabled to Playwright's actionability check; a person can still press it, so force.
        if (how === 'click') await p.click({ force: true })
        else {
          await p.focus()
          await page.keyboard.press(how === 'Enter' ? 'Enter' : ' ')
        }
        const overlay = page.locator('[data-overlay="roadmap"]')
        await expect(overlay).toBeVisible()
        await expect(overlay.getByRole('heading', { name: 'What is coming' })).toBeVisible()
        // The card is on THAT entry: exactly one row is marked, and it is the one that was pressed.
        await expect(overlay.locator('[data-focus="true"]')).toHaveCount(1)
        await expect(overlay.locator(`[data-coming-row="${id}"]`)).toHaveAttribute('data-focus', 'true')
        // One deep: the only control inside is Close, and focus starts there.
        await expect(overlay.locator('button, a, input, [role="button"]')).toHaveCount(1)
        await expect(overlay.getByRole('button', { name: 'Close' })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(overlay).toHaveCount(0)
        await expect(p, 'focus returns to the plate').toBeFocused()
      }
    })
  }

  test('the overlay is a dialog that traps focus: Tab and Shift+Tab stay on Close, and the page behind is not reached', async ({ page }) => {
    await plate(page, PLAIN).focus()
    await page.keyboard.press('Enter')
    const close = page.getByRole('button', { name: 'Close' })
    await expect(close).toBeFocused()
    const overlay = page.locator('[data-overlay="roadmap"]')
    await expect(overlay).toHaveAttribute('role', 'dialog')
    await expect(overlay).toHaveAttribute('aria-modal', 'true')
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press(i % 2 === 0 ? 'Tab' : 'Shift+Tab')
      expect(await overlay.evaluate((el) => el.contains(document.activeElement)), `press ${i + 1} stays inside`).toBe(true)
    }
    await expect(close).toBeFocused()
    // Pull focus out by script, as a click on the page behind would, and the next Tab brings it back in.
    await page.evaluate(() => (document.getElementById('after') as HTMLElement).focus())
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    // Close by button returns focus to the plate.
    await close.press('Enter')
    await expect(plate(page, PLAIN)).toBeFocused()
  })

  test('Alt+Left also closes the overlay', async ({ page }) => {
    await plate(page, WAITING).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-overlay="roadmap"]')).toBeVisible()
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(page.locator('[data-overlay="roadmap"]')).toHaveCount(0)
    await expect(plate(page, WAITING)).toBeFocused()
  })
})
