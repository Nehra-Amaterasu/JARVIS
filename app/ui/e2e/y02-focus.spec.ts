// Package Y02 in a real Chromium: Focus (Start, the Crucible session, Rest and the Drill) of the gallery entry "Y02", on invented questions
// (every reading SIMULATED). Built in memory by Vite from a virtual entry that draws one state bare in the shell canvas
// (nothing is written near dist, no port is used by the page). Proves:
//   geometry   every state at the shell canvas size (1302 x 664) has no inner scrollbar, nothing outside the box, every focusable part
//              at 44 px or more; at 390 px each is one column with no sideways scroll
//   keyboard   a Drill set from the keyboard alone: Enter checks, h opens hints (logged, nothing lowered), a miss says "Not yet. Worked
//              answer below" in no red, j and k step, x parks a thought and Enter files it, e ends on counts only
//   idle       zero requestAnimationFrame calls while the Drill stands idle, and the strip changes only on an event
// Screenshots go to Y02_SHOTS when it is set (outside the repository), else nowhere.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.Y02_SHOTS ? resolve(process.env.Y02_SHOTS) : ''
const URL_ = 'http://y02.test/'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

const ENTRY_ID = resolve(ROOT, 'e2e', '.y02-entry.tsx')
const entrySource = (root: string) => `
import '${root}/src/styles/design/clay/index.css'
import '${root}/src/ww/design/base.css'
import '${root}/src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import list from '${root}/src/gallery/entries/Y02'
const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', 'clay-' + THEME)
document.documentElement.setAttribute('data-legacy-styles', '')
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
const w = Number(q.get('w')) || 0
const node = list[0].states[Number(q.get('state') || 0)].node
const style = w ? { position: 'relative', width: w, padding: 12, boxSizing: 'border-box', '--y02-zoom': 1 } : { position: 'absolute', left: 64, top: 104, width: 1302, height: 664, '--y02-zoom': 1 }
createRoot(document.getElementById('root')).render(<div style={style} data-stage>{node}</div>)
`

let bundle: Promise<{ js: string; css: string }> | null = null
function buildPage() {
  bundle ??= (async () => {
    const root = ROOT.split(String.fromCharCode(92)).join('/')
    const out = await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      plugins: [{ name: 'y02-entry', resolveId: (id: string) => (id === ENTRY_ID ? id : null), load: (id: string) => (id === ENTRY_ID ? entrySource(root) : null) }],
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: ENTRY_ID, formats: ['iife'], name: 'Y02Page', fileName: 'y02' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

const shot = async (page: Page, sel: string, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator(sel).first().screenshot({ path: resolve(SHOTS, name) })
}

/** Open state i of the entry. `w` draws it at that width (the phone); without it the shell canvas box is used. */
async function state(page: Page, i: number, theme: 'light' | 'dark' = 'light', w = 0) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Y02</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number }
    w.__raf = 0
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb: FrameRequestCallback) => { w.__raf++; return orig(cb) }
  })
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&state=${i}${w ? `&w=${w}` : ''}`)
  await page.locator('.fv').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}

/** Let go of whatever holds the focus, so the next key press goes to the window like a hand lifted off a field. */
const release = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

const STATE_COUNT = 14
const NAMES = ['start', 'start-norotation', 'start-running', 'session', 'session-held', 'rest-early', 'rest-done', 'drill-numeric', 'drill-hints', 'drill-miss', 'drill-recall', 'drill-written', 'drill-end', 'drill-empty']

const measure = (page: Page) => page.evaluate(() => {
  const fv = document.querySelector<HTMLElement>('.fv')!
  const box = document.querySelector<HTMLElement>('.y02-box')!.getBoundingClientRect()
  const over = [...fv.querySelectorAll<HTMLElement>('*')].filter((e) => {
    if (e.closest('[aria-hidden="true"]') || e.closest('svg[aria-hidden]')) return false // drawings behind the text, clipped by their own box
    const r = e.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(e).position !== 'fixed' && (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1)
  }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`)
  const focusable = [...fv.querySelectorAll<HTMLElement>('button, input, [tabindex="0"], a[href], [role="switch"], [role="radio"]')]
    .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]'))
  const small = focusable.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width < 43.5 || r.height < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  const tiny = [...fv.querySelectorAll<HTMLElement>('*')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.95)
    .map((e) => `${e.className} ${getComputedStyle(e).fontSize}`)
  return {
    docY: document.documentElement.scrollHeight - innerHeight,
    docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    fvY: fv.scrollHeight - fv.clientHeight,
    fvX: fv.scrollWidth - fv.clientWidth,
    over, small, tiny, primaries: fv.querySelectorAll('[data-primary]').length,
  }
})

test.describe('Y02 geometry at the desk', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (let i = 0; i < STATE_COUNT; i++) {
    test(`state ${i} (${NAMES[i]}): one canvas, no inner scroll, nothing outside, targets 44 px, one accent`, async ({ page }) => {
      await state(page, i)
      const m = await measure(page)
      expect(m.docY, 'the document scrolls').toBeLessThanOrEqual(0)
      expect(m.fvY, 'the canvas scrolls inside').toBeLessThanOrEqual(1)
      expect(m.fvX, 'the canvas scrolls sideways').toBeLessThanOrEqual(1)
      expect(m.over, 'parts outside the box').toEqual([])
      expect(m.small, 'targets under 44 px').toEqual([])
      expect(m.tiny, 'text under 11 px').toEqual([])
      expect(m.primaries, 'accent fills').toBeLessThanOrEqual(1)
      await shot(page, '.y02-box', `${String(i).padStart(2, '0')}-${NAMES[i]}-1366-light.png`)
    })
  }
})

