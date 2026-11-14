// Jury evidence harness, shared helpers (package RG1). Nothing here is a test: e2e/jury.spec.ts drives these.
//
// Why this exists: the wave 6 jury could not verify reflow because its evidence was broken (specimens cropped by the
// gallery pane, phone frames covered by the sticky row, one shot blank below the first card, 100 of 206 files listed).
// So every shot here is the WHOLE specimen (the page is laid out with the index, the bar and the pane scroll taken out
// of the picture, then the specimen's own box, plus anything that spills out of it, is clipped), and every shot has a
// row in report.json and in index.md that says what the picture is and what was measured in it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const GALLERY_URL = 'http://gallery.test/'
export const SIZES = [{ width: 1366, height: 768 }, { width: 390, height: 844 }] as const
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
/** Chromium cannot make a texture taller than 16384 px; a specimen longer than this is cut at the foot and flagged. */
export const MAX_SHOT_HEIGHT = 16000

// ---------------------------------------------------------------- the rows of the report

export interface Row {
  file: string
  kind: 'specimen' | 'focus' | 'shell'
  entry: string
  state: string
  width: number
  theme: string
  /** the measured element: the specimen, the focused part, or the shell page */
  elW: number
  elH: number
  /** px by which anything inside the specimen sticks out of it, left or right, or the document scrolls sideways */
  overflowPx: number
  /** px of content cut by an overflow:hidden or clip box inside the specimen (a silent crop) and the count of boxes that scroll by design */
  clippedPx: number
  scrollers: number
  /** fewer than 8 distinct colours in a 24 x 24 sample grid of the whole picture, and of its lower half */
  blank: boolean | null
  blankLower: boolean | null
  distinct: number | null
  /** the smallest computed font size in px of any text inside the specimen, and the element that has it */
  minFontPx: number | null
  minFontEl: string
  textUnder11: number
  focusable: number
  /** focusable parts with a width or a height under 44 px, as measured (the figure the brief reads is the 390 one) */
  under44: number
  under44List: string[]
  truncated: boolean
  /** focus rows only */
  stop?: number
  ring?: string
  note?: string
}

export interface EntryInfo { id: string; group: string; states: string[]; focusStops: number; error?: string }

export interface Measure {
  elW: number; elH: number; overflowPx: number; clippedPx: number; scrollers: number
  minFontPx: number | null; minFontEl: string; textUnder11: number
  focusable: number; under44: number; under44List: string[]
  /** the box to clip the picture to, in page coordinates: the element and everything that sticks out of it */
  clip: { x: number; y: number; width: number; height: number }
}

// ---------------------------------------------------------------- pure helpers (checked in jury/helpers.spec.ts)

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x'
/** An entry id such as kit/Switch becomes a folder name: slashes to dashes, anything else odd to a dash. */
export const folderOf = (id: string): string => id.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]+/g, '-')
export const stateFile = (i: number, label: string): string => `${String(i + 1).padStart(2, '0')}-${slug(label)}`
export const shotName = (state: string, width: number, theme: string): string => `${state}-${width}-${theme}.png`
const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

