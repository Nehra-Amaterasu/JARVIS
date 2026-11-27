// Setup under the v3 look (R18, 27 Nov): the page the older frame kept behind its sixth tab, reachable again. Sandbox only, never the live
// app: engine-inputs.json is written to the scratch data dir of the sandbox, never to data/.
//
//   WW_SANDBOX_PORT=8931 WW_PREVIEW_PORT=5331 WW_SANDBOX_DIR="$TEMP/jarvis-ui-setup-e2e" node scripts/build-e2e.mjs
//   (the same variables) npx playwright test e2e/setup-v3.spec.ts --workers=1
//
// At 1366x768 and 390x844: the Setup row is in the spine and opens the page by click, by keyboard and by Alt+6; every one of the
// eighteen panes opens with no page error, nothing sideways, no document scroll, no key under 44 px; opening and walking the panes
// sends nothing but reads (nothing is saved or reset by looking); one field is changed and saved in two different panes and the
// engine's own answer is on screen; a pane left with unsaved changes says so; the harvester's three panes open. Pictures of every
// pane at 1366x768 and of four panes at 390x844 go to $TEMP/ui-setup-shots (SU3_SHOTS overrides).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.SU3_SHOTS ?? resolve(tmpdir(), 'ui-setup-shots'))
const SIZES = [{ name: '1366x768', w: 1366, h: 768 }, { name: '390x844', w: 390, h: 844 }]
const phone = (s: { w: number }) => s.w < 700
const PANES = ['rotation', 'dates', 'subjects', 'goals', 'timetable', 'attendance', 'deadlines', 'study', 'about', 'budget', 'style', 'calibration', 'career', 'connections', 'phone', 'backup', 'appearance', 'harvester']
const PHONE_SHOTS = new Set(['subjects', 'timetable', 'study', 'harvester'])

async function open(page: Page, baseURL: string | undefined, size = SIZES[0]) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
}

/** The phone keeps the spine in a sheet: open it so the Setup row can be pressed. */
async function openDeck(page: Page, size: { w: number }) {
  if (phone(size) && (await page.locator('.s3').getAttribute('data-deck')) !== 'open') await page.locator('.s3-tabbar .s3-tab').first().click()
}

/** Well Wisher open (the Setup row is a row of its project), then the row. */
async function openSetupByRow(page: Page, size: { w: number }) {
  await openDeck(page, size)
  const head = page.locator('#s3-spine .s3-head[data-project="wellwisher"]')
  if (await head.count()) await head.first().click()
  await openDeck(page, size)
  await page.locator('#s3-spine .s3-item[data-section="setup"]').click()
  await expect(page.locator('.su3')).toBeVisible()
}

const closeSheet = async (page: Page, size: { w: number }) => {
  if (!phone(size)) return
  const done = page.locator('.s3-tray[data-sheet="open"] .s3-done, .s3-done:visible').first()
  if (await done.count()) await done.click().catch(() => undefined)
}

/** A pane, by its index key; on the phone the pick opens the pane's sheet. */
async function pickPane(page: Page, id: string) {
  await page.locator(`.su3 [data-index="${id}"]`).click()
  await expect(page.locator(`.su3 [data-view-of="${id}"]`)).toBeVisible()
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(PROBE) as Promise<Probe>
}

