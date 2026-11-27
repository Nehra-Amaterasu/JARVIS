// Past-paper sources on the harvester screen (Setup > Harvester > Past papers), seen in a real browser with the harvest routes MOCKED by
// invented fixtures (hosts example.org, invented papers): the sandbox engine reads no publisher, and nothing of the owner's may reach a
// picture. At 1366x768 and 390x844, in the Well Wisher frame that hosts Setup (the v3 shell has no way to open Setup yet). The mock keeps the engine's rules (R-44, R-53, R-54): local copy refused before on, a bad address
// refused with a sentence, an unknown source 404, an off source answers `planned`, a fetch with the local copy off is a pointer.
//
//   WW_SANDBOX_PORT=8921 WW_PREVIEW_PORT=5321 WW_SANDBOX_DIR="$TEMP/jarvis-ui-src-e2e" node scripts/build-e2e.mjs
//   (the same variables) npx playwright test e2e/paper-sources.spec.ts --workers=1
//
// Pictures go to $TEMP/ui-src-shots (PS_SHOTS overrides). Asserted through the shared probe at every step: no page error, no document
// scroll, no key or field under 44 px, no text under 11 px, nothing sideways, no ellipsis; and the honest words: an off source is
// shown as off and never as "0 papers", a count appears only under the engine's live state, nothing is requested while a source is off.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { expect as baseExpect, test } from './fixtures'
import { PROBE, type Probe } from './probe'

const expect = baseExpect.configure({ timeout: 15_000 })
const SHOTS = resolve(process.env.PS_SHOTS ?? resolve(tmpdir(), 'ui-src-shots'))
const SIZES = [{ w: 1366, h: 768 }, { w: 390, h: 844 }]
const B = '/api/mission/harvest'

interface Src { id: string; name: string; kind: 'papers'; rights: string; terms_note: string; hosts: string[]; needs_address: boolean; address: string | null; on: boolean; local_copy: boolean; reason: string }
const reasonOf = (s: Src) => (!s.on ? `Off: nothing is asked of ${s.hosts[0]}.` : s.needs_address && !s.address ? 'On, and waiting for the address of the listing page.' : s.local_copy ? 'On: each paper you fetch is kept on this PC.' : 'On: papers are links; the site is asked only for the listing.')
const mk = (o: Partial<Src> & Pick<Src, 'id' | 'name' | 'hosts' | 'terms_note' | 'rights'>): Src => {
  const s: Src = { kind: 'papers', needs_address: false, address: null, on: false, local_copy: false, reason: '', ...o }
  return { ...s, reason: reasonOf(s) }
}
const ITEMS = [
  { key: 'k1', title: 'Signals and Systems, end semester', code: 'SG201', year: 2025, kind: 'paper', url: 'https://papers.example.org/sg201-2025.pdf', on_file: false },
  { key: 'k2', title: 'Signals and Systems, end semester, key', code: 'SG201', year: 2025, kind: 'key', url: 'https://papers.example.org/sg201-2025-key.pdf', on_file: false },
  { key: 'k-fault', title: 'Applied Maths, mid semester', code: 'AM102', year: null, kind: 'paper', url: 'https://papers.example.org/am102.pdf', on_file: false },
  { key: 'k4', title: 'Network Theory, end semester', code: 'NT301', year: 2024, kind: 'paper', url: 'https://papers.example.org/nt301-2024.pdf', on_file: true },
  { key: 'k5', title: 'Digital Logic, end semester', code: 'DL202', year: 2023, kind: 'paper', url: 'https://papers.example.org/dl202-2023.pdf', on_file: false },
]

interface Mock { sources: Src[]; calls: string[]; engineOffNow: boolean }
const newMock = (): Mock => ({
  calls: [], engineOffNow: false,
  sources: [
    mk({ id: 'gate_papers', name: 'Invented board past papers', rights: 'All rights reserved by the publisher', hosts: ['papers.example.org', 'files.example.org'],
      terms_note: 'The publisher lists these papers for candidates to read. You may follow a link to a paper; copying the files to another site is not allowed. Read this before you switch the source on.' }),
    mk({ id: 'papers_table', name: 'Invented university paper table', rights: 'Published by the university for its students', hosts: ['archive.example.org'], needs_address: true,
      terms_note: 'The university keeps its old papers on one page, for its own students. A link is fine; do not pass the files on. You give the address of that page yourself.' }),
    mk({ id: 'withdrawn_papers', name: 'Invented withdrawn source', rights: 'Not stated', hosts: ['gone.example.org'], terms_note: 'This source was withdrawn from the engine after the screen last read it.' }),
  ],
})

