// The Prepare face of Study > Papers against the engine's REAL preparation routes (R-64 to R-74) in the seeded sandbox, with NO mock: each
// tray is compared with what the same route answers when the test asks it. 1366x768, v3. Only with WW_SANDBOX_SEED=study.
//
//   export WW_SANDBOX_PORT=9012 WW_PREVIEW_PORT=5412 WW_SANDBOX_DIR="$TEMP/jarvis-ui-prep-real" WW_SANDBOX_SEED=study
//   node scripts/build-e2e.mjs && npx playwright test e2e/real-prep.spec.ts --workers=1
//
// What the seed cannot drive (28 Nov): it has no question bank, solution sheet or not-a-question item, no fixture model for R-64, and no
// JARVIS_SANDBOX_PREP_DELAY, so a rules-only run ends in well under the 2.5 s poll and "running" with Stop is not seen here (the mocked
// prep-store.spec.ts covers it). The model is never switched to Claude here: nothing of this spec may leave the PC.
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { NEEDS_SEED, SEEDED, engine, openApp, shot, watch } from './real-helpers'

const expect = baseExpect.configure({ timeout: 20_000 })
const P = '/api/mission/pyq'
test.skip(!SEEDED, NEEDS_SEED)

async function openPrepare(page: Page, baseURL: string | undefined) {
  await openApp(page, baseURL, '#study/papers')
  await expect(page.locator('[data-component="paper-desk"]')).toBeVisible({ timeout: 25_000 })
  await page.getByRole('radio', { name: 'Prepare' }).click()
  await expect(page.locator('[data-component="prep-face"]')).toBeVisible()
  await expect(page.locator('[data-said="counts"]')).toBeVisible()
}
const KEYS: [string, string][] = [
  ['papers', 'papers'], ['without_subject', 'without_subject'], ['question_banks', 'question_banks'], ['questions', 'questions'], ['pending', 'pending'],
  ['accepted', 'accepted'], ['accepted_unmarked', 'accepted_unmarked'], ['with_marks', 'with_marks'], ['marks_not_printed', 'marks_not_printed'], ['tagged', 'tagged'], ['not_questions', 'not_questions'],
]
const num = (v: unknown) => (typeof v === 'number' ? String(v) : 'not reported')