export function indexMarkdown(rows: Row[], meta: { generated: string; entries: number }): string {
  const head = [
    '# Jury evidence index', '',
    `Generated ${meta.generated}. ${rows.length} files from ${meta.entries} gallery entries and the shell. One line per file, so no glob is needed.`,
    'overflow = px that content sticks out of the specimen (or the document scrolls sideways); clipped = px cut by an overflow:hidden box; blank = fewer than 8 distinct colours in a sample grid; min px = smallest text; <44 = focusable parts with a side under 44 px.', '',
    '| file | entry | state | w | theme | size | overflow | clipped | blank | min px | <44 | note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  const lines = rows.map((r) => `| ${esc(r.file)} | ${esc(r.entry)} | ${esc(r.state)} | ${r.width} | ${r.theme} | ${r.elW}x${r.elH} | ${r.overflowPx} | ${r.clippedPx} | ${r.blank === null ? '-' : r.blank ? 'BLANK' : r.blankLower ? 'lower half blank' : 'no'} | ${r.minFontPx ?? '-'} | ${r.under44} | ${esc([r.ring ? `ring ${r.ring}` : '', r.truncated ? 'cut at 16000 px' : '', r.note ?? ''].filter(Boolean).join('; '))} |`)
  return [...head, ...lines, ''].join('\n')
}

export interface Summary {
  files: number; specimens: number; focus: number; shell: number
  entries: number; entriesWithError: number
  overflowing: number; clipped: number; blank: number; blankLower: number
  textUnder11: number; under44At390: number; focusableUnder44At390: number
}

export function summarize(rows: Row[], entries: EntryInfo[]): Summary {
  const spec = rows.filter((r) => r.kind !== 'focus')
  const at390 = spec.filter((r) => r.width === 390)
  return {
    files: rows.length,
    specimens: rows.filter((r) => r.kind === 'specimen').length,
    focus: rows.filter((r) => r.kind === 'focus').length,
    shell: rows.filter((r) => r.kind === 'shell').length,
    entries: entries.length,
    entriesWithError: entries.filter((e) => e.error).length,
    overflowing: spec.filter((r) => r.overflowPx > 0).length,
    clipped: spec.filter((r) => r.clippedPx > 0).length,
    blank: spec.filter((r) => r.blank).length,
    blankLower: spec.filter((r) => r.blankLower).length,
    textUnder11: spec.filter((r) => r.textUnder11 > 0 || (r.minFontPx !== null && r.minFontPx < 11)).length,
    under44At390: at390.filter((r) => r.under44 > 0).length,
    focusableUnder44At390: at390.reduce((n, r) => n + r.under44, 0),
  }
}

export function writeReport(dir: string, rows: Row[], entries: EntryInfo[], extra: Record<string, unknown> = {}): Summary {
  mkdirSync(dir, { recursive: true })
  const generated = new Date().toISOString()
  const summary = summarize(rows, entries)
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify({ generated, summary, ...extra, entries, shots: rows }, null, 1))
  writeFileSync(resolve(dir, 'index.md'), indexMarkdown(rows, { generated, entries: entries.length }))
  return summary
}

// ---------------------------------------------------------------- the gallery page

