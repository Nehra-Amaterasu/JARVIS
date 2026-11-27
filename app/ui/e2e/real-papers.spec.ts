// The paper desk (Study > Papers) against the engine's REAL pyq routes in the seeded sandbox: three text papers, one scanned paper with
// an OCR job that can run, be stopped and finish, unverified questions with their confidence in the review desk, two drafts from
// notes (accept one, reject one), the patterns and the practise-next list. No route is mocked. 1366x768, v3. Only with WW_SANDBOX_SEED=study.
//
//   export WW_SANDBOX_PORT=8961 WW_PREVIEW_PORT=5361 WW_SANDBOX_DIR="$TEMP/jarvis-ui-real-e2e" WW_SANDBOX_SEED=study
//   node scripts/build-e2e.mjs && npx playwright test e2e/real-papers.spec.ts --workers=1
//
// JARVIS_SANDBOX_OCR_DELAY (seconds a page, default 2) sets how long the job stays running; the run below needs about 4 s a pass.
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { NEEDS_SEED, SEEDED, engine, openApp, shot, watch } from './real-helpers'

const expect = baseExpect.configure({ timeout: 20_000 })
const P = '/api/mission/pyq'
const SCANNED = 'p-c3efd2296c2a'
test.skip(!SEEDED, NEEDS_SEED)

async function openDesk(page: Page, baseURL: string | undefined) {
  await openApp(page, baseURL, '#study/papers')
  await expect(page.locator('[data-component="paper-desk"]')).toBeVisible({ timeout: 25_000 })
}
const choose = async (page: Page, title: string) => {
  await page.mouse.move(683, 130)
  await page.locator('.pp-paper', { hasText: title }).first().click()
}

