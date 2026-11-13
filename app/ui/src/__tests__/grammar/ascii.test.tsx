// The ASCII grammar (spec 20.4.2, A.G02 accept lines): every data form has a required reading and a text twin, a
// hollow form when the state forbids a number, the atmosphere lint rejects a plate bound to a count, sparkline and
// the portrait are pure (golden bytes), and the portrait keeps a clear window for the initials.
import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '../ww/_stubs'
import { Lamp } from '../../shared/lamp'
import {
  AsciiBar, AsciiHeat, AsciiPlate, AsciiPortrait, HEAT_MAX_CELLS, RAMPS, SPARK_BLOCKS, SPARK_GAP, atmosphereBudget,
  atmosphereProblems, barTrack, cleanInitials, freezeText, heatLevel, portraitPlan, portraitText, scatterText, sparkline,
} from '../../shared/grammar'
import { ATMOSPHERE_MAX_BYTES } from '../../shared/grammar/ascii/ramps'
import { PORTRAIT_COLS, PORTRAIT_ROWS, PORTRAIT_WINDOW } from '../../shared/grammar/ascii/Ascii'

const SIM = { state: 'simulated' as const, since: null, reason: 'test fixture' }
const WAIT = { state: 'waiting' as const, since: null, reason: 'no report' }
const GOLDEN = join(__dirname, 'golden', 'ascii.json')
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})

describe('ramps', () => {
  it('are the four ramps of 20.4.2, glyph for glyph', () => {
    expect(RAMPS).toEqual({ r10: ' .:-=+*#%@', r5: ' .:+#', caret: ' .^AM', edge: '/\\|_-' })
  })
})

describe('sparkline', () => {
  it('maps min to the lowest block and max to the highest, gaps to a hatch', () => {
    expect(sparkline([0, 10, NaN, 5])).toBe(`${SPARK_BLOCKS[0]}${SPARK_BLOCKS[4]}${SPARK_GAP}${SPARK_BLOCKS[2]}`)
  })
  it('draws a flat series level at the middle step, an empty one as all gaps', () => {
    expect(sparkline([3, 3, 3])).toBe(SPARK_BLOCKS[2].repeat(3))
    expect(sparkline([NaN, Infinity])).toBe(SPARK_GAP.repeat(2))
    expect(sparkline([])).toBe('')
  })
  it('holds at most 512 points, the latest ones', () => {
    const s = sparkline(Array.from({ length: 2000 }, (_, i) => i))
    expect([...s].length).toBe(512)
    expect([...s].at(-1)).toBe(SPARK_BLOCKS[4])
  })
})

describe('AsciiHeat', () => {
  it('levels: a gap is -1, zero is 0, any positive count is at least 1, the top is 4', () => {
    expect(heatLevel(NaN, 9)).toBe(-1)
    expect(heatLevel(-1, 9)).toBe(-1)
    expect(heatLevel(0, 9)).toBe(0)
    expect(heatLevel(0.1, 9)).toBe(1)
    expect(heatLevel(9, 9)).toBe(4)
    expect(heatLevel(50, 9)).toBe(4)
  })
  it('shows the reading, a day number per cell, and a text twin per day', () => {
    m = mount(<AsciiHeat cells={[0, 3, NaN, 9]} unit="actions" reading={<Lamp reading={SIM} subject="Actions" />} />)
    const fig = m.container.querySelector('figure.g-heat')!
    expect(fig.getAttribute('data-grammar')).toBe('ascii')
    expect(fig.querySelector('figcaption [data-lamp="simulated"]')).not.toBeNull()
    expect([...fig.querySelectorAll('.g-heat-day')].map((d) => d.textContent)).toEqual(['1', '2', '3', '4'])
    expect([...fig.querySelectorAll('.g-sr li')].map((d) => d.textContent)).toEqual(['Day 1: 0 actions', 'Day 2: 3 actions', 'Day 3: no data', 'Day 4: 9 actions'])
    // the scale says what the darkest glyph means
    expect(fig.querySelector('.g-heat-scale')!.textContent).toContain('up to 9')
  })
  it('is hollow when the state forbids a number: no glyph, no count, the state word in the twin', () => {
    m = mount(<AsciiHeat cells={[1, 2, 3]} state="waiting" reading={<Lamp reading={WAIT} />} />)
    const fig = m.container.querySelector('figure.g-heat')!
    expect(fig.getAttribute('data-hollow')).toBe('true')
    expect([...fig.querySelectorAll('.g-heat-glyph')].every((g) => g.textContent === '·')).toBe(true)
    expect(fig.querySelector('.g-sr')!.textContent).toBe('No values shown: WAITING')
    expect(fig.querySelector('.g-heat-scale')).toBeNull()
  })
  it('is bounded: at most a year and a week of cells', () => {
    m = mount(<AsciiHeat cells={Array.from({ length: 1000 }, () => 1)} reading={<Lamp reading={SIM} />} />)
    expect(m.container.querySelectorAll('.g-heat-cell').length).toBe(HEAT_MAX_CELLS)
  })
})

