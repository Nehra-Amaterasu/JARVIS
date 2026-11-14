// QG1: the glitch sweep of the new shell, kept as a spec.
//
// With the flag on, for every section and its first views, at 1366x768 and 390x844, in both clay grounds (the JARVIS
// product is the dark one, Well Wisher the light one), it records what a tester would write down:
//   console errors and warnings, failed requests, uncaught exceptions; document overflow; clipped or pill-wrapped text;
//   overlapping or out-of-canvas controls; controls under 44 px; a missing focus ring after Tab; a scrolling box in a rail.
// Then it flips New UI and Classic UI three times, opens and closes the palette and What is new (Alt+N), resizes between
// the two sizes, and checks that nothing is left over (one chrome, no stuck scrim, no theme attribute left behind).
//
// GLITCH_OUT=<folder> writes report.json and report.md. The spec FAILS only on: an uncaught exception, a console error,
// document overflow, a stuck scrim, a duplicated chrome element. Everything else is data in the report (the page of a
// section belongs to another package; the report is how the next wave finds it).
//
// Own ports: WW_SANDBOX_PORT=8827 WW_PREVIEW_PORT=5227 WW_SANDBOX_DIR=<scratch> npx playwright test e2e/glitch-sweep.spec.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { MEASURE_SCRIPT, type Finding } from './glitch/measure'

const OUT = process.env.GLITCH_OUT ? resolve(process.env.GLITCH_OUT) : ''
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const JARVIS = ['core', 'room', 'senses', 'memory', 'console']
const WW = ['day', 'focus', 'study', 'tree', 'career']
const VIEWS: Record<string, string[]> = {
  core: ['talk', 'sound'], room: ['switches', 'rules'], senses: ['presence', 'signal', 'teach'],
  memory: ['recall', 'beliefs', 'people', 'keep'], console: ['health', 'events', 'connections', 'hardware', 'crew'],
  day: ['today', 'week', 'month', 'body', 'close'], focus: ['start', 'session', 'rest', 'drill'], study: ['papers', 'practice', 'plan', 'library', 'dmat'],
  tree: ['tree'], career: ['pipeline', 'certs', 'abroad', 'money', 'ladder'],
}
/** two views per section keep the run short; the rest are the same chrome around another page */
const FIRST_VIEWS = 2

const found: Finding[] = []
const hardFails: string[] = []
const log: string[] = []

const noteHard = (m: string) => { hardFails.push(m); log.push(`HARD ${m}`) }

function watch(page: Page, where: () => string) {
  page.on('pageerror', (e) => noteHard(`uncaught exception at ${where()}: ${e.message}`))
  page.on('console', (m) => {
    const t = m.type()
    if (t !== 'error' && t !== 'warning') return
    const text = m.text()
    // a request the sandbox has no route for is reported as a failed request, not twice
    if (/Failed to load resource/.test(text)) return
    if (t === 'error') noteHard(`console error at ${where()}: ${text.slice(0, 220)}`)
    else found.push({ kind: 'console-warning', where: where(), detail: text.slice(0, 220) })
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (/\/api\/events|\/ws|hot-update/.test(u)) return
    found.push({ kind: 'request-failed', where: where(), detail: `${r.method()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 120)} ${r.failure()?.errorText ?? ''}` })
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) found.push({ kind: 'http-error', where: where(), detail: `${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120)}` })
  })
}

async function open(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running')
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
}

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function product(page: Page) { return page.locator('[data-shell="v2"]').getAttribute('data-product') }
async function toProduct(page: Page, want: 'jarvis' | 'ww') {
  await blurText(page)
  if ((await product(page)) !== want) await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', want)
}

/** Tab through the chrome and the page; every focused control must show a ring (outline or box-shadow ring). */
async function focusRings(page: Page, where: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  const seen = new Set<string>()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 && cs.outlineColor !== 'rgba(0, 0, 0, 0)'
      const shadow = cs.boxShadow !== 'none' && /(\d+(\.\d+)?px)/.test(cs.boxShadow) && /\b0px 0px 0px (2|3)px\b|\b0px 0px 0px 2\.?\d*px/.test(cs.boxShadow)
      const parentRing = !!el.closest('[data-focus-ring],[data-focus-inset]') && (cs.outlineStyle !== 'none')
      const id = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')!.slice(0, 24)}]` : ''}`
      return { id, ring: outline || shadow || parentRing }
    })
    if (!r || seen.has(r.id)) continue
    seen.add(r.id)
    if (!r.ring) found.push({ kind: 'no-focus-ring', where, detail: r.id })
  }
}