test.describe('Y02 geometry on the phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  for (const i of [0, 2, 3, 5, 7, 9, 12, 13]) {
    test(`state ${i} (${NAMES[i]}) at 390 px: one column, no sideways scroll, targets 44 px`, async ({ page }) => {
      await state(page, i, 'light', 390)
      const m = await measure(page)
      expect(m.docX, 'the page scrolls sideways').toBeLessThanOrEqual(0)
      expect(m.fvX).toBeLessThanOrEqual(1)
      expect(m.small, 'targets under 44 px').toEqual([])
      await shot(page, '[data-stage]', `${String(i).padStart(2, '0')}-${NAMES[i]}-390-light.png`)
    })
  }
})

test.describe('Y02 keyboard and idle', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('a Drill set from the keyboard: check, hints that lower nothing, a calm miss with no red, step, park, end on counts', async ({ page }) => {
    await state(page, 7)
    const strip = () => page.locator('.dr-strip').innerText()
    const first = await strip()
    // typing is not an event: the strip stays
    await page.keyboard.type('1,92')
    expect(await strip()).toBe(first)
    await page.keyboard.press('Enter')
    await expect(page.locator('.dr-result[data-result="matched"]')).toHaveText(/Matches the key/)
    const afterCheck = await strip()
    expect(afterCheck).not.toBe(first)
    expect(afterCheck).toContain('matched 1')
    await page.keyboard.press('Enter')
    await expect(page.locator('.dr-kick').first()).toHaveText(/Question 2 of 6/)
    // two hints: logged, the matched count does not move. Escape leaves the field so the letter keys are keys again.
    await page.keyboard.press('Escape')
    await page.keyboard.press('h')
    await page.keyboard.press('h')
    await expect(page.locator('.dr-hint')).toHaveCount(2)
    expect(await strip()).toContain('matched 1')
    expect(await strip()).toContain('hints 2')
    // a miss: the stated words, and no red anywhere in the Drill
    await page.locator('input').first().click()
    await page.keyboard.type('300')
    await page.keyboard.press('Enter')
    await expect(page.locator('.dr-result[data-result="missed"]')).toHaveText('Not yet. Worked answer below')
    await expect(page.locator('.dr-worked')).toBeVisible()
    const red = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.fv *')].filter((e) => {
      if (e.closest('[data-primary]')) return false // the one warm accent fill of the main action is the product's orange, not a verdict
      const c = getComputedStyle(e)
      return [c.color, c.backgroundColor, c.borderTopColor, c.outlineColor].some((v) => {
        const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/)
        if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return false
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
        return r > 150 && g < 90 && b < 90
      })
    }).map((e) => String(e.className)))
    expect(red, 'a red token in the Drill').toEqual([])
    await shot(page, '.y02-box', 'keyboard-miss-1366-light.png')
    // step back and forth with j and k
    await release(page)
    await page.keyboard.press('k')
    await expect(page.locator('.dr-kick').first()).toHaveText(/Question 1 of 6/)
    await page.keyboard.press('j')
    await expect(page.locator('.dr-kick').first()).toHaveText(/Question 2 of 6/)
    // x opens the Park field, Enter files it and the focus returns
    await page.keyboard.press('x')
    await expect(page.locator('.pk-in')).toBeFocused()
    await page.keyboard.type('Ask about the clock tree')
    await page.keyboard.press('Enter')
    await expect(page.locator('.dr-park-list')).toContainText('Ask about the clock tree')
    await expect(page.locator('.pk-in')).toHaveCount(0)
    expect(await strip()).toContain('parked 1')
    // e ends the set: counts only, the filled dots stay
    await release(page)
    await page.keyboard.press('e')
    await expect(page.locator('.dr-counts')).toHaveText('2 attempted, 1 matched, 1 on the shelf')
    await expect(page.locator('.dd-btn[data-dot="filled"]')).toHaveCount(2)
    await expect(page.locator('.dd-note')).toHaveText('Ended early. The filled dots stay.')
    await shot(page, '.y02-box', 'keyboard-end-1366-light.png')
  })

  test('zero requestAnimationFrame while the Drill is idle, and the strip stands still', async ({ page }) => {
    await state(page, 7)
    await page.evaluate(() => { (window as unknown as { __raf: number }).__raf = 0 })
    const strip = await page.locator('.dr-strip').innerText()
    await page.waitForTimeout(1600)
    expect(await page.evaluate(() => (window as unknown as { __raf: number }).__raf)).toBe(0)
    expect(await page.locator('.dr-strip').innerText()).toBe(strip)
  })

  test('the Park field in the Crucible opens with P, files with Enter and closes with Escape', async ({ page }) => {
    await state(page, 3)
    await page.keyboard.press('p')
    await expect(page.locator('.pk-in')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.pk-in')).toHaveCount(0)
  })
})
