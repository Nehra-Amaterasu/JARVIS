// The design reset of 28 Nov (V0 and V1, package Z; docs/design/design-reset-1128.md) in a real Chromium.
//
// PART 1, the specimen (gallery entry v3/Reset), built in memory by Vite from e2e/bench/entry.tsx and served from a fake origin
// like e2e/v3-kit.spec.ts: nothing is written near app/ui/dist. For each of the four scenes (dark and light ground, one accent
// and an accent per project) at 1366 x 768 it takes a picture, proves from computed styles that the ground, the trays, the
// spine, the top plate, the dock and every key carry no gradient and no hue tint, measures the chrome (184 / 64 px spine, 56 /
// 44 px plate, a 44 px dock in both poses), scrolls the long tray and reads its soft edge, and measures every text box
// against the worst pixel under it with the text hidden (4.5 to 1).
//
// PART 2, the real app (dist-e2e built with VITE_LOOK_DEFAULT=off, the fragment look=v3 turns the look on; sandbox only, never
// the live app). The spine folds to its rail by itself at 1366 and stays open at 1920, and a pin holds; the top plate
// compresses on scroll and its view keys stay reachable; the dock is slim and opens by hover, focus and the "/" key; then a
// picture of twelve real views at 1366 x 768 and 1920 x 1200, with no gradient or tint on the chrome of any of them.
//
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_PORT=9031 WW_PREVIEW_PORT=5431 WW_SANDBOX_DIR="$TEMP/jarvis-ui-reset-e2e" npx playwright test e2e/design-reset.spec.ts --workers=1
// Pictures go to $TEMP/ui-reset-shots (RESET_SHOTS overrides), never into the repository.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = resolve(process.env.RESET_SHOTS ?? join(tmpdir(), 'ui-reset-shots'))
const URL_ = 'http://reset.test/'
const SCENES = [
  { id: 'dark-one', label: /^dark ground, one accent$/, ground: 'dark' },
  { id: 'dark-project', label: /^dark ground, an accent per project$/, ground: 'dark' },
  { id: 'light-one', label: /^light ground, one accent$/, ground: 'light' },
  { id: 'light-project', label: /^light ground, an accent per project$/, ground: 'light' },
] as const

// ------------------------------------------------------------------------------------------------ shared readers

/** The chrome surfaces and keys that must be flat and neutral, read in the page from computed styles. */
async function surfaceReport(scope: Locator) {
  return scope.evaluate((root) => {
    const SEL = '.s3-ground, .s3-spine, .s3-top, .s3-dock, .s3-tray, .s3-body, .s3-key:not(.s3-send), .s3-seg button, .s3-item, .s3-mode button, .s3-wellin, .v3-key:not([data-accent="true"])'
    const bad: string[] = []
    let n = 0
    for (const e of root.querySelectorAll<HTMLElement>(SEL)) {
      n++
      const cs = getComputedStyle(e)
      if (cs.backgroundImage !== 'none') bad.push(`${e.className}: background-image ${cs.backgroundImage.slice(0, 60)}`)
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(cs.backgroundColor)
      if (m && Number(m[4] ?? 1) > 0) {
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
        // a hue tint shows as a spread between the channels; the reset's neutrals hold 0 to 5 (the warm off-white #faf9f6 is 4)
        if (Math.max(r, g, b) - Math.min(r, g, b) > 6) bad.push(`${e.className}: tinted ${cs.backgroundColor}`)
      }
      // a glow is a shadow in a hue; the reset's shadows are black, white or the light ground's neutral shade
      for (const c of cs.boxShadow.matchAll(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/g)) {
        const [r, g, b] = [Number(c[1]), Number(c[2]), Number(c[3])]
        if (Math.max(r, g, b) - Math.min(r, g, b) > 16 && !/inset 0px 0px 0px 2px/.test(cs.boxShadow)) bad.push(`${e.className}: coloured shadow ${c[0]}`)
      }
    }
    return { n, bad }
  })
}