test.describe('real routes: the Prepare face', () => {
  test('counts, the model, the policy, a look at each step, a run to the end, accept and take back', async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    const w = watch(page)
    await openPrepare(page, baseURL)

    // ---- R-65: the sentence, and every count of the totals and of each subject, as the route gives them
    const c0 = (await engine(`${P}/prep`)).body
    await expect.soft(page.locator('[data-said="counts"]'), 'R-65 reason').toContainText(c0.reason)
    const stand = page.locator('[data-tray="standing"]')
    for (const [k, f] of KEYS) await expect.soft(stand.locator(`.prp-counts[aria-label="Totals"] [data-count="${k}"] .prp-num`), `R-65 counts.${f}`).toHaveText(num(c0.counts[f]))
    await expect.soft(stand.locator('[aria-label="Totals"] [data-count="solutions"] .prp-num'), 'R-65 counts.solutions.papers').toHaveText(num(c0.counts.solutions?.papers))
    const ready = (c0.counts.by_subject as any[]).reduce((a, s) => a + (s.sheet_ready_topics ?? 0), 0)
    await expect.soft(stand.locator('[aria-label="Totals"] [data-count="sheet_ready_topics"] .prp-num'), 'R-65 sum of by_subject.sheet_ready_topics').toHaveText(String(ready))
    for (const s of c0.counts.by_subject as any[]) {
      const row = stand.locator(`[data-subject="${s.subject}"]`)
      await expect.soft(row, `subject ${s.subject} is listed`).toContainText(s.name)
      for (const [k, f] of [['questions', 'questions'], ['accepted', 'accepted'], ['tagged', 'tagged'], ['sheet_ready_topics', 'sheet_ready_topics']]) await expect.soft(row.locator(`[data-count="${k}"] .prp-num`), `R-65 by_subject ${s.subject}.${f}`).toHaveText(num(s[f]))
    }
    for (const word of await stand.locator('.prp-count .prp-word').allInnerTexts()) expect.soft(word, 'every count carries the state word of R-65').toBe(c0.state.toUpperCase())
    console.log('R-65 counts:', JSON.stringify({ ...c0.counts, by_subject: (c0.counts.by_subject as any[]).map((s) => `${s.subject}:${s.questions}/${s.accepted}`) }))
    await shot(page, 'prep-01-where-it-stands')

    // ---- R-64 and R-69 as tray 3 shows them
    const model = (await engine(`${P}/model`)).body
    const tray3 = page.locator('[data-tray="deciders"]')
    await expect.soft(tray3.locator('[data-said="model"]'), 'R-64 reason').toContainText(model.reason)
    await expect.soft(tray3.locator('[data-count="sends_out"]'), 'R-64 sends_out').toContainText(model.sends_out ? 'yes' : 'no')
    await expect.soft(tray3.locator('[role="radio"][aria-checked="true"]').first(), 'R-64 provider on file').toHaveText({ off: 'Off (rules only)', local: 'Local model', claude: 'Claude' }[model.provider as string] ?? '?')
    console.log('R-64 model:', JSON.stringify(model))
    const pol = (await engine(`${P}/prep/policy`)).body
    await expect.soft(tray3.locator('[data-said="policy"]'), 'R-69 reason').toContainText(pol.reason)
    expect.soft(pol.policy.auto_accept, 'R-69 is off by default').toBe(false)
    await shot(page, 'prep-02-who-decides')

    // ---- a look at every step: each answer as printed equals the route's answer to the same call (apply false)
    const prep = page.locator('[data-tray="prepare"]')
    for (const name of ["Find each paper's subject", 'Read the papers again', 'Tag topics', 'Accept safe questions']) await prep.getByRole('switch', { name, exact: true }).click()
    await prep.locator('[data-key="look"]').click()
    const subjects = (c0.counts.by_subject as any[]).map((s) => s.subject)
    await expect(prep.locator('.prp-look')).toHaveCount(3 + subjects.length, { timeout: 120_000 })
    const r66 = (await engine(`${P}/prep/subjects`, { body: { apply: false, use_model: false } })).body
    await expect.soft(prep.locator('[data-look="subjects"] [data-said]'), 'R-66 look').toContainText(r66.reason)
    const r67 = (await engine(`${P}/prep/reread`, { body: { apply: false } })).body
    await expect.soft(prep.locator('[data-look="reread"] [data-said]'), 'R-67 look').toContainText(r67.reason)
    console.log('R-67 look rows:', JSON.stringify(r67.items?.map((x: any) => [x.title.slice(0, 30), x.changed, x.reason])))
    for (const [i, sid] of subjects.entries()) {
      const r68 = await engine(`${P}/prep/tags`, { body: { subject: sid, apply: false, use_model: false } })
      await expect.soft(prep.locator('[data-look="tags"]').nth(i).locator('[data-said]'), `R-68 look ${sid}`).toContainText(r68.status === 200 ? r68.body.reason : String(r68.body?.detail))
    }
    const after = (await engine(`${P}/prep`)).body
    expect.soft(JSON.stringify(after.counts), 'a look wrote nothing').toBe(JSON.stringify(c0.counts))
    await shot(page, 'prep-03-look')

    // ---- a run to the end on the scratch store (rules only), then tray 1 reads again
    for (const name of ['Read the papers again', 'Accept safe questions']) await prep.getByRole('switch', { name, exact: true }).click()
    await prep.locator('[data-key="run"]').click()
    await expect(prep.locator('.prp-run')).toHaveAttribute('data-run', /done|stopped|failed/, { timeout: 120_000 })
    const run = (await engine(`${P}/prep/run`)).body
    console.log('R-73 at the end:', JSON.stringify({ status: run.status, steps: run.run?.steps, seconds: run.seconds, failures: run.failures, notes: run.run?.notes }))
    expect.soft(run.status, 'R-73 status').toBe('done')
    await expect.soft(prep.locator('.prp-runhead'), 'end word').toHaveText({ done: 'Done', stopped: 'Stopped', failed: 'Failed' }[run.status as string] ?? '?')
    await expect.soft(prep.locator('[data-said="run"]'), 'R-73 reason').toContainText(run.reason)
    for (const [k, f] of [['accepted', 'accepted'], ['tagged', 'tagged'], ['withoutSubject', 'without_subject'], ['pending', 'pending']]) {
      await expect.soft(prep.locator(`[data-bn="${k}"] td`).first(), `R-73 counts_before.${f}`).toHaveText(num(run.counts_before?.[f]))
      await expect.soft(prep.locator(`[data-bn="${k}"] td`).nth(1), `R-73 counts_now.${f}`).toHaveText(num(run.counts_now?.[f]))
    }
    await expect.soft(prep.locator('[data-failures] .prp-num'), 'R-73 failures').toHaveText(num(run.failures))
    const c1 = (await engine(`${P}/prep`)).body
    await expect.soft(stand.locator('[aria-label="Totals"] [data-count="tagged"] .prp-num'), 'tray 1 read again after the run').toHaveText(num(c1.counts.tagged))
    await shot(page, 'prep-04-run-done')

    // ---- the policy switched on by his press, then accept and take back for the first subject
    await tray3.getByRole('switch', { name: 'Accept safe questions by rule' }).click()
    await expect.soft(tray3.locator('[data-said="policy"]'), 'R-69 after his press').toContainText((await engine(`${P}/prep/policy`)).body.reason)
    const sid = subjects[0]
    const row = prep.locator(`[data-accept="${sid}"]`)
    const acc = page.waitForResponse((r) => r.url().endsWith('/prep/accept'))
    await row.locator('[data-key="accept"]').click()
    const accBody = await (await acc).json()
    await expect.soft(row.locator('[data-said]'), 'R-70 answer as shown').toContainText(accBody.reason)
    console.log('R-70:', accBody.state, accBody.reason)
    const un = page.waitForResponse((r) => r.url().endsWith('/prep/unaccept'))
    await row.locator('[data-key="take-back"]').click()
    const unBody = await (await un).json()
    await expect.soft(row.locator('[data-said]'), 'R-71 answer as shown').toContainText(unBody.reason)
    expect.soft(unBody.returned, 'take back returns what the rule accepted').toBe(accBody.accepted)
    console.log('R-71:', unBody.state, unBody.reason)
    await shot(page, 'prep-05-accept-take-back')
    // the policy back off, as he found it
    await tray3.getByRole('switch', { name: 'Accept safe questions by rule' }).click()
    w.report('prepare face')
  })
})
