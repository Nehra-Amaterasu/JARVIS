// VIS1: every popover, menu, listbox, palette, drawer and sheet is an opaque surface with readable ink, whatever it is mounted under.
//
// The owner's three faults on the new interface (15 Nov): text that could not be seen in the Well Wisher side rails and in the
// Proof drawer (white on white), text that could not be seen in dropdowns and lists, and panels that slid in over the page with a
// see-through background. The rule this spec keeps: JARVIS is light ink on matte black, Well Wisher is dark ink on light, and every
// overlay sets BOTH its own surface and its own ink, so it reads under either, and its scrim sits below it.
//
// What is asserted, for each surface that can be reached with the shell flag ON, in the JARVIS side (clay-dark) and the Well Wisher
// side (clay-light), at 1366x768 and 390x844:
//   1  the panel's own background is opaque (alpha 1) and the panel is not faded (opacity 1 once its entrance has finished);
//   2  every visible text node, and every input value and placeholder, is at least 4.5:1 (3:1 for large text) against the colour
//      actually behind it, found by walking up to the first opaque ancestor and compositing the translucent layers on the way;
//   3  the panel is above its scrim (the topmost element at the panel's centre is the panel's, and at a point outside the panel
//      the topmost element is the scrim's, so no page chrome is painted over the scrim);
//   4  nothing is clipped by the viewport.
// It runs against the built app (dist-e2e) and the sandbox, as shell-v2.spec.ts does, and skips when dist-e2e is not built.
// VIS1_SHOTS=<folder> writes a PNG of every surface (a folder outside the repository; never Playwright's own output folder).
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.VIS1_SHOTS ? resolve(process.env.VIS1_SHOTS) : ''
type Product = 'jarvis' | 'ww'
const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const

/** A selector that may depend on the viewport width (the DetentRack is a list under the trigger on a desktop and a sheet on a phone). */
type By = string | ((width: number) => string | undefined)
interface Surface {
  id: string
  products: Product[]
  /** Opens it; returns nothing. The panel is found by `panel` afterwards. */
  open: (page: Page) => Promise<void>
  panel: By
  /** The scrim that must sit below the panel, when the surface has one. */
  scrim?: By
  /** Drawn in the page, not over it (a list specimen, a select): opacity and ink are checked, the scrim and the viewport are not. */
  inline?: boolean
  /** Ink only, on a region of the page that is not itself a surface (a rail): no opacity, scrim or viewport checks. */
  ink?: boolean
  /** Reachable at desktop width only (a phone has no such control on the page). */
  desktop?: boolean
}
const by = (b: By | undefined, w: number) => (typeof b === 'function' ? b(w) : b)

/**
 * The stylesheets a lazily loaded Well Wisher or classic page adds to the document and leaves there: the Well Wisher design layer
 * (Saffron Ash tokens on `.ww-portal`), the legacy kit sheet (overlay placement) and the classic pages. A person who opens the
 * classic interface, or any page that loads them, and comes back to the new shell has them under it, and that is the state the
 * owner's screenshots were taken in. 'clean' is the first launch, 'after classic' adds them last, as a lazy chunk would.
 */
const LAZY_CSS = (() => {
  try {
    const dir = resolve(ROOT, 'dist-e2e')
    const html = readFileSync(resolve(dir, 'index.html'), 'utf8')
    return readdirSync(resolve(dir, 'assets'))
      .filter((f) => f.endsWith('.css') && !html.includes(f))
      .map((f) => readFileSync(resolve(dir, 'assets', f), 'utf8'))
  } catch {
    return [] as string[]
  }
})()
const MODES = ['clean', 'after classic'] as const
type Mode = (typeof MODES)[number]