/** Every visible text box under `root`: its text, box (relative to root), colour and size. */
async function textBoxes(el: Locator) {
  return el.evaluate((root) => {
    const out: { t: string; x: number; y: number; w: number; h: number; color: string; size: number; weight: number }[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const b = root.getBoundingClientRect()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim()
      const p = n.parentElement
      if (!text || !p || p.closest('.s3-vis, .v3-sr, [data-tip], title')) continue
      const cs = getComputedStyle(p)
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
      if (p.closest('.s3-send') && p.closest('.s3-dock[data-open="false"]')) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width < 1 || r.height < 1 || r.bottom < b.top || r.top > b.bottom) continue
      // a row scrolled out of a tray body, or lying in its 24 px soft edge (faded on purpose: it says "there is more"), is not
      // reading text at that moment; the rows fully inside the body are measured
      const body = p.closest<HTMLElement>('.s3-body')
      if (body) {
        const br = body.getBoundingClientRect()
        const top = br.top + (body.dataset.moreUp === '1' ? 24 : 0)
        const bottom = br.bottom - (body.dataset.moreDown === '1' ? 24 : 0)
        if (r.top < top - 1 || r.bottom > bottom + 1) continue
      }
      out.push({ t: text, x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, color: cs.color, size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) })
    }
    return out
  })
}

/** The worst contrast of every text box, from a capture with the text hidden: the background pixel nearest the text's own luminance. */
async function contrast(page: Page, el: Locator, scopeSel: string) {
  const texts = await textBoxes(el)
  const style = await page.addStyleTag({ content: `${scopeSel} *{color:transparent !important;caret-color:transparent !important;-webkit-text-fill-color:transparent !important}${scopeSel} *::placeholder{color:transparent !important}` })
  const png = (await el.screenshot({ animations: 'disabled' })).toString('base64')
  await style.evaluate((n) => n.remove())
  return page.evaluate(
    async ({ png, texts }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(img, 0, 0)
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      const L = (r: number, gg: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b)
      const out: { t: string; ratio: number; color: string; large: boolean }[] = []
      for (const t of texts) {
        const m = (t.color.match(/[\d.]+/g) ?? []).map(Number)
        if (m.length > 3 && m[3] < 0.99) continue // a text drawn translucent on purpose is decoration, not reading text
        const lt = L(m[0], m[1], m[2])
        // the inner part of the box: a 2 px inset keeps a neighbour's shadow at the edge out of the read
        const x = Math.max(0, Math.floor(t.x + 2)), y = Math.max(0, Math.floor(t.y + 2))
        const w = Math.min(img.width - x, Math.ceil(t.w - 4)), h = Math.min(img.height - y, Math.ceil(t.h - 4))
        if (w < 1 || h < 1) continue
        const d = g.getImageData(x, y, w, h).data
        let worst = Infinity
        for (let i = 0; i < d.length; i += 4) {
          const lb = L(d[i], d[i + 1], d[i + 2])
          const rr = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)
          if (rr < worst) worst = rr
        }
        out.push({ t: t.t, ratio: worst, color: t.color, large: t.size >= 24 || (t.size >= 18.66 && t.weight >= 700) })
      }
      return out
    },
    { png, texts },
  )
}

// ------------------------------------------------------------------------------------------------ PART 1, the specimen

