// The Intake desk on the engine's store (rows R24 and R25), seen in a real browser with the intake and Classroom export routes MOCKED in
// the page to the shapes of app/tests/test_intake_routes.py and test_pyq_takeout.py (as built on main 7e7e3c1). Every row, file name and
// date is invented. Under the v3 look at 1366x768 and 390x844.
//
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_PORT=8991 WW_PREVIEW_PORT=5391 WW_SANDBOX_DIR="$TEMP/jarvis-ui-intake-e2e" npx playwright test e2e/intake-store.spec.ts --workers=1
//
// Pictures go to $TEMP/ui-intake-shots (INTAKE_SHOTS overrides). Each size walks: the list with a row in every state; an ambiguous row that
// Accept refuses until he picks the date, then the PATCH with that date; a decline (no Undo: the store has no way back to new); Take
// refused with the engine's 409 sentence, then taken; a Delete the engine refuses; a paste with one unreadable line; an accepted row
// changed to declined; the Classroom export listed by path with a refused entry and a video, one entry sent to the paper desk; and the
// fault with problems. It asserts that nothing is written before his press (no PATCH, take, delete or accept call without a press), and
// through the shared probe: no page error, no document scroll, no text under 11 px, no key under 44 px, no text cut with an ellipsis.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.INTAKE_SHOTS ?? resolve(tmpdir(), 'ui-intake-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const SRC = 'what you brought in'

const row = (id: string, over: Record<string, unknown>) => ({
  id, source: 'paste', kind: 'deadline', state: 'new', title: 'x', date: null, time: null, readings: [], ambiguous: false, subject: '', subject_suggestion: null,
  repeats: 'none', file: null, raw_hash: id, added: '2026-11-27T09:00:00', updated: '2026-11-27T09:00:00', ...over,
})
const ROWS = () => [
  row('i-aaaaaaaaaa01', { title: 'Assignment 3', date: '2026-12-02', time: '17:00', readings: [{ date: '2026-12-02', order: '' }], subject_suggestion: { subject: 'maths', score: 0.8 } }),
  row('i-aaaaaaaaaa02', { title: 'Quiz 1', ambiguous: true, readings: [{ date: '2026-12-03', order: 'day-month' }, { date: '2027-03-12', order: 'month-day' }], subject_suggestion: { subject: 'circuits', score: 0.66 } }),
  row('i-aaaaaaaaaa03', { source: 'ics', kind: 'event', title: 'Signals tutorial', date: '2026-12-01', time: '10:00', readings: [{ date: '2026-12-01', order: '' }], subject: 'signals', repeats: 'not expanded' }),
  row('i-aaaaaaaaaa04', { state: 'accepted', title: 'Lab report 2', date: '2026-12-04', time: '09:00', readings: [{ date: '2026-12-04', order: '' }], subject: 'signals' }),
  row('i-aaaaaaaaaa05', { state: 'declined', title: 'Seminar', date: '2026-12-05', time: '16:00', readings: [{ date: '2026-12-05', order: '' }] }),
  row('i-aaaaaaaaaa06', { source: 'folder', kind: 'file', title: 'notes-unit4.pdf', file: { name: 'notes-unit4.pdf', size: 482_000, owned: false } }),
  row('i-aaaaaaaaaa07', { source: 'folder', kind: 'file', title: 'scan-sheet.pdf', file: { name: 'scan-sheet.pdf', size: 3_200_000, owned: true } }),
  row('i-aaaaaaaaaa08', { source: 'folder', kind: 'file', state: 'taken', title: 'old-paper.pdf', file: { name: 'old-paper.pdf', size: 900_000, owned: false } }),
]
const LISTING = {
  id: 'tk-0123456789', name: 'classroom-export.zip', total_size: 53_912_000, note: 'Only .pdf and .pptx entries can be read.',
  entries: [
    { name: 'Signals/week1-slides.pdf', size: 912_000, kind: 'pdf', refused: null },
    { name: 'Signals/week2-deck.pptx', size: 1_050_000, kind: 'pptx', refused: null },
    { name: 'Signals/recording.mp4', size: 52_000_000, kind: 'other', refused: null },
    { name: '../outside.pdf', size: 4_000, kind: 'pdf', refused: 'The name leaves the archive.' },
  ],
}

