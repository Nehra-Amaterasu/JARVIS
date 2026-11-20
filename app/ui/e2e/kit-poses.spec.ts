// KIT1: the interaction language of the shared kit, measured in a real Chromium.
//
// The page is built in memory by Vite from the real pose gallery entry (src/gallery/entries/kit-poses.tsx), the real clay token files
// and the real kit stylesheet and NOTHING ELSE: no ww/design or ww/kit sheet is loaded. That is a JARVIS page's situation (gap row 31:
// the kit's Button, Chip, Field and Fold used to be sized there by a private block), so every size measured here comes from the shared
// sheet alone, on the light and on the dark ground. Nothing is written near app/ui/dist and no server, token or port is used.
//
// Proved: the gallery draws every cell (11 pieces x 7 poses, twice) and every cell carries data-demo; no interactive target is under 44 x 44
// CSS px; the pieces are laid out from the shared sheet (inline-flex buttons, a field with its label above); Segmented: a drag from
// option 1 to option 3 ends with option 3 checked, the thumb settles inside 240 ms with at most one overshoot after a key, a click and a
// drag release, the first movement starts inside 100 ms, reduced motion jumps; hover, focus and checked are three different pictures;
// the Switch thumb settles inside 240 ms and its word lands after it.
// Screenshots for the jury go to KIT_SHOTS (default: a folder under the OS temp directory, never the repository).
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.KIT_SHOTS ? resolve(process.env.KIT_SHOTS) : resolve(tmpdir(), 'jarvis-kit1-shots')
const WORK = resolve(ROOT, 'test-results', 'kit-poses')
const URL_ = 'http://kit-poses.test/'
const FONTS = `html{--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const POSES = ['rest', 'hover', 'pressed', 'focus', 'checked', 'disabled', 'loading']
const PIECES = ['Button', 'Button primary', 'Chip', 'Field', 'Switch', 'Rocker', 'Key', 'Segmented', 'HoldButton', 'Popover', 'Drawer']
/** Record a measurement on the test and print it, so the numbers reach the report and the log. */
const note = (a: { type: string; description: string }) => {
  test.info().annotations.push(a)
  console.log(`MEASURED ${a.type}: ${a.description}`)
}
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')

let bundle: Promise<{ js: string; css: string }> | null = null
function buildPage() {
  bundle ??= (async () => {
    mkdirSync(WORK, { recursive: true })
    const main = resolve(WORK, 'main.ts')
    writeFileSync(
      main,
      [
        `import ${JSON.stringify(posix(resolve(ROOT, 'src/styles/design/clay/index.css')))}`,
        `import { createElement } from 'react'`,
        `import { createRoot } from 'react-dom/client'`,
        `import entries from ${JSON.stringify(posix(resolve(ROOT, 'src/gallery/entries/kit-poses')))}`,
        `createRoot(document.getElementById('root')!).render(entries[0].states[0].node as never)`,
        `void createElement`,
      ].join(String.fromCharCode(10)) + String.fromCharCode(10),
    )
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: main, formats: ['iife'], name: 'KitPoses', fileName: 'poses' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the pose page produced no script')
    return { js, css }
  })()
  return bundle
}

async function open(page: Page, theme: 'light' | 'dark') {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kit poses</title><style>${FONTS}body{margin:0;padding:16px;background:var(--surface-ground);color:var(--ink-1)}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}`)
  await page.locator('[data-pose-grid]').first().waitFor()
  await page.waitForTimeout(400) // fonts and the first layout settle before anything is measured
}

const shot = async (loc: Locator, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  await loc.screenshot({ path: resolve(SHOTS, name) })
}