async function installMock(page: Page, m: Mock) {
  const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  await page.route(`**${B}/**`, async (route: Route) => {
    const req = route.request()
    const u = new URL(req.url())
    const path = u.pathname.replace(B, '')
    const method = req.method()
    m.calls.push(`${method} ${path}`)
    if (path === '/queue') return json(route, { enabled: false, paused: false, state: 'off', queued: 0, fetching: 0, refused: 0, on_disk: 0, last_run: null, items: [] })
    if (path === '/sources' && method === 'GET') {
      return json(route, { sources: [{ id: 'ocw', name: 'Open course material', kind: 'open', status: 'off', license: 'CC BY-NC-SA 4.0', reason: 'the harvester is off', terms_url: '', note: '', on_disk: 0 }],
        not_used: [], pdf_reader: { available: true, note: 'PDF text is read with PyMuPDF.' }, paper_sources: m.sources })
    }
    const sw = /^\/sources\/([^/]+)$/.exec(path)
    if (sw && method === 'PUT') {
      const s = m.sources.find((x) => x.id === sw[1])
      if (!s || s.id === 'withdrawn_papers') return json(route, { detail: 'No such source on this engine.' }, 404)
      const b = JSON.parse(req.postData() ?? '{}') as { on?: boolean; local_copy?: boolean; address?: string }
      if (m.engineOffNow) { s.on = false; s.local_copy = false }
      if (b.local_copy && !(b.on ?? s.on)) return json(route, { detail: 'Switch the source on before its local copy: the local copy is a second switch.' }, 400)
      if (b.address !== undefined) {
        if (!/^https?:\/\//.test(b.address)) return json(route, { detail: 'An address begins with http:// or https:// and names the page that lists the papers.' }, 400)
        if (!new URL(b.address).hostname.endsWith('example.org')) return json(route, { detail: 'That address is not on a host this source may ask.' }, 400)
        s.address = b.address
      }
      if (b.on !== undefined) { s.on = b.on; if (!b.on) s.local_copy = false }
      if (b.local_copy !== undefined) s.local_copy = b.local_copy
      s.reason = reasonOf(s)
      return json(route, { state: 'live', reason: s.reason, source: "the harvester's manifest", paper_source: s })
    }
    const ix = /^\/sources\/([^/]+)\/index$/.exec(path)
    if (ix) {
      const s = m.sources.find((x) => x.id === ix[1])!
      const none = { listed: 0, read_at: null, note: '' }
      if (!s.on) return json(route, { state: 'planned', reason: 'This source is off.', source: 'x', items: [], count: 0, ...none })
      if (s.needs_address && !s.address) return json(route, { state: 'waiting', reason: 'Give the address of the listing page first.', source: 'x', items: [], count: 0, ...none })
      const q = (u.searchParams.get('q') ?? '').toLowerCase()
      const items = ITEMS.filter((i) => !q || i.title.toLowerCase().includes(q))
      return json(route, { state: 'live', reason: `${items.length} of the 41 listed.`, source: 'x', items, count: items.length, listed: 41, read_at: '2026-11-27', note: 'Years are read from the file names; a paper without one says so.' })
    }
    const fx = /^\/sources\/([^/]+)\/fetch$/.exec(path)
    if (fx && method === 'POST') {
      const s = m.sources.find((x) => x.id === fx[1])!
      const key = (JSON.parse(req.postData() ?? '{}') as { key: string }).key
      if (key === 'k-fault') return json(route, { state: 'fault', reason: 'files.example.org refused twice today; it is left alone until tomorrow.', source: 'x', entry: null, job: null })
      const it = ITEMS.find((i) => i.key === key)!
      if (!s.local_copy) return json(route, { state: 'live', reason: 'A pointer is on record; the site was not asked. Switch the local copy on to keep the file.', source: 'x', entry: { url: it.url, sha256: null, local: 'pointer only' }, job: null })
      return json(route, { state: 'live', reason: 'The paper is on this PC and is being read at the paper desk.', source: 'x', entry: { url: it.url, sha256: 'a1b2c3', local: 'papers/x.pdf' }, job: { id: 'j1' } })
    }
    return json(route, { detail: 'No such route in the mock.' }, 404)
  })
}

const blurText = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.blur()
})