interface Mock { rows: ReturnType<typeof ROWS>; calls: string[]; bodies: Record<string, unknown[]>; fault: boolean; takeBusy: boolean; unreadable: boolean }
const newMock = (): Mock => ({ rows: ROWS(), calls: [], bodies: {}, fault: false, takeBusy: true, unreadable: true })
const PROBLEMS = ['rows.json could not be parsed; kept beside it as rows.json.1764200000.corrupt.', 'rows.json could not be read (PermissionError).']

async function installMock(page: Page, m: Mock) {
  await page.route('**/api/mission/academics', (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subjects: [{ id: 'maths', name: 'Maths' }, { id: 'signals', name: 'Signals' }, { id: 'circuits', name: 'Circuits' }] }) }))
  await page.route((u) => u.pathname.startsWith('/api/mission/intake') || u.pathname.startsWith('/api/mission/pyq/takeout'), async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const method = req.method()
    const path = u.pathname
    m.calls.push(`${method} ${path}${u.search}`)
    let body: Record<string, unknown> = {}
    try { body = req.postDataJSON() ?? {} } catch { body = {} }
    const json = (data: Record<string, unknown>, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { source: SRC, ...data } : data) })
    const refuse = (status: number, detail: string) => json({ detail }, status)
    const keep = (k: string) => { (m.bodies[k] ??= []).push(body) }
    if (path === '/api/mission/intake' && method === 'GET') {
      if (m.fault) return json({ state: 'fault', reason: PROBLEMS[PROBLEMS.length - 1], items: [], count: 0, problems: PROBLEMS })
      return json({ state: 'live', reason: `${m.rows.length} rows brought in.`, items: m.rows, count: m.rows.length })
    }
    if (path === '/api/mission/intake/paste') {
      keep('paste')
      const added = row('i-aaaaaaaaaa09', { title: 'Lab 3', date: '2026-12-09', readings: [{ date: '2026-12-09', order: '' }] })
      m.rows.push(added)
      return json({ state: 'live', reason: '1 new row from your lines; 1 line could not be read.', items: [added], count: 1, unread: [{ line: 2, text: '9 Dec 5pm', reason: 'Nothing is left for a title once the date and time are taken out.' }] })
    }
    const one = /^\/api\/mission\/intake\/(i-[0-9a-f]{12})(\/take)?$/.exec(path)
    if (one && method === 'PATCH') {
      keep('patch')
      const r = m.rows.find((x) => x.id === one[1])
      if (!r) return refuse(404, 'No such row.')
      if (r.ambiguous && !body.date) return refuse(400, 'This date can be read two ways; give the date before accepting.')
      Object.assign(r, { state: body.state, date: (body.date as string) ?? r.date, ambiguous: body.date ? false : r.ambiguous, subject: (body.subject as string) ?? r.subject })
      return json({ state: 'live', reason: `Row ${body.state}.`, row: r })
    }
    if (one && one[2] && method === 'POST') {
      keep('take')
      if (m.takeBusy) { m.takeBusy = false; return refuse(409, 'Already reading files; wait for that to finish.') }
      const r = m.rows.find((x) => x.id === one[1])!
      r.state = 'taken'
      return json({ state: 'live', reason: `Reading ${(r.file as { name: string }).name} into the paper desk.`, row: r, job: { id: 'j1' } })
    }
    if (one && !one[2] && method === 'DELETE') {
      keep('delete')
      return refuse(404, 'No such row.')
    }
    if (path === '/api/mission/pyq/takeout' && method === 'POST') {
      keep('list')
      return json({ state: 'live', reason: 'Listed 4 files in classroom-export.zip: 2 papers or decks you can read, 1 refused. Nothing was extracted.', listing: LISTING })
    }
    if (path === '/api/mission/pyq/takeout/tk-0123456789/accept') {
      keep('accept')
      return json({ state: 'live', reason: 'Reading 1 file from classroom-export.zip.', job: { id: 'j2' } })
    }
    return json({ detail: 'Not Found' }, 404)
  })
}

