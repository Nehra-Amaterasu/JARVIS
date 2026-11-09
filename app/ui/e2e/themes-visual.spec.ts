// P4 (plan 8.6): 3 themes x 6 workspaces x 3 viewports against baselines. The screenshot half is
// born in chunk 1b (kitchen sink), 4 (frame) and 6 to 12 (each workspace adds rows), and needs the
// fixture sandbox (`ww_sandbox --fixture`, not built yet) so no baseline contains real data.
// Chunk 1a ships the part that needs no page: the computed token values in a real Chromium for
// every theme and workspace, so a typo in a token file fails here before it fails a screenshot.
import { expect, openLab, test } from './fixtures'

const THEMES: Record<string, { 'data-theme'?: string }> = { ash: {}, paper: { 'data-theme': 'paper' }, indigo: { 'data-theme': 'indigo' } }
const ACCENT: Record<string, Record<string, string>> = {
  ash: { study: '#ff7a2e', tree: '#4fd1a1', life: '#ff8fa3', career: '#b794ff', focus: '#f5f6f8', setup: '#a9b8d0' },
  paper: { study: '#a63a06', tree: '#0b6b4d', life: '#a3263f', career: '#5b2bb3', focus: '#1a1814', setup: '#34506e' },
  indigo: { study: '#9aa0ff', tree: '#7fe0c0', life: '#ffa0b4', career: '#c3a8ff', focus: '#eef0ff', setup: '#b8c4ff' },
}
const toRgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

for (const [theme, attrs] of Object.entries(THEMES)) {
  for (const [ws, hex] of Object.entries(ACCENT[theme])) {
    test(`${theme} / ${ws}: the centre's --accent is the workspace accent of plan 5.7.5`, async ({ page }) => {
      await openLab(page, attrs as Record<string, string>)
      await page.evaluate((w) => document.getElementById('centre')!.setAttribute('data-ws', w), ws)
      const v = await page.evaluate(() => {
        const probe = document.createElement('i')
        probe.style.color = 'var(--accent)'
        document.getElementById('centre')!.appendChild(probe)
        return getComputedStyle(probe).color
      })
      expect(v).toBe(toRgb(hex))
    })
  }
}

test('a theme change re-resolves the tokens with no reload and keeps the DOM nodes', async ({ page }) => {
  await openLab(page)
  const before = await page.evaluate(() => { (document.getElementById('c1') as HTMLElement & { __tag?: number }).__tag = 7; return getComputedStyle(document.getElementById('root')!).getPropertyValue('--surface-0').trim() })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'paper'))
  const after = await page.evaluate(() => ({ s: getComputedStyle(document.getElementById('root')!).getPropertyValue('--surface-0').trim(), tag: (document.getElementById('c1') as HTMLElement & { __tag?: number }).__tag }))
  expect(before).toBe('#050506')
  expect(after.s).toBe('#f4f1ea')
  expect(after.tag).toBe(7)
})

test('first-screen screenshots, one primary, no horizontal scroll, 7 cards in 682 px', async () => {
  test.skip(true, 'needs a Well Wisher page and the sandbox fixture data: born in chunks 1b (kitchen sink) and 4 (frame); baselines are created from the fixture only')
})
