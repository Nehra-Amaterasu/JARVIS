// The jury bench (package BENCH): shared/kit, shared/art and shared/lamp mounted in a real Chromium, every exported
// component in each of its states, in the light and the dark clay theme, without touching the app.
//
// The page (e2e/bench/entry.tsx) is built in memory by Vite from the real components and the real token, kit, art and
// lamp stylesheets and served from a fake origin, as planned.spec.ts does; nothing is written near app/ui/dist and no
// server, token or port is involved (port 8790 is only started because the shared config starts the sandbox).
//
// What is asserted, per component (spec rows in e2e/bench/inpage.js):
//   a  forced-colors: active: every control keeps an edge and a focus outline; the five lamp shapes stay distinct
//   b  hit area at least 44 x 44 CSS px, the box plus any ::after extension found by elementFromPoint probes
//   c  Tab reaches every control; aria-disabled controls stay focusable (no disabled attribute)
//   d  reduced motion: no running animation after 1 s; motion allowed: none running after 6 s, no DOM churn, no rAF
//      loop and no live setInterval in the 7th second
//   e  greyscale: the five lamp glyphs differ as pixels
//   f  text 4.5:1 (3:1 large) against its real backdrop, and control edges 3:1, light and dark
//
// A failure is a FINDING. It is never hidden by weakening an assertion; it is listed in KNOWN below with the component,
// the measured value and the rule, so the suite is green while the list shows the debt. A KNOWN entry that stops failing
// fails the suite (delete it: the debt is paid), and a failure that is not in KNOWN fails the suite (a new regression).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'
import { KNOWN, type Known, type Rule } from './bench/known'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'test-results', 'jury-bench')
const URL_ = 'http://jury-bench.test/'
const INPAGE = readFileSync(resolve(ROOT, 'e2e/bench/inpage.js'), 'utf8')
const THEMES = ['light', 'dark'] as const
type Theme = (typeof THEMES)[number]
const OVERLAYS = ['Drawer', 'Sheet', 'Popover', 'RetroDialog', 'RetroDialogDestructive'] as const

// The page is N01's e2e/bench/entry.tsx plus G01's wave 5 specimens (src/__tests__/kit/bench-g01.tsx: LitPanel,
// PlannedGlyph, the planned plate in its bracket frame), joined by a two-line entry written into the test output folder
// (a virtual module is not resolved as a lib entry by this Vite), so neither file imports the other.
const MAIN = resolve(OUT, 'bench-main.ts')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const MAIN_SRC = [resolve(ROOT, 'e2e/bench/entry.tsx'), resolve(ROOT, 'src/__tests__/kit/bench-g01.tsx')].map((p) => `import ${JSON.stringify(posix(p))}`).join('\n')

let bundle: Promise<{ js: string; css: string }> | null = null
function buildBench() {
  bundle ??= (async () => {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(MAIN, MAIN_SRC + String.fromCharCode(10))
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      // typed loosely: this Vite's ESBuildOptions typing omits jsx, but the option is honoured (the entry has no React import)
      esbuild: { jsx: 'automatic' } as Record<string, unknown>,
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry: MAIN, formats: ['iife'], name: 'JuryBench', fileName: 'bench' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the bench build produced no script')
    // The legacy ww-* controls pick Paper (light) from html[data-theme='paper']; the clay theme owns that attribute here.
    css = css.replace(/html\[data-theme='(paper|indigo)'\]/g, "[data-ww-theme='$1']")
    return { js, css }
  })()
  return bundle
}