const WW = ['day', 'focus', 'study', 'tree', 'career']
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openIntake(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `node scripts/build-e2e.mjs` first')
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await expect(page.locator('[data-shell="v2"]')).toHaveAttribute('data-product', 'ww')
  await page.keyboard.press(`Control+${WW.indexOf('study') + 1}`)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < 3; k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('.s2-page')).toHaveAttribute('data-view', 'library')
  await expect(page.locator('[data-component="intake-desk"]')).toBeVisible({ timeout: 20_000 })
}

let sheetProblems: string[] = []
async function closeSheet(page: Page) {
  const done = page.locator('.s3-done:visible')
  if ((await done.count()) === 0) return
  try { await done.first().click({ timeout: 4000 }) } catch (e) {
    sheetProblems.push(`the sheet's Done key cannot be pressed: ${String(e).split(/\r?\n/).find((l) => /intercepts/.test(l))?.trim() ?? 'not reachable'}`)
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(300)
}
/** On the v3 phone the second and third trays are sheets opened from pills named by their peek; elsewhere this does nothing. */
async function reveal(page: Page, pill: 'Detail' | 'Doors', probe: string) {
  await closeSheet(page)
  if (await page.locator(probe).first().isVisible().catch(() => false)) return
  const p = page.locator('.s3-pill', { hasText: new RegExp(`^${pill}`) }).first()
  if (await p.isVisible().catch(() => false)) { await p.click(); await page.waitForTimeout(500) }
}
async function closeDrawer(page: Page) {
  const d = page.locator('.ik-sheet')
  if ((await d.count()) === 0 || !(await d.first().isVisible().catch(() => false))) return
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
}

async function measure(page: Page, at: string, problems: string[]) {
  const m = (await page.evaluate(PROBE)) as Probe
  for (const k of ['small', 'targets', 'sideways', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
  if (m.docOverflow > 1) problems.push(`${at} sideways document overflow ${m.docOverflow}px`)
  const doc = await page.evaluate(() => ({ over: document.documentElement.scrollHeight - document.documentElement.clientHeight, body: document.body.scrollHeight - document.body.clientHeight }))
  if (doc.over > 1 || doc.body > 1) problems.push(`${at} document scrolls vertically ${Math.max(doc.over, doc.body)}px`)
}
const shot = async (page: Page, size: { w: number }, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, `v3-${size.w}-${name}.png`) }) }
const writes = (m: Mock) => m.calls.filter((c) => !c.startsWith('GET '))

test.use({ actionTimeout: 20_000 })

