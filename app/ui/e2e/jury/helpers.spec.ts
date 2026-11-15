// Checks of the jury harness's own helpers (package RG1): file naming, the report and the index, and the blank check,
// proved on a real page with a flat picture and a busy one. These always run; the harness itself (e2e/jury.spec.ts) does not.
import { expect, test } from '@playwright/test'
import { BLANK_BELOW, REQUIRED_ENTRIES, distinctColours, folderOf, indexMarkdown, measure, shotName, slug, stateFile, summarize, waitNotLoading, waitSettled, type Row } from './lib'

const row = (o: Partial<Row>): Row => ({
  file: 'a/01-x-390-light.png', kind: 'specimen', entry: 'a/b', state: 'x', width: 390, theme: 'light', elW: 366, elH: 400, overflowPx: 0, clippedPx: 0, scrollers: 0,
  blank: false, blankLower: false, distinct: 30, minFontPx: 12, minFontEl: '', textUnder11: 0, focusable: 2, under44: 0, under44List: [], truncated: false, ...o,
})

test('names: an entry id becomes one folder, a state a numbered slug', () => {
  expect(folderOf('kit/Switch')).toBe('kit-Switch')
  expect(folderOf('data' + String.fromCharCode(92) + 'Jar v2')).toBe('data-Jar-v2')
  expect(slug('Waiting (no frame)!')).toBe('waiting-no-frame')
  expect(stateFile(0, 'Live')).toBe('01-live')
  expect(stateFile(11, '')).toBe('12-x')
  expect(shotName('01-live', 390, 'dark')).toBe('01-live-390-dark.png')
})

test('the index has one line per file and the summary counts the faults', () => {
  const rows = [row({}), row({ file: 'b', overflowPx: 12, under44: 3 }), row({ file: 'c', width: 1366, blank: true, under44: 5 }), row({ file: 'd', kind: 'focus', under44: 1 })]
  const md = indexMarkdown(rows, { generated: 'now', entries: 2 })
  expect(md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| file') && !l.startsWith('| ---'))).toHaveLength(4)
  const s = summarize(rows, [{ id: 'a/b', group: 'g', states: ['x'], focusStops: 1 }, { id: 'c', group: 'g', states: [], focusStops: 0, error: 'boom' }])
  expect(s).toMatchObject({ files: 4, specimens: 3, focus: 1, entries: 2, entriesWithError: 1, overflowing: 1, blank: 1, under44At390: 1, focusableUnder44At390: 3 })
})

test('the blank check tells a flat picture from a drawn one, and the measure sees overflow, a crop and small text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 })
  await page.setContent(`<body style="margin:0"><div id="flat" style="width:300px;height:200px;background:#eee"></div>
    <div id="busy" style="width:300px;height:200px;background:linear-gradient(90deg,red,blue,green,gold,purple,teal,pink,navy,lime,brown)"></div>
    <article id="s" style="width:200px;border:1px solid #000"><p style="font-size:9px;margin:0">tiny</p><button style="width:30px;height:30px">b</button>
      <div style="width:100px;overflow:hidden"><div style="width:180px;height:10px">wide</div></div><div style="width:260px;height:10px">spill</div></article></body>`)
  const flat = await distinctColours(page, await page.locator('#flat').screenshot())
  const busy = await distinctColours(page, await page.locator('#busy').screenshot())
  expect(flat.all).toBeLessThan(BLANK_BELOW)
  expect(busy.all).toBeGreaterThanOrEqual(BLANK_BELOW)
  const m = await measure(page, '#s', '#s')
  expect(m.overflowPx).toBe(59) // 260 px of content from the 1 px border in, against a 202 px right edge
  expect(m.clippedPx).toBe(80)
  expect(m.minFontPx).toBe(9)
  expect(m.textUnder11).toBe(1)
  expect(m.focusable).toBe(1)
  expect(m.under44).toBe(1)
  expect(m.clip.width).toBeGreaterThanOrEqual(260)
})

test('waitSettled waits for a Suspense fallback, aria-busy and a finite animation to go, and says what kept it waiting', async ({ page }) => {
  await page.setContent(`<body><main id="root"><div class="s2-loading" role="status">Loading…</div></main>
    <style>@keyframes spin { to { transform: rotate(360deg) } } .loop { animation: spin 1s linear infinite } .blur { animation: spin 700ms linear 1 }</style></body>`)
  // the fallback is replaced after 300 ms by the page: a settled answer, and only after it went
  await page.evaluate(() => setTimeout(() => { document.querySelector('#root')!.innerHTML = '<h1>Room</h1><div class="loop">ambient</div>' }, 300))
  const t0 = Date.now()
  expect(await waitSettled(page, '#root', { animations: true, busy: true })).toEqual({ settled: true, why: [] })
  expect(Date.now() - t0).toBeGreaterThanOrEqual(280)

  // a fallback that never goes is reported, with its words, once the (short) bound is up
  await page.evaluate(() => { document.querySelector('#root')!.innerHTML = '<p role="status">Loading the Well Wisher state…</p>' })
  const stuck = await waitSettled(page, '#root', { timeout: 400 })
  expect(stuck.settled).toBe(false)
  expect(stuck.why[0]).toContain('Loading the Well Wisher state')
  expect(await waitNotLoading(page, '#root', 300)).toBe(false)

  // aria-busy counts for a shell page, and not for a specimen that shows a busy state on purpose
  await page.evaluate(() => { document.querySelector('#root')!.innerHTML = '<button aria-busy="true">Saving</button>' })
  expect((await waitSettled(page, '#root', { busy: true, timeout: 300 })).why).toEqual(['an element is aria-busy'])
  expect((await waitSettled(page, '#root', { timeout: 300 })).settled).toBe(true)

  // a finite animation (the section cross-fade) is waited for; an endless loop is not
  await page.evaluate(() => { document.querySelector('#root')!.innerHTML = '<div class="blur">fade</div><div class="loop">ambient</div>' })
  const t1 = Date.now()
  expect((await waitSettled(page, '#root', { animations: true })).settled).toBe(true)
  expect(Date.now() - t1).toBeGreaterThanOrEqual(500)
})

test('a full run requires the dashboard entries and the lazy product canary to be listed', () => {
  expect(REQUIRED_ENTRIES).toEqual(expect.arrayContaining(['data/CountdownDots', 'data/NextThree', 'data/HandoffKey', 'data/Legend']))
  expect(new Set(REQUIRED_ENTRIES).size).toBe(REQUIRED_ENTRIES.length)
})