// ------------------------------------------------------------------------------------------------ the edge rule (craft pass)
// Decided 13 Nov (craft pass, docs/research/product-design-overhaul.md): WCAG 1.4.11 asks for 3:1 on the visual
// information needed to IDENTIFY a component or its STATE. So, in the default light and dark themes:
//   state-bearing parts keep the old 3:1 check (own fill, own border, an SVG stroke, or a bordered container two levels
//     up): fields (input, textarea, select, textbox, combobox, spinbutton), switches, sliders and custom checkboxes;
//   a SELECTED piece (aria-selected, aria-checked or aria-pressed true on a tab, radio, option-like or toggle button)
//     must be 3:1 by its OWN fill or border against what is around it (no container fallback: the piece itself is the
//     information);
//   every other control is identified by its label and its shape: it passes when it has a visible text label at 4.5:1
//     (3:1 large) against its own face, or a named icon whose stroke or fill is 3:1 against its face; a control with
//     neither still needs the old 3:1 edge.
// Focus is checked in these themes too (it was only checked under forced colours): every kit and lamp control, on
// focus, draws a ring at least 2 px wide, at 3:1 against the ground beside it, with an offset of at least 2 px (an
// inset ring is allowed where the spec asks for one: inside [data-focus-inset] bars and on the chamfered plate).
// The high-contrast theme and forced colours keep the old rule for EVERY control: (h) below runs the original
// scanContrast with data-contrast='high', and (a) keeps the forced-colours edge scan unchanged.
const EDGE_RULES = `(() => {
  const bn = window.__bn
  if (!bn || bn.__craft) return
  bn.__craft = true
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (s) => { if (!s || s === 'transparent' || s === 'none') return [0, 0, 0, 0]; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#010203'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), a + b[3] * (1 - a)] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const backdrop = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y)
    let i = stack.indexOf(el); if (i < 0) i = 0
    const layers = []
    for (; i < stack.length; i++) {
      const cs = getComputedStyle(stack[i])
      if (stack[i] instanceof SVGElement) continue
      const c = rgba(cs.backgroundColor); c[3] *= parseFloat(cs.opacity)
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break }
    }
    let acc = [255, 255, 255, 1]
    const root = rgba(getComputedStyle(document.documentElement).backgroundColor)
    if (!layers.length || layers[layers.length - 1][3] < 0.999) acc = root[3] > 0 ? root : acc
    for (let k = layers.length - 1; k >= 0; k--) acc = over(layers[k], acc)
    return acc
  }
  const worse = (map, key, score, text) => { const cur = map[key]; if (!cur) map[key] = { score, text, count: 1 }; else { cur.count++; if (score < cur.score) { cur.score = score; cur.text = text } } }
  const describe = (el) => { const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28); const c = (el.getAttribute('class') || '').split(' ')[0]; return el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + (c ? '.' + c : '') + ' "' + t + '"' }
  const FIELD = 'input:not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [role=textbox], [role=combobox], [role=searchbox], [role=spinbutton]'
  const on = (el) => ['aria-selected', 'aria-checked', 'aria-pressed'].some((a) => el.getAttribute(a) === 'true')
  const kind = (el) => {
    const role = el.getAttribute('role') || ''
    if (el instanceof SVGElement) return 'mark' // an SVG mark: its edge is its stroke, judged by the original rule
    if (el.matches(FIELD) || ['switch', 'slider', 'checkbox'].includes(role)) return 'state'
    if (on(el) && (['tab', 'radio', 'menuitemradio', 'menuitemcheckbox'].includes(role) || el.hasAttribute('aria-pressed'))) return 'selected'
    return 'labelled'
  }
  const face = (el) => { const r = el.getBoundingClientRect(); const outside = backdrop(el.parentElement || el, Math.max(0, r.left - 3), r.top + r.height / 2); return over(rgba(getComputedStyle(el).backgroundColor), outside) }
  const hiddenText = (n) => !!n.parentElement.closest('.k-vh, .ww-sr-only, .art-sr, [hidden]')
  const label = (el) => {
    const f = face(el)
    let best = null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let n
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim() || hiddenText(n)) continue
      range.selectNodeContents(n)
      const rc = range.getBoundingClientRect()
      if (rc.width < 2 || rc.height < 2) continue
      const cs = getComputedStyle(n.parentElement)
      const fs = parseFloat(cs.fontSize)
      const need = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5
      const r = ratio(over(rgba(cs.color), f), f)
      if (!best || r - need > best.margin) best = { margin: r - need, text: r.toFixed(2) + ':1 text "' + n.nodeValue.trim().slice(0, 16) + '" (needs ' + need + ')' }
    }
    if (best && best.margin >= 0) return { ok: true }
    const named = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
    if (named) for (const sh of el.querySelectorAll('svg path, svg circle, svg rect, svg line, svg polyline, svg polygon, svg ellipse')) {
      const sc = getComputedStyle(sh)
      for (const p of [sc.stroke, sc.fill]) { if (!p || p === 'none') continue; if (ratio(over(rgba(p), f), f) >= 3) return { ok: true } }
    }
    return { ok: false, why: best ? best.text : 'no visible label' }
  }
  const ownEdge = (el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    const outside = backdrop(el.parentElement || el, Math.max(0, r.left - 3), r.top + r.height / 2)
    let best = ratio(over(rgba(cs.backgroundColor), outside), outside)
    for (const s of ['top', 'right', 'bottom', 'left']) if (parseFloat(cs['border-' + s + '-width']) >= 1 && cs['border-' + s + '-style'] !== 'none') best = Math.max(best, ratio(over(rgba(cs['border-' + s + '-color']), outside), outside))
    return best
  }
  const original = bn.scanContrast
  bn.scanContrastAll = original
  bn.scanContrast = () => {
    const r = original()
    for (const k of Object.keys(r.out)) if (k.endsWith('|edge-contrast')) delete r.out[k]
    // the old per-control verdicts, re-run one control at a time so each can be judged by its kind
    for (const el of bn.interactive()) {
      if (['img', 'group', 'presentation'].includes(el.getAttribute('role') || '') && el.tagName !== 'BUTTON') continue
      if (el.tagName === 'INPUT' && ['range', 'checkbox', 'radio'].includes(el.type)) continue
      if (el.getAttribute('role') === 'option') continue
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const o = bn.owner(el)
      const k = kind(el)
      bn.stats['edge-kind:' + k] = (bn.stats['edge-kind:' + k] || 0) + 1
      if (k === 'selected') {
        const e = ownEdge(el)
        if (e < 3) worse(r.out, o + '|edge-contrast', e - 3, 'selected piece ' + e.toFixed(2) + ':1 against its neighbours needs 3:1: ' + describe(el))
        continue
      }
      if (k === 'labelled') {
        const l = label(el)
        if (l.ok) continue
        if (ownEdge(el) >= 3) continue
      }
      // state-bearing, or an unlabelled control: the original rule, as the original scan judged this owner
      const key = o + '|edge-contrast'
      const e = (() => {
        let best = ownEdge(el)
        if (el instanceof SVGElement) for (const sh of el.querySelectorAll('circle, rect, path, polygon, ellipse, line')) { const sc = getComputedStyle(sh); const rr = el.getBoundingClientRect(); const out = backdrop(el.parentElement || el, Math.max(0, rr.left - 3), rr.top + rr.height / 2); for (const p of [sc.stroke, sc.fill]) { if (p === 'none') continue; best = Math.max(best, ratio(over(rgba(p), out), out)) } }
        let p = el.parentElement
        for (let i = 0; i < 2 && p && best < 3; i++, p = p.parentElement) {
          const pc = getComputedStyle(p); const pr = p.getBoundingClientRect()
          const po = backdrop(p.parentElement || p, Math.max(0, pr.left - 3), pr.top + 2)
          for (const s of ['top', 'right', 'bottom', 'left']) if (parseFloat(pc['border-' + s + '-width']) >= 1 && pc['border-' + s + '-style'] !== 'none') best = Math.max(best, ratio(over(rgba(pc['border-' + s + '-color']), po), po))
        }
        return best
      })()
      if (e < 3) worse(r.out, key, e - 3, (k === 'state' ? 'state-bearing part ' : k === 'mark' ? 'mark ' : 'unlabelled control ') + e.toFixed(2) + ':1 needs 3:1: ' + describe(el))
    }
    return r
  }
  // the ring in the default themes: at least 2 px, 3:1 against the ground beside it, offset 2 px or more (inset only where the spec allows)
  bn.scanRings = () => {
    const out = {}
    for (const el of bn.interactive()) {
      const o = bn.owner(el)
      if (!/^(kit|lamp)\\//.test(o) && !(bn.OPEN && o !== 'page')) continue
      if (el.getAttribute('role') === 'option') continue
      el.scrollIntoView({ block: 'center', inline: 'center' })
      el.focus({ preventScroll: true })
      let host = null
      for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) {
        if (e !== el && !e.matches(':focus-within')) continue
        const cs = getComputedStyle(e)
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && rgba(cs.outlineColor)[3] > 0) { host = e; break }
      }
      bn.stats['ring:' + (host ? (host === el ? 'self' : 'ancestor') : 'none')] = (bn.stats['ring:' + (host ? (host === el ? 'self' : 'ancestor') : 'none')] || 0) + 1
      if (!host) { if (!(el instanceof SVGElement)) worse(out, o + '|focus', 0, 'no focus ring in the default theme: ' + describe(el)); el.blur(); continue }
      const cs = getComputedStyle(host)
      const w = parseFloat(cs.outlineWidth)
      const off = parseFloat(cs.outlineOffset)
      const inset = !!host.closest('[data-focus-inset]') || host.classList.contains('k-chamfer')
      const r = host.getBoundingClientRect()
      const ground = backdrop(host.parentElement || host, Math.max(0, r.left - Math.max(off, 0) - w - 2), r.top + r.height / 2)
      const c = ratio(over(rgba(cs.outlineColor), ground), ground)
      if (w < 2) worse(out, o + '|focus', w - 2, 'ring ' + w + ' px needs 2 px: ' + describe(el))
      else if (!inset && off < 2) worse(out, o + '|focus', off - 2, 'ring offset ' + off + ' px needs 2 px: ' + describe(el))
      else if (c < 3) worse(out, o + '|focus', c - 3, 'ring ' + c.toFixed(2) + ':1 against the ground needs 3:1: ' + describe(el))
      el.blur()
    }
    return out
  }
})()`

