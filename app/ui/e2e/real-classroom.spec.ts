// The Classroom face (Study > Library > Classroom, files and Due) against the engine's REAL routes G-01 to G-19 in the seeded sandbox:
// no route is mocked. 1366x768, v3 look. Runs only with WW_SANDBOX_SEED=study.
//
//   export WW_SANDBOX_PORT=8961 WW_PREVIEW_PORT=5361 WW_SANDBOX_DIR="$TEMP/jarvis-ui-real-e2e" WW_SANDBOX_SEED=study
//   node scripts/build-e2e.mjs && npx playwright test e2e/real-classroom.spec.ts --workers=1
//
// The sandbox says it is a FIXTURE ("Fixture mode: invented Classroom data", source "an invented Classroom"); the screen has to say so
// too and never show it as a real sign-in. Pictures go to $TEMP/ui-real-shots (REAL_SHOTS overrides).
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { NEEDS_SEED, RAW_ISO, SEEDED, engine, localStamp, openApp, shot, watch } from './real-helpers'

const expect = baseExpect.configure({ timeout: 15_000 })
const G = '/api/mission/gcr'
test.skip(!SEEDED, NEEDS_SEED)

async function openClassroom(page: Page, baseURL: string | undefined) {
  await openApp(page, baseURL, '#study/library')
  const face = page.getByRole('radiogroup', { name: 'Library face' }).getByRole('radio', { name: 'Classroom' })
  await expect(face).toBeVisible({ timeout: 20_000 })
  await face.click()
  await expect(page.locator('[data-component="classroom-shelf"]')).toBeVisible()
  await expect(page.locator('[data-component="classroom-link"]')).toBeVisible()
}

