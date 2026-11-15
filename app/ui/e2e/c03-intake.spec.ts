// Package C03 in a real Chromium: the Manual Intake desk of the gallery entry "C03" (invented items, SIMULATED).
// Built in memory by Vite from a virtual entry (nothing is written near dist, no port is used). Proves:
//   geometry   the desk at the shell canvas size (1230 x 664) has no document scroll, no inner scrollbar, no target under 44 px, seven rows
//              and at most three headers on the first page; the detail never runs past the box; at 382 px (358 px of content) and at
//              390 px it is one column with no sideways scroll
//   keyboard   the four doors are four tab stops and the Classroom plate is none; the list is one tab stop; arrows walk it; `a` accepts
//              the chosen row; a door key opens its sheet, Tab stays inside it, Escape closes it and the focus returns to the door
//   surfaces   every sheet sets an opaque surface and its text is 4.5:1 on it; no text is under 11 px; nothing animates at idle
//   branches   reduced motion removes the lift; forced colours draw the doors with a border
// Screenshots go to C03_SHOTS when it is set (outside the repository), else nowhere.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.C03_SHOTS ? resolve(process.env.C03_SHOTS) : ''
const URL_ = 'http://c03.test/'
const FONTS = "html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}"

const ENTRY_ID = resolve(ROOT, 'e2e', '.c03-entry.tsx')
const entrySource = (root: string) => `
import '${root}/src/styles/design/clay/index.css'
import '${root}/src/ww/design/base.css'
import '${root}/src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import list from '${root}/src/gallery/entries/C03'
const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', 'clay-' + THEME)
document.documentElement.setAttribute('data-legacy-styles', '')
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
const w = Number(q.get('w')) || 0
const node = list[0].states[Number(q.get('state') || 0)].node
const style = w ? { position: 'relative', width: w, padding: 12, boxSizing: 'border-box' } : { position: 'absolute', left: 64, top: 48, width: 1302, height: 720 }
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
      plugins: [{ name: 'c03-entry', resolveId: (id: string) => (id === ENTRY_ID ? id : null), load: (id: string) => (id === ENTRY_ID ? entrySource(root) : null) }],
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: ENTRY_ID, formats: ['iife'], name: 'C03Page', fileName: 'c03' } },
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
const shotPage = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, name), fullPage: true })
}

/** Open state i of the entry. `w` draws it at that width (the phone); without it the shell canvas box is used. */
async function state(page: Page, i: number, theme: 'light' | 'dark' = 'light', w = 0) {
  const { js, css } = await buildPage()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C03</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}&state=${i}${w ? `&w=${w}` : ''}`)
  await page.locator('.ik-desk, .c03-parts').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(450)
}