for (const size of SIZES) {
  test.describe(`intake store at ${size.w}x${size.h}`, () => {
    test.use({ viewport: { width: size.w, height: size.h } })

    test('every state, every press his, the engine sentences, the export door', async ({ page, baseURL }) => {
      sheetProblems = []
      const problems: string[] = []
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      const m = newMock()
      await installMock(page, m)
      await openIntake(page, baseURL)
      const tag = (s: string) => `${size.w}px ${s}`
      const desk = page.locator('[data-component="intake-desk"]')

      // ---- the list: new rows only under New; no write was made by looking
      await expect(desk.locator('.ik-row')).toHaveCount(5)
      await expect(desk.locator('.ik-row-title')).toContainText(['Signals tutorial', 'Assignment 3', 'Quiz 1', 'notes-unit4.pdf', 'scan-sheet.pdf'])
      expect(writes(m), 'nothing is written before his press').toEqual([])
      await expect(desk.locator('[data-component="intake-count"]')).toContainText('5 new')
      await measure(page, tag('list'), problems); await shot(page, size, 'intake-1-list')

      // ---- the other states each have their own filter, in the engine's word
      const show = desk.getByRole('radiogroup', { name: 'Show' })
      await show.getByRole('radio', { name: 'Accepted' }).click()
      await expect(desk.locator('.ik-row')).toHaveCount(2)
      await expect(desk.locator('.ik-row').filter({ hasText: 'old-paper.pdf' })).toContainText('Sent')
      await expect(desk.locator('.ik-row').filter({ hasText: 'Lab report 2' })).toContainText('Accepted')
      await measure(page, tag('accepted'), problems); await shot(page, size, 'intake-2-accepted')
      await show.getByRole('radio', { name: 'Declined' }).click()
      await expect(desk.locator('.ik-row')).toHaveCount(1)
      await show.getByRole('radio', { name: 'New' }).click()

      // ---- an ambiguous row: Accept is refused until he picks the date; the engine's two readings, in its order words
      await desk.locator('.ik-row[data-row="i-aaaaaaaaaa02"]').click()
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      const detail = page.locator('[data-component="intake-detail"]')
      await expect(detail.getByRole('button', { name: /^Accept/ })).toHaveAttribute('aria-disabled', 'true')
      await expect(detail.getByRole('radiogroup', { name: 'Which date is it?' })).toBeVisible()
      await expect(detail.getByRole('radio', { name: '3 Dec, day first' })).toBeVisible()
      await expect(detail.getByRole('radio', { name: /12 Mar 2027, month first/ })).toBeVisible()
      await measure(page, tag('ambiguous'), problems); await shot(page, size, 'intake-3-ambiguous')
      await detail.getByRole('radio', { name: '3 Dec, day first' }).click()
      await detail.getByRole('button', { name: /^Accept/ }).click()
      await expect(page.locator('.ww-toast').first()).toContainText('Accepted “Quiz 1”')
      expect(m.bodies.patch.at(-1)).toMatchObject({ state: 'accepted', date: '2026-12-03' })
      // the store has no way back to new: the toast offers no Undo
      await expect(page.locator('.ww-toast').getByRole('button', { name: 'Undo' })).toHaveCount(0)

      // ---- a decline is his press too
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      await closeSheet(page)
      await desk.locator('.ik-row[data-row="i-aaaaaaaaaa01"]').click()
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      await detail.getByRole('button', { name: /^Decline/ }).click()
      await expect(page.locator('.ww-toast').last()).toContainText('Declined “Assignment 3”')
      expect(m.bodies.patch.at(-1)).toEqual({ state: 'declined' })

      // ---- Take: the engine says it is busy, in its own sentence; the second press is taken
      await closeSheet(page)
      await desk.locator('.ik-row[data-row="i-aaaaaaaaaa06"]').click()
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      await expect(detail).toContainText('your folder')
      await detail.getByRole('button', { name: 'Take to Papers' }).click()
      await expect(page.locator('.ww-toast').last()).toContainText('Not sent: Already reading files; wait for that to finish.')
      await expect(desk.locator('.ik-row[data-row="i-aaaaaaaaaa06"]')).toHaveCount(1)
      await detail.getByRole('button', { name: 'Take to Papers' }).click()
      await expect(page.locator('.ww-toast').last()).toContainText('Sent for reading.')
      expect(m.bodies.take).toEqual([{ to: 'papers' }, { to: 'papers' }])

      // ---- Delete of a file the app owns needs a second press, and the engine's refusal is printed as it is
      await closeSheet(page)
      await desk.locator('.ik-row[data-row="i-aaaaaaaaaa07"]').click()
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      await expect(detail).toContainText('a copy the app holds')
      const rm = detail.getByRole('button', { name: /Remove this item|Press again to remove this item/ })
      await rm.click()
      expect(m.bodies.delete ?? [], 'one press asks, it does not delete').toHaveLength(0)
      await detail.getByRole('button', { name: 'Press again to remove this item' }).click()
      await expect(page.locator('.ww-toast').last()).toContainText('Not removed: No such row.')
      await expect(desk.locator('.ik-row[data-row="i-aaaaaaaaaa07"]')).toHaveCount(1)
      await measure(page, tag('delete refused'), problems); await shot(page, size, 'intake-4-delete-refused')

      // ---- Paste: the text goes to the engine as it is; the unreadable line is listed with the engine's reason
      await reveal(page, 'Doors', '[data-component="doors"]')
      await page.locator('[data-door="paste"]').click()
      await page.locator('#ik-paste').fill('Maths Lab 3 - due 9 Dec\n9 Dec 5pm')
      await page.getByRole('button', { name: 'Read these lines' }).click()
      const reading = page.locator('[data-component="paste-reading"]')
      await expect(reading).toContainText('1 new row from your lines; 1 line could not be read.')
      await expect(reading).toContainText('9 Dec 5pm')
      await expect(reading).toContainText('line 2: Nothing is left for a title once the date and time are taken out.')
      expect(m.bodies.paste).toEqual([{ text: 'Maths Lab 3 - due 9 Dec\n9 Dec 5pm' }])
      await measure(page, tag('paste'), problems); await shot(page, size, 'intake-5-paste')
      await closeDrawer(page)

      // ---- an accepted row can be changed to declined (no way back to new), by his press
      await closeSheet(page)
      await show.getByRole('radio', { name: 'Accepted' }).click()
      await desk.locator('.ik-row[data-row="i-aaaaaaaaaa04"]').click()
      await reveal(page, 'Detail', '[data-component="intake-detail"]')
      await expect(detail.getByRole('button', { name: /Back to new/ })).toHaveCount(0)
      await detail.getByRole('button', { name: 'Decline instead' }).click()
      expect(m.bodies.patch.at(-1)).toMatchObject({ state: 'declined' })
      await closeSheet(page)

      // ---- the Classroom export: listed by path, the refused entry and the video have no key, one entry is sent on its own press
      const before = writes(m).length
      await reveal(page, 'Doors', '[data-component="doors"]')
      await page.locator('[data-door="archive"]').click()
      await page.locator('#ik-zip-path').fill('D:\\Exports\\classroom-export.zip')
      await page.getByRole('button', { name: 'List it' }).click()
      const door = page.locator('[data-component="archive-listing"]')
      await expect(door).toContainText('4 files in classroom-export.zip')
      await expect(door).toContainText('refused: The name leaves the archive.')
      await expect(door).toContainText('not a .pdf or .pptx; only those are read')
      expect(m.bodies.list).toEqual([{ path: 'D:\\Exports\\classroom-export.zip' }])
      expect(writes(m).length - before, 'listing is one call and sends nothing').toBe(1)
      await expect(door.getByRole('button', { name: 'Send to paper desk' })).toHaveCount(2)
      await expect(page.locator('[data-entry="../outside.pdf"] button')).toHaveCount(0)
      await expect(page.locator('[data-entry="Signals/recording.mp4"] button')).toHaveCount(0)
      expect(m.bodies.accept ?? [], 'nothing is extracted before a press').toHaveLength(0)
      await measure(page, tag('export listed'), problems); await shot(page, size, 'intake-6-export-listed')
      await page.locator('[data-entry="Signals/week2-deck.pptx"]').getByRole('button', { name: 'Send to paper desk' }).click()
      await expect(page.locator('[data-entry="Signals/week2-deck.pptx"]')).toContainText('Reading 1 file from classroom-export.zip.')
      expect(m.bodies.accept).toEqual([{ entries: ['Signals/week2-deck.pptx'] }])
      await expect(page.locator('[data-entry="Signals/week1-slides.pdf"]').getByRole('button', { name: 'Send to paper desk' })).toBeEnabled()
      await measure(page, tag('export sent'), problems); await shot(page, size, 'intake-7-export-sent')
      await closeDrawer(page)

      expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
      problems.push(...new Set(sheetProblems))
      expect(problems, problems.join('\n')).toEqual([])
    })

    test('the rows file set aside is a fault with its lines, never an empty desk', async ({ page, baseURL }) => {
      sheetProblems = []
      const problems: string[] = []
      const m = newMock()
      m.fault = true
      await installMock(page, m)
      await openIntake(page, baseURL)
      const empty = page.locator('[data-component="intake-empty"]')
      await expect(empty).toContainText('Fault: rows.json could not be read (PermissionError).')
      await expect(page.locator('[data-component="intake-problems"] li')).toHaveCount(2)
      await expect(page.locator('[data-component="intake-problems"]')).toContainText('kept beside it as rows.json.1764200000.corrupt.')
      await expect(page.locator('[data-component="intake-count"]')).toContainText('--')
      expect(writes(m)).toEqual([])
      await measure(page, `${size.w}px fault`, problems); await shot(page, size, 'intake-8-fault')
      expect(problems, problems.join('\n')).toEqual([])
    })
  })
}