const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`

async function openBench(page: Page, theme: Theme, open = '') {
  const { js, css } = await buildBench()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jury bench</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?theme=${theme}${open ? `&open=${open}` : ''}`)
  await page.locator('[data-bench]').first().waitFor()
  await page.evaluate(INPAGE)
  await page.evaluate(EDGE_RULES)
  await page.waitForTimeout(400) // the 160 ms colour cross-fades of the ww controls must finish before any colour is sampled
}

// ------------------------------------------------------------------------------------------------ findings ledger
interface Hit { score: number; text: string; count: number }
type Scan = Record<string, Hit>
interface Finding { theme: Theme; component: string; rule: string; measured: string; count: number }
const findings: Finding[] = []
/** How much each scan looked at, summed over the main page and the five overlay pages. */
const STATS: Record<string, Record<string, number>> = {}
const addStats = (label: string, s: Record<string, number>) => {
  STATS[label] ??= {}
  for (const [k, v] of Object.entries(s)) STATS[label][k] = (STATS[label][k] ?? 0) + v
}

const knownKey = (k: Known) => `${k.component}|${k.rule}`
/** Compare what a scan found with KNOWN for this theme; both an unlisted failure and a stale entry fail the test. */
function settle(theme: Theme, rules: Rule[], scan: Scan, scope: (component: string) => boolean = () => true) {
  const found = new Map<string, Hit>()
  for (const [k, v] of Object.entries(scan)) {
    const [component, rule] = k.split('|')
    if (!rules.includes(rule as Rule) || !scope(component)) continue
    found.set(k, v)
    findings.push({ theme, component, rule, measured: v.text, count: v.count })
  }
  if (process.env.BENCH_LEARN) return // measuring only: findings.json is written, nothing is compared
  const listed = KNOWN.filter((k) => rules.includes(k.rule) && (!k.themes || k.themes.includes(theme)) && scope(k.component))
  const listedKeys = new Set(listed.map(knownKey))
  const unlisted = [...found.keys()].filter((k) => !listedKeys.has(k)).map((k) => `${k}: ${found.get(k)!.text}`)
  const stale = listed.filter((k) => !found.has(knownKey(k))).map(knownKey)
  expect(unlisted, `new failures (not in KNOWN), ${theme}`).toEqual([])
  expect(stale, `KNOWN entries that no longer fail, ${theme}: delete them`).toEqual([])
}

