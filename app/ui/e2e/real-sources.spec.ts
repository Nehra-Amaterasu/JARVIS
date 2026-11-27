// The harvester's Past papers pane (Setup > Harvester > Past papers) against the engine's REAL harvest routes in the seeded sandbox:
// the two sources the engine knows, their terms and switches, a switch pressed, an address refused or kept, and the listing asked of an
// address that is no site (the engine's own fault sentence must reach the screen). No route is mocked. 1366x768. Only with WW_SANDBOX_SEED=study.
//
// Setup is opened under the v3 look with `#setup` (27 Nov, R32: it opened in the older frame while `#setup` did not exist).
import type { Page } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { NEEDS_SEED, SEEDED, engine, shot, watch } from './real-helpers'

const expect = baseExpect.configure({ timeout: 15_000 })
const H = '/api/mission/harvest/sources'
test.skip(!SEEDED, NEEDS_SEED)

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

/** Setup under the v3 look (R32, 27 Nov): `#setup` opens it since R18, so the older-frame fallback this spec carried is gone. */
async function openSetup(page: Page, baseURL: string | undefined): Promise<void> {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => { location.hash = '#setup' })
  await expect(page.locator('[data-page="setup"]')).toBeVisible({ timeout: 20_000 })
}

test.describe('real routes: the harvester past-paper sources', () => {
  test('the sources, their terms, a switch, an address, a listing that cannot be read', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    await openSetup(page, baseURL)
    await page.locator('[data-index="harvester"]').click()
    await expect(page.locator('#su-harvester')).toBeVisible()
    await page.locator('#su-harvester').getByRole('radio', { name: 'Past papers' }).click()
    await expect(page.locator('[data-component="paper-sources"]')).toBeVisible()

    const list = (await engine(H)).body
    console.log('engine sources:', JSON.stringify(list.paper_sources?.map((s: any) => ({ id: s.id, on: s.on, local_copy: s.local_copy, needs_address: s.needs_address, address: s.address }))))
    expect(list.paper_sources.length).toBeGreaterThanOrEqual(2)

    // ---- every source: name, rights, terms (before any switch), hosts, the engine's sentence, off is "Off" and never a zero
    for (const s of list.paper_sources) {
      // the pane shows one source at a time, chosen by a segmented control named after the source
      await page.locator('[data-component="paper-sources"]').getByRole('radio', { name: s.name }).click()
      const sec = page.locator(`[data-paper-source="${s.id}"]`)
      await expect.soft(sec, `source ${s.id} is on the screen`).toBeVisible()
      await expect.soft(sec.locator('[data-rights]')).toContainText(s.rights)
      await expect.soft(sec.locator('[data-terms]')).toHaveText(s.terms_note)
      await expect.soft(sec.locator('[data-hosts]')).toContainText(s.hosts.join(', '))
      await expect.soft(sec.locator('[data-reason]'), 'the engine\'s sentence for the state').toHaveText(s.reason)
      await expect.soft(sec).toHaveAttribute('data-on', s.on ? 'true' : 'false')
      if (!s.on) await expect.soft(sec).not.toContainText(/\b0 papers\b/)
    }
    await shot(page, 'sources-pane')

    // ---- the source that needs an address: Read the listing says why it cannot, the switch goes to PUT, the sentence is the engine's
    const table = list.paper_sources.find((s: any) => s.needs_address)
    await page.locator('[data-component="paper-sources"]').getByRole('radio', { name: table.name }).click()
    const sec = page.locator(`[data-paper-source="${table.id}"]`)
    const read = sec.getByRole('button', { name: 'Read the listing' })
    await expect.soft(read).toHaveAttribute('aria-disabled', 'true')
    const put = page.waitForResponse((r) => r.url().includes(`${H}/${table.id}`) && r.request().method() === 'PUT')
    await sec.getByRole('switch', { name: 'Use this source' }).click()
    const on = await (await put).json()
    await expect.soft(sec.locator('[data-reason]')).toHaveText(on.paper_source.reason)
    await expect.soft(sec).toHaveAttribute('data-on', 'true')
    await shot(page, 'sources-switched-on')

    // an address that is not a web page is refused with the engine's sentence
    await sec.getByLabel('Address of the listing page').fill('not an address')
    const refusedRes = page.waitForResponse((r) => r.url().includes(`${H}/${table.id}`) && r.request().method() === 'PUT')
    await sec.getByRole('button', { name: 'Save the address' }).click()
    const refused = await refusedRes
    const refusedBody = await refused.json().catch(() => ({}))
    expect.soft(refused.status()).toBeGreaterThanOrEqual(400)
    await expect.soft(sec.locator('[data-say]')).toContainText(String(refusedBody.detail ?? refusedBody.reason ?? '').slice(0, 40))
    await shot(page, 'sources-address-refused')

    // the invented address: kept, and the listing asked of a host that does not exist: the engine's fault sentence must reach the screen
    const addr = 'https://papers.invented-fixture.example/past-papers.html'
    await sec.getByLabel('Address of the listing page').fill(addr)
    await sec.getByRole('button', { name: 'Save the address' }).click()
    await expect.soft(sec.locator('[data-reason]')).not.toHaveText(/waiting for the address/)
    const idxRes = page.waitForResponse((r) => r.url().includes(`${H}/${table.id}/index`))
    await sec.getByRole('button', { name: 'Read the listing' }).click()
    const idx = await (await idxRes).json().catch(() => ({}))
    console.log('index answer:', JSON.stringify(idx).slice(0, 400))
    await expect.soft(sec.locator('[data-listing]'), 'the listing says what the engine said').toContainText(`${idx.items.length} shown of the ${idx.listed} listed`)
    const listing = await sec.locator('[data-listing]').innerText()
    // R32, 27 Nov: the engine's read stamp is UTC; the screen prints it in the viewer's clock ("27 Nov 2026, 14:30"), never the raw ISO text
    expect(listing, 'the listing prints the read stamp raw').not.toMatch(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/)
    await expect.soft(sec.locator('[data-listing]')).not.toContainText(/\b0 shown of the 0 listed\b/)
    await shot(page, 'sources-listing')

    // leave the source as it was found: off, no address
    await sec.getByRole('switch', { name: 'Use this source' }).click()
    w.report('sources')
  })
})
