// Day / Today counters against the engine's REAL routes (GET /api/mission/life, POST /life/count with `expect`, GET and PUT /life/layout)
// in the seeded sandbox: plus, minus, the yes-or-no counter as a tick, undo, a count another window moved (409, no undo step) and the
// "Choose counters" sheet kept by the engine. No route is mocked. 1366x768, v3. Only with WW_SANDBOX_SEED=study.
//
//   export WW_SANDBOX_PORT=8961 WW_PREVIEW_PORT=5361 WW_SANDBOX_DIR="$TEMP/jarvis-ui-real-e2e" WW_SANDBOX_SEED=study
//   node scripts/build-e2e.mjs && npx playwright test e2e/real-day.spec.ts --workers=1
import { expect as baseExpect, test } from './fixtures'
import { NEEDS_SEED, SEEDED, engine, openApp, shot, watch } from './real-helpers'

const expect = baseExpect.configure({ timeout: 15_000 })
test.skip(!SEEDED, NEEDS_SEED)

const counters = async () => (await engine('/api/mission/life')).body.counters as { id: string; name: string; want: string; today: number | null }[]

test.describe('real routes: Day counters', () => {
  test('numbers, plus, minus, the tick, undo, a refused count and the choice kept by the engine', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const w = watch(page)
    await openApp(page, baseURL, '#day/today')
    const plate = page.locator('[data-callout="counters"]')
    await expect(plate.locator('.td-ctile').first()).toBeVisible({ timeout: 20_000 })
    const rows = await counters()
    const n = (id: string) => plate.locator(`[data-counter="${id}"] .td-ctile-n`)
    const water = rows.find((c) => c.id === 'fixture-water')!
    const scroll = rows.find((c) => c.id === 'fixture-scroll')!
    const walk = rows.find((c) => c.id === 'fixture-walk')!

    // ---- the numbers on the tiles are the engine's, the yes-or-no counter is a tick (never a number)
    for (const c of rows.filter((x) => x.want !== 'yes')) {
      await expect.soft(plate.locator(`[data-counter="${c.id}"]`)).toContainText(c.name)
      await expect.soft(n(c.id), `${c.id} shows the engine's ${c.today}`).toHaveText(String(c.today))
    }
    const tick = plate.locator(`[data-counter="${walk.id}"] button.td-tick`)
    await expect.soft(tick).toHaveAttribute('aria-pressed', (walk.today ?? 0) >= 1 ? 'true' : 'false')
    await expect.soft(plate.locator(`[data-counter="${walk.id}"]`)).not.toContainText(/\b[2-9]\b/)
    await shot(page, 'day-counters')

    // ---- plus and minus: the engine holds what the tile shows, and the body carried the number he saw
    const sent: string[] = []
    page.on('request', (r) => { if (r.url().endsWith('/api/mission/life/count')) sent.push(r.postData() ?? '') })
    await plate.getByRole('button', { name: `${water.name}: one more` }).click()
    await expect.soft(n(water.id)).toHaveText(String((water.today ?? 0) + 1))
    await expect.poll(async () => (await counters()).find((c) => c.id === water.id)!.today).toBe((water.today ?? 0) + 1)
    await plate.getByRole('button', { name: `${scroll.name}: one less` }).click()
    await expect.soft(n(scroll.id)).toHaveText(String((scroll.today ?? 0) - 1))
    await expect.poll(async () => (await counters()).find((c) => c.id === scroll.id)!.today).toBe((scroll.today ?? 0) - 1)
    await expect.poll(() => sent.map((x) => JSON.parse(x).expect), { message: 'every count press carries the number he saw' }).toEqual([water.today, scroll.today])
    await shot(page, 'day-counters-plus-minus')

    // ---- the tick: off, on
    await tick.click()
    await expect.soft(tick).toHaveAttribute('aria-pressed', (walk.today ?? 0) >= 1 ? 'false' : 'true')
    await expect.poll(async () => (await counters()).find((c) => c.id === walk.id)!.today).toBe((walk.today ?? 0) >= 1 ? 0 : 1)
    await tick.click()
    await expect.poll(async () => (await counters()).find((c) => c.id === walk.id)!.today).toBe(walk.today ?? 0)

    // ---- undo walks back through the taps of the visit, newest first (tick twice, minus, plus)
    const undo = plate.locator('[data-act="undo-count"]')
    for (let i = 0; i < 4; i++) await undo.click({ timeout: 5000 })
    const back = await counters()
    expect.soft(back.map((c) => c.today), 'after four undos every counter is where the engine had it').toEqual(rows.map((c) => c.today))
    await expect.soft(undo).toBeDisabled()
    await shot(page, 'day-counters-undone')

    // ---- a count another window moved: the engine answers 409, the screen says its sentence and shows its number, and no undo step is made
    const moved = await engine('/api/mission/life/count', { body: { id: water.id, value: 9 } })
    expect(moved.status).toBe(200)
    await plate.getByRole('button', { name: `${water.name}: one more` }).click()
    const said = plate.locator('[data-said]')
    await expect.soft(said, 'the engine\'s own sentence for the 409').toContainText('changed since you saw it; it is now 9')
    await expect.soft(n(water.id), 'the tile shows the number the engine holds').toHaveText('9')
    await expect.poll(async () => (await counters()).find((c) => c.id === water.id)!.today).toBe(9)
    await expect.soft(undo, 'a refused press leaves nothing to undo').toBeDisabled()
    await shot(page, 'day-counters-409')

    // ---- Choose counters: kept by the engine (R-63); order and hide go to PUT; a fresh window with no device copy shows the same
    await plate.locator('[data-act="choose-counters"]').click()
    const sheet = page.locator('.td-choose')
    await expect.soft(sheet.locator('[data-kept]')).toHaveAttribute('data-kept', 'engine')
    const before = (await engine('/api/mission/life/layout')).body
    await sheet.getByRole('button', { name: `Move ${water.name} down` }).click()
    await sheet.locator(`[data-counter="${scroll.id}"] button`).first().click() // Shown -> Hidden
    await expect.poll(async () => (await engine('/api/mission/life/layout')).body.saved).toBe(true)
    const layout = (await engine('/api/mission/life/layout')).body
    expect.soft(layout.order.indexOf(water.id), 'water moved one place down').toBe(before.order.indexOf(water.id) + 1)
    expect.soft(layout.shown, 'the hidden counter is not shown').not.toContain(scroll.id)
    expect.soft(layout.shown.length).toBe(rows.length - 1)
    await shot(page, 'day-counters-choose')
    await page.keyboard.press('Escape')
    await page.evaluate(() => localStorage.removeItem('ww.day.counters.v1'))
    await page.reload()
    await expect(page.locator('[data-callout="counters"] .td-ctile').first()).toBeVisible({ timeout: 20_000 })
    await expect.soft(page.locator('[data-callout="counters"] [data-counter]'), 'a window with no device copy follows the engine\'s list').toHaveCount(layout.shown.length)
    await expect.soft(page.locator(`[data-callout="counters"] [data-counter="${scroll.id}"]`)).toHaveCount(0)
    const ids = await page.locator('[data-callout="counters"] [data-counter]').evaluateAll((els) => els.map((e) => e.getAttribute('data-counter')))
    expect.soft(ids, 'tiles stand in the engine\'s order').toEqual(layout.order.filter((id: string) => layout.shown.includes(id)))
    await shot(page, 'day-counters-reloaded')
    w.report('day counters')
  })
})