test.describe('real routes: the paper desk', () => {
  test('the papers listed, OCR on the scanned one (run, stop, run again, done), the review desk', async ({ page, baseURL }) => {
    test.setTimeout(180_000)
    const w = watch(page)
    await openDesk(page, baseURL)
    const papers = (await engine(`${P}/papers`)).body
    expect(papers.items.length).toBeGreaterThanOrEqual(4)

    // ---- R-01: every paper is listed with its title; the counts on a row are the engine's
    for (const p of papers.items) {
      const row = page.locator('.pp-paper', { hasText: p.title.slice(0, 40) }).first()
      await expect.soft(row, `paper ${p.id} is listed`).toBeVisible()
      await expect.soft(row).toContainText(String(p.counts.questions))
    }
    await shot(page, 'papers-list')

    // ---- the scanned paper: faults say run OCR, one key
    const scanned = papers.items.find((p: any) => p.id === SCANNED)
    await choose(page, scanned.title.slice(0, 40))
    const panel = page.locator('[data-component="ocr-panel"]')
    await expect.soft(panel).toBeVisible()
    for (const f of scanned.faults) await expect.soft(page.locator('.pp-faults'), `fault line "${f}"`).toContainText(f)
    const ocr0 = (await engine(`${P}/ocr`)).body
    await expect.soft(panel.locator('.pp-ocr-state')).toContainText(ocr0.reason)
    await shot(page, 'papers-scanned-waiting')

    // ---- run, then Stop while it runs
    const key = page.getByRole('button', { name: /Read with OCR/ })
    await key.click()
    await expect.soft(panel.locator('.pp-ocr-head')).toContainText(/Reading page \d of 2/)
    const mid = (await engine(`${P}/ocr`)).body
    expect.soft(mid.job?.status, 'the engine says running while the screen does').toBe('running')
    await shot(page, 'papers-ocr-running')
    await page.getByRole('button', { name: /Stop/ }).click()
    await expect.soft(panel.locator('.pp-ocr-head')).toHaveText('Stopped', { timeout: 30_000 })
    const stopped = (await engine(`${P}/ocr`)).body
    expect.soft(stopped.job?.status).toBe('stopped')
    await expect.soft(panel.locator('.pp-ocr-facts')).toContainText(`${stopped.job.pages_read ?? stopped.job.pagesRead ?? 0} of`)
    await shot(page, 'papers-ocr-stopped')

    // ---- run again to the end
    await page.getByRole('button', { name: /Read with OCR/ }).click()
    await expect.soft(panel.locator('.pp-ocr-head')).toContainText(/Reading page/)
    await expect.soft(panel.locator('.pp-ocr-head')).toHaveText('Done', { timeout: 60_000 })
    const done = (await engine(`${P}/ocr`)).body
    expect.soft(done.job.status).toBe('done')
    console.log('OCR job at the end:', JSON.stringify(done.job))
    const facts = panel.locator('.pp-ocr-facts')
    await expect.soft(facts).toContainText('Pages read')
    await expect.soft(facts.locator('div', { hasText: /^Drafts to review/ }), 'drafts to review is the engine\'s count').toContainText(String(done.job.questions ?? done.job.drafts ?? ''))
    await expect.soft(page.locator('.pp-faults'), 'the under-gate page keeps its confidence line').toContainText(/below 0\.85|confidence/)
    await shot(page, 'papers-ocr-done')

    // ---- the review desk: questions read by OCR are unverified and say their confidence
    const qs = (await engine(`${P}/questions?paper=${SCANNED}`)).body
    console.log('questions of the scanned paper after OCR:', qs.count, JSON.stringify(qs.items.slice(0, 2)))
    const review = page.getByRole('button', { name: /Review \d+ waiting/ })
    await expect.soft(review).toBeVisible()
    await review.click()
    const desk = page.locator('.rv-desk')
    await expect(desk).toBeVisible()
    await expect.soft(desk).toContainText('Read by OCR, check it.')
    await expect.soft(desk).toContainText(/OCR confidence 0\.\d\d, text unverified\./)
    await expect.soft(desk).not.toContainText(/verified by|checked by me/i)
    await shot(page, 'review-ocr-question')
    let sawWhole = false
    for (let i = 0; i < 6 && !sawWhole; i++) {
      if (/split it by hand/.test(await desk.innerText())) { sawWhole = true; await shot(page, 'review-whole-page-draft') }
      await page.keyboard.press('j')
      await page.waitForTimeout(150)
    }
    expect.soft(sawWhole, 'the whole-page draft is reached').toBe(true)
    await page.keyboard.press('Escape')
    w.report('papers OCR and review')
  })

  test('drafts from notes: accept one, see the rejected one; patterns and practise-next as the desk shows them', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    await openDesk(page, baseURL)
    const drafts = (await engine(`${P}/drafts`)).body
    const pending = drafts.items.find((d: any) => d.status === 'pending')
    const rejected = drafts.items.find((d: any) => d.status === 'rejected')
    await page.getByRole('button', { name: 'Draft questions from my notes' }).click()
    const panel = page.locator('[data-component="drafts-panel"]')

    // ---- R-51: both drafts are listed with their state, their engine checks and their sources; none is called verified
    await expect.soft(panel.locator('.pp-drafts-count')).toContainText('1 draft is waiting')
    const a = panel.locator(`.pp-draft[data-draft="${pending.id}"]`)
    const r = panel.locator(`.pp-draft[data-draft="${rejected.id}"]`)
    await expect.soft(a).toContainText(pending.text)
    await expect.soft(a).toContainText('written by the local model, not checked')
    await expect.soft(a, 'the engine\'s similarity number is drawn as the engine sent it').toContainText(`similarity ${pending.checks.similarity.toFixed(2)}`)
    for (const s of pending.sources) await expect.soft(a).toContainText(s.title)
    await expect.soft(r).toContainText('Rejected')
    await expect.soft(r, 'the engine\'s reason for the rejection is shown').toContainText(String(rejected.reason).slice(0, 30))
    await expect.soft(r.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0)
    await shot(page, 'drafts-list')

    // ---- Accept needs marks; accept with 5 marks; the engine has it as accepted with those marks
    const accept = a.getByRole('button', { name: 'Accept', exact: true })
    await expect.soft(accept).toHaveAttribute('aria-disabled', 'true')
    await a.getByLabel('Marks').fill('5')
    const res = page.waitForResponse((x) => x.url().includes(`/drafts/${pending.id}`) && x.request().method() === 'PATCH')
    await accept.click()
    const answer = await res
    expect.soft(answer.status(), 'the PATCH of the accept was taken').toBe(200)
    await expect.soft(a).toContainText('Accepted by you')
    const after = (await engine(`${P}/drafts`)).body.items.find((d: any) => d.id === pending.id)
    expect.soft(after.status).toBe('accepted')
    expect.soft(after.marks, 'the marks he typed reached the engine').toBe(5)
    await shot(page, 'drafts-accepted')

    // ---- R-31 patterns and R-32 practise-next, as the desk shows them for the subject
    const subject = pending.subject
    const pat = (await engine(`${P}/patterns?subject=${subject}`)).body
    const next = (await engine(`${P}/practise-next?subject=${subject}`)).body
    const body = await page.locator('[data-component="paper-desk"]').innerText()
    // the ledger writes a topic as a short label with an ellipsis, so the first 6 letters are what can be compared
    for (const t of pat.patterns.topics.slice(0, 3)) expect.soft(body, `pattern topic "${t.topic}" is on the desk`).toContain(String(t.topic).slice(0, 6))
    // R-32 practise-next has a client method and no screen on the desk that calls it: nothing of it can be seen here
    expect.soft(next.items.length, 'the engine has a practise-next list').toBeGreaterThan(0)
    expect.soft(body, 'a year the engine does not know is not drawn as 0').not.toMatch(/0\s+0\s+0\s+20\d\d/)
    await shot(page, 'papers-patterns-practise')
    w.report('papers drafts and patterns')
  })
})
