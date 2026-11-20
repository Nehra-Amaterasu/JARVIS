// T1, design language v3: the kit specimen (gallery entry v3/Kit) in a real Chromium.
//
// The page is the real What is new gallery built in memory by Vite from e2e/bench/entry.tsx and served from a fake origin, the
// way e2e/gallery.spec.ts does it: nothing is written near app/ui/dist and no sandbox token is used. The specimen has four
// scenes (dark and light ground, glass on and off), each over a bright busy wallpaper drawn in CSS. For every scene, at
// 1366 x 768 and at 390 x 844, this spec
//   - takes a picture into V3_SHOTS (default: a folder under the temp directory, never the repository);
//   - reads the computed size of every text node (11 px or more) and the box of every control (44 x 44 or more);
//   - checks that nothing is cut with an ellipsis, nothing overflows sideways, and every state word is whole;
//   - measures the contrast of every text box against the WORST background pixel under it, with the text hidden (spec 2.7);
// and checks the poses (hover, pressed, focus and the locked key differ as pictures), one continuous motion at most, and that
// reduced motion stops every animation.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.V3_SHOTS ? resolve(process.env.V3_SHOTS) : join(tmpdir(), 'jarvis-t1-shots')
const URL_ = 'http://v3kit.test/'
const FONTS = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--font-ui:system-ui,'Segoe UI',sans-serif;--font-sans:system-ui,'Segoe UI',sans-serif;--font-mono:ui-monospace,Consolas,monospace}`
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }
const SCENES = [
  { id: 'dark-on', label: /^dark ground, glass on$/, ground: 'dark', glass: 'on' },
  { id: 'light-on', label: /^light ground, glass on$/, ground: 'light', glass: 'on' },
  { id: 'dark-off', label: /^dark ground, glass off$/, ground: 'dark', glass: 'off' },
  { id: 'light-off', label: /^light ground, glass off$/, ground: 'light', glass: 'off' },
] as const

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
  const doc = `<!doctype html><html lang="en" data-theme="clay-${scene.ground}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v3 kit</title><style>${FONTS}</style><style>${css}</style></head><body><div id="root"></div><script>${safe}</script></body></html>`
  await page.route(`${URL_}**`, (route) => route.fulfill({ contentType: 'text/html', body: doc }))
  await page.goto(`${URL_}?view=gallery&theme=${scene.ground}`)
  await page.locator('[data-gallery]').waitFor()
  await page.locator('.gl-item[data-entry-id="v3/Kit"]').click()
  await page.getByRole('radiogroup', { name: 'State' }).getByRole('radio', { name: scene.label }).click()
  const el = page.locator(`[data-v3-scene="${scene.id}"]`)
  await el.waitFor()
  await page.waitForTimeout(1800) // the rise (500 ms and its stagger), the glint (1.2 s after 500 ms is let run) and the arc sweep settle
  return el
}

const shot = async (el: ReturnType<Page['locator']>, name: string) => {
  mkdirSync(SHOTS, { recursive: true })
  const path = join(SHOTS, name)
  await el.screenshot({ path, animations: 'disabled' })
  return path
}