async function boot(page: Page, baseURL: string | undefined, mode: Mode) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; build it with `npx vite build --outDir dist-e2e`')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  if (mode === 'after classic') {
    expect(LAZY_CSS.length, 'the lazy stylesheets of dist-e2e').toBeGreaterThan(0)
    for (const content of LAZY_CSS) await page.addStyleTag({ content })
  }
}
async function toProduct(page: Page, want: Product) {
  const shell = page.locator('[data-shell="v2"]')
  if ((await shell.getAttribute('data-product')) !== want) await page.keyboard.press('Alt+0')
  await expect(shell).toHaveAttribute('data-product', want)
  await page.waitForTimeout(250)
}
async function gallery(page: Page, entry: string) {
  await page.keyboard.press('Alt+n')
  await page.locator('[data-gallery]').waitFor({ timeout: 10_000 })
  await page.locator(`.gl-item[data-entry-id="${entry}"]`).click()
  await page.waitForTimeout(250)
}
const press = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).first().click()

const SURFACES: Surface[] = [
  { id: 'palette', products: ['jarvis', 'ww'], open: (p) => p.keyboard.press('Control+k'), panel: '[data-overlay="palette"]', scrim: '.s2-scrim' },
  {
    id: 'shortcuts', products: ['jarvis', 'ww'],
    open: async (p) => { await p.keyboard.press('Control+k'); await p.keyboard.type('shortcuts'); await p.keyboard.press('Enter') },
    panel: '[data-overlay="shortcuts"]', scrim: '.s2-scrim',
  },
  {
    id: 'kit drawer', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'kit/Drawer'); await press(p, 'Open drawer') },
    panel: '.ww-sheet[data-place="right"][data-state="open"]', scrim: '.ww-scrim[data-state="open"]',
  },
  {
    id: 'kit sheet', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'kit/Drawer'); await press(p, 'Open sheet') },
    panel: '.ww-sheet[data-place="bottom"][data-state="open"]', scrim: '.ww-scrim[data-state="open"]',
  },
  {
    id: 'kit popover', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'kit/Popover'); await press(p, 'Toggle popover') },
    panel: '.ww-popover[data-state="open"]',
  },
  {
    id: 'kit dialog', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'kit/RetroDialog'); await press(p, 'Open dialog') },
    panel: '.k-dialog', scrim: '.k-scrim',
  },
  { id: 'kit palette list', products: ['jarvis', 'ww'], open: (p) => gallery(p, 'kit/PaletteView'), panel: '.k-palette', inline: true },
  {
    id: 'trim popover', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'kit/Trim'); await p.locator('button.tr-key').nth(1).click() },
    panel: '.tr-pop',
  },
  {
    id: 'detent rack', products: ['jarvis', 'ww'],
    open: async (p) => { await gallery(p, 'data/DetentRack'); await p.locator('.d3r-trigger').first().click() },
    panel: (w) => (w < 900 ? '.d3r-portal .d3r-sheet' : '.d3r[data-open]:not([data-flow]) > .d3r-rack'),
    scrim: (w) => (w < 900 ? '.d3r-portal .d3r-scrim' : undefined),
  },
  {
    id: 'field select', products: ['jarvis', 'ww'],
    open: (p) => gallery(p, 'kit/Field'),
    panel: '.ww-field[data-kind="select"] select',
    inline: true,
  },
  { id: 'proof drawer', products: ['ww'], open: (p) => p.locator('.ps-open').click(), panel: '.ps-drawer[data-state="open"]', scrim: '.ww-scrim[data-state="open"]' },
  {
    id: 'plan the day drawer', products: ['ww'],
    open: (p) => press(p, 'Plan the day'),
    panel: '.td-plan[data-state="open"]', scrim: '.ww-scrim[data-state="open"]',
  },
  { id: 'shell rail', products: ['jarvis', 'ww'], open: async () => {}, panel: '.s2-rail', inline: true, ink: true },
  { id: 'proof rail', products: ['ww'], open: async () => {}, panel: '.ps', inline: true, ink: true },
  { id: 'page canvas', products: ['jarvis', 'ww'], open: async () => {}, panel: '.s2-page', inline: true, ink: true },
  {
    id: 'add application drawer', products: ['ww'], desktop: true,
    open: async (p) => { await p.keyboard.press('Control+5'); await press(p, /Add application/) },
    panel: '.ww-sheet[data-state="open"]', scrim: '.ww-scrim[data-state="open"]',
  },
  {
    id: 'tree view settings popover', products: ['ww'], desktop: true,
    // 27 Nov (b): the Tree bar has no "View settings" key any more (the legend is its own row, the stage keys sit beside the stage). The
    // in-tree panel this surface was written to check is still drawn, now behind the "Tree <name> <count>" key (TreePicker), so that opens it.
    open: async (p) => { await p.keyboard.press('Control+4'); await press(p, /^Tree \S/) },
    // under the shell the Tree draws its own in-tree panel (CP2, ww/tree/ShellBars.tsx Panel), not the portaled kit popover
    panel: '.ww-popover[data-state="open"], .ww-tree-panel[role="dialog"]',
  },
]