const merge = (...s: Scan[]): Scan => {
  const out: Scan = {}
  for (const one of s) for (const [k, v] of Object.entries(one)) out[k] = out[k] ? { score: Math.min(out[k].score, v.score), text: out[k].score <= v.score ? out[k].text : v.text, count: out[k].count + v.count } : { ...v }
  return out
}

async function scanAllPages(page: Page, theme: Theme, fn: () => Promise<Scan>, includeOverlays = true): Promise<Scan> {
  const label = `${test.info().title}`
  const grab = async () => addStats(label, (await page.evaluate('window.__bn.stats')) as Record<string, number>)
  await openBench(page, theme)
  const parts = [await fn()]
  await grab()
  if (includeOverlays) {
    for (const o of OVERLAYS) {
      await openBench(page, theme, o)
      await page.waitForTimeout(250) // the 200 ms sheet and 120 ms popover entrances settle before the probes
      parts.push(await fn())
      await grab()
    }
  }
  return merge(...parts)
}

test.setTimeout(180_000)

// BENCH_PEEK=Popover:dark writes a screenshot of one overlay to test-results/jury-bench/peek.png (a debugging aid)
test('peek', async ({ page }) => {
  const peek = process.env.BENCH_PEEK
  test.skip(!peek, 'set BENCH_PEEK=<Overlay>:<theme> to use')
  const [o, t] = peek!.split(':')
  await openBench(page, t as Theme, o)
  await page.waitForTimeout(500)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: resolve(OUT, 'peek.png') })
})

async function tabScan(page: Page): Promise<Scan> {
  const n = (await page.evaluate('window.__bn.tabPrep()')) as number
  await page.mouse.move(0, 0)
  // scrollable regions are Tab stops too, so the budget is generous; stop early once focus has left the page
  for (let i = 0; i < n * 2 + 30; i++) {
    await page.keyboard.press('Tab')
    if (i > 3 && (await page.evaluate('window.__bn.tabAtEnd()'))) break
  }
  return (await page.evaluate('window.__bn.tabResult()')) as Scan
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(resolve(OUT, 'findings.json'), JSON.stringify({ stats: STATS, findings, known: KNOWN }, null, 1))
  const rows = findings.map((f) => `| ${f.theme} | ${f.component} | ${f.rule} | ${f.count} | ${f.measured.replace(/\|/g, '/')} |`)
  writeFileSync(resolve(OUT, 'findings.md'), ['| theme | component | rule | hits | worst measured |', '|---|---|---|---|---|', ...rows].join('\n') + '\n')
})

// ------------------------------------------------------------------------------------------------ harness canary
// A scan that finds nothing proves nothing, so one deliberately bad control and one moving element must be caught.
test('harness canary: every scan sees a deliberately bad control', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await openBench(page, 'light')
  await page.evaluate(() => {
    const d = document.createElement('section')
    d.dataset.bench = 'canary/Bad'
    d.innerHTML =
      '<button id="c1" type="button" style="width:20px;height:20px;border:0;background:transparent;outline:none;color:#777">x</button>' +
      '<div role="button" style="color:#777;background:#888;padding:4px;font-size:12px">low contrast</div>' +
      '<i id="c3" style="display:block;width:10px;height:10px;background:currentColor;animation:cn 1s linear infinite"></i><style>@keyframes cn{to{transform:rotate(1turn)}}</style>'
    document.getElementById('bn-root')!.append(d)
  })
  const edges = (await page.evaluate('window.__bn.scanEdges()')) as Scan
  const hits = (await page.evaluate('window.__bn.scanHits()')) as Scan
  const tabs = await tabScan(page)
  const anim = (await page.evaluate('window.__bn.anims()')) as Scan
  await page.emulateMedia({ forcedColors: 'none' })
  const contrast = ((await page.evaluate('window.__bn.scanContrast()')) as { out: Scan }).out
  for (const [name, scan, key] of [['edge', edges, 'canary/Bad|edge'], ['focus', edges, 'canary/Bad|focus'], ['hit', hits, 'canary/Bad|hit'], ['tab', tabs, 'canary/Bad|tab'], ['motion', anim, 'canary/Bad|motion'], ['contrast', contrast, 'canary/Bad|contrast']] as const) {
    expect(Object.keys(scan), `the ${name} scan caught the canary`).toContain(key)
  }
})