async function openHarvester(page: Page, baseURL: string | undefined, narrow = false) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `node scripts/build-e2e.mjs` first')
  // Setup is reached through the Well Wisher frame's own Setup tab. Under the v2 and v3 shells nothing opens it (Alt+6 is swallowed and the
  // settings views are not built), so the harvester screen is seen in the frame the shell=off app shows; the v3 tokens are the frame's own.
  await page.goto('/#t=ww-e2e&shell=off')
  await page.getByText('Study', { exact: true }).first().click()
  await expect(page.locator('.ww-frame [role="tab"]').first()).toBeVisible({ timeout: 20_000 })
  await blurText(page)
  await page.mouse.click(8, 8)
  await page.keyboard.press('Alt+6') // the strip's own Setup tab is overlapped by the brand and the season switch at these sizes
  await expect(page.locator('[data-page="setup"]')).toBeVisible({ timeout: 20_000 })
  // At 390 px the older frame lays its Today and Proof panels over the page, so nothing under them can be pressed (that frame is not a phone
  // design and is not this screen's). To measure this pane at the phone's width its two side panels are hidden here, and only here.
  if (narrow) await page.addStyleTag({ content: '.ww-left, .ww-right { display: none !important; }' })
  await page.locator('[data-index="harvester"]').click()
  await expect(page.locator('#su-harvester')).toBeVisible()
  await page.locator('#su-harvester').getByRole('radio', { name: 'Past papers' }).click()
  await expect(page.locator('[data-component="paper-sources"]')).toBeVisible()
}

const innerY: string[] = []
// The probe is the shared one, rooted on the Past papers pane instead of the page: the older frame around Setup is not this screen's, and at
// 390 px it lays its side panels over the page (not touched here). The pane's own overflow, and the Setup centre's scroll, are measured apart.
const PANE_PROBE = PROBE.replace("document.querySelector('.s2-page') || document.body", "document.querySelector('[data-harvest-pane=\"papers\"]')")
async function measure(page: Page, at: string, problems: string[], size: { w: number }) {
  const m = (await page.evaluate(PANE_PROBE)) as Probe
  for (const k of ['small', 'targets', 'sideways', 'ellipsis'] as const) for (const d of m[k]) problems.push(`${at} ${k}: ${d}`)
  for (const d of m.innerY) innerY.push(`${at} ${d}`)
  const own = await page.evaluate(() => {
    const p = document.querySelector('[data-harvest-pane="papers"]') as HTMLElement
    const c = document.querySelector('.ww-centre') as HTMLElement | null
    return { wide: p.scrollWidth - p.clientWidth, centre: c ? c.scrollHeight - c.clientHeight : 0 }
  })
  if (own.wide > 1) problems.push(`${at} the pane is ${own.wide}px wider than its box`)
  // the owner's no-scroll rule (9 Nov): a Setup view fits 1366x768 without scrolling. The 390 px frame is not designed for Setup, so only report it there.
  if (own.centre > 1) (size.w >= 1000 ? problems : innerY).push(`${at} the Setup centre scrolls ${own.centre}px`)
}
const shot = async (page: Page, size: { w: number }, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: resolve(SHOTS, `v3-${size.w}-${name}.png`) }) }

test.use({ actionTimeout: 20_000 })

