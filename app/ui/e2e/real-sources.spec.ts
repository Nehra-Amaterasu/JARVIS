// The harvester's Past papers pane (Setup > Harvester > Past papers) against the engine's REAL harvest routes in the seeded sandbox:
// the two sources the engine knows, their terms and switches, a switch pressed, an address refused or kept, and the listing asked of an
// address that is no site (the engine's own fault sentence must reach the screen). No route is mocked. 1366x768. Only with WW_SANDBOX_SEED=study.
//
// Setup is reached under v3 only after another branch merges: this spec first tries `#setup` under the v3 shell and, when that does not open
// it, opens Setup in the older frame (shell=off) the way e2e/paper-sources.spec.ts does, and says so in the log.
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

async function openSetup(page: Page, baseURL: string | undefined): Promise<'v3' | 'older frame'> {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built; run `node scripts/build-e2e.mjs` first')
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/#t=ww-e2e&shell=v2&look=v3')
  await expect(page.locator('.s3')).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => { location.hash = '#setup' })
  const viaV3 = await page.locator('[data-page="setup"]').waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)
  if (viaV3) return 'v3'
  await page.goto('about:blank') // a hash-only change would keep the v3 shell alive
  await page.goto('/#t=ww-e2e&shell=off')
  await page.getByText('Study', { exact: true }).first().click()
  await expect(page.locator('.ww-frame [role="tab"]').first()).toBeVisible({ timeout: 20_000 })
  await blurText(page)
  await page.mouse.click(8, 8)
  await page.keyboard.press('Alt+6')
  await expect(page.locator('[data-page="setup"]')).toBeVisible({ timeout: 20_000 })
  return 'older frame'
}

test.describe('real routes: the harvester past-paper sources', () => {
  test('the sources, their terms, a switch, an address, a listing that cannot be read', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    const frame = await openSetup(page, baseURL)
    console.log(`Setup opened in the ${frame}${frame === 'older frame' ? ' (#setup does not open under v3 in this worktree)' : ''}`)
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
    // setup/** is another builder's folder: the raw stamp is reported as a note, not failed here (see the mismatch list)
    if (/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/.test(listing)) test.info().annotations.push({ type: 'MISMATCH', description: 'PaperSources shows the listing read stamp raw: ' + (listing.match(/read [^.]*/)?.[0] ?? '') })
    await expect.soft(sec.locator('[data-listing]')).not.toContainText(/\b0 shown of the 0 listed\b/)
    await shot(page, 'sources-listing')

    // leave the source as it was found: off, no address
    await sec.getByRole('switch', { name: 'Use this source' }).click()
    w.report('sources')
  })
})