// ------------------------------------------------------------------------------------------------ coverage
test('every exported component of kit, art and lamp is on the bench', async ({ page }) => {
  await openBench(page, 'light')
  const r = await page.evaluate(() => {
    const b = (window as unknown as { __bench: { exports: Record<string, string[]>; rendered: () => string[] } }).__bench
    const drawn = new Set(b.rendered())
    const missing: string[] = []
    for (const [pkg, names] of Object.entries(b.exports)) for (const n of names) if (!drawn.has(`${pkg}:${n}`)) missing.push(`${pkg}:${n}`)
    return { missing, counts: Object.fromEntries(Object.entries(b.exports).map(([k, v]) => [k, v.length])) }
  })
  addStats('exports drawn (capitalised function exports)', r.counts)
  expect(r.missing, 'exports the bench does not draw').toEqual([])
  expect(r.counts.kit).toBeGreaterThanOrEqual(42) // 40 before wave 5, plus LitPanel and PlannedGlyph (G01)
  expect(r.counts.art).toBeGreaterThanOrEqual(19)
  expect(r.counts.lamp).toBe(5) // Lamp, LampGlyph, Reading, Annunciators and, from wave 5, PlannedGlyph
})

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    // ---------------------------------------------------------------------------------------- a: forced colours
    test(`(a) forced colours: every control keeps an edge and a focus outline [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      const scan = await scanAllPages(page, theme, () => page.evaluate('window.__bn.scanEdges()') as Promise<Scan>)
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
      settle(theme, ['edge', 'focus'], scan)
    })

    test(`(a) forced colours: the five lamp shapes stay distinct, drawn and as markup [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      await openBench(page, theme)
      const sigs = (await page.evaluate('window.__bn.signatures()')) as Record<string, string[]>
      for (const [set, list] of Object.entries(sigs)) {
        expect(list.length, `${set}: five glyphs found`).toBe(5)
        expect(new Set(list).size, `${set}: five different SVG bodies`).toBe(5)
      }
      // and as pixels, because identical markup is not the only way two shapes can look alike
      const sets = await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as { __bn: { glyphSets(): Record<string, Element[]> } }).__bn.glyphSets()).map(([k, v]) => [k, v.length])))
      for (const set of Object.keys(sets)) {
        const shots: string[] = []
        for (let i = 0; i < 5; i++) {
          const loc = page.locator(set === 'lamp/LampGlyph' ? '[data-bench="lamp/LampGlyph"] svg.lamp-glyph' : set === 'kit/Lamp' ? '[data-bench="kit/Lamp"] [data-form="glyph only"] svg' : '[data-bench="art/ArtTable"] [data-form="marks and tags"] .bn-cell > svg.art-mark').nth(i)
          shots.push('data:image/png;base64,' + (await loc.screenshot()).toString('base64'))
        }
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
          const d = (await page.evaluate(([a, b]) => (window as unknown as { __bn: { pixelDiff(a: string, b: string): Promise<number> } }).__bn.pixelDiff(a, b), [shots[i], shots[j]])) as number
          expect(d, `${set}: glyph ${i} vs ${j} differ under forced colours (fraction of pixels)`).toBeGreaterThan(0.02)
        }
      }
    })

    // ---------------------------------------------------------------------------------------- b: hit areas
    test(`(b) every control is at least 44 x 44 CSS px, ::after extensions included [${theme}]`, async ({ page }) => {
      const scan = await scanAllPages(page, theme, () => page.evaluate('window.__bn.scanHits()') as Promise<Scan>)
      settle(theme, ['hit'], scan)
    })

    // ---------------------------------------------------------------------------------------- c: keyboard
    test(`(c) Tab reaches every control and aria-disabled controls stay focusable [${theme}]`, async ({ page }) => {
      const run = () => tabScan(page)
      const scan = await scanAllPages(page, theme, run)
      settle(theme, ['tab'], scan)
    })

    // ---------------------------------------------------------------------------------------- d: motion
    test(`(d) reduced motion: no running animation after 1 s [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openBench(page, theme)
      await page.waitForTimeout(1000)
      const running = (await page.evaluate('window.__bn.anims()')) as Scan
      const churn = (await page.evaluate('window.__bn.mutationWindow(1000)')) as Scan
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
      settle(theme, ['motion', 'churn'], merge(running, churn))
    })

    test(`(d) motion allowed: nothing is animating, churning or looping after 6 s [${theme}]`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.addInitScript(() => {
        const w = window as unknown as { __raf: number; __ivl: Set<number> }
        w.__raf = 0
        w.__ivl = new Set()
        const raf = window.requestAnimationFrame.bind(window)
        window.requestAnimationFrame = (f) => (w.__raf++, raf(f))
        const si = window.setInterval.bind(window)
        window.setInterval = ((...a: Parameters<typeof setInterval>) => {
          const id = si(...a) as unknown as number
          w.__ivl.add(id)
          return id
        }) as typeof setInterval
        const ci = window.clearInterval.bind(window)
        window.clearInterval = ((id?: number) => (w.__ivl.delete(id as number), ci(id))) as typeof clearInterval
      })
      await openBench(page, theme)
      await page.waitForTimeout(6200)
      const running = (await page.evaluate('window.__bn.anims()')) as Scan
      await page.evaluate(() => ((window as unknown as { __raf: number }).__raf = 0))
      const churn = (await page.evaluate('window.__bn.mutationWindow(1000)')) as Scan
      const loops = await page.evaluate(() => ({ raf: (window as unknown as { __raf: number }).__raf, intervals: (window as unknown as { __ivl: Set<number> }).__ivl.size }))
      const idle: Scan = {}
      if (loops.raf > 0) idle['page|idle-loop'] = { score: 0, count: loops.raf, text: `${loops.raf} requestAnimationFrame calls in the 7th second` }
      if (loops.intervals > 0) idle['page|idle-loop'] = { score: 0, count: loops.intervals, text: `${loops.intervals} setInterval timers still live at 7 s` }
      settle(theme, ['motion', 'churn', 'idle-loop'], merge(running, churn, idle))
    })

    // ---------------------------------------------------------------------------------------- e: greyscale
    test(`(e) greyscale: the five lamp glyphs differ as shapes [${theme}]`, async ({ page }) => {
      await openBench(page, theme)
      await page.addStyleTag({ content: 'html{filter:grayscale(1)}' })
      const groups: [string, string][] = [
        ['lamp/LampGlyph', '[data-bench="lamp/LampGlyph"] svg.lamp-glyph'],
        ['kit/Lamp', '[data-bench="kit/Lamp"] [data-form="glyph only"] svg'],
        ['art/StateMark', '[data-bench="art/ArtTable"] [data-form="marks and tags"] .bn-cell > svg.art-mark'],
      ]
      const scan: Scan = {}
      for (const [name, sel] of groups) {
        const shots: string[] = []
        for (let i = 0; i < 5; i++) shots.push('data:image/png;base64,' + (await page.locator(sel).nth(i).screenshot()).toString('base64'))
        let worst = 1
        let pair = ''
        for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
          const d = (await page.evaluate(([a, b]) => (window as unknown as { __bn: { pixelDiff(a: string, b: string): Promise<number> } }).__bn.pixelDiff(a, b), [shots[i], shots[j]])) as number
          if (d < worst) { worst = d; pair = `${i} vs ${j}` }
        }
        if (worst < 0.02) scan[`${name}|grey`] = { score: worst, count: 1, text: `glyphs ${pair} differ in ${(worst * 100).toFixed(1)}% of pixels (needs 2%)` }
      }
      settle(theme, ['grey'], scan)
    })

    // ---------------------------------------------------------------------------------------- f: contrast
    test(`(f) text 4.5:1 (3:1 large) and control edges 3:1 [${theme}]`, async ({ page }) => {
      const skipped = { image: 0, hidden: 0 }
      const run = async () => {
        const r = (await page.evaluate('window.__bn.scanContrast()')) as { out: Scan; skipped: typeof skipped }
        skipped.image += r.skipped.image
        skipped.hidden += r.skipped.hidden
        return r.out
      }
      const scan = await scanAllPages(page, theme, run)
      mkdirSync(OUT, { recursive: true })
      writeFileSync(resolve(OUT, `contrast-skips-${theme}.json`), JSON.stringify(skipped))
      settle(theme, ['contrast', 'edge-contrast'], scan)
    })

    // ---------------------------------------------------------------------------------------- f2: the ring, default theme
    test(`(f) every kit and lamp control draws a 2 px focus ring at 3:1 with a 2 px offset [${theme}]`, async ({ page }) => {
      const scan = await scanAllPages(page, theme, () => page.evaluate('window.__bn.scanRings()') as Promise<Scan>)
      settle(theme, ['focus'], scan)
    })

    // ---------------------------------------------------------------------------------------- h: high contrast, the old rule for every control
    test(`(h) high contrast: text 4.5:1 and EVERY control's edge 3:1, labelled or not [${theme}]`, async ({ page }) => {
      const run = async () => {
        await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
        await page.waitForTimeout(300) // the 120 ms colour cross-fades of the ww controls settle before any colour is sampled
        return ((await page.evaluate('window.__bn.scanContrastAll()')) as { out: Scan }).out
      }
      const scan = await scanAllPages(page, theme, run)
      settle(theme, ['contrast', 'edge-contrast'], scan)
    })
  })
}