/** The in-page audit: returns one line per defect. Plain JS, serialised into the page. */
function audit(a: { panel: string; scrim?: string; inline?: boolean; ink?: boolean }): string[] {
  const out: string[] = []
  const panels = Array.from(document.querySelectorAll<HTMLElement>(a.panel)).filter((e) => e.getClientRects().length > 0)
  const panel = panels[0]
  if (!panel) return [`panel not found: ${a.panel}`]
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })!
  type RGBA = [number, number, number, number]
  const parse = (css: string): RGBA => {
    const m = css.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map((s) => (s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s)))
      if (p.length >= 3 && p.every((n) => !Number.isNaN(n))) return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
    }
    cx.globalCompositeOperation = 'copy'
    cx.fillStyle = '#000'
    cx.fillStyle = css
    cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const over = (f: RGBA, b: RGBA): RGBA => {
    const al = f[3] + b[3] * (1 - f[3])
    if (al === 0) return [0, 0, 0, 0]
    return [0, 1, 2].map((i) => (f[i] * f[3] + b[i] * b[3] * (1 - f[3])) / al).concat(al) as RGBA
  }
  const lum = (c: RGBA) => {
    const l = c.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
  }
  const ratio = (x: RGBA, y: RGBA) => { const p = lum(x); const q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05) }
  const root = getComputedStyle(document.documentElement).backgroundColor
  const canvasBg = parse(root)
  const page: RGBA = canvasBg[3] === 1 ? canvasBg : [255, 255, 255, 1]
  /** The colour behind an element: its own and every ancestor's translucent layers, down to the first opaque one. */
  const backdrop = (el: Element): RGBA => {
    const layers: RGBA[] = []
    let n: Element | null = el
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 0.999) break
      n = n.parentElement
    }
    let acc: RGBA = layers.length && layers[layers.length - 1][3] >= 0.999 ? layers[layers.length - 1] : page
    for (let i = layers.length - (acc === page ? 1 : 2); i >= 0; i--) acc = over(layers[i], acc)
    return acc
  }
  const opacityOf = (el: Element) => { let o = 1; let n: Element | null = el; while (n) { o *= Number(getComputedStyle(n).opacity); n = n.parentElement } return o }
  const name = (e: Element | null) => (e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : 'nothing')

  // 1: opaque, not faded
  const own = parse(getComputedStyle(panel).backgroundColor)
  if (!a.ink && own[3] < 0.999) out.push(`panel background is not opaque: alpha ${own[3].toFixed(2)} on ${name(panel)}`)
  if (!a.ink && opacityOf(panel) < 0.999) out.push(`panel is faded: opacity ${opacityOf(panel).toFixed(2)} on ${name(panel)}`)

  // 2: ink
  const seen = new Set<Element>()
  const checks: { el: Element; text: string; fg: RGBA }[] = []
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? '').trim()
    const el = n.parentElement
    if (!t || !el || seen.has(el)) continue
    seen.add(el)
    if (el.tagName === 'OPTION' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
    checks.push({ el, text: t, fg: parse(getComputedStyle(el).color) })
  }
  for (const f of [...(panel.matches('input, textarea, select') ? [panel] : []), ...Array.from(panel.querySelectorAll<HTMLElement>('input, textarea, select'))]) {
    if (f instanceof HTMLInputElement && /^(range|checkbox|radio|hidden|button|submit)$/.test(f.type)) continue
    const s = getComputedStyle(f)
    if (f instanceof HTMLSelectElement) checks.push({ el: f, text: `select value "${f.selectedOptions[0]?.textContent ?? ''}"`, fg: parse(s.color) })
    else if (f.value) checks.push({ el: f, text: `value "${f.value}"`, fg: parse(s.color) })
    const ph = (f as HTMLInputElement).placeholder
    if (ph) checks.push({ el: f, text: `placeholder "${ph}"`, fg: parse(getComputedStyle(f, '::placeholder').color) })
  }
  // the options of a native select are drawn by the browser from the option's own colours
  for (const o of Array.from(panel.querySelectorAll<HTMLOptionElement>('option')).concat(panel instanceof HTMLSelectElement ? Array.from(panel.options) : [])) {
    const s = getComputedStyle(o)
    const bg = parse(s.backgroundColor)
    const fg = parse(s.color)
    const under = bg[3] >= 0.999 ? bg : over(bg, backdrop(o.parentElement!))
    const r = ratio(over(fg, under), under)
    if (bg[3] < 0.999) out.push(`select option has no opaque background of its own (alpha ${bg[3].toFixed(2)}): "${o.textContent}"`)
    if (r < 4.5) out.push(`select option ${r.toFixed(2)}:1 "${o.textContent}" ink ${s.color} on ${s.backgroundColor}`)
  }
  const bad: string[] = []
  let counted = 0
  for (const c of checks) {
    const s = getComputedStyle(c.el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const rects = c.el.getClientRects()
    if (!rects.length || (rects[0].width <= 1 && rects[0].height <= 1)) continue
    if (c.el.closest('[aria-hidden="true"], :disabled, [aria-disabled="true"], [inert]')) continue
    if (parseFloat(s.fontSize) < 1) continue
    const bg = backdrop(c.el)
    const fg = over([c.fg[0], c.fg[1], c.fg[2], c.fg[3] * opacityOf(c.el)], bg)
    const px = parseFloat(s.fontSize)
    const large = px >= 24 || (px >= 18.66 && Number(s.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    const r = ratio(fg, bg)
    counted++
    if (r < need) bad.push(`${r.toFixed(2)}:1 (< ${need}) "${c.text.slice(0, 28)}" in ${name(c.el)}: ink ${s.color} on ${bg.slice(0, 3).map(Math.round).join(',')}`)
  }
  if (counted === 0) out.push('no visible text found to check')
  out.push(...bad.slice(0, 8))
  if (bad.length > 8) out.push(`... and ${bad.length - 8} more`)

  // 3: above its scrim
  const r = panel.getBoundingClientRect()
  if (a.inline) return out
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(x, 1), vw - 1)
  const clampY = (y: number) => Math.min(Math.max(y, 1), vh - 1)
  const mid = document.elementFromPoint(clampX((r.left + r.right) / 2), clampY((r.top + r.bottom) / 2))
  if (!mid || !(panel === mid || panel.contains(mid))) out.push(`panel is covered at its centre by ${name(mid)}`)
  if (a.scrim) {
    const scrim = document.querySelector<HTMLElement>(a.scrim)
    if (!scrim) out.push(`scrim not found: ${a.scrim}`)
    else {
      if (parse(getComputedStyle(scrim).backgroundColor)[3] === 0) out.push(`the scrim ${name(scrim)} paints nothing`)
      const pts: [number, number][] = [[4, 4], [vw - 4, 4], [4, vh - 4], [vw - 4, vh - 4], [vw / 2, 4], [vw / 2, vh - 4], [4, vh / 2], [vw - 4, vh / 2]]
      const free = pts.find(([x, y]) => x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1)
      if (free) {
        const t = document.elementFromPoint(free[0], free[1])
        if (!t || !(scrim === t || scrim.contains(t))) out.push(`outside the panel at ${Math.round(free[0])},${Math.round(free[1])} the top element is ${name(t)}, not the scrim ${name(scrim)}`)
      }
    }
  }

  // 4: inside the viewport
  if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push(`panel is clipped by the viewport: ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${vw}x${vh}`)
  return out
}

for (const mode of MODES) {
  for (const vp of VIEWPORTS) {
    // the first launch is checked at the desktop size only; the state a classic visit leaves behind at both sizes
    if (mode === 'clean' && vp.width < 900) continue
    for (const product of ['jarvis', 'ww'] as const) {
      test.describe(`${product} side, ${mode}, ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } })
        for (const s of SURFACES.filter((x) => x.products.includes(product) && !(x.desktop && vp.width < 900))) {
          test(s.id, async ({ page, baseURL }) => {
            await boot(page, baseURL, mode)
            await toProduct(page, product)
            expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(product === 'jarvis' ? 'clay-dark' : 'clay-light')
            await s.open(page)
            const panel = by(s.panel, vp.width)!
            await expect(page.locator(panel).first()).toBeVisible({ timeout: 8_000 })
            // let the entrance (opacity and travel) finish before measuring: a panel caught mid-fade is not a finding
            await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => null))))
            await page.waitForTimeout(150)
            if (SHOTS) {
              mkdirSync(SHOTS, { recursive: true })
              await page.screenshot({ path: resolve(SHOTS, `${s.id.replace(/\W+/g, '-')}-${product}-${mode.replace(' ', '-')}-${vp.name}.png`) })
            }
            const findings = await page.evaluate(audit, { panel, scrim: by(s.scrim, vp.width), inline: s.inline, ink: s.ink })
            expect(findings, `${s.id} in the ${product} side, ${mode}, at ${vp.name}`).toEqual([])
          })
        }
      })
    }
  }
}

// ---- the same hand on both sides: hover, press and focus move the dark parts as they move the light ones ----
// The owner: "both sides must be made of the same clay, with press in and out, shadow, glare and hover moving together". For each
// control the specimen is read at rest, under the pointer, pressed and keyboard-focused in the JARVIS side (clay-dark) and in the
// Well Wisher side (clay-light), and what MOVES is compared: a lift (translate up or the glare coming on), a sink on press (the
// part drops or its shadow changes) with the glare off, a change of face, and a 2 px focus ring. A feature one side has and the
// other lacks fails, which is how a dark Key that did not lift or a dark Chip that did not sink would show.
const FEEL: { id: string; entry: string; pick: string; sub?: string; glare?: string }[] = [
  { id: 'Button', entry: 'kit/Button', pick: 'button.ww-btn:not([aria-disabled="true"]):not(.primary)' },
  { id: 'Key', entry: 'kit/Key', pick: 'button.k-key:not([aria-disabled="true"])' },
  { id: 'Switch', entry: 'kit/Switch', pick: 'button.k-switch:not([aria-disabled="true"])', sub: '.k-switch-thumb' },
  { id: 'Rocker', entry: 'kit/Rocker', pick: '.k-rocker-half:not([data-active="true"])' },
  { id: 'Chip', entry: 'kit/Chip', pick: 'button.ww-chip:not([aria-disabled="true"])' },
  { id: 'Segmented', entry: 'kit/Segmented', pick: '.ww-seg-opt[aria-checked="false"], .ww-seg-opt:not([aria-checked="true"])' },
]
interface Sample { ty: number; sc: number; shadow: string; bg: string; glare: number; ring: number }
async function sample(page: Page, pick: string, sub?: string): Promise<Sample> {
  return page.evaluate(({ pick, sub }) => {
    const host = document.querySelector<HTMLElement>(`.gl-pane ${pick.split(',').join(', .gl-pane ')}`)!
    const el = sub ? host.querySelector<HTMLElement>(sub)! : host
    const cs = getComputedStyle(el)
    const m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform)
    const before = getComputedStyle(el, '::before')
    const hostCs = getComputedStyle(host)
    return {
      ty: m.m42, sc: m.a, shadow: cs.boxShadow, bg: cs.backgroundColor,
      glare: before.content !== 'none' && before.content !== 'normal' ? Number(before.opacity) : 0,
      ring: hostCs.outlineStyle === 'none' ? 0 : parseFloat(hostCs.outlineWidth),
    }
  }, { pick, sub })
}
async function feel(page: Page, f: (typeof FEEL)[number]) {
  const host = page.locator(`.gl-pane ${f.pick.split(',').join(', .gl-pane ')}`).first()
  await host.scrollIntoViewIfNeeded()
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  const rest = await sample(page, f.pick, f.sub)
  await host.hover()
  await page.waitForTimeout(350)
  const hov = await sample(page, f.pick, f.sub)
  await page.mouse.down()
  await page.waitForTimeout(300)
  const prs = await sample(page, f.pick, f.sub)
  await page.mouse.move(2, 2)
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.keyboard.press('Shift')
  await host.focus()
  await page.waitForTimeout(250)
  const foc = await sample(page, f.pick, f.sub)
  const differ = (a: string, b: string) => a !== b
  return {
    lifts: hov.ty < rest.ty - 0.4 || hov.glare > rest.glare + 0.2 || differ(hov.shadow, rest.shadow),
    glareOnHover: hov.glare > rest.glare + 0.2,
    facesMoves: differ(hov.bg, rest.bg),
    sinksOnPress: prs.ty > hov.ty + 0.4 || prs.sc < hov.sc - 0.005 || differ(prs.shadow, hov.shadow),
    glareOffOnPress: prs.glare < hov.glare - 0.2 || hov.glare === 0,
    ring2px: foc.ring >= 2,
    raw: { rest, hov, prs, foc },
  }
}
test.describe('hover, press and focus move both sides alike', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  test('every control moves the same way in the dark JARVIS side and the light Well Wisher side', async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    const res: Record<string, Record<Product, Awaited<ReturnType<typeof feel>>>> = {}
    for (const product of ['jarvis', 'ww'] as const) {
      await boot(page, baseURL, 'clean')
      await toProduct(page, product)
      for (const f of FEEL) {
        await gallery(page, f.entry)
        res[f.id] ??= {} as Record<Product, Awaited<ReturnType<typeof feel>>>
        res[f.id][product] = await feel(page, f)
      }
    }
    const bad: string[] = []
    for (const f of FEEL) {
      const d = res[f.id].jarvis
      const l = res[f.id].ww
      for (const k of ['lifts', 'glareOnHover', 'facesMoves', 'sinksOnPress', 'glareOffOnPress', 'ring2px'] as const) {
        if (l[k] && !d[k]) bad.push(`${f.id}: ${k} on the light side but not on the dark side (${JSON.stringify({ light: l.raw, dark: d.raw })})`)
      }
      if (!d.lifts && !d.facesMoves) bad.push(`${f.id}: the dark part does not answer the pointer (${JSON.stringify(d.raw)})`)
      if (!d.sinksOnPress) bad.push(`${f.id}: the dark part does not sink when pressed (${JSON.stringify(d.raw)})`)
      if (!d.ring2px) bad.push(`${f.id}: the dark part shows no 2 px focus ring (${JSON.stringify(d.raw)})`)
    }
    expect(bad).toEqual([])
  })
})