describe('AsciiBar', () => {
  it('track text: fill, head and empty add up to the width', () => {
    expect(barTrack(0.7, 10)).toEqual({ fill: '#######', empty: '---' })
    expect(barTrack(0.5, 16, 'car')).toEqual({ fill: '####o=o>', empty: '--------' })
    expect(barTrack(null, 8)).toEqual({ fill: '', empty: '--------' })
    for (const r of [0, 0.01, 0.33, 0.99, 1, 1.4]) for (const h of [undefined, '>', 'car', 'chopper'] as const) {
      const t = barTrack(r, 12, h)
      expect(t.fill.length + t.empty.length).toBe(12)
    }
  })
  it('is a meter with the percentage as text and the reading beside it', () => {
    m = mount(<AsciiBar value={7} max={10} label="Unit 3" reading={<Lamp reading={SIM} />} />)
    const meter = m.container.querySelector('[role="meter"]')!
    expect(meter.getAttribute('aria-valuetext')).toBe('70 percent, 7 of 10')
    expect(m.container.querySelector('.g-bar-pct')!.textContent).toBe('70 %')
    expect(m.container.querySelector('.g-bar-reading [data-lamp="simulated"]')).not.toBeNull()
  })
  it('keeps a real percentage past 100 and fills the track', () => {
    m = mount(<AsciiBar value={15} max={10} reading={<Lamp reading={SIM} />} />)
    expect(m.container.querySelector('.g-bar-pct')!.textContent).toBe('150 %')
    expect(m.container.querySelector('.g-bar-empty')!.textContent).toBe('')
  })
  it('is hollow for WAITING, PLANNED, FAULT and for a value that is not a number', () => {
    for (const state of ['waiting', 'planned', 'fault'] as const) {
      m = mount(<AsciiBar value={4} max={10} state={state} label="Spend" reading={<Lamp reading={WAIT} />} />)
      expect(m.container.querySelector('[role="meter"]')).toBeNull()
      expect(m.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toMatch(/^Spend: no value, (WAITING|PLANNED|FAULT)$/)
      expect(m.container.querySelector('.g-bar-pct')!.textContent).toBe('—')
      m.unmount()
      m = null
    }
    m = mount(<AsciiBar value={NaN} max={10} reading={<Lamp reading={WAIT} />} />)
    expect(m.container.querySelector('.g-bar')!.getAttribute('data-hollow')).toBe('true')
  })
})

describe('AsciiPlate and the atmosphere lint', () => {
  it('atmosphere is aria-hidden decoration; data is an image with a name', () => {
    m = mount(<AsciiPlate text={'.^A\n^AM'} ramp="caret" />)
    expect(m.container.querySelector('pre')!.getAttribute('aria-hidden')).toBe('true')
    m.unmount()
    m = mount(<AsciiPlate text={'.^A'} tier="data" label="Branch plate" />)
    expect(m.container.querySelector('pre')!.getAttribute('role')).toBe('img')
    expect(m.container.querySelector('pre')!.getAttribute('aria-label')).toBe('Branch plate')
  })
  it('rejects an atmosphere plate bound to a count (digits) and one over 8 KB', () => {
    expect(atmosphereProblems('.^AM')).toEqual([])
    expect(atmosphereProblems('streak 12')[0]).toMatch(/digits/)
    expect(atmosphereProblems('.'.repeat(ATMOSPHERE_MAX_BYTES + 1))[0]).toMatch(/size/)
    m = mount(<AsciiPlate text="day 3" />)
    expect(m.container.querySelector('pre')!.getAttribute('data-lint')).toBe('fail')
  })
  it('cuts a plate over the budget and marks it', () => {
    m = mount(<AsciiPlate text={('x'.repeat(99) + '\n').repeat(100)} />)
    const pre = m.container.querySelector('pre')!
    expect(pre.getAttribute('data-over')).toBe('true')
    expect(new TextEncoder().encode(pre.textContent!).length).toBeLessThanOrEqual(ATMOSPHERE_MAX_BYTES)
  })
  it('freeze keeps the shape as a 1-bit field; scatter is seeded and keeps spaces and lines', () => {
    const t = '@@@@\n    \n.:-='
    const f = freezeText(t, 'r10')
    expect(f.split('\n').map((l) => l.length)).toEqual([4, 4, 4])
    expect(f.split('\n')[0]).toBe('::::')
    expect(f.split('\n')[1]).toBe('    ')
    expect(scatterText(t)).toBe(scatterText(t))
    expect(scatterText(t).split('\n')[1]).toBe('    ')
    expect(/^[/\\x\n ]+$/.test(scatterText(t))).toBe(true)
  })
  it('the byte budget across files: 8 KB a file, 6 files a section, 90 KB in all', () => {
    expect(atmosphereBudget([{ name: 'a', section: 'life', bytes: 4000 }])).toEqual([])
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `f${i}`, section: 'life', bytes: 100 }))
    expect(atmosphereBudget(many)[0]).toMatch(/life: 7 files/)
    const big = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, section: `s${i}`, bytes: 8000 }))
    expect(atmosphereBudget(big).join(' ')).toMatch(/total: 96000/)
  })
})

