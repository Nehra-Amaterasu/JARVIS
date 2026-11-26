// Day fixes (25 Nov), in a real Chromium on the built app (dist-e2e) under the v3 look: the Date sheet, the Proof drawer, the counters
// of Day / Today and the gym session inside Day / Body. Sandbox only, never the live app.
//
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_PORT=8901 WW_PREVIEW_PORT=5301 WW_SANDBOX_DIR="$TEMP/jarvis-ui-day-e2e" npx playwright test e2e/day-fixes.spec.ts --workers=1
//
// Every route that carries a number or a subject is answered here with invented rows (no real subject, no real counter name), so the
// checks do not depend on what the sandbox holds. The measures: no two fields of a paper intersect, nothing passes the sheet's edge,
// every label stands directly above its own field, the Proof drawer has no horizontal scroll and cuts nothing, "+N more" stays on
// Today, plus / minus / undo move the engine's numbers, the college tick never shows 2, and Body starts a session in place (no sheet).
// Pictures go to $TEMP/ui-day-shots (UI_DAY_SHOTS overrides).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Locator, Page, Route } from '@playwright/test'
import { expect, test } from './fixtures'

const SHOTS = resolve(process.env.UI_DAY_SHOTS ?? resolve(tmpdir(), 'ui-day-shots'))
mkdirSync(SHOTS, { recursive: true })
const SIZES = [
  { name: '1366x768', w: 1366, h: 768 },
  { name: '800x900', w: 800, h: 900 },
  { name: '390x844', w: 390, h: 844 },
  { name: '360x740', w: 360, h: 740 },
]
const phone = (w: number) => w < 700

interface Box { x: number; y: number; width: number; height: number }
const overlap = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

// ---------------------------------------------------------------- invented data
const EXAMS = [
  { subject: 'sig', title: 'Signals and Systems', date: '2026-12-08', start: '10:00', end: '13:00', units: [1, 2, 3, 4, 5], kind: 'end_sem', max: 60, target: 45, approx: true, difficulty: 'normal' },
  { subject: 'cir', title: 'Circuits', date: '2026-12-10', start: '10:00', end: '13:00', units: [], kind: 'backlog', max: 60, target: null, approx: false, difficulty: 'hard', may_miss: true },
  { subject: 'dsp', title: 'Digital Design', date: '2026-12-14', start: null, end: null, units: [2, 3], kind: 'cie', max: 20, target: 15, approx: true, difficulty: 'easy' },
]
const SUBJECTS = [{ id: 'sig', name: 'Signals and Systems' }, { id: 'cir', name: 'Circuits' }, { id: 'dsp', name: 'Digital Design' }]