for (const size of SIZES) {
  test(`v3 ${size.w}x${size.h}: past-paper sources through their states, measured`, async ({ page, baseURL }) => {
    test.setTimeout(150_000)
    const m = newMock()
    const problems: string[] = []
    innerY.length = 0
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
    await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null }) as typeof window.open })
    await page.setViewportSize({ width: size.w, height: size.h })
    await installMock(page, m)
    await openHarvester(page, baseURL, size.w < 700)
    const tag = (s: string) => `${size.w}px ${s}`
    const pane = page.locator('[data-component="paper-sources"]')
    const card = (id: string) => page.locator(`[data-paper-source="${id}"]`)
    const requests = () => m.calls.filter((c) => /\/index|\/fetch|^PUT/.test(c))

    // ---- 1. both sources off: the terms are on screen before any switch, the local copy waits, nothing is asked
    await expect(card('gate_papers')).toBeVisible()
    await expect(card('gate_papers').locator('[data-terms]')).toContainText('Read this before you switch the source on.')
    await expect(card('gate_papers').locator('[data-rights]')).toContainText('All rights reserved')
    await expect(card('gate_papers').locator('[data-hosts]')).toContainText('papers.example.org, files.example.org')
    await expect(card('gate_papers').getByRole('switch', { name: /Use this source/ })).toHaveAttribute('aria-checked', 'false')
    await expect(card('gate_papers').getByRole('switch', { name: /Keep a local copy/ })).toHaveAttribute('aria-disabled', 'true')
    await expect(card('gate_papers')).toContainText('Off: nothing is asked of papers.example.org.')
    await expect(card('gate_papers').locator('[data-off]')).toContainText('nothing is listed')
    await expect(pane).not.toContainText(/\b0 papers|0 shown/)
    await expect(pane.locator('[data-nothing-by-itself]')).toContainText('Nothing here downloads by itself')
    await expect(pane.locator('[data-pdf-note]')).toContainText('PDF reading is available. PDF text is read with PyMuPDF.')
    await measure(page, tag('both off'), problems, size); await shot(page, size, 'ps-1-off')
    // pressing the blocked keys changes nothing and asks nothing
    await card('gate_papers').getByRole('switch', { name: /Keep a local copy/ }).click({ force: true })
    await card('gate_papers').getByRole('button', { name: 'Read the listing' }).click({ force: true })
    expect(requests(), 'a source that is off makes no request').toEqual([])

    // ---- 2. switch on: links only, local copy opens; the listing is read only when asked
    await card('gate_papers').getByRole('switch', { name: /Use this source/ }).click()
    await expect(card('gate_papers').getByRole('switch', { name: /Use this source/ })).toHaveAttribute('aria-checked', 'true')
    await expect(card('gate_papers').locator('.ww-chip, [class*="chip"]').first()).toContainText('On, links only')
    await expect(card('gate_papers').getByRole('switch', { name: /Keep a local copy/ })).not.toHaveAttribute('aria-disabled', 'true')
    expect(requests()).toEqual(['PUT /sources/gate_papers'])
    await measure(page, tag('on, links only'), problems, size); await shot(page, size, 'ps-2-on')

    // ---- 3. the engine's sentence when it refuses the local copy: the engine turned the source off in another window
    m.engineOffNow = true
    await card('gate_papers').getByRole('switch', { name: /Keep a local copy/ }).click()
    await expect(card('gate_papers').locator('[data-say]')).toContainText('Refused: Switch the source on before its local copy: the local copy is a second switch.')
    m.engineOffNow = false
    await measure(page, tag('local copy refused'), problems, size); await shot(page, size, 'ps-3-refused')
    await card('gate_papers').getByRole('switch', { name: /Use this source/ }).click() // the screen still shows it on; this press turns it off
    await expect(card('gate_papers').getByRole('switch', { name: /Use this source/ })).toHaveAttribute('aria-checked', 'false')
    await card('gate_papers').getByRole('switch', { name: /Use this source/ }).click()
    await expect(card('gate_papers').getByRole('switch', { name: /Use this source/ })).toHaveAttribute('aria-checked', 'true')

    // ---- 4. the listing: a state word, a count only when live, three papers a page, links that record a pointer
    await card('gate_papers').getByRole('button', { name: 'Read the listing' }).click()
    await expect(card('gate_papers').locator('[data-index-state="live"]')).toBeVisible()
    await expect(card('gate_papers').locator('[data-index-reason]')).toContainText('5 shown of the 41 listed, read 2026-11-27.')
    await expect(card('gate_papers').locator('[data-paper-key]')).toHaveCount(3)
    await expect(card('gate_papers')).toContainText('The local copy is off, so each paper is a link to the publisher.')
    await expect(card('gate_papers').getByRole('button', { name: /^Fetch / })).toHaveCount(0)
    await measure(page, tag('listing'), problems, size); await shot(page, size, 'ps-4-listing')
    await card('gate_papers').getByRole('button', { name: 'Open the link for Signals and Systems, end semester', exact: true }).click()
    await expect(card('gate_papers').locator('[data-paper-key="k1"]')).toContainText('A pointer is on record; the site was not asked.')
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://papers.example.org/sg201-2025.pdf'])

    // ---- 5. local copy on: Fetch appears; a refusal by the site is printed in its own words
    await card('gate_papers').getByRole('switch', { name: /Keep a local copy/ }).click()
    await expect(card('gate_papers').getByRole('switch', { name: /Keep a local copy/ })).toHaveAttribute('aria-checked', 'true')
    await expect(card('gate_papers').getByRole('button', { name: /^Fetch / }).first()).toBeVisible()
    await card('gate_papers').getByRole('button', { name: 'Fetch Signals and Systems, end semester', exact: true }).click()
    await expect(card('gate_papers').locator('[data-paper-key="k1"]')).toContainText('The paper is on this PC and is being read at the paper desk.')
    await expect(card('gate_papers').locator('[data-paper-key="k1"]')).toContainText('on file')
    await measure(page, tag('fetched'), problems, size); await shot(page, size, 'ps-5-fetched')
    await card('gate_papers').getByRole('button', { name: 'Fetch Applied Maths, mid semester', exact: true }).click()
    await expect(card('gate_papers').locator('[data-paper-key="k-fault"]')).toContainText('Refused: files.example.org refused twice today; it is left alone until tomorrow.')
    await measure(page, tag('site refused'), problems, size); await shot(page, size, 'ps-6-site-refused')

    // ---- 6. switching the source off clears what was read: an off source is shown as off, never as a count
    await card('gate_papers').getByRole('switch', { name: /Use this source/ }).click()
    await expect(card('gate_papers').locator('[data-off]')).toBeVisible()
    await expect(card('gate_papers').locator('[data-paper-key]')).toHaveCount(0)
    await expect(pane).not.toContainText(/\b0 papers|0 shown/)

    // ---- 7. the second source needs an address: refused with the engine's sentence, then saved, then the listing
    await pane.getByRole('radio', { name: 'Invented university paper table' }).click()
    await expect(card('papers_table')).toBeVisible()
    await expect(card('papers_table').getByLabel('Address of the listing page')).toBeVisible()
    await card('papers_table').getByRole('switch', { name: /Use this source/ }).click()
    await expect(card('papers_table')).toContainText('On, and waiting for the address of the listing page.')
    await expect(card('papers_table').getByRole('button', { name: 'Read the listing' })).toHaveAttribute('aria-disabled', 'true')
    await expect(card('papers_table')).toContainText('Save the listing address first.')
    await card('papers_table').getByLabel('Address of the listing page').fill('not-an-address')
    await card('papers_table').getByRole('button', { name: 'Save the address' }).click()
    await expect(card('papers_table').locator('[data-say]')).toContainText('Refused: An address begins with http:// or https://')
    await measure(page, tag('bad address'), problems, size); await shot(page, size, 'ps-7-bad-address')
    await card('papers_table').getByLabel('Address of the listing page').fill('https://archive.example.org/old-papers')
    await card('papers_table').getByRole('button', { name: 'Save the address' }).click()
    await expect(card('papers_table').getByRole('button', { name: 'Read the listing' })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(card('papers_table').getByLabel('Address of the listing page')).toHaveValue('https://archive.example.org/old-papers')
    await card('papers_table').getByLabel('Search the listing').fill('network')
    await card('papers_table').getByRole('button', { name: 'Read the listing' }).click()
    await expect(card('papers_table').locator('[data-paper-key]')).toHaveCount(1)
    await expect(card('papers_table').locator('[data-index-reason]')).toContainText('1 shown of the 41 listed')
    await measure(page, tag('table listing'), problems, size); await shot(page, size, 'ps-8-table')

    // ---- 8. a source the engine no longer knows: 404, printed
    await pane.getByRole('radio', { name: 'Invented withdrawn source' }).click()
    await card('withdrawn_papers').getByRole('switch', { name: /Use this source/ }).click()
    await expect(card('withdrawn_papers').locator('[data-say]')).toContainText('Refused: No such source on this engine.')
    await expect(card('withdrawn_papers').getByRole('switch', { name: /Use this source/ })).toHaveAttribute('aria-checked', 'false')
    await measure(page, tag('404'), problems, size); await shot(page, size, 'ps-9-404')

    test.info().annotations.push({ type: 'inner-scroll', description: innerY.join(' | ') || 'none' })
    expect(errors, 'page errors').toEqual([])
    expect(problems, 'measured problems').toEqual([])
  })
}