/** What one travel of a thumb looked like frame by frame: when it started, when it was at rest, how far it overshot and how often it crossed. */
interface Travel {
  start: number | null
  settle: number
  overshootPx: number
  crossings: number
  from: number
  to: number
  moving: boolean
}
/** Arm a per-frame recorder on `thumbSel`, run `act` (which must fire `mark` events), and read the record back. */
async function travel(page: Page, thumbSel: string, markEvent: 'keydown' | 'click' | 'pointerup', act: () => Promise<void>): Promise<Travel> {
  await page.evaluate(
    ({ sel, ev }) => {
      const thumb = document.querySelector(sel) as HTMLElement
      const w = window as unknown as { __rec: { t0: number; first: number; samples: { t: number; x: number }[]; sawMoving: boolean } }
      w.__rec = { t0: 0, first: 0, samples: [], sawMoving: false }
      document.addEventListener(ev, () => (w.__rec.t0 ||= performance.now()), { capture: true, once: true })
      const t00 = performance.now()
      const tick = () => {
        const now = performance.now()
        w.__rec.samples.push({ t: now, x: thumb.getBoundingClientRect().left })
        if (thumb.getAttribute('data-moving') === 'true') w.__rec.sawMoving = true
        if (now - t00 < 1500) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { sel: thumbSel, ev: markEvent },
  )
  await act()
  await page.waitForTimeout(1200)
  return page.evaluate(() => {
    const r = (window as unknown as { __rec: { t0: number; samples: { t: number; x: number }[]; sawMoving: boolean } }).__rec
    const after = r.samples.filter((s) => s.t >= r.t0 - 1)
    const from = after[0]?.x ?? 0
    const to = r.samples[r.samples.length - 1].x
    const dir = Math.sign(to - from) || 1
    let start: number | null = null
    let lastOff = r.t0
    let over = 0
    let crossings = 0
    let side = 0
    for (const s of after) {
      if (start === null && Math.abs(s.x - from) > 0.5) start = s.t - r.t0
      if (Math.abs(s.x - to) > 0.5) lastOff = s.t
      over = Math.max(over, (s.x - to) * dir)
      const d = s.x - to
      const sd = Math.abs(d) < 0.25 ? 0 : Math.sign(d)
      if (sd !== 0 && side !== 0 && sd !== side) crossings++
      if (sd !== 0) side = sd
    }
    return { start, settle: lastOff - r.t0, overshootPx: over, crossings, from, to, moving: r.sawMoving }
  })
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the pose gallery, ${theme} theme`, () => {
    test('draws every cell, and every cell carries data-demo', async ({ page }) => {
      await open(page, theme)
      const grids = page.locator('[data-pose-grid]')
      await expect(grids).toHaveCount(2)
      const cells = page.locator('[data-pose-cell]')
      expect(await cells.count()).toBe(2 * PIECES.length * POSES.length)
      for (const g of ['page', 'dark']) {
        const grid = page.locator(`[data-pose-grid="${g}"]`)
        for (const piece of PIECES) {
          for (const pose of POSES) {
            const cell = grid.locator(`[data-pose-cell="${piece}/${pose}"]`)
            await expect(cell, `${g} ${piece} ${pose}`).toHaveCount(1)
            await expect(cell).toHaveAttribute('data-demo', pose)
            const na = (await cell.getAttribute('data-na')) === 'true'
            if (na) expect((await cell.innerText()).trim().length, `${piece}/${pose} says why it is n/a`).toBeGreaterThan(10)
            else expect(await cell.locator(':scope > :not([data-cap])').count(), `${piece}/${pose} draws a piece`).toBeGreaterThan(0)
          }
        }
      }
      await shot(grids.nth(0), `poses-${theme}-page.png`)
      await shot(grids.nth(1), `poses-${theme}-dark-scene.png`)
    })

    test('no interactive target is under 44 x 44 px, and the sizes come from the shared sheet alone', async ({ page }) => {
      await open(page, theme)
      const r = await page.evaluate(() => {
        const sel = 'button, input:not([type=hidden]), select, textarea, [role=switch], [role=radio], a[href]'
        const small: string[] = []
        let n = 0
        let min = Infinity
        for (const el of document.querySelectorAll<HTMLElement>(`[data-pose-grid] ${sel.split(', ').join(', [data-pose-grid] ')}`)) {
          // layout size, not the painted box: a pressed pose is drawn at 98 percent, and the target is the layout box
          const b = { width: el.offsetWidth, height: el.offsetHeight }
          if (b.width === 0 || b.height === 0) continue
          n++
          min = Math.min(min, b.width, b.height)
          if (b.width < 43.5 || b.height < 43.5) small.push(`${el.className || el.tagName} ${b.width.toFixed(1)}x${b.height.toFixed(1)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 16)}"`)
        }
        const btn = document.querySelector('.ww-btn') as HTMLElement
        const field = document.querySelector('.ww-field') as HTMLElement
        const input = document.querySelector('.ww-input') as HTMLElement
        const chip = document.querySelector('button.ww-chip') as HTMLElement
        const cs = (e: HTMLElement) => getComputedStyle(e)
        return {
          n,
          min,
          small,
          btnDisplay: cs(btn).display,
          btnH: btn.offsetHeight,
          fieldDisplay: cs(field).display,
          inputH: input.offsetHeight,
          chipDisplay: cs(chip).display,
          chipH: chip.offsetHeight,
        }
      })
      expect(r.n).toBeGreaterThan(100)
      expect(r.small, 'targets under 44 x 44').toEqual([])
      expect(r.min).toBeGreaterThanOrEqual(43.5)
      // laid out by the kit sheet, with no Well Wisher stylesheet in the page
      expect(r.btnDisplay).toBe('inline-flex')
      expect(r.btnH).toBeGreaterThanOrEqual(43.5)
      expect(r.fieldDisplay).toBe('grid')
      expect(r.inputH).toBeGreaterThanOrEqual(43.5)
      // a control chip sits in its one stable wrapper (an inline-flex box), which blockifies the chip's own inline-flex to flex: both are the sheet's flex layout
      expect(['inline-flex', 'flex']).toContain(r.chipDisplay)
      expect(r.chipH).toBeGreaterThanOrEqual(43.5)
      note({ type: 'targets', description: `${r.n} targets, smallest side ${r.min.toFixed(1)} px` })
    })

    test('hover, focus and checked are three different pictures; the still hover is the live hover', async ({ page }) => {
      await open(page, theme)
      const grid = page.locator('[data-pose-grid="page"]')
      const style = (loc: Locator) =>
        loc.evaluate((el) => {
          const c = getComputedStyle(el)
          return { bg: c.backgroundColor, outline: c.outlineStyle + ' ' + c.outlineWidth, shadow: c.boxShadow, transform: c.transform }
        })
      const hovered = await style(grid.locator('[data-pose-cell="Segmented/hover"] .ww-seg-opt[data-demo="hover"]'))
      const focused = await style(grid.locator('[data-pose-cell="Segmented/focus"] .ww-seg-opt[data-demo="focus"]'))
      const checked = await style(grid.locator('[data-pose-cell="Segmented/checked"] .ww-seg-opt[aria-checked="true"]'))
      const plain = await style(grid.locator('[data-pose-cell="Segmented/rest"] .ww-seg-opt[aria-checked="false"]').first())
      expect(focused.outline, 'focus is the 2 px ring').toContain('2px')
      expect(hovered.outline, 'hover has no ring').not.toContain('2px')
      expect(checked.outline).not.toContain('2px')
      expect(new Set([hovered.bg, checked.bg]).size, 'hover is not the checked fill').toBe(2)
      expect(hovered.bg, 'hover is a lit face, not the bare channel').not.toBe(plain.bg)
      expect(hovered.transform, 'hover lifts').not.toBe('none')
      expect(focused.transform, 'focus does not move').toBe(plain.transform)
      // the still pose and the real pointer paint the same face
      const live = grid.locator('[data-pose-cell="Segmented/rest"] .ww-seg-opt[aria-checked="false"]').first()
      await live.hover()
      await page.waitForTimeout(250)
      const liveStyle = await style(live)
      expect(liveStyle.bg).toBe(hovered.bg)
      expect(liveStyle.shadow).toBe(hovered.shadow)
    })

    test('the Segmented thumb: a drag from option 1 to option 3 checks option 3, and it settles inside 240 ms', async ({ page }) => {
      await open(page, theme)
      const group = page.locator('[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] [role=radiogroup]')
      const opts = group.getByRole('radio')
      await expect(opts).toHaveCount(3)
      await expect(opts.nth(0)).toHaveAttribute('aria-checked', 'true')
      await expect(group).toHaveAttribute('data-thumb', 'on')
      await group.scrollIntoViewIfNeeded() // the mouse works in viewport coordinates
      const a = (await opts.nth(0).boundingBox())!
      const c = (await opts.nth(2).boundingBox())!
      const thumbSel = '[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] .ww-seg-thumb'
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 })
      await expect(group).toHaveAttribute('data-dragging', 'true')
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 12 })
      // while carried, the thumb is under the pointer and drawn
      const carried = await page.evaluate((sel) => {
        const t = document.querySelector(sel) as HTMLElement
        return { drag: t.getAttribute('data-drag'), opacity: getComputedStyle(t).opacity }
      }, thumbSel)
      expect(carried).toEqual({ drag: 'true', opacity: '1' })
      const t = await travel(page, thumbSel, 'pointerup', async () => {
        await page.mouse.up()
      })
      await expect(opts.nth(2)).toHaveAttribute('aria-checked', 'true')
      await expect(opts.nth(0)).toHaveAttribute('aria-checked', 'false')
      await expect(group).not.toHaveAttribute('data-dragging', 'true')
      expect(t.settle, 'release to rest').toBeLessThanOrEqual(240)
      expect(t.crossings, 'at most one overshoot').toBeLessThanOrEqual(1)
      note({ type: 'drag release', description: `settle ${t.settle.toFixed(0)} ms, overshoot ${t.overshootPx.toFixed(2)} px, crossings ${t.crossings}` })
      await shot(group, `segmented-${theme}-after-drag.png`)
    })

    test('a key press and a click move the same thumb: first movement under 100 ms, at rest under 240 ms, one overshoot at most', async ({ page }) => {
      await open(page, theme)
      const group = page.locator('[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] [role=radiogroup]')
      const opts = group.getByRole('radio')
      const thumbSel = '[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] .ww-seg-thumb'
      await opts.nth(0).focus()
      const key = await travel(page, thumbSel, 'keydown', async () => {
        await page.keyboard.press('ArrowRight')
      })
      await expect(opts.nth(1)).toHaveAttribute('aria-checked', 'true')
      expect(key.moving, 'the thumb was drawn while it travelled').toBe(true)
      expect(key.start, 'first movement').not.toBeNull()
      expect(key.start!, 'feedback inside 100 ms').toBeLessThanOrEqual(100)
      expect(key.settle, 'key: at rest').toBeLessThanOrEqual(240)
      expect(key.crossings).toBeLessThanOrEqual(1)
      const click = await travel(page, thumbSel, 'click', async () => {
        await opts.nth(2).click()
      })
      await expect(opts.nth(2)).toHaveAttribute('aria-checked', 'true')
      expect(click.settle, 'click: at rest').toBeLessThanOrEqual(240)
      expect(click.crossings).toBeLessThanOrEqual(1)
      // nothing keeps moving afterwards (principle 5: nothing after 400 ms)
      const idle = await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).getAnimations().length, thumbSel)
      expect(idle).toBe(0)
      note({
        type: 'thumb travel',
        description: `key: start ${key.start!.toFixed(0)} ms, settle ${key.settle.toFixed(0)} ms, overshoot ${key.overshootPx.toFixed(2)} px; click: settle ${click.settle.toFixed(0)} ms, overshoot ${click.overshootPx.toFixed(2)} px`,
      })
    })

    test('reduced motion: the thumb jumps (no travel, one frame)', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await open(page, theme)
      const group = page.locator('[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] [role=radiogroup]')
      const opts = group.getByRole('radio')
      const thumbSel = '[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] .ww-seg-thumb'
      await opts.nth(0).focus()
      const t = await travel(page, thumbSel, 'keydown', async () => {
        await page.keyboard.press('ArrowRight')
      })
      await expect(opts.nth(1)).toHaveAttribute('aria-checked', 'true')
      expect(t.moving, 'never drawn travelling').toBe(false)
      expect(t.settle, 'at rest in a frame or two').toBeLessThanOrEqual(60)
    })

    test("data-motion='calm' does the same as the OS flag", async ({ page }) => {
      await open(page, theme)
      await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'calm'))
      const group = page.locator('[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] [role=radiogroup]')
      const opts = group.getByRole('radio')
      const thumbSel = '[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] .ww-seg-thumb'
      await opts.nth(0).focus()
      const t = await travel(page, thumbSel, 'keydown', async () => {
        await page.keyboard.press('ArrowRight')
      })
      expect(t.moving).toBe(false)
      expect(t.settle).toBeLessThanOrEqual(60)
    })

    test('two options and a touch pointer keep tap: nothing is dragged', async ({ browser }) => {
      const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, colorScheme: theme })
      const page = await ctx.newPage()
      await open(page, theme)
      const group = page.locator('[data-pose-grid="page"] [data-pose-cell="Segmented/rest"] [role=radiogroup]')
      const mq = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)
      expect(mq, 'a phone has no fine hovering pointer').toBe(false)
      const opts = group.getByRole('radio')
      await opts.nth(2).tap()
      await expect(opts.nth(2)).toHaveAttribute('aria-checked', 'true')
      await expect(group).not.toHaveAttribute('data-dragging', 'true')
      await ctx.close()
    })

    test('the Switch: the thumb settles inside 240 ms with one overshoot, the word lands after it, and a still frame has no running animation', async ({ page }) => {
      await open(page, theme)
      const cell = page.locator('[data-pose-grid="page"] [data-pose-cell="Switch/rest"]')
      const sw = cell.getByRole('switch')
      await expect(sw).toHaveAttribute('aria-checked', 'false')
      const thumbSel = '[data-pose-grid="page"] [data-pose-cell="Switch/rest"] .k-switch-thumb'
      const t = await travel(page, thumbSel, 'click', async () => {
        await sw.click()
      })
      await expect(sw).toHaveAttribute('aria-checked', 'true')
      expect(t.to - t.from, 'it travelled about 32 px').toBeGreaterThan(28)
      expect(t.settle, 'at rest').toBeLessThanOrEqual(240)
      expect(t.crossings, 'one overshoot at most').toBeLessThanOrEqual(1)
      const word = await cell.locator('.k-switch-word').getAttribute('data-flip')
      expect(word, 'the word is the one that arrives after the thumb').toBe('true')
      const running = await page.evaluate(() => document.getAnimations().length)
      expect(running, 'nothing animating at rest').toBe(0)
      note({ type: 'switch', description: `settle ${t.settle.toFixed(0)} ms, overshoot ${t.overshootPx.toFixed(2)} px, travel ${(t.to - t.from).toFixed(1)} px` })
      await shot(cell, `switch-${theme}-on.png`)
    })
  })
}
