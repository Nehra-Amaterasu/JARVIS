// The jury evidence harness (package RG1). SKIPPED unless JURY_SHOTS names a folder.
//
//   JURY_SHOTS=<folder> npx playwright test e2e/jury.spec.ts          (all entries)
//   JURY_ENTRIES=kit/Switch,data/Jar JURY_SHOTS=<folder> ...           (only those ids, comma separated)
//   JURY_SCALE=1.5 ...                                                 (the gallery's own default zoom; the harness draws 1x, the real size)
//
// Writes, under <JURY_SHOTS>:
//   <entry id, slashes as dashes>/<NN-state>-<width>-<theme>.png   the WHOLE specimen at 1366 and 390, light and dark
//   <entry id>/focus-<n>.png                                       one focus sheet per entry: Tab through up to 12 parts
//   shell/<section>-<width>.png                                    the first view of each shell section (flag on)
//   report.json and index.md                                       one row per file, with what was measured in it
// It fails only when a specimen throws or cannot be found; a geometry fault (overflow, a blank picture, text under 11 px,
// a target under 44 px) is data in the report, because the jury reads the report, not a red test.
//
// How a specimen is shot whole: the page is the real What is new gallery (built in memory the way e2e/gallery.spec.ts builds
// it), with a style that takes the index, the bar and the pane's scroll box out of the picture (see lib.ts). The entry and its
// state are chosen through the page's own controls; the picture is clipped to the specimen's box plus anything that sticks
// out of it, so a fault shows in the picture as well as in the numbers. The specimen is drawn at 1x, its real size.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  MAX_SHOT_HEIGHT, SIZES, THEMES, BLANK_BELOW, distinctColours, folderOf, measure, openGallery, pickEntry, shotName, showState, stateFile, writeReport,
  type EntryInfo, type Row, type Theme,
} from './jury/lib'

const OUT = process.env.JURY_SHOTS ? resolve(process.env.JURY_SHOTS) : ''
const ONLY = (process.env.JURY_ENTRIES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const SCALE = (['1', '1.5', '2'].includes(process.env.JURY_SCALE ?? '') ? process.env.JURY_SCALE : '1') as '1' | '1.5' | '2'
const SPECIMEN = 'article.gl-specimen'
const FOCUS_STOPS = 12

const rows: Row[] = []
const entries = new Map<string, EntryInfo>()
const failures: string[] = []

test.describe.configure({ mode: 'serial' })
test.skip(!OUT, 'JURY_SHOTS is not set: this harness writes screenshots only when it names a folder')
test.afterAll(() => {
  if (!OUT || !rows.length) return
  const s = writeReport(OUT, rows, [...entries.values()], { viewports: SIZES, themes: THEMES, only: ONLY.length ? ONLY : 'all', scale: SCALE })
  console.log(`jury: ${JSON.stringify(s)}`)
})

const blankFields = (d: { all: number; lower: number } | null) => d
  ? { blank: d.all < BLANK_BELOW, blankLower: d.lower < BLANK_BELOW, distinct: d.all }
  : { blank: null, blankLower: null, distinct: null }

async function shoot(page: Page, file: string, clip: { x: number; y: number; width: number; height: number }) {
  const height = Math.min(clip.height, MAX_SHOT_HEIGHT)
  const png = await page.screenshot({ path: file, fullPage: true, clip: { ...clip, height }, animations: 'allow' })
  return { png, truncated: clip.height > MAX_SHOT_HEIGHT }
}

/** One entry at one size and theme: a whole-specimen picture per state. */
async function specimenShots(page: Page, id: string, states: string[], width: number, theme: Theme) {
  const dir = resolve(OUT, folderOf(id))
  mkdirSync(dir, { recursive: true })
  const count = states.length
  const list = count ? states : ['specimen']
  for (let i = 0; i < list.length; i++) {
    await showState(page, count > 1 ? i : null, count)
    const m = await measure(page, SPECIMEN, SPECIMEN)
    const base = stateFile(i, list[i])
    const name = shotName(base, width, theme)
    const { png, truncated } = await shoot(page, resolve(dir, name), m.clip)
    const colours = await distinctColours(page, png)
    rows.push({ file: `${folderOf(id)}/${name}`, kind: 'specimen', entry: id, state: list[i], width, theme, ...m, ...blankFields(colours), truncated })
  }
  await showState(page, null, count)
}

/** The focus sheet of one entry: Tab through up to 12 focusable parts, one small picture per stop, ring measured. */
async function focusSheet(page: Page, id: string): Promise<number> {
  const dir = resolve(OUT, folderOf(id))
  mkdirSync(dir, { recursive: true })
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); document.querySelector<HTMLElement>('.gl-pane')?.focus() })
  let stops = 0
  let prev: string | null = null
  for (let n = 1; n <= FOCUS_STOPS; n++) {
    await page.keyboard.press('Tab')
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const spec = document.querySelector('article.gl-specimen')
      if (!el || !spec || !spec.contains(el)) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32)
      const key = `${el.tagName}|${label}|${Math.round(r.left)}|${Math.round(r.top)}`
      return {
        key, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height,
        desc: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${label}"`,
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : cs.boxShadow !== 'none' ? `shadow ${cs.boxShadow.slice(0, 40)}` : 'none',
      }
    })
    if (!at || at.key === prev) break
    prev = at.key
    stops++
    const pad = 36
    const clip = { x: Math.max(0, Math.floor(at.x - pad)), y: Math.max(0, Math.floor(at.y - pad)), width: Math.ceil(Math.min(at.w + pad * 2, 900)), height: Math.ceil(Math.min(at.h + pad * 2, 600)) }
    const name = `focus-${n}.png`
    await page.screenshot({ path: resolve(dir, name), fullPage: true, clip, animations: 'allow' })
    rows.push({
      file: `${folderOf(id)}/${name}`, kind: 'focus', entry: id, state: `focus ${n}: ${at.desc}`, width: 1366, theme: 'light', stop: n, ring: at.ring,
      elW: Math.round(at.w), elH: Math.round(at.h), overflowPx: 0, clippedPx: 0, scrollers: 0, blank: null, blankLower: null, distinct: null,
      minFontPx: null, minFontEl: '', textUnder11: 0, focusable: 1, under44: at.w < 44 || at.h < 44 ? 1 : 0, under44List: [], truncated: false,
      note: at.ring === 'none' ? 'no ring drawn' : undefined,
    })
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return stops
}