const stat = (id: string, name: string, value: number, unit?: string) => ({ id, name, value, unit, explain: `${name} is counted from logged work.` })
const week = (start: string, end: string, days_logged: number, mean: number | null) => ({ start, end, days_logged, mean })
const STATUS = {
  date: '2026-11-25', rank: { rank: 'D' }, level: { level: 5, into: 80, need: 180 }, xp: 640,
  stats: [stat('knowledge', 'Knowledge', 0), stat('focus', 'Focus', 32, 'h'), stat('consistency', 'Consistency', 2, '/30 days'), stat('proof', 'Proof', 0), stat('recall', 'Recall', 12), stat('vitality', 'Vitality', 0)],
  not_counted: { xp_from_games: 80, xp_carried_over: 0, nodes_claimed: [], explain: 'XP from games has no logged action behind it.' },
  domains: [{ id: 'fitness', name: 'Fitness', status: 'off' }, { id: 'money', name: 'Money: skills for income', status: 'planned', why: 'Needs a source of real evidence first.' }],
}
const V2 = {
  date: '2026-11-25',
  series: [{ id: 'water', name: 'Glasses of water', want: 'more', weeks: [week('a', 'b', 0, null), week('c', 'd', 3, 4), week('e', 'f', 0, null), week('g', 'h', 5, 6)], points: [4, 6], weeks_with_data: 2, enough_for_line: true }],
  weeks_note: 'A line needs 2 weeks with logged days; a week with none is left out, never drawn as 0.',
  consistency: { window_days: 28, counters: [{ id: 'water', name: 'Glasses of water', logged: 8, asked: 8, hit: 6, ratio: 0.75, need: 0 }], hit: 6, asked: 8, ratio: 0.75, rule: 'A day counts when the counter was logged that day.' },
  rank: { rank: 'D', next: 'C', target: 'C', top: false, met: 1, of: 2, requirements: [
    { req: 'hours', name: 'focus hours logged', have: 32, need: 60, met: false },
    { req: 'nodes', name: 'skill-tree nodes mastered with a finished contract', have: 3, need: 3, met: true },
  ] },
  suggestions: [
    { id: 'consistency', text: 'Consistency is 2/30 days. One 15-minute contract today would count.', go: { ws: 'study', view: null, label: 'Go to Study' }, basis: 'a rule' },
    { id: 'quest', text: 'Optional: the calisthenics quest line adds one 15-minute session a day.', go: { card: 'P4', label: 'Show quest lines' }, basis: 'a rule' },
  ],
  recent: [], wins: [],
  advice: [{ id: 'if-then', text: 'Write the plan as a sentence with a trigger.', source: { author: 'A. Author', work: 'A paper about plans', year: 1999, kind: 'journal article' }, strength: 'theory', strength_note: 'an explanation put forward', limit: 'Short studies only.' }],
}
const WEEKLY = { status: 'ok', week: { start: '2026-11-19', end: '2026-11-25' }, totals: '3/7 active days, 120 minutes', moved: [], stalled: [], change: { rule: 'keep', text: 'Next week: keep the plan.' }, say: '' }
const SESSIONS = { status: 'ok', say: 'Building today: 40 minutes.', today_minutes: 40, week_minutes: 150, week_areas: { project: 90 }, model: { explain: 'Commits less than 90 min apart are one session.' } }
const GITHUB = { status: 'ok', configured: false, say: 'No GitHub name is set.' }

interface Row { id: string; name: string; want: string; today: number | null }

async function mockInputs(page: Page) {
  await page.route(/\/api\/mission\/inputs$/, (r) => json(r, { raw: { exams: EXAMS, subjects: SUBJECTS.map((s) => ({ ...s, units: [] })) }, inputs: { source: 'file', warnings: [] }, editable: ['exams'] }))
  await page.route(/\/api\/mission\/academics$/, (r) => json(r, { subjects: SUBJECTS, exams: [] }))
}
async function mockProof(page: Page) {
  await page.route(/\/api\/mission\/status$/, (r) => json(r, STATUS))
  await page.route(/\/api\/mission\/status\/v2$/, (r) => json(r, V2))
  await page.route(/\/api\/mission\/weekly$/, (r) => json(r, WEEKLY))
  await page.route(/\/api\/mission\/engine\/sessions$/, (r) => json(r, SESSIONS))
  await page.route(/\/api\/mission\/engine\/proof$/, (r) => json(r, GITHUB))
}
/** A small engine for the counters: the same rules as germoney.life_tap (0 to 500, `value` sets, `delta` nudges). Returns the rows and the log of bodies. */
async function mockLife(page: Page) {
  const rows: Row[] = [
    { id: 'college', name: 'Went to college', want: 'yes', today: 1 },
    { id: 'smokes', name: 'Cigarettes', want: 'less', today: 6 },
    { id: 'joints', name: 'Joints', want: 'less', today: 1 },
    { id: 'drinks', name: 'Drinks', want: 'less', today: null },
    { id: 'water', name: 'Glasses of water', want: 'more', today: 4 },
    { id: 'reels', name: 'Reels', want: 'less', today: 2 },
  ]
  const posts: Record<string, unknown>[] = []
  await page.route(/\/api\/mission\/life$/, (r) => json(r, { status: 'ok', counters: rows }))
  await page.route(/\/api\/mission\/life\/count$/, (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>
    posts.push(body)
    const row = rows.find((x) => x.id === body.id)
    if (!row) return json(r, { detail: 'no such counter' }, 400)
    const v = 'value' in body ? Number(body.value) : (row.today ?? 0) + Number(body.delta)
    if (!(v >= 0 && v <= 500)) return json(r, { detail: 'a count is 0 to 500' }, 400)
    row.today = v
    return json(r, { status: 'ok', counters: rows })
  })
  return { rows, posts }
}

