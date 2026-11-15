// L01 Day / Month: the page on the fixture port (SIMULATED) and on the null port (WAITING), the live overlay from the existing stores,
// the Marks legend, the glob host, the registration, and a copy check over every file of the package.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_PORT } from '../../ports'
import { createFixturePort, FIXTURE_MONTH, FIXTURE_TODAY } from '../fixtures'
import { collectFaces } from '../faces'
import { liveDays } from '../live'
import { MonthPage } from '../Month'
import { view } from '../../../../shell/views/day-month.view'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(cleanup)

const mount = async (props: Partial<Parameters<typeof MonthPage>[0]> = {}) => {
  const r = render(<MonthPage today={FIXTURE_TODAY} initialMonth={FIXTURE_MONTH} form="desk" port={createFixturePort(FIXTURE_TODAY)} {...props} />)
  await flush(6)
  return r.container
}
const cell = (c: HTMLElement, d: string) => c.querySelector<HTMLButtonElement>(`button[data-date="${d}"]`)!

describe('Day / Month on the fixture port', () => {
  it('stamps the page SIMULATED in the head and in the reading, and draws counts', async () => {
    const c = await mount()
    expect(c.querySelector('.mo-sub .k-lamp')!.getAttribute('data-state')).toBe('simulated')
    expect(c.querySelector('.mo-side-head .k-lamp')!.getAttribute('data-state')).toBe('simulated')
    expect(c.querySelector('.mo')!.getAttribute('data-simulated')).toBe('true')
    expect(c.querySelector('.mo-month')!.textContent).toContain('November')
    expect(c.querySelectorAll('.mo-kinds li').length).toBeGreaterThan(3)
    expect(c.querySelector('.mo-pvd')!.textContent).not.toContain('--')
    expect(c.querySelectorAll('.alm-cell').length).toBe(42)
  })

  it('shows the Google lamp with its own word, and Planned and Done as two numbers with no ratio', async () => {
    const c = await mount()
    expect(c.querySelector('.mo-google .k-lamp')!.getAttribute('data-state')).toBe('simulated')
    expect([...c.querySelectorAll('.mo-pvd dt')].map((d) => d.textContent)).toEqual(['Planned', 'Done'])
    expect(c.querySelector('.mo-pvd')!.textContent).not.toMatch(/%|ratio|of \d/)
  })

  it('marks an exam date as a planned Classroom mark and the Google days with a notch', async () => {
    const c = await mount()
    expect(cell(c, '2026-11-25').querySelector('.alm-mark[data-kind="classroom"]')!.getAttribute('data-shape')).toBe('hexagon-outline')
    expect(cell(c, '2026-11-03').querySelector('.alm-mark[data-kind="google"]')!.getAttribute('data-shape')).toBe('notch')
    expect(cell(c, '2026-11-20').querySelector('.alm-mark[data-kind="google"]')!.getAttribute('data-shape')).toBe('notch-outline')
  })

  it('marks a Sunday as a rest day and today with the ring', async () => {
    const c = await mount()
    expect(cell(c, '2026-11-15').getAttribute('data-rest')).toBe('true')
    expect(cell(c, FIXTURE_TODAY).getAttribute('aria-current')).toBe('date')
  })

  it('opens the day in the drawer and Esc leaves the page as it was', async () => {
    const c = await mount()
    click(cell(c, '2026-11-12'))
    await flush(6)
    expect(document.body.querySelector('.dd-sheet h2')!.textContent).toBe('Thursday 12 November 2026')
    expect(cell(c, '2026-11-12').getAttribute('data-selected')).toBe('true')
  })

  it('moves the month with the keys and Today brings it back', async () => {
    const c = await mount()
    click(buttons(c, 'Next month')[0])
    await flush(6)
    expect(c.querySelector('.mo-month')!.textContent).toContain('December')
    click(buttons(c, 'Today')[0])
    await flush(6)
    expect(c.querySelector('.mo-month')!.textContent).toContain('November')
    keyDown(c.querySelector('.alm')!, 'PageUp')
    await flush(6)
    expect(c.querySelector('.mo-month')!.textContent).toContain('October')
  })

  it('switches to the year form and back, and a month key jumps to the month', async () => {
    const c = await mount()
    keyDown(c.querySelector('.alm')!, 'y')
    await flush(6)
    expect(c.querySelector('.alm')!.getAttribute('data-mode')).toBe('year')
    expect(c.querySelector('.mo-month')!.textContent).toBe('2026')
    expect(c.querySelector('.mo-side-head h2')!.textContent).toBe('Year reading')
    click(buttons(c, /^March/)[0])
    await flush(6)
    expect(c.querySelector('.alm')!.getAttribute('data-mode')).toBe('month')
    expect(c.querySelector('.mo-month')!.textContent).toContain('March')
  })

  it('says a month with nothing logged in words, and holds back every number', async () => {
    const c = await mount({ port: createFixturePort(FIXTURE_TODAY, { empty: true }) })
    expect(c.querySelector('.mo-why')!.textContent).toContain('Nothing logged this month yet')
    expect(c.querySelector('.mo-pvd')!.textContent).toContain('--')
    expect(c.querySelectorAll('.alm-strip').length).toBe(0)
  })

  it('opens the Marks legend, names every shape and hides a kind when its switch is off', async () => {
    const c = await mount()
    expect(c.querySelectorAll('.alm-mark[data-kind="body"]').length).toBeGreaterThan(0)
    click(buttons(c, 'Marks')[0])
    await flush(4)
    const pop = document.body.querySelector('.mo-pop')!
    expect(pop.querySelectorAll('li[data-kind]').length).toBe(9)
    expect(pop.textContent).toContain('From Google')
    expect(pop.textContent).toContain('Classroom')
    click(pop.querySelector<HTMLElement>('li[data-kind="body"] [role="switch"]'))
    await flush(4)
    expect(c.querySelectorAll('.alm-cell .alm-mark[data-kind="body"]').length).toBe(0)
    expect(c.querySelectorAll('.alm-mark[data-kind="study"]').length).toBeGreaterThan(0)
  })
})

