// R7 (25 Nov, owner: "career is really confusing to navigate through"): the Applications view of Career under v3, in a real Chromium on
// the built app (dist-e2e, sandbox only, never the live app). The server's answers are mocked in the page with invented programmes, so the
// rows, their order and their dates are known.
//
//   node scripts/build-e2e.mjs
//   WW_SANDBOX_PORT=8911 WW_PREVIEW_PORT=5311 WW_SANDBOX_DIR="$TEMP/jarvis-ui-nav-e2e" npx playwright test e2e/career-way.spec.ts --workers=1
//
// Checked at 1366x768, 1920x1200 and 390x844: the list runs soonest closing date first (undated after, ruled out last); every row shows
// one stage chip and no five-column dots and no WAITING line; a date that is not confirmed is a small tag, once per row; choosing a row
// fills the second tray with that application; the stepper moves the stage forward and back through the server; the view has one main key
// (Add application); keys are 44 px, no text under 11 px, nothing runs past the screen. Pictures go to $TEMP/ui-nav-shots.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const SHOTS = resolve(process.env.UI_NAV_SHOTS ?? resolve(tmpdir(), 'ui-nav-shots'))
const SIZES = [
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1920x1200', w: 1920, h: 1200 },
  { name: '390x844', w: 390, h: 844 },
]

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
type Status = 'idea' | 'preparing' | 'applied' | 'interview' | 'offer' | 'rejected' | 'not_eligible'
const app = (id: string, org: string, programme: string, status: Status, closes: number | null, extra: Record<string, unknown> = {}) => ({
  id, org, programme, url: '', opens: null, closes: closes === null ? null : day(closes), status, requirements: [], stipend: '', notes: '', reason: '', verified: false, source: 'invented',
  days_left: closes, opens_in: null, nodes: [], prep: [], ...extra,
})
// invented rows, given out of order on purpose: the page sorts them
const ROWS = () => [
  app('vale-intern', 'Vale Instruments', 'Embedded internship', 'idea', 88),
  app('northgate', 'Northgate Labs', 'Summer internship', 'preparing', 9, { url: 'https://example.org/northgate', notes: 'Ask for a reference first.', prep: [{ id: 'p1', title: 'Write the cover note', done: false }] }),
  app('fen-out', 'Fen Optics', 'Technician', 'not_eligible', 30, { reason: 'needs a licence' }),
  app('quay', 'Quay Analytics', 'Data internship', 'idea', null),
  app('lumen', 'Lumen Research Group', 'Research placement', 'applied', 41),
  app('ashford', 'Ashford Design Works', 'Junior engineer', 'interview', 64),
  app('old-one', 'Old Wharf Co', 'Graduate scheme', 'idea', -5),
]
const EXPECTED = ['Northgate Labs', 'Lumen Research Group', 'Ashford Design Works', 'Vale Instruments', 'Quay Analytics', 'Old Wharf Co', 'Fen Optics']

async function openCareer(page: Page, baseURL: string | undefined, size: { w: number; h: number }) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  let rows = ROWS()
  const posts: string[] = []
  await page.route('**/api/mission/applications', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: { ok: true } })
    return route.fulfill({ json: { applications: rows, pipeline: {}, due_soon: [], tasks: [], goals: [] } })
  })
  await page.route('**/api/mission/applications/*/status', async (route) => {
    const id = decodeURIComponent(route.request().url().split('/applications/')[1].split('/')[0])
    const status = (route.request().postDataJSON() as { status: Status }).status
    rows = rows.map((r) => (r.id === id ? { ...r, status } : r))
    posts.push(`${id}:${status}`)
    return route.fulfill({ json: { ok: true } })
  })
  await page.setViewportSize({ width: size.w, height: size.h })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur() })
  await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+5')
  await page.locator('.t2-apps').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
  return posts
}