async function open(page: Page, baseURL: string | undefined, size: { w: number; h: number }, hash: string) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
  await page.evaluate((h) => { location.hash = h }, hash)
  await expect(page.locator('.s2-page')).toBeVisible()
}
/** On the phone the second and third tray are bottom sheets behind two pills: open the one whose job reads `job`. */
async function showTray(page: Page, size: { w: number }, job: RegExp) {
  if (!phone(size.w)) return
  const pill = page.locator('[data-peek]').filter({ hasText: job }).first()
  // the tray registers its pills a moment after the page mounts: press until the pill says its sheet is open
  await expect(async () => {
    if ((await pill.getAttribute('aria-expanded')) !== 'true') await pill.click({ timeout: 2000 })
    expect(await pill.getAttribute('aria-expanded')).toBe('true')
  }).toPass({ timeout: 15_000 })
}
/** Press a key after centring it: on the phone a tray is a bottom sheet with its own Done key along the foot, and Playwright's "nearest edge" scroll can leave a key under it. */
const tap = async (loc: Locator) => {
  // centre it inside its own scroller only: element.scrollIntoView() would also shift the shell's overflow:hidden frame, and a picture taken then is a lie
  await loc.evaluate((e) => {
    let p = e.parentElement
    while (p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement
    if (p) p.scrollTop += e.getBoundingClientRect().top - p.getBoundingClientRect().top - p.clientHeight / 2
  })
  await loc.click()
}
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) })