describe('Day / Month on the null port', () => {
  it('says WAITING with the reason, draws the skeleton, and shows no figure', async () => {
    const c = await mount({ port: DAY_PORT })
    expect(c.querySelector('.mo-sub .k-lamp')!.getAttribute('data-state')).toBe('waiting')
    expect(c.querySelector('.mo-why')!.textContent).toContain('not connected')
    expect(c.querySelector('.mo-google .k-lamp')!.getAttribute('data-state')).toBe('planned')
    expect(c.querySelector('.mo-pvd')!.textContent).toContain('--')
    expect(c.querySelectorAll('.alm-skel').length).toBe(42)
    expect(c.querySelectorAll('.alm-strip').length).toBe(0)
    expect(c.querySelector('.mo-hollow')!.textContent).toContain('No counts')
    expect(c.querySelector('.mo-intents .mo-hollow')!.textContent).toContain('not connected')
  })
})

describe('the live overlay from the existing stores', () => {
  it('turns the plan log into study minutes by day and today\'s classes into marks, all LIVE', () => {
    const days = liveDays('2026-11-18', [
      { date: '2026-11-10', minutes: 30, kind: 'log' },
      { date: '2026-11-10', minutes: 20, kind: 'log' },
      { date: '2026-11-11', kind: 'log' },
      { date: '2026-11-12', minutes: 40, kind: 'note' },
    ], [{ id: 'a', status: 'present' }, { id: 'b', status: null }, { id: 'c', status: 'cancelled' }])
    const ten = days.find((d) => d.date === '2026-11-10')!
    expect(ten.minutes).toBe(50)
    expect(ten.state).toBe('live')
    expect(ten.marks).toEqual([{ kind: 'study', done: true, count: 2, state: 'live' }])
    expect(days.find((d) => d.date === '2026-11-11')).toBeUndefined()
    expect(days.find((d) => d.date === '2026-11-12')).toBeUndefined()
    const today = days.find((d) => d.date === '2026-11-18')!
    expect(today.marks.map((m) => `${m.kind}:${m.done}`).sort()).toEqual(['class:false', 'class:true'])
  })
  it('knows nothing when the stores have not read', () => {
    expect(liveDays('2026-11-18', null, null)).toEqual([])
  })
})

describe('the month host and the registration', () => {
  const Body = () => null
  it('orders faces, keeps the first of a repeated id, skips a file with no face', () => {
    const faces = collectFaces({
      './b.face.tsx': { face: { id: 'b', title: 'B', order: 2, Body } },
      './a.face.tsx': { default: { id: 'a', title: 'A', order: 1, Body } },
      './c.face.tsx': { face: { id: 'a', title: 'dup', order: 0, Body } },
      './d.face.tsx': { face: { id: 'd' } },
    })
    expect(faces.map((f) => f.id)).toEqual(['a', 'b'])
  })
  it('registers day.month for Well Wisher through a lazy import', () => {
    expect(view.id).toBe('day.month')
    expect(view.product).toBe('ww')
    expect(typeof view.load).toBe('function')
    const text = readFileSync(join(__dirname, '../../../../shell/views/day-month.view.ts'), 'utf8')
    expect(text).toMatch(/import\.meta\.env\.VITE_PRODUCT !== 'jarvis'/)
    expect(text).not.toMatch(/^\s*import\s[^'"]*?from\s*['"][^'"]*\/ww\//m)
  })
})

describe('the copy of the package', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? (f === '__tests__' ? [] : walk(p)) : /\.(tsx?|css)$/.test(f) ? [p] : []
    })
  const root = join(__dirname, '../../../..')
  const files = [...walk(join(root, 'shared/almanac')), ...walk(join(root, 'ww/day/month')), ...walk(join(root, 'ww/day/drawer')), join(root, 'ww/day/ports.ts'), ...walk(join(root, 'ww/day/adapters'))]

  it('holds none of the banned words of 20.6.7, and no streak prop', () => {
    const banned = /streak|failed|missed|clean|relapse|disorder|treat|diagnos/i
    expect(files.length).toBeGreaterThan(15)
    const hits = files.filter((f) => banned.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
  it('draws no red and no hard-coded colour: tokens by name', () => {
    const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(|\bred\b|\bcrimson\b/i)
    expect(css).not.toMatch(/outline:\s*none|border:\s*1px solid var\(--(line|edge)/)
  })
})