test.describe('Career under v3: one clear path through the applications', () => {
  for (const size of SIZES) {
    test(`${size.name}: list, one chip, choose, stepper, one main key`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      mkdirSync(SHOTS, { recursive: true })
      const posts = await openCareer(page, baseURL, size)
      const phone = size.w < 700

      // ---- the list is sorted by closing date: dated soonest first, then undated, then closed, then ruled out
      const names = await page.locator('.t2-app .t2-app-name').allTextContents()
      expect(names).toEqual(EXPECTED)
      // the ruled-out row (last, by design) keeps its own date but is not part of the order
      const days = (await page.locator('.t2-app-days b').allTextContents()).slice(0, -1)
      const nums = days.filter((d) => /^\d+$/.test(d)).map(Number)
      expect(nums, 'days left run upward').toEqual([...nums].sort((a, b) => a - b))

      // ---- a row: one stage chip, no five columns of dots, no WAITING line, the date caveat as one small tag
      const rows = page.locator('.t2-apps > li')
      for (let i = 0; i < (await rows.count()); i++) {
        const row = rows.nth(i)
        await expect(row.locator('.t2-chip')).toHaveCount(1)
        expect((await row.innerText()).toUpperCase()).not.toContain('WAITING')
        expect(await row.locator('.t2-app-tag').count()).toBeLessThanOrEqual(1)
      }
      await expect(page.locator('.t2-stages, .t2-stagehead')).toHaveCount(0)
      await expect(page.locator('.t2-app .t2-chip').first()).toHaveText('Preparing')
      await expect(page.locator('.t2-app .t2-app-tag').first()).toHaveText('date not confirmed')
      // the names the owner could not follow are gone
      const body = (await page.locator('.s2-page').innerText()).toLowerCase()
      expect(body).not.toContain('runway')
      expect(body).not.toContain('flight board')
      expect(body).not.toContain('[ applications ]')

      // ---- one main key: Add application; "Do next step" is not a second main key
      await expect(page.locator('[data-primary="true"]')).toHaveCount(1)
      await expect(page.locator('[data-primary="true"]')).toContainText('Add application')

      // ---- the soonest application is chosen on open, and choosing another fills the second tray with that one
      // on the phone choosing a row opens the second tray as a sheet; its Done key (Escape) brings the list back
      const open = async (name: string) => {
        await expect(page.locator('.t2-this .t2-v3-name').first()).toHaveText(name)
      }
      const closeSheet = async () => { if (phone) { await page.keyboard.press('Escape'); await expect(page.locator('.s3-tray[data-sheet="open"]')).toHaveCount(0) } }
      if (!phone) await open('Northgate Labs')
      await page.locator('.t2-app', { hasText: 'Lumen Research Group' }).click()
      await expect(page.locator('.t2-app[aria-pressed="true"]')).toHaveCount(1)
      await expect(page.locator('.t2-app[aria-pressed="true"] .t2-app-name')).toHaveText('Lumen Research Group')
      await open('Lumen Research Group')
      await page.waitForTimeout(800)   // a phone sheet fades in; the picture is of the settled tray
      await page.screenshot({ path: resolve(SHOTS, `career-this-${size.name}.png`) })

      // ---- the stepper moves the stage forward and back through the server, and the row's one chip follows
      await expect(page.locator('.t2-stepper .t2-step[aria-pressed="true"]')).toContainText('Applied')
      await page.getByRole('button', { name: 'On to Interview' }).click()
      await expect(page.locator('.t2-app', { hasText: 'Lumen Research Group' }).locator('.t2-chip')).toHaveText('Interview')
      expect(posts).toContain('lumen:interview')
      await page.getByRole('button', { name: 'Back to Applied' }).click()
      await expect(page.locator('.t2-app', { hasText: 'Lumen Research Group' }).locator('.t2-chip')).toHaveText('Applied')
      await page.getByRole('button', { name: 'Lumen Research Group: Offer' }).click()
      await expect(page.locator('.t2-app', { hasText: 'Lumen Research Group' }).locator('.t2-chip')).toHaveText('Offer')
      expect(posts.slice(-1)[0]).toBe('lumen:offer')
      await expect(page.getByRole('button', { name: 'On', exact: true })).toBeDisabled()

      // ---- the closing date: confirm action is inside the application's own detail
      await expect(page.getByRole('button', { name: 'I checked this date today' }).first()).toBeVisible()

      // ---- the first application keeps its next step as a key of its own
      await closeSheet()
      await page.locator('.t2-app', { hasText: 'Northgate Labs' }).click()
      await open('Northgate Labs')
      await expect(page.getByRole('button', { name: 'Do this step' })).toBeEnabled()
      await expect(page.locator('.t2-this').getByRole('link', { name: 'Its page' })).toBeVisible()
      await expect(page.locator('.t2-ahead')).toContainText('Closing dates in the next 120 days')

      // ---- size: keys of 44 px, no text under 11 px, nothing past the screen
      const probe = await page.evaluate(() => {
        const out = { small: [] as string[], keys: [] as string[], sw: document.documentElement.scrollWidth, iw: innerWidth }
        const root = document.querySelector('.t2-v3')!
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height) continue
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())
          if (own && parseFloat(getComputedStyle(el).fontSize) < 10.99) out.small.push(`${el.className} ${getComputedStyle(el).fontSize}`)
          if ((el.tagName === 'BUTTON' || el.tagName === 'SELECT') && r.height < 43.5) out.keys.push(`${(el.textContent ?? '').trim().slice(0, 24)} ${Math.round(r.height)}px`)
        }
        return out
      })
      expect(probe.small, 'text under 11 px').toEqual([])
      expect(probe.keys, 'keys under 44 px').toEqual([])
      expect(probe.sw).toBeLessThanOrEqual(probe.iw + 1)
      await closeSheet()
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(SHOTS, `career-list-${size.name}.png`) })
    })
  }
})
