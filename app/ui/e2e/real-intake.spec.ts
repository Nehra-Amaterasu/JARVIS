// The Intake desk and the Classroom export door against the REAL routes of the seeded sandbox: no mocks. Every screen is compared with what
// the same route returns, read straight from the engine by this spec with the sandbox token. It runs only when the sandbox was started
// with the study seed (the owner's data is never read):
//
//   cd app && python -m jarvis_app.ww_sandbox --seed study --port 8992 --token ww-e2e --dir "$TEMP/jarvis-ui-intake-seed" --fresh
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_SEED=study WW_SANDBOX_PORT=8992 WW_PREVIEW_PORT=5392 WW_SANDBOX_DIR="$TEMP/jarvis-ui-intake-seed" npx playwright test e2e/real-intake.spec.ts --workers=1
//
// The seed of 27 Nov has no intake rows and no export archive ("intake rows: next" on the board), so this spec makes its own through the
// desk: it pastes lines (the engine's parser reads them), accepts, declines, and lists a .zip it builds with the venv's python in a scratch
// folder. It writes only to the sandbox's folder. The ambiguity and the problem lines it needs are made by the real engine, not by us.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'

const expect = baseExpect.configure({ timeout: 20_000 })
const PORT = Number(process.env.WW_SANDBOX_PORT ?? 8790)
const SEEDED = process.env.WW_SANDBOX_SEED === 'study'
const DIR = process.env.WW_SANDBOX_DIR ?? ''
const SHOTS = resolve(process.env.INTAKE_SHOTS ?? resolve(tmpdir(), 'ui-intake-shots'))
const TOKEN = 'ww-e2e'
const PY = process.env.WW_PYTHON ?? 'C:/Projects/JARVIS/.venv/Scripts/python.exe'

const engine = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { ...init, headers: { 'x-jarvis-token': TOKEN, ...(init.headers ?? {}) } })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> }
}
const WW = ['day', 'focus', 'study', 'tree', 'career']
const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})
async function openIntake(page: Page) {
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('[data-shell="v2"]')).toBeVisible({ timeout: 15_000 })
  await blurText(page)
  if ((await page.locator('[data-shell="v2"]').getAttribute('data-product')) !== 'ww') await page.keyboard.press('Alt+0')
  await page.keyboard.press(`Control+${WW.indexOf('study') + 1}`)
  await expect(page.locator('.s2-page')).toHaveAttribute('data-section', 'study')
  for (let k = 0; k < 6; k++) { await blurText(page); await page.keyboard.press('[') }
  for (let k = 0; k < 3; k++) { await blurText(page); await page.keyboard.press(']') }
  await expect(page.locator('[data-component="intake-desk"]')).toBeVisible({ timeout: 20_000 })
}
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, `real-1366-${name}.png`) }) }
const findRows = (dir: string): string | null => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { const r = findRows(p); if (r) return r } else if (n === 'rows.json' && p.includes('intake')) return p
  }
  return null
}