// ------------------------------------------------------------------------------------------------ reflow at phone width
for (const theme of THEMES) {
  test(`(reflow) nothing is wider than a 390 px viewport [${theme}]`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openBench(page, theme)
    settle(theme, ['reflow'], (await page.evaluate('window.__bn.reflow()')) as Scan)
  })
}

// ------------------------------------------------------------------------------------------------ material branches
// The clay recipe (20.4.4, and the craft pass of 13 Nov) as the browser computes it, in its four branches: normal (the
// highlight and shade pair, the rim, the engraved well, grain), high contrast by the in-app switch (grain, highlight
// and wells off, the shade stays as feel, every rim and engraving becomes the strong edge) and forced colours (every
// shade, grain and filter off). tokens.test.ts proves the OS route (prefers-contrast: more) carries the same
// declarations as the switch, so one route is measured here.
interface Material { key: string; keyRim: string[]; well: string; wellEdge: string[]; panel: string; panelShade: string; grain: number; grainShown: string; errBorder: string; plannedBorder: string }
const layers = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim())
/** the x and y offsets of one computed shadow layer ("rgba(...) 4px 6px 12px 0px [inset]") */
const offsets = (layer: string) => layer.replace(/rgba?\([^)]*\)/, '').trim().split(/\s+/).slice(0, 2).map(parseFloat)
const material = (page: Page) =>
  page.evaluate((): Material => {
    const q = (s: string) => document.querySelector(s) as HTMLElement
    const inner = q('.k-panel .k-panel-in')
    return {
      key: getComputedStyle(q('.k-key')).boxShadow,
      keyRim: ['Top', 'Right', 'Bottom', 'Left'].map((s) => getComputedStyle(q('.k-key')).getPropertyValue(`border-${s.toLowerCase()}-color`)),
      well: getComputedStyle(q('.k-switch')).boxShadow,
      wellEdge: ['top', 'right', 'bottom', 'left'].map((s) => getComputedStyle(q('.k-switch[data-on="false"]')).getPropertyValue(`border-${s}-color`)),
      panel: getComputedStyle(q('.k-panel:not([data-state])')).filter,
      panelShade: getComputedStyle(q('.k-panel:not([data-state]) .k-panel-in')).boxShadow,
      grain: Number(getComputedStyle(inner, '::before').opacity),
      grainShown: getComputedStyle(inner, '::before').display,
      // the error panel's edge is the card's own 2 px border (or, chamfered, its clipped ::before); a box border would frame it as a square
      errBorder: getComputedStyle(q(".k-panel[data-state='error']")).borderTopWidth,
      plannedBorder: getComputedStyle(q(".k-panel[data-state='planned']")).borderTopWidth,
    }
  })