const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`

/**
 * Lays the page out so the specimen is the only thing that matters: the document grows with it (no scroll box), the bar
 * and the sticky rows are gone, and the index is out of the picture. At desktop width the index keeps its 276 px column
 * hidden, so the specimen has the width it has in the real 1302 px canvas; at phone width it is dropped. Every control is
 * still driven by the page's own click handlers (el.click()), so the specimen is selected the way a person selects it.
 */
const ISOLATE = `
html,body{height:auto!important;min-height:0!important;overflow:visible!important}
#root{height:auto!important}
.gl{height:auto!important;min-height:0!important;overflow:visible!important}
.gl-bar{display:none!important}
.gl-side{visibility:hidden!important;overflow:hidden!important;max-height:0!important}
.gl-main{display:block!important;overflow:visible!important}
.gl-pane{height:auto!important;min-height:0!important;overflow:visible!important}
@media (max-width:760px){.gl{display:block!important}.gl-side{display:none!important}}
`

let bundle: Promise<{ js: string; css: string }> | null = null
/** The gallery page, built once in memory by Vite from e2e/bench/entry.tsx (the way e2e/gallery.spec.ts builds it). */
export function buildGallery() {
  bundle ??= (async () => {
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: resolve(ROOT, 'e2e/bench/entry.tsx'), formats: ['iife'], name: 'GalleryPage', fileName: 'gallery' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the gallery build produced no script')
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

const routed = new WeakSet<Page>()
/** Opens the gallery in one theme, at the chosen scale (1x unless asked), with the specimen isolated; resolves with every entry id the index lists. */
export async function openGallery(page: Page, theme: Theme, scale: '1' | '1.5' | '2' = '1'): Promise<string[]> {
  const { js, css } = await buildGallery()
  if (!routed.has(page)) {
    const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
    const doc = (t: Theme) => `<!doctype html><html lang="en" data-theme="clay-${t}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What is new</title><style>${FONTS}</style><style>${css}</style><style>${ISOLATE}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
    await page.route(`${GALLERY_URL}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc(new URL(route.request().url()).searchParams.get('theme') === 'dark' ? 'dark' : 'light') }))
    routed.add(page)
  }
  await page.goto(`${GALLERY_URL}?view=gallery&theme=${theme}`)
  await page.locator('[data-gallery]').waitFor()
  // the product's own entries arrive a moment after the shared ones (collect.ts): wait until the index stops growing
  let last = -1
  let same = 0
  for (let i = 0; i < 100 && same < 3; i++) {
    const n = await page.locator('.gl-item').count()
    same = n === last ? same + 1 : 0
    last = n
    if (same < 3) await page.waitForTimeout(100)
  }
  // 1x by default: the real size, so a phone frame is a phone frame (the gallery's own default is 1.5x, which zooms the specimen; JURY_SCALE=1.5 draws that)
  await press(page, `.gl-radios[aria-label="Scale"] [role="radio"]:nth-child(${['1', '1.5', '2'].indexOf(scale) + 1})`)
  return page.locator('.gl-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-entry-id') ?? ''))
}

/** A click that works on a control the isolation has hidden: the page's own onClick runs. */
export const press = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => (el as HTMLElement).click())

const q = (id: string) => id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export async function pickEntry(page: Page, id: string): Promise<{ group: string; states: string[] }> {
  await press(page, `.gl-item[data-entry-id="${q(id)}"]`)
  await page.locator(`article.gl-specimen[data-entry="${q(id)}"]`).waitFor({ timeout: 10_000 })
  return page.evaluate(() => ({
    group: document.querySelector('article.gl-specimen')?.getAttribute('data-group') ?? '',
    states: [...document.querySelectorAll('article.gl-specimen figcaption.gl-state-cap')].map((c) => (c.textContent ?? '').trim()),
  }))
}

/** Show state i alone, or all of them (null), through the page's own State switch. */
export async function showState(page: Page, i: number | null, count: number) {
  if (count > 1) await press(page, `.gl-states-switch [role="radio"]:nth-child(${(i === null ? 0 : i + 1) + 1})`)
}

// ---------------------------------------------------------------- measuring (runs in the page)

/**
 * Waits for fonts, images and two frames, then measures `root` (its box, what sticks out of it) and `scan` (text and
 * focusable parts). Pure DOM reads; nothing is written to the page.
 */
export function measure(page: Page, root: string, scan: string): Promise<Measure> {
  return page.evaluate(async ({ root, scan }) => {
    await document.fonts.ready
    const imgs = [...document.querySelectorAll<HTMLImageElement>(`${scan} img`)].filter((i) => !i.complete)
    await Promise.all(imgs.map((i) => new Promise<void>((ok) => { i.addEventListener('load', () => ok(), { once: true }); i.addEventListener('error', () => ok(), { once: true }); setTimeout(ok, 3000) })))
    await new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())))

    const el = document.querySelector<HTMLElement>(root)
    const sc = document.querySelector<HTMLElement>(scan) ?? el
    if (!el || !sc) throw new Error(`jury: ${root} is not on the page`)
    const rr = el.getBoundingClientRect()
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return false
      const cs = getComputedStyle(e)
      return cs.visibility !== 'hidden' && cs.display !== 'none'
    }
    const name = (e: Element) => `${e.tagName.toLowerCase()}${typeof (e as HTMLElement).className === 'string' && (e as HTMLElement).className ? '.' + (e as HTMLElement).className.trim().split(/\s+/)[0] : ''}`
    // does an ancestor below `top` clip or scroll this element sideways? Then it cannot stick out of the specimen.
    const clippedBy = (e: Element, top: Element) => {
      for (let p = e.parentElement; p && p !== top.parentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox !== 'visible') return true
      }
      return false
    }

    let left = rr.left
    let right = rr.right
    let top = rr.top
    let bottom = rr.bottom
    let spill = 0
    let clipped = 0
    let scrollers = 0
    const all = [el, ...el.querySelectorAll<HTMLElement>('*')]
    for (const e of all) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none') continue
      if (e !== el && e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible') {
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') scrollers++
        else clipped = Math.max(clipped, e.scrollWidth - e.clientWidth)
      }
      if (e === el || !shown(e) || clippedBy(e, el)) continue
      const r = e.getBoundingClientRect()
      spill = Math.max(spill, r.right - rr.right, rr.left - r.left)
      left = Math.min(left, r.left); right = Math.max(right, r.right)
      top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
    }
    const docOver = document.documentElement.scrollWidth - innerWidth

    let minFont = Infinity
    let minEl = ''
    let under11 = 0
    const scanAll = [sc, ...sc.querySelectorAll<HTMLElement>('*')]
    for (const e of scanAll) {
      if (/^(SCRIPT|STYLE)$/.test(e.tagName) || !shown(e)) continue
      let own = false
      for (const n of e.childNodes) if (n.nodeType === 3 && (n.textContent ?? '').trim()) { own = true; break }
      if (!own) continue
      const fs = parseFloat(getComputedStyle(e).fontSize)
      if (fs < 11) under11++
      if (fs < minFont) { minFont = fs; minEl = `${name(e)} "${(e.textContent ?? '').trim().slice(0, 24)}"` }
    }

    const FOCUS = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[role=button],[role=tab],[role=radio],[role=switch],[role=slider],[role=checkbox],[role=option],[role=menuitem],[role=link]'
    let focusable = 0
    const small: string[] = []
    let smallN = 0
    for (const e of sc.querySelectorAll<HTMLElement>(FOCUS)) {
      if ((e as HTMLButtonElement).disabled || e.getAttribute('aria-hidden') === 'true' || !shown(e)) continue
      focusable++
      const r = e.getBoundingClientRect()
      if (r.width < 44 || r.height < 44) { smallN++; if (small.length < 8) small.push(`${name(e)} ${Math.round(r.width)}x${Math.round(r.height)}`) }
    }

    return {
      elW: Math.round(rr.width), elH: Math.round(rr.height),
      overflowPx: Math.round(Math.max(0, spill, docOver)), clippedPx: Math.round(clipped), scrollers,
      minFontPx: minFont === Infinity ? null : Math.round(minFont * 100) / 100, minFontEl: minEl, textUnder11: under11,
      focusable, under44: smallN, under44List: small,
      clip: { x: Math.max(0, Math.floor(left + scrollX)), y: Math.max(0, Math.floor(top + scrollY)), width: Math.ceil(right - left) + 1, height: Math.ceil(bottom - top) + 1 },
    }
  }, { root, scan })
}

/** Distinct colours in a 24 x 24 grid over the whole picture and over its lower half, decoded in the page (no image library). */
export function distinctColours(page: Page, png: Buffer): Promise<{ all: number; lower: number }> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    const grid = (y0: number, y1: number) => {
      const seen = new Set<number>()
      const N = 24
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const x = Math.min(bmp.width - 1, Math.floor(((ix + 0.5) / N) * bmp.width))
          const y = Math.min(bmp.height - 1, y0 + Math.floor(((iy + 0.5) / N) * (y1 - y0)))
          const d = ctx.getImageData(x, y, 1, 1).data
          seen.add((d[0] << 16) | (d[1] << 8) | d[2])
        }
      }
      return seen.size
    }
    const out = { all: grid(0, bmp.height), lower: grid(Math.floor(bmp.height / 2), bmp.height) }
    bmp.close()
    return out
  }, png.toString('base64'))
}

export const BLANK_BELOW = 8