test('every gallery entry, every state, both sizes, both themes, plus a focus sheet each', async ({ page }) => {
  test.setTimeout(20 * 60_000)
  mkdirSync(OUT, { recursive: true })
  const errs: string[] = []
  let current = '(load)'
  page.on('pageerror', (e) => errs.push(`${current}: ${e.message}`))

  for (const size of SIZES) {
    for (const theme of THEMES) {
      await page.setViewportSize(size)
      const all = await openGallery(page, theme, SCALE)
      const ids = ONLY.length ? ONLY : all
      expect(ids.length, 'the gallery lists no entries').toBeGreaterThan(0)
      const missing = ONLY.filter((id) => !all.includes(id))
      for (const id of missing) failures.push(`${id}: not in the gallery index`)
      for (const id of ids.filter((i) => all.includes(i))) {
        current = `${id} ${size.width} ${theme}`
        try {
          const info = await pickEntry(page, id)
          const known = entries.get(id) ?? { id, group: info.group, states: info.states, focusStops: 0 }
          entries.set(id, known)
          await specimenShots(page, id, info.states, size.width, theme)
          if (size.width === 1366 && theme === 'light') known.focusStops = await focusSheet(page, id)
        } catch (e) {
          const msg = `${current}: ${(e as Error).message.split('\n')[0]}`
          failures.push(msg)
          const info = entries.get(id) ?? { id, group: '', states: [], focusStops: 0 }
          info.error = msg
          entries.set(id, info)
        }
      }
    }
  }
  failures.push(...errs)
  expect(failures, 'specimens that threw or could not be found').toEqual([])
})

// The shell with the flag on: each section's first view at both sizes (the way e2e/shell-v2.spec.ts opens it).
const JARVIS = [['core', 1], ['room', 2], ['senses', 3], ['memory', 4], ['console', 5]] as const
const WW = [['day', 1], ['focus', 2], ['study', 3], ['tree', 4], ['career', 5]] as const

test('the shell, flag on: the first view of every section at both sizes', async ({ page, baseURL }) => {
  test.setTimeout(5 * 60_000)
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npm run bundle:check` first')
  const dir = resolve(OUT, 'shell')
  mkdirSync(dir, { recursive: true })
  await page.goto('/#t=ww-e2e&shell=v2')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  const bad: string[] = []
  for (const size of SIZES) {
    await page.setViewportSize(size)
    for (const [product, list] of [['jarvis', JARVIS], ['ww', WW]] as const) {
      if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== product) await page.keyboard.press('Alt+0')
      await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', product)
      for (const [section, n] of list) {
        try {
          await page.keyboard.press(`Control+${n}`)
          await expect(page.locator('.s2-page')).toHaveAttribute('data-section', section)
          // the section change cross-fades with a blur: a picture taken mid-change is blurred (seen in the first trial run), so wait for the page to be still
          await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3000 }).catch(() => undefined)
          const m = await measure(page, '.s2-page', '[data-shell="v2"]')
          const name = `${section}-${size.width}.png`
          const png = await page.screenshot({ path: resolve(dir, name), animations: 'allow' })
          const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'default')
          rows.push({ file: `shell/${name}`, kind: 'shell', entry: `shell/${section}`, state: 'first view', width: size.width, theme, ...m, ...blankFields(await distinctColours(page, png)), truncated: false })
          entries.set(`shell/${section}`, { id: `shell/${section}`, group: 'shell', states: ['first view'], focusStops: 0 })
        } catch (e) {
          bad.push(`shell/${section} ${size.width}: ${(e as Error).message.split('\n')[0]}`)
        }
      }
    }
  }
  expect(bad, 'shell sections that could not be shot').toEqual([])
})