describe('AsciiPortrait', () => {
  const grid = (ini: string) => {
    const lines = portraitText(ini).split('\n')
    return Array.from({ length: PORTRAIT_ROWS }, (_, y) => (lines[y] ?? '').padEnd(PORTRAIT_COLS, ' '))
  }
  it('is pure: same initials, same bytes (golden file; rewrite only on purpose with GRAMMAR_GOLDEN_WRITE=1)', () => {
    const now = {
      hashes: Object.fromEntries(['AN', 'KR', 'MS', 'TJ', 'BLD', 'Q', 'ZZ9', 'X'].map((i) => [i, sha(portraitText(i))])),
      sparkline: sparkline([12, 18, 15, 22, NaN, 30, 41, 38, 26, 33, 45, 40]),
      full: { AN: portraitText('AN') },
    }
    if (process.env.GRAMMAR_GOLDEN_WRITE || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n')
    expect(now).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')))
  })
  it('keeps the window clear: nothing is drawn where the initials sit', () => {
    for (const ini of ['AN', 'KR', 'MS', 'TJ', 'BLD', 'Q', 'ZZ9', 'X']) {
      const g = grid(ini)
      const cx = (PORTRAIT_COLS - 1) / 2, cy = (PORTRAIT_ROWS - 1) / 2
      for (let y = cy - PORTRAIT_WINDOW.dy; y <= cy + PORTRAIT_WINDOW.dy; y++) {
        expect(g[y].slice(cx - PORTRAIT_WINDOW.dx, cx + PORTRAIT_WINDOW.dx + 1), ini).toBe(' '.repeat(2 * PORTRAIT_WINDOW.dx + 1))
      }
    }
  })
  it('is a deliberate shape: the drawn cells are mirror-true left to right and top to bottom', () => {
    for (const ini of ['AN', 'KR', 'MS', 'TJ', 'BLD', 'Q', 'ZZ9', 'X', 'PO', 'LE']) {
      const g = grid(ini)
      for (let y = 0; y < PORTRAIT_ROWS; y++) for (let x = 0; x < PORTRAIT_COLS; x++) {
        const ink = g[y][x] !== ' '
        expect(g[y][PORTRAIT_COLS - 1 - x] !== ' ', `${ini} ${x},${y}`).toBe(ink)
        expect(g[PORTRAIT_ROWS - 1 - y][x] !== ' ', `${ini} ${x},${y}`).toBe(ink)
      }
    }
  })
  it('carries no digit (it is not a reading) and separates people: 40 initials give at least 15 plates', () => {
    const all = Array.from({ length: 40 }, (_, i) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i * 7) % 26)))
    for (const i of all) expect(/[0-9]/.test(portraitText(i))).toBe(false)
    expect(new Set(all.map(portraitText)).size).toBeGreaterThanOrEqual(15)
    expect(new Set(all.map((i) => portraitPlan(i).shape)).size).toBe(3)
  })
  it('is named by the initials, never a face, and the plate is hidden from assistive technology', () => {
    expect(cleanInitials(' a.n ')).toBe('AN')
    expect(cleanInitials('')).toBe('?')
    expect(cleanInitials('abcd')).toBe('ABC')
    m = mount(<AsciiPortrait initials="an" />)
    const fig = m.container.querySelector('figure')!
    expect(fig.getAttribute('role')).toBe('img')
    expect(fig.getAttribute('aria-label')).toBe('Initials A N')
    expect(fig.querySelector('pre')!.getAttribute('aria-hidden')).toBe('true')
    expect(fig.querySelector('.g-initials')!.textContent).toBe('AN')
  })
})