async function sweepState(page: Page, where: string) {
  const res = (await page.evaluate(MEASURE_SCRIPT)) as { findings: Omit<Finding, 'where'>[]; docOverflow: number }
  for (const f of res.findings) found.push({ ...f, where })
  if (res.docOverflow > 1) noteHard(`document overflow ${res.docOverflow}px at ${where}`)
}

test.describe.configure({ mode: 'serial' })

test.describe('Glitch sweep, flag on', () => {
  test.afterAll(() => {
    // the same finding on many views is one line with a count
    const seen = new Map<string, { f: Finding; n: number; at: string[] }>()
    for (const f of found) {
      const k = `${f.kind}|${f.detail}`
      const e = seen.get(k)
      if (e) { e.n++; if (e.at.length < 6) e.at.push(f.where) } else seen.set(k, { f, n: 1, at: [f.where] })
    }
    const rows = [...seen.values()].sort((a, b) => a.f.kind.localeCompare(b.f.kind))
    if (OUT) {
      mkdirSync(OUT, { recursive: true })
      writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ hard: hardFails, rows, log }, null, 2))
      const md = ['# Glitch sweep', '', `hard failures: ${hardFails.length}`, ...hardFails.map((h) => `- ${h}`), '', '| kind | detail | count | first places |', '|---|---|---|---|',
        ...rows.map((r) => `| ${r.f.kind} | ${r.f.detail.replace(/\|/g, '/')} | ${r.n} | ${r.at.join('; ')} |`)]
      writeFileSync(resolve(OUT, 'report.md'), md.join('\n'))
    }
    console.log(`glitch-sweep: ${hardFails.length} hard, ${rows.length} distinct findings (${found.length} total)`)
  })

  for (const size of SIZES) {
    test(`every section, first views, ${size.w}x${size.h}, both grounds`, async ({ page, baseURL }) => {
      test.setTimeout(240_000)
      let where = 'load'
      watch(page, () => where)
      await page.setViewportSize({ width: size.w, height: size.h })
      await open(page, baseURL)
      for (const [p, order] of [['jarvis', JARVIS], ['ww', WW]] as const) {
        await toProduct(page, p)
        const ground = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
        for (const [i, sec] of order.entries()) {
          await blurText(page)
          await page.keyboard.press(`Control+${i + 1}`)
          await expect(page.locator('.s2-page')).toHaveAttribute('data-section', sec)
          for (const v of VIEWS[sec].slice(0, FIRST_VIEWS)) {
            // views are reached by ] from the first one, the way a keyboard user does
            for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
            for (let k = 0; k < VIEWS[sec].indexOf(v); k++) { await blurText(page); await page.keyboard.press(']') }
            await expect(page.locator('.s2-page')).toHaveAttribute('data-view', v)
            await page.waitForTimeout(250)
            where = `${p}/${sec}.${v} ${size.w}px ${ground}`
            await sweepState(page, where)
            if (v === VIEWS[sec][0]) await focusRings(page, where)
          }
        }
      }
    })
  }

  test('New UI and Classic UI three times, palette, What is new, resize: nothing left over', async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    let where = 'toggle'
    watch(page, () => where)
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, baseURL)
    const chrome = async () => page.evaluate(() => ({
      titles: document.querySelectorAll('.s2-title').length, rails: document.querySelectorAll('.s2-rail').length,
      canvases: document.querySelectorAll('.s2-canvas').length, shells: document.querySelectorAll('[data-shell="v2"]').length,
      scrims: document.querySelectorAll('.s2-scrim').length, theme: document.documentElement.getAttribute('data-theme') ?? '',
      product: document.documentElement.getAttribute('data-product') ?? '', docks: document.querySelectorAll('.app .dock').length,
    }))
    for (let round = 1; round <= 3; round++) {
      where = `toggle round ${round} to classic`
      await page.locator('.s2-classic').click()
      await expect(page.locator('.app .dock')).toBeVisible({ timeout: 15_000 })
      const c = await chrome()
      if (c.shells !== 0 || c.titles !== 0) noteHard(`${where}: the new chrome is still mounted (${JSON.stringify(c)})`)
      if (/^clay-/.test(c.theme)) noteHard(`${where}: data-theme ${c.theme} left behind`)
      if (c.product) found.push({ kind: 'attribute-left', where, detail: `data-product="${c.product}" stays on <html> in the classic frame` })
      where = `toggle round ${round} to new`
      // the classic frame's switch is the title-bar "New UI" button
      await page.getByRole('button', { name: /new ui/i }).first().click()
      await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
      const n = await chrome()
      if (n.titles !== 1 || n.rails !== 1 || n.canvases !== 1 || n.shells !== 1) noteHard(`${where}: duplicated or missing chrome ${JSON.stringify(n)}`)
      if (n.scrims !== 0) noteHard(`${where}: a scrim is mounted with nothing open`)
      if (n.docks !== 0) noteHard(`${where}: the classic dock is still in the new frame`)
    }
    where = 'palette'
    for (let k = 0; k < 3; k++) {
      await page.locator('.s2-rail [data-rove]').first().focus()
      const before = await page.evaluate(() => String(document.activeElement?.className ?? ''))
      await page.keyboard.press('Control+k')
      await expect(page.locator('[data-overlay="palette"]')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('[data-overlay="palette"]')).toHaveCount(0)
      if ((await chrome()).scrims !== 0) noteHard(`palette round ${k + 1}: a scrim stays after Escape`)
      const after = await page.evaluate(() => document.activeElement?.tagName ?? '')
      if (after === 'BODY') found.push({ kind: 'focus-lost', where: `palette round ${k + 1}`, detail: `focus fell to <body> (was ${before.toString().slice(0, 30)})` })
    }
    where = 'what is new'
    for (let k = 0; k < 3; k++) {
      await blurText(page)
      await page.keyboard.press('Alt+n')
      await expect(page.locator('.gl-specimen, [data-place="app.new"], .gl-index').first()).toBeVisible({ timeout: 15_000 })
      await sweepState(page, `what is new ${k + 1}`)
      await page.keyboard.press('Alt+ArrowLeft')
      await page.waitForTimeout(200)
      if ((await chrome()).scrims !== 0) noteHard(`what is new round ${k + 1}: a scrim stays`)
    }
    where = 'resize'
    for (const s of [SIZES[1], SIZES[0], SIZES[1], SIZES[0]]) {
      await page.setViewportSize({ width: s.w, height: s.h })
      await page.waitForTimeout(250)
      const n = await chrome()
      if (n.titles !== 1 || n.rails !== 1 || n.canvases !== 1) noteHard(`resize to ${s.w}: chrome ${JSON.stringify(n)}`)
      await sweepState(page, `resize ${s.w}`)
    }
    expect(hardFails, hardFails.join('\n')).toEqual([])
  })

  test('kept fixes: label contrast on a main button, the gallery at 1x with a drawn select, a location crumb', async ({ page, baseURL }) => {
    watch(page, () => 'kept fixes')
    await page.setViewportSize({ width: 1366, height: 768 })
    await open(page, baseURL)
    // the shell's button reset sits at 0,0,1 (:where), so a one-class rule in a view decides a button's colour
    const spec = await page.evaluate(() => {
      const probe = document.createElement('button')
      probe.className = 'probe-main'
      const st = document.createElement('style')
      st.textContent = '.probe-main { color: rgb(1, 2, 3); font-size: 17px; }'
      document.head.append(st)
      document.querySelector('.s2')!.append(probe)
      const cs = getComputedStyle(probe)
      const r = { color: cs.color, size: cs.fontSize }
      probe.remove(); st.remove()
      return r
    })
    expect(spec).toEqual({ color: 'rgb(1, 2, 3)', size: '17px' })
    await blurText(page)
    await page.keyboard.press('Alt+n')
    await expect(page.locator('.gl-index, .gl-specimen').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('radio', { name: '1x' })).toHaveAttribute('aria-checked', 'true')
    expect(await page.locator('.gl-select select').evaluate((el) => getComputedStyle(el).appearance)).toBe('none')
  })

  test('the sweep passes: no hard failure anywhere', () => {
    expect(hardFails, hardFails.join('\n')).toEqual([])
  })
})