/** Every focusable or pressable part inside `sel` that is under 44 px on either side (the element itself, its bounding box). */
const smallTargets = (page: Page, sel: string) => page.evaluate((s) => {
  return [...document.querySelectorAll<HTMLElement>(s)]
    .map((e) => ({ c: `${e.tagName.toLowerCase()}.${e.className.toString().slice(0, 28)} ${(e.textContent ?? '').trim().slice(0, 14)}`, r: e.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0 && (x.r.width < 43.5 || x.r.height < 43.5))
    .map((x) => `${x.c} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`)
}, sel)

const TARGETS = '.ik-desk button:not([disabled]), .ik-desk select, .ik-desk [role="switch"], .ik-desk [role="radio"], .ik-desk a[href]'

test.describe('C03 geometry', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  for (const theme of ['light', 'dark'] as const) {
    test(`the desk at the canvas size has no scroll, seven rows, at most three headers and no target under 44 px (${theme})`, async ({ page }) => {
      await state(page, 0, theme)
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 'the document scrolls').toBeLessThanOrEqual(0)
      const box = await page.locator('.c03-box').first().boundingBox()
      expect(Math.round(box!.width)).toBe(1230)
      expect(Math.round(box!.height)).toBe(664)
      const m = await page.evaluate(() => {
        const q = (s: string) => document.querySelector<HTMLElement>(s)!
        const inner = q('.ik-desk-in')
        const ledger = q('.ik-ledger')
        const detail = q('.ik-detail')
        const last = [...document.querySelectorAll<HTMLElement>('.ik-row')].pop()!.getBoundingClientRect()
        return {
          innerY: inner.scrollHeight - inner.clientHeight, innerX: inner.scrollWidth - inner.clientWidth,
          ledgerY: ledger.scrollHeight - ledger.clientHeight, detailY: detail.scrollHeight - detail.clientHeight,
          lastRowCut: Math.round(last.bottom - ledger.getBoundingClientRect().bottom),
          primaryH: Math.round(document.querySelector<HTMLElement>('.ik-keys [data-primary]')?.getBoundingClientRect().height ?? 0),
          rows: document.querySelectorAll('.ik-row').length, heads: document.querySelectorAll('.ik-ghead').length,
          doorStops: [...document.querySelectorAll<HTMLElement>('.ik-door')].filter((d) => d.tabIndex === 0).length,
        }
      })
      expect(m.innerY, 'the desk scrolls inside').toBeLessThanOrEqual(1)
      expect(m.innerX).toBeLessThanOrEqual(1)
      expect(m.ledgerY, 'the ledger scrolls inside').toBeLessThanOrEqual(1)
      expect(m.detailY, 'the chosen item runs past its card').toBeLessThanOrEqual(1)
      expect(m.lastRowCut, 'the last row is cut off').toBeLessThanOrEqual(1)
      expect(m.rows).toBe(7)
      expect(m.primaryH, 'principle 13: the primary key is 48 px or taller').toBeGreaterThanOrEqual(48)
      expect(m.heads).toBeLessThanOrEqual(3)
      expect(m.doorStops, 'four doors are four tab stops; the Classroom plate is none').toBe(4)
      expect(await smallTargets(page, TARGETS), 'targets under 44 px').toEqual([])
      await shot(page, '.c03-box', `desk-1230-${theme}.png`)
    })
  }

  test('the empty desk, the ambiguous item, the folder file, the accepted list and forty rows each fit the same box', async ({ page }) => {
    for (const i of [1, 2, 3, 4, 5]) {
      await state(page, i)
      const m = await page.evaluate(() => {
        const inner = document.querySelector<HTMLElement>('.c03-box')!
        const over = [...inner.querySelectorAll<HTMLElement>('*')].filter((e) => {
          const r = e.getBoundingClientRect(), b = inner.getBoundingClientRect()
          return r.width > 0 && (r.right > b.right + 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.top < b.top - 1)
        }).map((e) => e.className.toString().slice(0, 40))
        const detail = document.querySelector<HTMLElement>('.ik-detail')!
        return { over, scroll: inner.scrollHeight - inner.clientHeight, detail: detail.scrollHeight - detail.clientHeight }
      })
      await shot(page, '.c03-box', `desk-state-${i}.png`)
      expect(m.over, `state ${i}: parts outside the box`).toEqual([])
      expect(m.scroll).toBeLessThanOrEqual(1)
      expect(m.detail, `state ${i}: the chosen item overflows its card`).toBeLessThanOrEqual(1)
      expect(await smallTargets(page, TARGETS), `state ${i}: targets under 44 px`).toEqual([])
    }
  })

  test('the sheets: paste, calendar file, archive, courses and folder open over the desk, opaque, with text at 4.5:1', async ({ page }) => {
    const luminance = `
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }`
    for (const i of [6, 7, 8, 9, 10]) {
      await state(page, i)
      const m = await page.evaluate(`(() => {
        ${luminance}
        const sheet = document.querySelector('.ik-sheet');
        const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
        const bg = rgb(getComputedStyle(sheet).backgroundColor);
        const ink = rgb(getComputedStyle(sheet).color);
        const a = bg.length > 3 ? bg[3] : 1;
        const hi = Math.max(lum(bg.slice(0, 3)), lum(ink.slice(0, 3))) + 0.05, lo = Math.min(lum(bg.slice(0, 3)), lum(ink.slice(0, 3))) + 0.05;
        const r = sheet.getBoundingClientRect();
        const small = [...sheet.querySelectorAll('*')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 10.99).map((e) => e.className + ' ' + e.textContent.slice(0, 20));
        return { alpha: a, contrast: hi / lo, w: Math.round(r.width), h: Math.round(r.height), small, vw: innerWidth, vh: innerHeight };
      })()`) as { alpha: number; contrast: number; w: number; h: number; small: string[]; vw: number; vh: number }
      await shotPage(page, `sheet-${i}.png`)
      expect(m.alpha, `sheet ${i} is see-through`).toBe(1)
      expect(m.contrast, `sheet ${i} ink contrast`).toBeGreaterThanOrEqual(4.5)
      expect(m.small, `sheet ${i}: text under 11 px`).toEqual([])
      expect(m.w).toBeLessThanOrEqual(m.vw)
      expect(m.h).toBeLessThanOrEqual(m.vh)
      expect(await smallTargets(page, '.ik-sheet button:not([disabled]), .ik-sheet select, .ik-sheet [role="switch"]'), `sheet ${i}: targets under 44 px`).toEqual([])
    }
  })

  test('no text is under 11 px, the ink holds 4.5:1 on its own surface, and nothing animates at idle', async ({ page }) => {
    await state(page, 0)
    const m = await page.evaluate(`(() => {
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b };
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgba = (s) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const rgb = (s) => rgba(s).slice(0, 3);
      const surface = (e) => { const chain = []; for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) chain.push(c); if (c[3] === 1) break; } let out = [255, 255, 255]; for (const c of chain.reverse()) out = [0, 1, 2].map((k) => c[k] * c[3] + out[k] * (1 - c[3])); return out; };
      const desk = document.querySelector('.ik-desk');
      const texts = [...desk.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const small = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 10.99).map((e) => e.className + ' ' + e.textContent.slice(0, 20));
      const weak = texts.map((e) => { const fg = rgb(getComputedStyle(e).color).slice(0, 3); const bg = surface(e); const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return { t: (e.className + ' ' + e.textContent.slice(0, 24)), r: Math.max(a, b) / Math.min(a, b) }; }).filter((x) => x.r < 4.5).map((x) => x.t + ' ' + x.r.toFixed(2));
      return { small, weak, anims: document.getAnimations().length };
    })()`) as { small: string[]; weak: string[]; anims: number }
    expect(m.small, 'text under 11 px').toEqual([])
    expect(m.weak, 'ink under 4.5:1').toEqual([])
    expect(m.anims, 'something animates at idle').toBe(0)
  })
})

