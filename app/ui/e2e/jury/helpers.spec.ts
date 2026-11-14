// Checks of the jury harness's own helpers (package RG1): file naming, the report and the index, and the blank check,
// proved on a real page with a flat picture and a busy one. These always run; the harness itself (e2e/jury.spec.ts) does not.
import { expect, test } from '@playwright/test'
import { BLANK_BELOW, distinctColours, folderOf, indexMarkdown, measure, shotName, slug, stateFile, summarize, type Row } from './lib'

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
