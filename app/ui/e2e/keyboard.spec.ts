// P7 (plan 8.6): every primary reachable by keyboard, Esc order, Alt+n, no traps. Born in chunk 4
// with the frame; each workspace extends it. Chunk 1a proves the one rule that belongs to the
// token layer: the focus ring is at least 2 px and 3:1 against its surface in all three themes.
import { expect, openLab, test } from './fixtures'

const lum = (c: number[]) => {
  const f = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)

for (const [theme, attrs] of [['ash', {}], ['paper', { 'data-theme': 'paper' }], ['indigo', { 'data-theme': 'indigo' }]] as const) {
  test(`${theme}: Tab shows a focus ring of 2 px or more with 3:1 contrast against the surface`, async ({ page }) => {
    await openLab(page, attrs as Record<string, string>)
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const cs = getComputedStyle(el)
      return { id: el.id, width: parseFloat(cs.outlineWidth), style: cs.outlineStyle, colour: cs.outlineColor, bg: getComputedStyle(document.getElementById('root')!).backgroundColor }
    })
    expect(r.id).toBe('tap')
    expect(r.style).toBe('solid')
    expect(r.width).toBeGreaterThanOrEqual(2)
    const a = lum(parse(r.colour))
    const b = lum(parse(r.bg))
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(3)
  })
}

test('Tab order, Esc order, Alt+1..6 and the hold-to-confirm path', async () => {
  test.skip(true, 'needs the frame and the action registry (chunk 4); nothing to tab through yet')
})