test.describe('C03 keyboard', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('the doors, the list, Accept, a sheet with a trapped Tab, Escape and the focus back on the door', async ({ page }) => {
    await state(page, 0)
    // four doors, then the plate is skipped
    await page.locator('.ik-door[data-door="folder"]').focus()
    const names: string[] = []
    for (let n = 0; n < 4; n++) {
      names.push(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-door') ?? ''))
      await page.keyboard.press('Tab')
    }
    expect(names).toEqual(['folder', 'paste', 'ics', 'archive'])
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-door'))).not.toBe('classroom')
    // the list is one tab stop and the arrows walk it
    expect(await page.locator('.ik-row[tabindex="0"]').count()).toBe(1)
    await page.locator('.ik-row[tabindex="0"]').focus()
    const first = await page.locator('.ik-detail h2').textContent()
    await page.keyboard.press('ArrowDown')
    expect(await page.locator('.ik-detail h2').textContent()).not.toBe(first)
    expect(await page.evaluate(() => document.activeElement?.className)).toContain('ik-row')
    // Accept is a press: the count falls by one and the toast offers Undo
    const before = await page.locator('.ik-count-n').textContent()
    await page.keyboard.press('a')
    await expect(page.locator('.ww-toast')).toContainText('Accepted')
    expect(Number.parseInt((await page.locator('.ik-count-n').textContent()) ?? '0')).toBe(Number.parseInt(before ?? '0') - 1)
    // a sheet: Enter opens it, Tab stays inside, Escape closes it and the door has the focus again
    await page.locator('.ik-door[data-door="paste"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.ik-sheet')).toBeVisible()
    for (let n = 0; n < 12; n++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.ik-sheet'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(page.locator('.ik-sheet')).toBeHidden()
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('data-door'))).toBe('paste')
  })

  test('the focus ring is 2 px on the focused row, door and button', async ({ page }) => {
    await state(page, 0)
    for (const sel of ['.ik-door[data-door="paste"]', '.ik-row[tabindex="0"]', '.ik-detail .ww-btn']) {
      await page.locator(sel).first().focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      const w = await page.evaluate(() => { const s = getComputedStyle(document.activeElement as HTMLElement); return { w: parseFloat(s.outlineWidth), style: s.outlineStyle } })
      expect(w.style, sel).not.toBe('none')
      expect(w.w, sel).toBeGreaterThanOrEqual(2)
    }
  })
})