for (const theme of THEMES) {
  test(`(material) lit lip, shade, well and grain in normal, high-contrast and forced branches [${theme}]`, async ({ page }) => {
    await openBench(page, theme)
    const normal = await material(page)
    // craft pass: the raised key is a 1 px lit lip drawn inside the face (one inset layer, down and right of the top-left
    // edge, so it follows the curve) in front of the pair (a highlight up and left, a shade down and right); three
    // layers, and no outline at all: the border is transparent on every side (14 Nov: a two-colour border lip notched
    // the orange pill at the corners where its colours met)
    const kl = layers(normal.key)
    expect(kl.length, 'the lip plus the pair').toBe(3)
    expect(/inset/.test(kl[0]) && !/inset/.test(kl[1]) && !/inset/.test(kl[2]), `only the lip is inset: ${normal.key}`).toBe(true)
    const [lx, ly] = offsets(kl[0].replace('inset', ''))
    expect([lx, ly], 'the lip sits on the lit edge').toEqual([1, 1])
    const [hx, hy] = offsets(kl[1])
    const [sx, sy] = offsets(kl[2])
    expect([hx < 0, hy < 0, sx > 0, sy > 0], `the light comes from the top left: ${normal.key}`).toEqual([true, true, true, true])
    expect(normal.keyRim.every((c) => c === 'rgba(0, 0, 0, 0)'), 'no outline on any side').toBe(true)
    expect(normal.well, 'the switch track is a well').toMatch(/inset/)
    expect(normal.wellEdge.every((c) => c !== 'rgba(0, 0, 0, 0)'), 'the well is engraved on all four sides').toBe(true)
    expect(normal.wellEdge[0], 'the engraving has two sides').not.toBe(normal.wellEdge[2])
    expect(normal.panel, 'the soft card casts no filter shade (that was the chamfer)').toBe('none')
    expect(layers(normal.panelShade).length, 'the card casts the raised pair').toBe(2)
    expect(normal.grain).toBeCloseTo(0.025, 3)
    expect(normal.errBorder, 'the error panel draws its fault edge on the card, not a square box border round it').toBe('0px')
    expect(normal.plannedBorder, 'the planned panel is drawn by the dashed edge of the card, not a square box border').toBe('0px')

    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
    const hc = await material(page)
    expect(hc.grain, 'high contrast: no grain').toBe(0)
    expect(hc.well, 'high contrast: the well is edge only').toBe('none')
    expect(layers(hc.key)[1], 'high contrast: the highlight is transparent').toMatch(/^rgba\(0, 0, 0, 0\)/)
    expect(layers(hc.key)[0], 'high contrast: the lip is transparent').toMatch(/^rgba\(0, 0, 0, 0\)/)
    expect(new Set(hc.keyRim).size, 'high contrast: the key is outlined on all four sides in one strong edge').toBe(1)
    expect(hc.keyRim[0]).not.toBe('rgba(0, 0, 0, 0)')
    expect(new Set(hc.wellEdge).size, 'high contrast: the well edge is one strong edge').toBe(1)

    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'))
    await page.emulateMedia({ forcedColors: 'active' })
    const forced = await material(page)
    expect(forced.key, 'forced colours: no shade').toBe('none')
    expect(forced.well).toBe('none')
    expect(forced.panel, 'forced colours: no drop filter').toBe('none')
    expect(forced.panelShade, 'forced colours: the card casts no shade').toBe('none')
    expect(forced.grainShown, 'forced colours: no grain layer').toBe('none')
    expect(forced.errBorder, 'forced colours: the error panel keeps its 2 px border').toBe('2px')
  })
}