/** Everything the text and target checks need, read in the page. */
async function inspect(el: ReturnType<Page['locator']>) {
  return el.evaluate((root) => {
    const small: string[] = []
    const cut: string[] = []
    const texts: { t: string; size: number; x: number; y: number; w: number; h: number; color: string }[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim()
      const p = n.parentElement
      if (!text || !p) continue
      if (p.closest('.v3-sr, [aria-hidden="true"] .v3-sr')) continue
      const cs = getComputedStyle(p)
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      // an SVG text node would scale with its viewBox: the real size is the box height over the line, so measure the box
      const scale = p instanceof SVGElement ? p.getBoundingClientRect().height / Math.max(1, (p as unknown as SVGGraphicsElement).getBBox?.().height ?? 1) : 1
      const size = parseFloat(cs.fontSize) * scale
      const b = root.getBoundingClientRect()
      texts.push({ t: text, size, x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, color: cs.color })
      if (size < 11) small.push(`${text} ${size}px`)
    }
    for (const e of root.querySelectorAll<HTMLElement>('*')) {
      const cs = getComputedStyle(e)
      if (cs.textOverflow === 'ellipsis') cut.push(`${e.className} ellipsis`)
      if (e.matches('.v3-chip, .v3-chip-word') && e.scrollWidth > e.clientWidth + 1) cut.push(`${e.className} clipped ${e.scrollWidth}>${e.clientWidth}`)
    }
    const targets: string[] = []
    for (const b of root.querySelectorAll<HTMLElement>('button, [role=button], a[href], input, select, textarea')) {
      const r = b.getBoundingClientRect()
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) targets.push(`${b.textContent?.trim() || b.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    const overflow = root.scrollWidth - root.clientWidth
    return { small, cut, texts, targets, overflow, w: root.getBoundingClientRect().width, h: root.getBoundingClientRect().height }
  })
}

/** The worst contrast of every text box, from a capture with the text hidden (spec 2.7): the brightest pixel under a light text, the darkest under a dark one. */
async function measureContrast(page: Page, el: ReturnType<Page['locator']>, texts: Awaited<ReturnType<typeof inspect>>['texts']) {
  await page.addStyleTag({ content: '[data-v3-scene] *{color:transparent !important;text-shadow:none !important;-webkit-text-fill-color:transparent !important}[data-v3-scene] svg *{animation:none !important}' })
  const png = (await el.screenshot({ animations: 'disabled' })).toString('base64')
  const res = await page.evaluate(
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
      const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number)
      const out: { t: string; ratio: number; color: string }[] = []
      for (const t of texts) {
        const [r, gg, b] = parse(t.color)
        const lt = L(r, gg, b)
        const x = Math.max(0, Math.floor(t.x)), y = Math.max(0, Math.floor(t.y))
        const w = Math.min(img.width - x, Math.ceil(t.w)), h = Math.min(img.height - y, Math.ceil(t.h))
        if (w < 1 || h < 1) continue
        const d = g.getImageData(x, y, w, h).data
        // the worst background under a text is the one nearest its own luminance
        let worst = Infinity
        for (let i = 0; i < d.length; i += 4) {
          const lb = L(d[i], d[i + 1], d[i + 2])
          const rr = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05)
          if (rr < worst) worst = rr
        }
        out.push({ t: t.t, ratio: worst, color: t.color })
      }
      return out
    },
    { png, texts },
  )
  return res
}

for (const vp of [DESKTOP, PHONE]) {
  test.describe(`at ${vp.width} x ${vp.height}`, () => {
    test.use({ viewport: vp })
    for (const scene of SCENES) {
      test(`${scene.id}: drawn, 11 px text, 44 px targets, nothing cut, nothing sideways`, async ({ page }) => {
        const errs: string[] = []
        page.on('pageerror', (e) => errs.push(e.message))
        const el = await openScene(page, scene)
        await shot(el, `${scene.id}-${vp.width}.png`)
        const r = await inspect(el)
        expect(r.texts.length).toBeGreaterThan(40)
        expect(r.small, 'text under 11 px').toEqual([])
        expect(r.targets, 'controls under 44 x 44').toEqual([])
        expect(r.cut, 'cut text').toEqual([])
        expect(r.overflow, 'sideways overflow of the scene').toBeLessThanOrEqual(0)
        expect(errs).toEqual([])
        // the document itself never scrolls sideways
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
        // glass off: every alpha is 1 in the computed style, on the scene itself
        const alphas = await el.evaluate((n) => {
          const cs = getComputedStyle(n)
          return ['--ga', '--sa', '--ta', '--tna', '--tla', '--wa'].map((k) => cs.getPropertyValue(k).trim())
        })
        if (scene.glass === 'off') expect(alphas).toEqual(['1', '1', '1', '1', '1', '1'])
        else expect(alphas.every((a) => a !== '1')).toBe(true)
        const filt = await el.evaluate((n) => getComputedStyle(n.querySelector('.v3-ground')!).backdropFilter)
        if (scene.glass === 'off') expect(filt).toBe('none')
        else expect(filt).toContain('blur')
      })

      test(`${scene.id}: every text box clears 4.5 to 1 over the worst pixel under it, with the text hidden`, async ({ page }) => {
        const el = await openScene(page, scene)
        const r = await inspect(el)
        const res = await measureContrast(page, el, r.texts)
        mkdirSync(SHOTS, { recursive: true })
        writeFileSync(join(SHOTS, `contrast-${scene.id}-${vp.width}.json`), JSON.stringify(res.sort((a, b) => a.ratio - b.ratio).slice(0, 12), null, 1))
        const bad = res.filter((x) => x.ratio < 4.5).map((x) => `${x.t.slice(0, 30)} ${x.ratio.toFixed(2)} ${x.color}`)
        expect(bad, 'text under 4.5 to 1').toEqual([])
      })
    }

    test('poses: hover, pressed, focus and locked are different pictures, and the locked key has no raise or press shadow', async ({ page }) => {
      const el = await openScene(page, SCENES[0])
      const sh = await el.evaluate((root) => {
        const pick = (pose: string) => {
          const cell = [...root.querySelectorAll('span')].find((s) => s.textContent === pose)?.parentElement
          const b = cell?.querySelector<HTMLElement>('button')
          return b ? { shadow: getComputedStyle(b).boxShadow, transform: getComputedStyle(b).transform, bg: getComputedStyle(b).backgroundImage } : null
        }
        return { rest: pick('key rest'), hover: pick('key hover'), pressed: pick('key pressed'), focus: pick('key focus'), lit: pick('lit: ON, selected'), accent: pick('accent rest'), accentPressed: pick('accent pressed'), locked: pick('locked'), lockedHover: pick('locked, hover (no change)') }
      })
      for (const k of Object.keys(sh) as (keyof typeof sh)[]) expect(sh[k], k).not.toBeNull()
      const s = (k: keyof typeof sh) => sh[k]!.shadow
      expect(s('hover')).not.toBe(s('rest'))
      expect(s('pressed')).not.toBe(s('rest'))
      expect(s('pressed')).toContain('inset')
      expect(s('focus')).not.toBe(s('rest'))
      expect(s('focus')).toMatch(/0px 0px 0px 3px[\s\S]*0px 0px 0px 5px/)
      expect(s('rest')).not.toContain('inset')
      expect(s('accentPressed')).toContain('inset')
      expect(sh.hover!.transform).not.toBe('none') // lifted 1 px
      // the lit key is a different fill from the rest key; it is not the accent
      expect(sh.lit!.bg).not.toBe(sh.rest!.bg)
      expect(sh.lit!.bg).not.toBe(sh.accent!.bg)
      // locked: sunk, not raised, not the press shadow; hover changes nothing
      expect(s('locked')).toContain('inset')
      expect(s('locked')).not.toBe(s('pressed'))
      expect(s('lockedHover')).toBe(s('locked'))
      expect(sh.locked!.transform).toBe('none')
      await el.screenshot({ path: join(SHOTS, `poses-${vp.width}.png`) })
    })

    test('the locked key is a real control with its reason as text, and a press changes nothing', async ({ page }) => {
      const el = await openScene(page, SCENES[0])
      const k = el.locator('button[aria-disabled="true"]').first()
      await expect(k).toBeVisible()
      const why = await k.getAttribute('aria-describedby')
      await expect(el.locator(`#${why}`)).toHaveText(/^Locked: /)
      await k.focus()
      await expect(k).toBeFocused()
      const before = await k.evaluate((b) => b.outerHTML)
      await k.click({ force: true })
      expect(await k.evaluate((b) => b.outerHTML)).toBe(before)
    })

    test('one continuous motion in the scene at most; reduced motion stops every animation and the stills stay', async ({ page }) => {
      const el = await openScene(page, SCENES[0])
      await page.waitForTimeout(1500)
      const running = await el.evaluate((root) => root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity).length)
      expect(running, 'continuous animations').toBeLessThanOrEqual(1)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(400)
      const after = await el.evaluate((root) => root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length)
      expect(after, 'running animations under reduced motion').toBe(0)
      // the stills: the ring at full strength, the arcs at their reading
      const ring = await el.evaluate((root) => getComputedStyle(root.querySelector('.v3-sigil .v3-spin')!).opacity)
      expect(parseFloat(ring)).toBe(1)
      await expect(el.locator('.v3-gauge[data-pose="drawn"] .v3-arc')).toHaveCount(1)
    })

    test('forced colours: the keys keep an edge and the ground is dropped', async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' })
      const el = await openScene(page, SCENES[0])
      const r = await el.evaluate((root) => {
        const k = root.querySelector<HTMLElement>('button.v3-key')!
        const cs = getComputedStyle(k)
        return { border: parseFloat(cs.borderTopWidth), style: cs.borderTopStyle, ground: getComputedStyle(root.querySelector('.v3-ground')!).display }
      })
      expect(r.border).toBeGreaterThanOrEqual(1)
      expect(r.style).not.toBe('none')
      expect(r.ground).toBe('none')
    })
  })
}