test.describe('the real intake routes, no mocks', () => {
  test.skip(!SEEDED, 'WW_SANDBOX_SEED=study is not set: this spec needs the sandbox started with the study seed, so it never touches the real data')
  test.use({ viewport: { width: 1366, height: 768 }, actionTimeout: 20_000 })

  test('the list, a paste, a decision, a decline and the export, each compared with its route', async ({ page }) => {
    const mismatches: string[] = []
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await openIntake(page)
    const desk = page.locator('[data-component="intake-desk"]')

    // ---- the list on screen equals the route's list (the seed has none: the engine's own sentence is on screen, not an invented desk)
    const first = await engine('/api/mission/intake')
    if (first.json.count === 0) {
      await expect(desk.locator('[data-component="intake-empty"]')).toContainText(first.json.reason)
      await expect(desk.locator('.ik-row')).toHaveCount(0)
    }
    await shot(page, 'intake-1-empty')

    // ---- paste: the screen shows what the engine's POST answered
    await page.locator('[data-door="paste"]').click()
    // a number in each title, so a second run on the same sandbox folder still makes new rows (the store drops a line it already has)
    const n = Date.now() % 100000
    await page.locator('#ik-paste').fill(`Fixture Circuits Lab ${n} - due 9 Dec 5pm
Fixture Signals quiz ${n} - due 04/05
9 Dec 5pm`)
    const posted = page.waitForResponse((r) => r.url().endsWith('/api/mission/intake/paste') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Read these lines' }).click()
    const ans = (await (await posted).json()) as Record<string, any>
    const reading = page.locator('[data-component="paste-reading"]')
    await expect(reading).toContainText(ans.reason)
    for (const t of ans.items as { title: string }[]) await expect(reading).toContainText(t.title)
    for (const u of ans.unread as { line: number; text: string; reason: string }[]) await expect(reading).toContainText(`line ${u.line}: ${u.reason}`)
    if ((ans.unread as unknown[]).length === 0) mismatches.push('the engine read all three pasted lines, including the line "9 Dec 5pm" (a date and nothing else); no unread line was exercised')
    await shot(page, 'intake-2-pasted')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // ---- the desk's list equals the route's list again, row for row (title, state, date)
    const list = await engine('/api/mission/intake')
    const news = (list.json.items as any[]).filter((r) => r.state === 'new')
    await expect(desk.locator('.ik-row')).toHaveCount(news.length)
    for (const r of news) await expect(desk.locator(`.ik-row[data-row="${r.id}"]`)).toContainText(r.title)
    await expect(desk.locator('[data-component="intake-count"]')).toContainText(`${news.length} new`)
    await shot(page, 'intake-3-list')

    // ---- an ambiguous row (if the engine read one): the two readings on screen are the engine's; Accept sends the date he chose and the route agrees
    const amb = news.find((r) => r.ambiguous)
    if (amb) {
      await desk.locator(`.ik-row[data-row="${amb.id}"]`).click()
      const detail = page.locator('[data-component="intake-detail"]')
      await expect(detail.getByRole('button', { name: /^Accept/ })).toHaveAttribute('aria-disabled', 'true')
      const pick = detail.getByRole('radiogroup', { name: 'Which date is it?' }).getByRole('radio').first()
      await pick.click()
      const patched = page.waitForResponse((r) => /\/api\/mission\/intake\/i-/.test(r.url()) && r.request().method() === 'PATCH')
      await detail.getByRole('button', { name: /^Accept/ }).click()
      const pa = (await (await patched).json()) as Record<string, any>
      await expect(page.locator('.ww-toast').last()).toContainText(`Accepted “${amb.title}”`)
      if (pa.row.date !== amb.readings[0].date) mismatches.push(`ambiguous accepted with the first reading ${amb.readings[0].date}, the route kept ${pa.row.date}`)
      const after = (await engine('/api/mission/intake')).json.items.find((r: any) => r.id === amb.id)
      if (after.state !== 'accepted' || after.ambiguous !== false) mismatches.push(`after Accept the route says state ${after.state} ambiguous ${after.ambiguous}`)
    } else mismatches.push('the engine read no ambiguous row from "04/05"; the ambiguity flow was not exercised')

    // ---- a decline: the screen's row leaves New and the route says declined
    const rest = (await engine('/api/mission/intake')).json.items.find((r: any) => r.state === 'new' && !r.ambiguous)
    if (rest) {
      await desk.locator(`.ik-row[data-row="${rest.id}"]`).click()
      await page.locator('[data-component="intake-detail"]').getByRole('button', { name: /^Decline/ }).click()
      await expect(desk.locator(`.ik-row[data-row="${rest.id}"]`)).toHaveCount(0)
      const state = (await engine('/api/mission/intake')).json.items.find((r: any) => r.id === rest.id).state
      if (state !== 'declined') mismatches.push(`declined on screen, the route says ${state}`)
      await desk.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Declined' }).click()
      await expect(desk.locator(`.ik-row[data-row="${rest.id}"]`)).toHaveCount(1)
      await expect(page.locator('.ww-toast').last().getByRole('button', { name: 'Undo' })).toHaveCount(0)
    }
    await shot(page, 'intake-4-decided')

    // ---- the Classroom export: a zip built here, listed by path; the screen's entries are the route's, the refused ones have no key
    const zip = join(tmpdir(), 'ui-intake-real-export.zip')
    execFileSync(PY, ['-c', [
      'import zipfile,sys',
      'z=zipfile.ZipFile(sys.argv[1],"w")',
      'z.writestr("Signals/week1-slides.pdf",b"%PDF-1.4\\n%fixture\\n")',
      'z.writestr("Signals/notes.txt",b"invented")',
      'z.writestr("Signals/recording.mp4",b"invented")',
      'z.close()',
    ].join(';'), zip])
    await page.locator('[data-door="archive"]').click()
    await page.locator('#ik-zip-path').fill(zip)
    const listed = page.waitForResponse((r) => r.url().endsWith('/api/mission/pyq/takeout') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'List it' }).click()
    const lst = (await (await listed).json()) as Record<string, any>
    const door = page.locator('[data-component="archive-listing"]')
    await expect(door).toContainText(lst.reason)
    for (const e of lst.listing.entries as { name: string; kind: string; refused: string | null }[]) {
      const li = page.locator(`[data-entry="${e.name}"]`)
      await expect(li).toBeVisible()
      const keys = await li.getByRole('button', { name: 'Send to paper desk' }).count()
      const should = !e.refused && e.kind !== 'other'
      if (keys !== (should ? 1 : 0)) mismatches.push(`${e.name}: engine kind ${e.kind} refused ${e.refused}; the screen drew ${keys} send key(s)`)
      if (e.refused) await expect(li).toContainText(e.refused)
    }
    await shot(page, 'intake-5-export-listed')
    const accepted = page.waitForResponse((r) => /\/takeout\/tk-[0-9a-f]+\/accept$/.test(r.url()))
    await page.locator('[data-entry="Signals/week1-slides.pdf"]').getByRole('button', { name: 'Send to paper desk' }).click()
    const acc = (await (await accepted).json()) as Record<string, any>
    await expect(page.locator('[data-entry="Signals/week1-slides.pdf"]')).toContainText(acc.reason ?? acc.detail)
    await shot(page, 'intake-6-export-sent')
    await page.keyboard.press('Escape')

    // ---- the rows file set aside: the screen is a fault with the engine's own problem lines
    const rows = findRows(DIR)
    if (rows) {
      const aside = `${rows}.keep`
      renameSync(rows, aside)
      writeFileSync(rows, '{ not json', 'utf-8')
      try {
        const bad = await engine('/api/mission/intake')
        await page.reload()
        await openIntake(page)
        if (bad.json.state === 'fault') {
          await expect(desk.locator('[data-component="intake-empty"]')).toContainText(bad.json.reason)
          for (const p of bad.json.problems as string[]) await expect(page.locator('[data-component="intake-problems"]')).toContainText(p)
        } else mismatches.push(`a rows file that is not JSON gave state ${bad.json.state}, not fault`)
        await shot(page, 'intake-7-fault')
      } finally {
        renameSync(aside, rows)
        for (const f of readdirSync(join(rows, '..'))) if (f.endsWith('.corrupt')) renameSync(join(rows, '..', f), join(tmpdir(), `ui-intake-${f}`))
      }
    } else mismatches.push('rows.json was not found under the sandbox folder; the fault with problems was not exercised')

    writeFileSync(join(tmpdir(), 'ui-intake-real-mismatches.txt'), mismatches.join('\n') || 'none', 'utf-8')
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([])
    expect(existsSync(zip)).toBe(true)
    expect(readFileSync(join(tmpdir(), 'ui-intake-real-mismatches.txt'), 'utf-8').split('\n').filter((l) => l && l !== 'none' && !/exercised/.test(l)), mismatches.join('\n')).toEqual([])
  })
})