test.describe('C03 phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [w, label] of [[382, '358 px of content'], [390, '390 px']] as const) {
    test(`one column, no sideways scroll, every target 44 px (${label})`, async ({ page }) => {
      await state(page, 0, 'light', w)
      const m = await page.evaluate(() => {
        const doors = [...document.querySelectorAll<HTMLElement>('.ik-door')].map((d) => Math.round(d.getBoundingClientRect().left))
        const main = document.querySelector<HTMLElement>('.ik-main')!
        const cols = getComputedStyle(main).gridTemplateColumns.split(' ').length
        return { x: document.documentElement.scrollWidth - innerWidth, doorLefts: new Set(doors).size, cols }
      })
      expect(m.x, 'the page scrolls sideways').toBeLessThanOrEqual(0)
      expect(m.doorLefts, 'the doors are one column').toBe(1)
      expect(m.cols).toBe(1)
      expect(await smallTargets(page, TARGETS), 'targets under 44 px').toEqual([])
      await shotPage(page, `desk-${w}.png`)
    })
  }

  test('the sheets fit a phone', async ({ page }) => {
    for (const i of [6, 8, 9]) {
      await state(page, i, 'light', 390)
      const r = await page.evaluate(() => { const s = document.querySelector('.ik-sheet')!.getBoundingClientRect(); return { r: s.right, w: innerWidth, x: document.documentElement.scrollWidth - innerWidth } })
      expect(r.r).toBeLessThanOrEqual(r.w + 1)
      expect(r.x).toBeLessThanOrEqual(0)
      await shotPage(page, `sheet-${i}-390.png`)
    }
  })
})

test.describe('C03 branches', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test('reduced motion removes the lift of a door', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await state(page, 0)
    const t = await page.evaluate(() => getComputedStyle(document.querySelector('.ik-door[data-door="paste"]')!).transitionDuration)
    expect(parseFloat(t)).toBe(0)
  })

  test('forced colours draw a door with a border and the plate dashed', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await state(page, 0)
    const m = await page.evaluate(() => ({
      door: getComputedStyle(document.querySelector('.ik-door[data-door="paste"]')!).borderTopStyle,
      plate: getComputedStyle(document.querySelector('.ik-door[data-door="classroom"]')!).borderTopStyle,
    }))
    expect(m.door).toBe('solid')
    expect(m.plate).toBe('dashed')
  })

  test('shots of the rest of the states for the jury', async ({ page }) => {
    test.skip(!SHOTS, 'C03_SHOTS is not set')
    for (const i of [0, 1, 2, 3, 5, 11]) {
      for (const theme of ['light', 'dark'] as const) {
        await state(page, i, theme)
        await shot(page, '.c03-box, .c03-parts', `state-${i}-${theme}.png`)
      }
    }
  })
})