test.describe('Day fixes', () => {
  test.describe.configure({ mode: 'default' })

  // ================================================================ R2 the Date sheet
  for (const size of SIZES) {
    test(`${size.name}: the Date sheet never overlaps, never passes its edge, every label stands over its own field`, async ({ page, baseURL }) => {
      test.setTimeout(40_000)
      await mockInputs(page)
      await mockLife(page)
      await open(page, baseURL, size, '#day/today')
      await showTray(page, size, /follow|ahead/i)
      await page.getByRole('button', { name: 'Edit the date sheet' }).first().click()
      const sheet = page.locator('.ww-sheet[data-state="open"]')
      await expect(sheet.locator('[data-paper]').first()).toBeVisible()
      for (let pageNo = 0; pageNo < 2; pageNo++) {
        const body = (await sheet.locator('.ww-sheet-body').boundingBox())!
        const hScroll = await sheet.locator('.ww-sheet-body').evaluate((e) => e.scrollWidth - e.clientWidth)
        expect(hScroll, 'the sheet scrolls sideways').toBeLessThanOrEqual(1)
        for (const paper of await sheet.locator('[data-paper]:visible').all()) {
          const fields = await paper.locator('.ww-field').all()
          expect(fields.length).toBe(9) // Subject Paper Date Starts Ends How hard Aim for Out of Units covered
          const boxes: Box[] = []
          for (const f of fields) {
            const b = (await f.boundingBox())!
            boxes.push(b)
            expect(b.x, 'a field starts left of the sheet body').toBeGreaterThanOrEqual(body.x - 1)
            expect(b.x + b.width, 'a field passes the sheet\'s right edge').toBeLessThanOrEqual(body.x + body.width + 1)
            // the label is directly above its own control, in the same column
            const label = (await f.locator('.ww-field-label').boundingBox())!
            const control = (await f.locator('.ww-input').boundingBox())!
            expect(label.y + label.height, 'a label is under its field').toBeLessThanOrEqual(control.y + 1)
            expect(Math.abs(label.x - control.x), 'a label is over another column').toBeLessThanOrEqual(12)
            expect(control.height, 'an input is under 44 px').toBeGreaterThanOrEqual(43.5)
          }
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `field ${i} meets field ${j}`).toBe(false)
          // the units hint is whole: nothing clips it and it reaches the full text
          const hint = paper.locator('.ww-field-note')
          await expect(hint).toHaveText('Numbers, commas. Empty is all.')
          expect(await hint.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
          const h = (await hint.boundingBox())!
          expect(h.x + h.width).toBeLessThanOrEqual(body.x + body.width + 1)
        }
        if (pageNo === 0) {
          await shot(page, `date-${size.name}`)
          const next = page.getByRole('button', { name: 'Next papers' })
          if (!(await next.isVisible()) || (await next.getAttribute('aria-disabled')) === 'true') break
          await next.click()
        }
      }
      // the functions are still there: paging, Add a paper, the two ticks, delete, Save when something changed
      await expect(sheet.getByRole('button', { name: 'Add a paper' })).toBeVisible()
      const first = sheet.locator('[data-paper]:visible').first()
      await first.getByLabel('Tentative').click()
      await expect(sheet.getByRole('button', { name: /^Save \d+ change/ })).toBeVisible()
      await expect(first.getByRole('button', { name: /^Remove / })).toBeVisible()
      // a comma can be typed in Units covered
      const units = first.getByLabel('Units covered')
      await units.fill('1, 2,')
      await expect(units).toHaveValue('1, 2,')
    })
  }

  // ================================================================ R3 the Proof drawer
  for (const size of SIZES) {
    test(`${size.name}: the Proof drawer is three plain sections, nothing cut, no sideways scroll`, async ({ page, baseURL }) => {
      test.setTimeout(40_000)
      await mockProof(page)
      await mockLife(page)
      await open(page, baseURL, size, '#day/today')
      await showTray(page, size, /evidence|proof/i)
      await page.locator('.ps-open').first().click()
      const sheet = page.locator('.ww-sheet[data-state="open"]')
      await expect(sheet.locator('[data-card="P1"]')).toBeVisible()
      const body = sheet.locator('.ww-sheet-body')
      const bb = (await body.boundingBox())!
      expect(await body.evaluate((e) => e.scrollWidth - e.clientWidth), 'the Proof drawer scrolls sideways').toBeLessThanOrEqual(1)
      // the three sections, in order, each with a real heading
      await expect(sheet.locator('[data-card] .ww-card-title')).toHaveText(['Rank', 'The System suggests', 'Stats']) // the other seven are not mounted until the fold opens
      await expect(sheet.locator('[data-card="P2"] .ww-kicker')).toHaveText('Next steps')
      // no box inside a box: the cards have no face, and nothing in the three sections draws a border
      const framed = await sheet.locator('[data-card="P1"], [data-card="P2"], [data-card="P3"]').evaluateAll((els) => els.flatMap((root) => [root, ...root.querySelectorAll('*')]).filter((e) => {
        const cs = getComputedStyle(e as Element)
        return (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' && cs.borderTopStyle !== 'hidden' && !e.matches('.ww-meter[data-known="false"]')) && !(e as HTMLElement).matches('button, input, select, textarea')
      }).map((e) => (e as HTMLElement).className))
      expect(framed, 'a hairline box in the Proof sections').toEqual([])
      // nothing passes the right edge, and the numerals are the reading face
      for (const sel of ['[data-card="P1"] *', '[data-card="P2"] *', '[data-card="P3"] *']) {
        const over = await sheet.locator(sel).evaluateAll((els, edge) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > (edge as number) + 1 }).map((e) => (e as HTMLElement).className), bb.x + bb.width)
        expect(over, `cut at the edge in ${sel}`).toEqual([])
      }
      const face = await sheet.locator('[data-card="P3"] .ww-stat-value').first().evaluate((e) => getComputedStyle(e).fontFamily)
      expect(face).not.toMatch(/dot|matrix/i)
      expect(await sheet.locator('[data-card="P3"] .ww-stat').count()).toBe(6)
      // the Rank checklist keeps Met and Open words
      await expect(sheet.locator('[data-card="P1"] [data-req="hours"]')).toContainText('Open')
      await expect(sheet.locator('[data-card="P1"] [data-req="nodes"]')).toContainText('Met')
      // folds are closed by default; "Not counted" opens in place without moving the sheet's width
      const w0 = (await sheet.boundingBox())!.width
      const fold = sheet.getByRole('button', { name: /^Not counted/ })
      await expect(fold).toHaveAttribute('aria-expanded', 'false')
      await fold.click()
      await expect(fold).toHaveAttribute('aria-expanded', 'true')
      expect((await sheet.boundingBox())!.width).toBe(w0)
      // the bars arrive on the calm spring once they scroll into view: 80 of 180 XP is less than half a bar, 3 of 3 a whole one
      await expect(async () => {
        const fills = await sheet.locator('[data-card="P1"] .ww-meter-fill').evaluateAll((els) => els.map((e) => Math.round(new DOMMatrixReadOnly(getComputedStyle(e).transform).a * 100) / 100))
        expect(fills[0], 'the level bar').toBeCloseTo(80 / 180, 1)
        expect(fills[1], 'focus hours 32 of 60').toBeCloseTo(32 / 60, 1)
        expect(fills[2], 'nodes 3 of 3').toBeCloseTo(1, 1)
      }).toPass({ timeout: 8000 })
      await shot(page, `proof-${size.name}`)
      await sheet.locator('[data-card="P3"]').scrollIntoViewIfNeeded()
      await shot(page, `proof-stats-${size.name}`)
      // the seven other cards wait behind one closed fold; a suggestion that points at one opens it
      const more = sheet.getByRole('button', { name: /^More proof/ })
      await expect(more).toHaveAttribute('aria-expanded', 'false')
      await sheet.getByRole('button', { name: 'Show quest lines' }).click()
      await expect(more).toHaveAttribute('aria-expanded', 'true')
      await expect(sheet.locator('[data-card="P4"]')).toBeVisible()
      expect(await body.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    })
  }

  // ================================================================ R4 the counters
  for (const size of SIZES.filter((s) => s.w !== 800)) {
    test(`${size.name}: counters, +N more stays on Today, plus and minus, undo twice, the college tick`, async ({ page, baseURL }) => {
      test.setTimeout(40_000)
      const life = await mockLife(page)
      await open(page, baseURL, size, '#day/today')
      await showTray(page, size, /follow|ahead/i)
      const plate = page.locator('[data-callout="counters"]')
      await expect(plate.locator('.td-ctile')).toHaveCount(4)
      // every key on the plate is at least 44 x 44
      for (const b of await plate.locator('.td-step, .td-tick, .td-more, [data-act]').all()) {
        const r = (await b.boundingBox())!
        expect(Math.min(r.width, r.height), 'a counter key is under 44 px').toBeGreaterThanOrEqual(43.5)
      }
      const hash = await page.evaluate(() => location.hash)
      await tap(plate.getByRole('button', { name: '+2 more' }))
      await expect(plate.locator('.td-ctile')).toHaveCount(6)
      expect(await page.evaluate(() => location.hash), '+N more left Today').toBe(hash)
      await expect(page.locator('.s2-page')).toHaveAttribute('data-view', 'today')
      await shot(page, `counters-${size.name}`)

      const n = (id: string) => plate.locator(`[data-counter="${id}"] .td-ctile-n`)
      await tap(plate.getByRole('button', { name: 'Cigarettes: one more' }))
      await expect(n('smokes')).toHaveText('7')
      await tap(plate.getByRole('button', { name: 'Cigarettes: one less' }))
      await tap(plate.getByRole('button', { name: 'Cigarettes: one less' }))
      await expect(n('smokes')).toHaveText('5')
      await tap(plate.getByRole('button', { name: 'Glasses of water: one more' }))
      await expect(n('water')).toHaveText('5')
      // undo twice: the water first, then the second minus on the cigarettes
      const undo = plate.locator('[data-act="undo-count"]')
      await tap(undo)
      await expect(n('water')).toHaveText('4')
      await tap(undo)
      await expect(n('smokes')).toHaveText('6')
      expect(life.rows.find((r) => r.id === 'smokes')!.today).toBe(6)

      // went to college: one tick, never a number above 1
      const tick = plate.locator('[data-counter="college"] button.td-tick')
      await expect(plate.locator('[data-counter="college"]')).not.toContainText(/\b[2-9]\b/)
      await expect(tick).toHaveAttribute('aria-pressed', 'true')
      await tap(tick)
      await expect(tick).toHaveAttribute('aria-pressed', 'false')
      expect(life.rows.find((r) => r.id === 'college')!.today).toBe(0)
      await tap(tick)
      await expect(tick).toHaveAttribute('aria-pressed', 'true')
      expect(life.rows.find((r) => r.id === 'college')!.today).toBe(1)

      // Choose counters: hide one, the choice is kept on this device
      await tap(plate.locator('[data-act="choose-counters"]'))
      const choose = page.locator('.ww-sheet[data-state="open"]')
      await expect(choose).toContainText('Kept on this device')
      await tap(choose.locator('[data-counter="reels"] button').first())
      await page.keyboard.press('Escape')
      await expect(plate.locator('[data-counter="reels"]')).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('ww.day.counters.v1'))).toContain('reels')
      await shot(page, `counters-chosen-${size.name}`)
    })
  }

  // ================================================================ R5 the gym session inside Body
  for (const size of SIZES.filter((s) => s.w !== 800)) {
    test(`${size.name}: Body starts the session in place, one row per exercise, and saves`, async ({ page, baseURL }) => {
      test.setTimeout(40_000)
      let logged: Record<string, unknown> | null = null
      await page.route(/\/api\/mission\/log$/, (r) => { logged = r.request().postDataJSON() as Record<string, unknown>; return json(r, { ok: true, say: 'logged' }) })
      await mockLife(page)
      await open(page, baseURL, size, '#day/body')
      const startKey = page.locator('[data-act="log-session"]')
      await expect(startKey).toBeVisible()
      await shot(page, `body-idle-${size.name}`)
      await startKey.click()
      // in place: no sheet opened
      await expect(page.locator('.ww-sheet[data-state="open"]')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Which muscles today' })).toBeVisible()
      await page.getByRole('button', { name: /^Chest/ }).click()
      await page.locator('[data-act="build-session"]').click()
      const rows = page.locator('.by-lift')
      await expect(rows.first()).toBeVisible()
      expect(await rows.count()).toBeGreaterThanOrEqual(2)
      await expect(rows.first().locator('.by-lift-last')).toContainText(/^LAST/) // numbers, or the honest "no history yet"
      // one row per exercise with its three inputs, every input 44 px, nothing past the tray
      const tray = (await page.locator('.by-session').boundingBox())!
      for (const input of await rows.first().locator('.by-num-input').all()) {
        const b = (await input.boundingBox())!
        expect(b.height).toBeGreaterThanOrEqual(43.5)
        expect(b.x + b.width).toBeLessThanOrEqual(tray.x + tray.width + 1)
      }
      for (const r of await rows.all()) { const b = (await r.boundingBox())!; expect(b.x + b.width).toBeLessThanOrEqual(tray.x + tray.width + 1) }
      // the page itself never scrolls sideways, and nothing of the session is wider than the window
      const wide = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - innerWidth,
        sx: scrollX,
        out: [...document.querySelectorAll('.by-session, .by-session *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1).map((e) => (e as HTMLElement).className),
      }))
      expect(wide.out, 'a part of the session is outside the window').toEqual([])
      expect(wide.doc, 'the document scrolls sideways').toBeLessThanOrEqual(0)
      await shot(page, `body-session-${size.name}`)
      // Save is unavailable until one lift is filled
      const save = page.locator('[data-act="save-session"]')
      const first = rows.first()
      // the sandbox may hold a session from an earlier run, and the form then starts from its numbers: empty the reps first
      await first.getByLabel(/: reps$/).fill('')
      await expect(save).toHaveAttribute('aria-disabled', 'true')
      await first.getByLabel(/: reps$/).fill('10')
      await first.getByLabel(/: kg$/).fill('40')
      await expect(save).toContainText('1/')
      await save.click()
      await expect(page.locator('.by-session[data-stage="idle"]')).toContainText('Session saved')
      expect(logged).not.toBeNull()
      expect((logged as unknown as { track: string }).track).toBe('body')
      // Change muscles still works
      await startKey.click()
      await page.getByRole('button', { name: /^Back/ }).click()
      await page.locator('[data-act="build-session"]').click()
      await page.locator('[data-act="change-muscles"]').click()
      await expect(page.getByRole('heading', { name: 'Which muscles today' })).toBeVisible()
    })
  }
})