// ------------------------------------------------------------------------------------------------ one accent per view
// 20.4.4 "Pulse accent": one --accent-fill per view, on the primary action or the current item. The lint resolves the
// accent through a probe element (a CSS variable is a string until the browser computes it) and counts, per
// [data-view], the elements whose computed background is that colour. The bench has no data-view of its own, so a
// canary proves the count: one view with two accent fills (caught) and one with a single fill (passes). Wired here
// first; the section packages add their views to a page this lint runs on.
const ACCENT_LINT = `(() => {
  const probe = document.createElement('i')
  probe.style.background = 'var(--accent-fill)'
  document.body.append(probe)
  const accent = getComputedStyle(probe).backgroundColor
  probe.remove()
  const out = {}
  for (const v of document.querySelectorAll('[data-view]')) {
    let n = 0
    for (const el of v.querySelectorAll('*')) if (getComputedStyle(el).backgroundColor === accent) n++
    out[v.getAttribute('data-view')] = n
  }
  return { accent, out }
})()`
for (const theme of THEMES) {
  test(`(accent) at most one accent-filled element per data-view, and the lint catches two [${theme}]`, async ({ page }) => {
    await openBench(page, theme)
    await page.evaluate(() => {
      const view = (id: string, n: number) => {
        const v = document.createElement('section')
        v.setAttribute('data-view', id)
        for (let i = 0; i < n; i++) {
          const b = document.createElement('button')
          b.className = 'k-btn'
          b.setAttribute('data-primary', 'true')
          b.textContent = `Go ${i}`
          v.append(b)
        }
        document.body.append(v)
      }
      view('lint.two', 2)
      view('lint.one', 1)
    })
    const r = (await page.evaluate(ACCENT_LINT)) as { accent: string; out: Record<string, number> }
    expect(r.accent, 'the accent resolved to a colour').toMatch(/^rgb/)
    expect(r.out['lint.two'], 'the canary view with two accent fills is caught').toBe(2)
    expect(r.out['lint.one']).toBe(1)
    const over = Object.entries(r.out).filter(([id, n]) => !id.startsWith('lint.') && n > 1)
    expect(over, 'views with more than one accent fill').toEqual([])
  })
}

// ------------------------------------------------------------------------------------------------ screenshots
const SHOTS: { name: string; theme: Theme; forced?: boolean; grey?: boolean; hc?: boolean }[] = [
  { name: 'light', theme: 'light' },
  { name: 'dark', theme: 'dark' },
  { name: 'high-contrast-light', theme: 'light', hc: true },
  { name: 'forced-colors', theme: 'light', forced: true },
  { name: 'greyscale', theme: 'light', grey: true },
]
const VIEWPORTS = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
for (const s of SHOTS) {
  for (const v of VIEWPORTS) {
    test(`screenshot ${s.name} ${v.w}x${v.h}`, async ({ page }) => {
      await page.setViewportSize({ width: v.w, height: v.h })
      if (s.forced) await page.emulateMedia({ forcedColors: 'active' })
      await page.emulateMedia({ reducedMotion: 'reduce', ...(s.forced ? { forcedColors: 'active' as const } : {}) })
      await openBench(page, s.theme)
      if (s.grey) await page.addStyleTag({ content: 'html{filter:grayscale(1)}' })
      if (s.hc) await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'))
      await page.waitForTimeout(500)
      mkdirSync(OUT, { recursive: true })
      const path = resolve(OUT, `bench-${s.name}-${v.w}x${v.h}.png`)
      await page.screenshot({ path, fullPage: true })
    })
  }
}