let bundle: Promise<{ js: string; css: string }> | null = null
function buildGallery() {
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

async function openScene(page: Page, scene: (typeof SCENES)[number]) {
  const { js, css } = await buildGallery()
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html lang="en" data-theme="clay-${scene.ground}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>reset</title><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${scene.ground}`)
  await page.locator('[data-gallery]').waitFor()
  await page.locator('.gl-item[data-entry-id="v3/Reset"]').click()
  await page.getByRole('radiogroup', { name: 'State' }).getByRole('radio', { name: scene.label }).click()
  const el = page.locator(`[data-reset-scene="${scene.id}"]`)
  await el.waitFor()
  await page.mouse.move(0, 0)
  // lift the scene out of the gallery's fixed-height pane into the body, and grow the window to its height, so a picture and the
  // contrast read are of the whole scene and not of a clipped part
  await el.evaluate((n) => {
    document.body.appendChild(n)
    const root = document.getElementById('root')
    if (root) root.style.display = 'none'
    document.documentElement.style.cssText += ';height:auto;overflow:visible'
    document.body.style.cssText += ';margin:0;height:auto;overflow:visible;padding:0.5rem'
  })
  const vp = page.viewportSize()!
  const h = await el.evaluate((n) => n.getBoundingClientRect().height)
  await page.setViewportSize({ width: vp.width, height: Math.min(9000, Math.ceil(h) + 40) })
  await page.waitForTimeout(900)
  return el
}

test.describe('the specimen at 1366 x 768', () => {
  test.use({ viewport: { width: 1366, height: 768 } })
  for (const scene of SCENES) {
    test(`${scene.id}: flat neutral chrome, the chrome in both poses, a scrolling tray, readable text`, async ({ page }) => {
      test.setTimeout(150_000)
      const errs: string[] = []
      page.on('pageerror', (e) => errs.push(e.message))
      mkdirSync(SHOTS, { recursive: true })
      const el = await openScene(page, scene)
      await el.screenshot({ path: join(SHOTS, `specimen-${scene.id}.png`), animations: 'disabled' })

      // no gradient and no hue tint on the ground, the trays and the chrome, computed
      const flat = await surfaceReport(el)
      expect(flat.n, 'chrome surfaces found').toBeGreaterThan(40)
      expect(flat.bad, 'gradient, tint or coloured shadow on a surface').toEqual([])

      // the chrome in both poses
      const full = el.locator('[data-reset-frame="full-full"]')
      const rail = el.locator('[data-reset-frame="rail-slim"]')
      expect(Math.round((await full.locator('.s3-spine').boundingBox())!.width)).toBe(184)
      expect(Math.round((await rail.locator('.s3-spine').boundingBox())!.width)).toBe(64)
      const fullTop = (await full.locator('.s3-top').boundingBox())!.height
      const slimTop = (await rail.locator('.s3-top').boundingBox())!.height
      expect(fullTop).toBeGreaterThanOrEqual(55)
      expect(fullTop).toBeLessThanOrEqual(57)
      expect(slimTop).toBeGreaterThanOrEqual(43.5)
      expect(slimTop).toBeLessThanOrEqual(45)
      for (const f of [full, rail]) expect((await f.locator('.s3-dock').boundingBox())!.height, 'the dock is 44 px in both poses').toBeLessThanOrEqual(44.5)
      expect(await full.locator('.s3-dock').getAttribute('data-open')).toBe('false')
      expect(await rail.locator('.s3-dock').getAttribute('data-open')).toBe('true')
      // the slim plate keeps its view keys (the Core views), one press away
      expect(await rail.locator('.s3-seg button').count()).toBeGreaterThan(1)

      // the long tray scrolls its own body, with the soft edge where there is more
      const body = full.locator('.s3-tray[data-step="1"] .s3-body')
      const m0 = await body.evaluate((b) => ({ sh: b.scrollHeight, ch: b.clientHeight, down: b.dataset.moreDown, up: b.dataset.moreUp, mask: getComputedStyle(b).maskImage || getComputedStyle(b).webkitMaskImage }))
      expect(m0.sh, 'the long body is taller than its tray').toBeGreaterThan(m0.ch + 40)
      expect(m0.down).toBe('1')
      expect(m0.up).toBe('0')
      expect(m0.mask).toContain('gradient')
      await body.evaluate((b) => { b.scrollTop = b.scrollHeight })
      await expect.poll(() => body.evaluate((b) => `${b.dataset.moreUp}${b.dataset.moreDown}`)).toBe('10')
      await body.evaluate((b) => { b.scrollTop = 0 })

      // every text box at 4.5 to 1 over the worst pixel under it (3 to 1 for large text)
      const res = await contrast(page, el, `[data-reset-scene="${scene.id}"]`)
      writeFileSync(join(SHOTS, `specimen-contrast-${scene.id}.json`), JSON.stringify(res.sort((a, b) => a.ratio - b.ratio).slice(0, 15), null, 1))
      expect(res.length).toBeGreaterThan(120)
      const bad = res.filter((x) => x.ratio < (x.large ? 3 : 4.5)).map((x) => `${x.t.slice(0, 40)} ${x.ratio.toFixed(2)} ${x.color}`)
      expect(bad, 'text under its contrast floor').toEqual([])
      expect(errs).toEqual([])
    })
  }
})

// ------------------------------------------------------------------------------------------------ PART 2, the real app

const SIZES = [
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1920x1200', w: 1920, h: 1200 },
] as const
const VIEWS: { id: string; hash: string }[] = [
  { id: 'core-talk', hash: '#core/talk' },
  { id: 'core-sound', hash: '#core/sound' },
  { id: 'console-hardware', hash: '#console/hardware' },
  { id: 'console-crew', hash: '#console/crew' },
  { id: 'senses-presence', hash: '#senses/presence' },
  { id: 'day-today', hash: '#day/today' },
  { id: 'day-week', hash: '#day/week' },
  { id: 'study-papers', hash: '#study/papers' },
  { id: 'study-library', hash: '#study/library' },
  { id: 'tree', hash: '#tree/tree' },
  { id: 'career', hash: '#career/pipeline' },
  { id: 'setup', hash: '#setup' },
]

async function openApp(page: Page, baseURL: string | undefined, size: { w: number; h: number }, hash: string, extra = '') {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto(`/#t=ww-e2e&shell=v2&look=v3${extra}`)
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
  await page.evaluate((h) => { location.hash = h }, hash)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', viewOf(hash))
}
/** The view a hash opens: '#day/today' is today, '#setup' is setup. The page of the place before keeps .s2-page visible for a moment,
 *  so a test waits for the new view's attribute, never for visibility alone. */
const viewOf = (hash: string) => hash.replace(/^#/, '').split('/').pop()!
const spineW = async (page: Page) => Math.round((await page.locator('#s3-spine').boundingBox())!.width)

test.describe('the chrome in the real app', () => {
  test('the spine folds to its rail by itself at 1366, stays open at 1920, and a pin holds until it matches the window again', async ({ page, baseURL }) => {
    test.setTimeout(60_000)
    await openApp(page, baseURL, SIZES[0], '#core/talk')
    await page.evaluate(() => localStorage.removeItem('app.spine'))
    await page.reload()
    await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.s3')).toHaveAttribute('data-spine', 'rail')
    await expect(page.locator('.s3')).toHaveAttribute('data-spine-pin', 'auto')
    await expect.poll(() => spineW(page)).toBe(64)
    // the open project's sections are icons in the rail, and each names itself in a flyout on focus
    const room = page.locator('.s3-item[data-section="room"]')
    await expect(room).toBeVisible()
    expect(await room.getAttribute('data-fly')).toBe('Room')
    // pin it open
    await page.locator('.s3-fold').click()
    await expect(page.locator('.s3')).toHaveAttribute('data-spine', 'full')
    await expect(page.locator('.s3')).toHaveAttribute('data-spine-pin', 'pinned')
    await expect.poll(() => spineW(page)).toBe(184)
    expect(await page.evaluate(() => localStorage.getItem('app.spine'))).toBe('full')
    // a wide window wants it open too: the pin now equals the window, and folding back returns to automatic
    await page.setViewportSize({ width: 1920, height: 1200 })
    await expect.poll(() => spineW(page)).toBe(184)
    await page.locator('.s3-fold').click()
    await expect(page.locator('.s3')).toHaveAttribute('data-spine', 'rail')
    await page.locator('.s3-fold').click()
    await expect(page.locator('.s3')).toHaveAttribute('data-spine-pin', 'auto')
    expect(await page.evaluate(() => localStorage.getItem('app.spine'))).toBeNull()
    await expect.poll(() => spineW(page)).toBe(184)
  })

  test('the top plate is 56 px, compresses to 44 px when a tray is scrolled, keeps its view keys, and opens again at the top', async ({ page, baseURL }) => {
    test.setTimeout(60_000)
    await openApp(page, baseURL, SIZES[1], '#day/today')
    await expect(page.locator('.s3')).toHaveAttribute('data-plate', 'full')
    const h0 = (await page.locator('.s3-top').boundingBox())!.height
    expect(h0).toBeGreaterThanOrEqual(55)
    expect(h0).toBeLessThanOrEqual(57)
    // make one tray body taller than its tray (a real scroll of real content: filler appended in the test only), then scroll it
    const body = page.locator('.s3-tray .s3-body').first()
    await body.evaluate((b) => {
      const pad = document.createElement('div')
      pad.setAttribute('data-test-pad', '')
      pad.style.minHeight = '2400px'
      b.appendChild(pad)
    })
    // the plate resets to full on a place change, in an effect that can land just after a very fast first scroll: scroll again
    // until the shell has seen it (a person's scroll is many events, never one)
    await expect(async () => {
      await body.evaluate((b) => { b.scrollTop = b.scrollTop === 200 ? 240 : 200 })
      await expect(page.locator('.s3')).toHaveAttribute('data-plate', 'slim', { timeout: 500 })
    }).toPass({ timeout: 10_000 })
    await expect.poll(async () => Math.round((await page.locator('.s3-top').boundingBox())!.height)).toBe(44)
    const views = page.locator('.s3-seg button')
    expect(await views.count()).toBeGreaterThan(1)
    await views.nth(1).click()
    await expect(page.locator('.s2-page')).toHaveAttribute('data-view', /week|month|body|close/)
    // a new place starts with the plate open
    await expect(page.locator('.s3')).toHaveAttribute('data-plate', 'full')
  })

  test('a window under 760 px tall keeps the plate slim', async ({ page, baseURL }) => {
    await openApp(page, baseURL, { w: 1366, h: 720 }, '#core/talk')
    await expect(page.locator('.s3')).toHaveAttribute('data-plate', 'slim')
  })

  test('the dock is a 44 px line, opens on hover, on focus and on "/", and never changes its height', async ({ page, baseURL }) => {
    await openApp(page, baseURL, SIZES[0], '#core/talk')
    const dock = page.locator('.s3-dock')
    await page.mouse.move(600, 300)
    await expect(dock).toHaveAttribute('data-open', 'false')
    const h0 = (await dock.boundingBox())!.height
    expect(h0).toBeLessThanOrEqual(44.5)
    await dock.hover()
    await expect(dock).toHaveAttribute('data-open', 'true')
    expect((await dock.boundingBox())!.height).toBe(h0)
    await page.mouse.move(600, 300)
    await expect(dock).toHaveAttribute('data-open', 'false')
    await page.locator('.s3-wellin input').focus()
    await expect(dock).toHaveAttribute('data-open', 'true')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(dock).toHaveAttribute('data-open', 'false')
    await page.locator('body').press('/')
    await expect(page.locator('.s3-wellin input')).toBeFocused()
    await expect(dock).toHaveAttribute('data-open', 'true')
    expect((await dock.boundingBox())!.height).toBe(h0)
  })

  for (const size of SIZES) {
    test(`${size.name}: twelve real views, pictured, with flat neutral chrome`, async ({ page, baseURL }) => {
      test.setTimeout(240_000)
      mkdirSync(SHOTS, { recursive: true })
      await openApp(page, baseURL, size, VIEWS[0].hash)
      const report: Record<string, unknown> = {}
      for (const v of VIEWS) {
        await page.evaluate((h) => { location.hash = h }, v.hash)
        await expect(page.locator('.s2-page')).toHaveAttribute('data-view', viewOf(v.hash))
        await page.mouse.move(size.w - 4, 4)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: join(SHOTS, `view-${v.id}-${size.name}.png`) })
        const flat = await surfaceReport(page.locator('body'))
        // the trays that clip content with no way to reach it: a box with overflow hidden or clip whose content is taller, inside the canvas
        const clipped = await page.evaluate(() => {
          const out: string[] = []
          for (const e of document.querySelectorAll<HTMLElement>('.s2-canvas *')) {
            const cs = getComputedStyle(e)
            if (!/(hidden|clip)/.test(cs.overflowY) || e.clientHeight < 60) continue
            if (e.scrollHeight > e.clientHeight + 8 && !e.closest('svg') && !e.matches('.s3-tray')) out.push(`${e.className || e.tagName} ${e.scrollHeight}>${e.clientHeight}`)
          }
          return out.slice(0, 12)
        })
        report[v.id] = { bad: flat.bad, clipped }
        expect(flat.bad, `${v.id}: gradient or tint on the chrome`).toEqual([])
      }
      writeFileSync(join(SHOTS, `views-${size.name}.json`), JSON.stringify(report, null, 1))
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 'the page never scrolls as a whole').toBeLessThanOrEqual(0)
    })
  }

  test('the per-project accent scheme is chosen by the fragment and changes only the signal colour', async ({ page, baseURL }) => {
    await openApp(page, baseURL, SIZES[0], '#senses/presence', '&accent=project')
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'project')
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
    expect(accent).toBe('#86e07a')
    await page.screenshot({ path: join(SHOTS, 'view-senses-presence-accent-project-1366x768.png') })
    await page.evaluate(() => { location.hash = '#core/talk' })
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#edaa3a')
    await page.evaluate(() => localStorage.removeItem('app.accent'))
  })
})