test.describe('Setup under the v3 look', () => {
  for (const size of SIZES) {
    test(`${size.name}: the way in, every pane, the 44 px rule`, async ({ page, baseURL }) => {
      test.setTimeout(240_000)
      mkdirSync(SHOTS, { recursive: true })
      const errors: string[] = []
      const writes: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('request', (r) => {
        if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
      })
      await open(page, baseURL, size)

      // 1. the way in: the row in the spine, by click
      await openSetupByRow(page, size)
      await expect(page.locator('.s3-loc-s')).toContainText('Setup')
      expect(await page.evaluate(() => location.hash)).toBe('#setup')
      await expect(page.locator('#s3-spine .s3-item[data-section="setup"]')).toHaveAttribute('aria-current', 'page')

      // 2. by keyboard: leave to Day, focus the row, Enter
      await page.evaluate(() => { location.hash = '#today' })
      await expect(page.locator('.su3')).toHaveCount(0)
      await openDeck(page, size)
      await page.locator('#s3-spine .s3-item[data-section="setup"]').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.su3')).toBeVisible()

      // 3. Alt+6 from anywhere
      await page.evaluate(() => { location.hash = '#today' })
      await expect(page.locator('.su3')).toHaveCount(0)
      await page.keyboard.press('Alt+6')
      await expect(page.locator('.su3')).toBeVisible()

      // 4. every pane opens. Writes are counted from here: the game brief's own key-value save at load is not Setup's.
      writes.length = 0
      const wide = !phone(size)
      for (const id of PANES) {
        await closeSheet(page, size)
        await pickPane(page, id)
        await page.waitForTimeout(250)
        if (wide || PHONE_SHOTS.has(id)) await page.screenshot({ path: resolve(SHOTS, `setup-${size.name}-${id}.png`) })
        const p = await probe(page)
        expect.soft(p.docOverflow, `${id}: document sideways`).toBe(0)
        expect.soft(p.sideways, `${id}: sideways`).toEqual([])
        expect.soft(p.targets, `${id}: keys under 44 px`).toEqual([])
        expect.soft(p.small, `${id}: text under 11 px`).toEqual([])
        expect.soft(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight), `${id}: document scroll`).toBeLessThanOrEqual(0)
      }
      // a side-by-side tray is not a dialog: picking a pane must not turn the pane tray into a modal sheet on the desktop
      if (wide) await expect(page.locator('.s3-tray[data-step="2"]')).not.toHaveAttribute('role', 'dialog')
      expect(errors, 'no page error').toEqual([])
      // the Mission game's own mirror of itself (bridge.ts: @silicon_game_v1 and @silicon_game_brief) is written whichever page is open; it
      // is the game store's, not Setup's, and carries none of the inputs
      expect(writes.filter((w) => !/silicon_game_(v1|brief)/.test(w)), 'looking at the panes saved or reset nothing').toEqual([])
    })

    test(`${size.name}: change one field in two panes, save, read the engine's answer; unsaved says so; harvester`, async ({ page, baseURL }) => {
      test.setTimeout(240_000)
      mkdirSync(SHOTS, { recursive: true })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await open(page, baseURL, size)
      await openSetupByRow(page, size)

      // pane 1: Study time
      await pickPane(page, 'study')
      const spin = page.locator('#su-study').getByRole('spinbutton').first()
      await expect(spin).toBeVisible()
      const before = await spin.inputValue()
      await spin.fill(String(Number(before) + 5))
      await expect(page.locator('.su-savebar-text')).toContainText('1 section changed: Study time')

      // leave it unsaved and look at another pane: the index and the bar both still say so
      await closeSheet(page, size)
      await pickPane(page, 'about')
      await expect(page.locator('.su3 [data-index="study"] [aria-label="unsaved changes"]')).toBeVisible()
      await expect(page.locator('.su-savebar-text')).toContainText('Study time')
      await closeSheet(page, size)
      await pickPane(page, 'study')
      await expect(spin).toHaveValue(String(Number(before) + 5)) // the draft survived the visit elsewhere

      // save: the engine's answer is on screen
      await page.getByRole('button', { name: /Save 1 change/ }).click()
      await expect(page.locator('[data-save-report]')).toContainText('Saved: Study time', { timeout: 20_000 })
      await expect(page.locator('.su-savebar-text')).toContainText('nothing to save')
      await page.screenshot({ path: resolve(SHOTS, `setup-${size.name}-saved-study.png`) })

      // pane 2: About you
      await closeSheet(page, size)
      await pickPane(page, 'about')
      const gh = page.locator('#su-about').getByLabel('GitHub username')
      // a new value each run: the scratch data dir keeps what an earlier run saved, and a value equal to the saved one is not a change
      await gh.fill(`invented-${Date.now().toString(36)}`)
      await expect(page.locator('.su-savebar-text')).toContainText('1 section changed: About you')
      await page.getByRole('button', { name: /Save 1 change/ }).click()
      await expect(page.locator('[data-save-report]')).toContainText('Saved: About you', { timeout: 20_000 })
      await page.screenshot({ path: resolve(SHOTS, `setup-${size.name}-saved-about.png`) })

      // the harvester's three panes
      await closeSheet(page, size)
      await pickPane(page, 'harvester')
      for (const name of ['Sources', 'Queue', 'Past papers']) {
        const radio = page.locator('#su-harvester').getByRole('radio', { name: new RegExp(`^${name}`) })
        await radio.click()
        await expect(radio).toBeChecked()
        await page.waitForTimeout(200)
        await page.screenshot({ path: resolve(SHOTS, `setup-${size.name}-harvester-${name.replace(' ', '-')}.png`) })
      }
      expect(errors, 'no page error').toEqual([])
    })

    test(`${size.name}: the main action of the panes that open something: date sheet, phone, backup, discard`, async ({ page, baseURL }) => {
      test.setTimeout(180_000)
      mkdirSync(SHOTS, { recursive: true })
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await open(page, baseURL, size)
      await openSetupByRow(page, size)

      // Dates: the date sheet (overlay O1) is drawn by the host's own OverlayHost, since the frame is not mounted here
      await pickPane(page, 'dates')
      await page.getByRole('button', { name: 'Edit the date sheet' }).click()
      await expect(page.getByRole('dialog', { name: 'Date sheet', exact: true })).toBeVisible()
      await page.screenshot({ path: resolve(SHOTS, `setup-${size.name}-overlay-date.png`) })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Date sheet', exact: true })).toHaveCount(0)

      // Phone: the pairing sheet (O2)
      await closeSheet(page, size)
      await pickPane(page, 'phone')
      await page.locator('#su-phone').getByRole('button', { name: /^(Pair phone|Phone)$/ }).click()
      await expect(page.getByRole('dialog', { name: 'Phone', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')

      // Backup: the engine answers with the export file
      await closeSheet(page, size)
      await pickPane(page, 'backup')
      const dl = page.waitForEvent('download', { timeout: 20_000 })
      await page.locator('#su-backup').getByRole('button', { name: 'Backup', exact: true }).click()
      expect((await dl).suggestedFilename()).toMatch(/.json$/)

      // Discard: a draft, then Discard all asks (overlay O7), and Discard puts the value back
      await closeSheet(page, size)
      await pickPane(page, 'study')
      const spin = page.locator('#su-study').getByRole('spinbutton').first()
      const was = await spin.inputValue()
      await spin.fill(String(Number(was) + 7))
      await page.getByRole('button', { name: 'Discard all' }).click()
      await expect(page.getByRole('dialog', { name: 'Confirm', exact: true }).getByText('Discard all changes?')).toBeVisible()
      await page.getByRole('dialog', { name: 'Confirm', exact: true }).getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(spin).toHaveValue(was)
      await expect(page.locator('.su-savebar-text')).toContainText('nothing to save')
      expect(errors, 'no page error').toEqual([])
    })
  }
})