test.describe('real routes: Classroom', () => {
  test('files view: the link says fixture, the courses, the files and what each key answers', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    await openClassroom(page, baseURL)
    const status = (await engine(`${G}/status`)).body
    const courses = (await engine(`${G}/courses`)).body
    const files = (await engine(`${G}/files`)).body

    // ---- G-01: the link. The engine's state, its sentence (which says fixture), and its counts, as written
    const link = page.locator('[data-component="classroom-link"]')
    await expect.soft(link).toHaveAttribute('data-state', status.state)
    await expect.soft(link, 'the engine\'s sentence is on the screen').toContainText(status.reason)
    await expect.soft(link, 'a fixture is said as a fixture, never as a sign-in').toContainText(/fixture/i)
    await expect.soft(link.locator('[data-component="classroom-counts"]')).toHaveText(
      [['courses', 'course'], ['files', 'file'], ['notes', 'note'], ['papers', 'paper'], ['faults', 'fault']].map(([k, one]) => `${status.counts[k]} ${one}${status.counts[k] === 1 ? '' : 's'}`).join(', '))
    const synced = await link.locator('[data-component="classroom-synced"]').innerText()
    expect.soft(synced, `"Last sync" shows the engine's UTC stamp raw (${synced})`).not.toMatch(RAW_ISO)
    await shot(page, 'classroom-files-link')

    // ---- G-06: each course, its counts and its state word (the engine's item state is Google's "active", not a lamp state)
    for (const c of courses.items) {
      const row = page.locator(`[data-course="${c.id}"]`)
      await expect.soft(row, `course ${c.id} is listed`).toContainText(c.name)
      await expect.soft(row).toContainText(`${c.files} files, ${c.notes} notes, ${c.papers} papers`)
      await expect.soft(row.locator('[data-lamp]').first(), `course ${c.id} state "${c.state}" is drawn as LIVE`).toHaveAttribute('data-lamp', 'live')
    }

    // ---- G-07: each file, the stale one and the also-in one say so
    for (const f of files.items) {
      const row = page.locator(`[data-file="${f.id}"]`)
      await expect.soft(row, `file ${f.id} is listed`).toContainText(f.title)
      if (f.stale) await expect.soft(row.locator('[data-component="classroom-stale"]')).toBeVisible()
      for (const a of f.also_in ?? []) {
        const other = courses.items.find((c: any) => c.id === a.course)
        await expect.soft(row.locator('[data-component="classroom-also"]'), `"Also in" names the course, not its id ${a.course}`).toContainText(other?.name ?? a.post_title)
      }
    }
    await shot(page, 'classroom-files-list')

    // ---- the stale file: the engine's reason is the sentence, the note opens
    const stale = files.items.find((f: any) => f.stale)
    await page.locator(`[data-file="${stale.id}"] .cr-pick`).click()
    const reader = page.locator('[data-component="classroom-reader"]')
    await expect.soft(reader, 'the stale file shows the engine\'s own reason').toContainText(stale.reason)
    const noteRes = page.waitForResponse((r) => r.url().includes(`/files/${stale.id}/note`))
    await reader.getByRole('button', { name: 'Read note' }).click()
    const note = await (await noteRes).json()
    const heading = String(note.markdown).split(String.fromCharCode(10)).find((l: string) => /^#{1,3} /.test(l))?.replace(/^#+ /, '').trim() ?? ''
    await expect.soft(page.locator('[data-component="classroom-open"][data-mode="note"]'), 'the note shows its first heading').toContainText(heading)
    await shot(page, 'classroom-stale-note')

    // ---- original of a pdf in the app, a Word file only in its own program
    const pdf = files.items.find((f: any) => f.id === 'fxNotesPdf001')
    await page.locator(`[data-file="${pdf.id}"] .cr-pick`).click()
    await reader.getByRole('button', { name: 'Open original' }).click()
    await expect.soft(page.locator('[data-component="classroom-open"][data-mode="original"] iframe')).toBeVisible()
    await shot(page, 'classroom-original')
    const docx = files.items.find((f: any) => f.ext === 'docx')
    await page.locator(`[data-file="${docx.id}"] .cr-pick`).click()
    await expect.soft(reader.getByRole('button', { name: 'Open original' })).toHaveCount(0)

    // ---- G-04, G-05, G-14: Sync now; the key to stop it is offered until the first poll, though the fixture sync takes 0.3 s
    const syncRes = page.waitForResponse((r) => r.url().endsWith(`${G}/sync`) && r.request().method() === 'POST')
    await link.getByRole('button', { name: 'Sync now' }).click()
    await syncRes
    const stop = link.getByRole('button', { name: 'Stop sync' })
    await expect.soft(stop, 'a Stop key while the job runs (the engine ended it in under a second)').toBeVisible({ timeout: 5000 })
    await shot(page, 'classroom-sync-running')
    if (await stop.isVisible().catch(() => false)) {
      await stop.click()
      await expect.soft(page.locator('[data-component="classroom-say"]'), 'Stop after the job ended answers with the engine\'s sentence').toContainText(/No sync is running|Stopping/)
    }
    await expect.poll(async () => (await engine(`${G}/sync`)).body.job.status).toBe('done')
    const job = (await engine(`${G}/sync`)).body.job
    await expect.soft(page.locator('[data-component="classroom-job"]'), 'the finished job\'s own sentence').toContainText(job.text, { timeout: 15_000 })
    for (const line of job.fault_lines) await expect.soft(page.locator('[data-component="classroom-faults"]')).toContainText(line.slice(0, 40))
    await shot(page, 'classroom-sync-done')
    // ---- Send to paper desk: the pdf that is already a paper, then the Word file after Mark as paper
    const paperPdf = files.items.find((f: any) => f.id === 'fxPaperPdf005')
    await page.locator(`[data-file="${paperPdf.id}"] .cr-pick`).click()
    let res = page.waitForResponse((r) => r.url().includes(`/files/${paperPdf.id}/to-papers`))
    await reader.getByRole('button', { name: 'Send to paper desk' }).click()
    let body = await (await res).json().catch(() => ({}))
    const sentence1 = body.reason ?? body.detail ?? ''
    await expect.soft(page.locator('[data-component="classroom-notice"]'), 'the notice is the engine\'s sentence for the pdf').toContainText(sentence1)
    await shot(page, 'classroom-to-papers-pdf')

    await page.locator(`[data-file="${docx.id}"] .cr-pick`).click()
    await expect.soft(reader.getByRole('button', { name: 'Send to paper desk' })).toHaveAttribute('aria-disabled', 'true')
    await reader.getByRole('button', { name: 'Mark as paper' }).click()
    await expect.soft(page.locator('[data-component="classroom-notice"]')).toBeVisible()
    const after = (await engine(`${G}/files`)).body.items.find((f: any) => f.id === docx.id)
    expect.soft(after.kind, 'Mark as paper reached the engine').toBe('paper')
    res = page.waitForResponse((r) => r.url().includes(`/files/${docx.id}/to-papers`))
    await reader.getByRole('button', { name: 'Send to paper desk' }).click()
    body = await (await res).json().catch(() => ({}))
    await expect.soft(page.locator('[data-component="classroom-notice"]'), 'the notice is the engine\'s sentence for the Word file').toContainText(body.reason ?? body.detail ?? '')
    await shot(page, 'classroom-to-papers-docx')

    w.report('classroom files view')
  })

  test('due view: the assignments, reminders, announcements and the calendar', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    await openClassroom(page, baseURL)
    await page.getByRole('radiogroup', { name: 'Classroom view' }).getByRole('radio', { name: 'Due' }).click()
    await expect(page.locator('[data-component="classroom-due-list"]')).toBeVisible()
    const open = (await engine(`${G}/assignments`)).body
    const all = (await engine(`${G}/assignments?show=all`)).body

    // ---- G-15 open: the rows, the work word, Late, the four counts, the read stamp
    for (const a of open.items) {
      const row = page.locator(`[data-assignment="${a.id}"]`).first()
      await expect.soft(row).toContainText(a.title)
      await expect.soft(row, `${a.id} says its Classroom work word`).toContainText({ assigned: 'Assigned', turned_in: 'Turned in', returned: 'Returned', unknown: 'Unknown' }[a.work as 'assigned'])
      if (a.late) await expect.soft(row).toContainText('Late')
      else await expect.soft(row).not.toContainText('Late')
      if (!a.due) await expect.soft(row).toContainText('No due date')
    }
    const counts = page.locator('[data-component="classroom-due-counts"]')
    for (const [k, v] of Object.entries(open.counts)) await expect.soft(counts, `count ${k}`).toContainText(String(v))
    await expect.soft(page.locator('[data-component="classroom-due-state"]'), 'the engine\'s sentence beside the state word').toContainText(open.reason)
    const read = await page.locator('[data-component="classroom-due-read"]').innerText()
    expect.soft(read, `"Read at" shows the engine's UTC stamp raw (${read})`).not.toMatch(RAW_ISO)
    await expect.soft(page.locator('[data-component="classroom-link"]'), 'the fixture is still said in the Due view').toContainText(/fixture/i)
    await shot(page, 'classroom-due-list')

    // ---- All: the turned-in one joins
    await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
    await expect(page.locator('[data-component="classroom-due-list"] [data-assignment]')).toHaveCount(all.items.length)
    await expect.soft(page.locator('.cr-due-row[data-assignment="fxWorkDone02"]')).toContainText('Turned in')
    await shot(page, 'classroom-due-all')

    // ---- the late one: Open in Classroom is refused by the fixture and the screen says the engine's sentence
    await page.locator('[data-assignment="fxWorkLate01"] .cr-pick').click()
    const detail = page.locator('[data-component="classroom-due-detail"]')
    await expect.soft(detail).toContainText('Late')
    let res = page.waitForResponse((r) => r.url().includes('/assignments/fxWorkLate01/open'))
    await detail.getByRole('button', { name: 'Open in Classroom' }).click()
    let body = await (await res).json()
    await expect.soft(page.locator('[data-component="classroom-notice"]')).toContainText(body.detail ?? body.reason)
    // Remind me on work whose time has passed: the engine refuses with a sentence
    res = page.waitForResponse((r) => r.url().includes('/assignments/fxWorkLate01/remind'))
    await detail.getByRole('button', { name: 'Remind me' }).click()
    body = await (await res).json()
    await expect.soft(page.locator('[data-component="classroom-notice"]')).toContainText(body.detail ?? body.reason)
    await shot(page, 'classroom-due-late-refused')

    // ---- the one due soon: Remind me, then Remove reminder
    await page.locator('[data-assignment="fxWorkSoon04"] .cr-pick').click()
    res = page.waitForResponse((r) => r.url().includes('/assignments/fxWorkSoon04/remind'))
    await detail.getByRole('button', { name: 'Remind me' }).click()
    body = await (await res).json()
    await expect.soft(page.locator('[data-component="classroom-notice"]')).toContainText(body.reason)
    await expect.soft(page.locator('[data-component="classroom-reminder"]')).toContainText(localStamp(body.reminder.due))
    await expect.soft(page.locator('.cr-due-row[data-assignment="fxWorkSoon04"]')).toContainText('Reminder set')
    const made = (await engine(`${G}/assignments`)).body.items.find((a: any) => a.id === 'fxWorkSoon04')
    expect.soft(made.reminder?.id, 'the engine lists the reminder it made').toBe(body.reminder.id)
    await shot(page, 'classroom-due-reminder')
    const del = page.waitForResponse((r) => r.url().includes(`/api/reminders/${body.reminder.id}`))
    await detail.getByRole('button', { name: 'Remove reminder' }).click()
    expect.soft((await del).status(), 'DELETE /api/reminders/{id}').toBe(200)
    await expect.soft(detail.getByRole('button', { name: 'Remind me' })).toBeVisible()
    const gone = (await engine(`${G}/assignments`)).body.items.find((a: any) => a.id === 'fxWorkSoon04')
    expect.soft(gone.reminder, 'the engine no longer lists the reminder').toBeNull()

    // ---- G-18, G-19: announcements (newest first, at most 3 shown) and the calendar, times in the viewer's own clock
    const ann = (await engine(`${G}/announcements`)).body
    const annBlock = page.locator('[data-component="classroom-announcements"]')
    for (const x of ann.items.slice(0, 3)) await expect.soft(annBlock).toContainText(x.text)
    await expect.soft(annBlock).toContainText(localStamp(ann.items[0].posted))
    await expect.soft(annBlock, 'the engine\'s sentence').toContainText(ann.reason)
    const cal = (await engine(`${G}/calendar`)).body
    const calBlock = page.locator('[data-component="classroom-calendar"]')
    for (const x of cal.items) await expect.soft(calBlock).toContainText(x.title)
    const timed = cal.items.find((x: any) => !x.all_day)
    await expect.soft(calBlock, `the timed event "${timed.start}" is shown in local time`).toContainText(localStamp(timed.start))
    await expect.soft(calBlock).toContainText('all day')
    await shot(page, 'classroom-due-announcements')
    w.report('classroom due view')
  })
})
