// B04: the lamp, the {state, since, reason} contract, the annunciators, the store hooks and the rule that no widget
// renders a number without a state (spec 6.6, D12, A.B04).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '../ww/_stubs'
import { useCapability, useStore } from '../../lib/store'
import {
  Annunciators, JARVIS_ANNUNCIATORS, LAMP_SPECS, LAMP_STATES, Lamp, NO_REPORT, Reading, WAITING_DEFAULT, WW_ANNUNCIATORS,
  lampName, readingOf, showsNumber, sinceText, type LampReading, type LampState,
} from '../../shared/lamp'

const NOW = 1_700_000_000_000
const live: LampReading = { state: 'live', since: NOW - 3000, reason: 'board reported' }
const rd = (state: LampState, reason = ''): LampReading => ({ state, since: state === 'live' || state === 'simulated' ? NOW - 61_000 : null, reason })

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  document.body.innerHTML = ''
  useStore.setState({ readings: {} })
})
afterEach(() => {
  m?.unmount()
  m = null
})

describe('the contract', () => {
  it('has exactly the five states of spec 6.6, each with its own shape, token and word', () => {
    expect([...LAMP_STATES]).toEqual(['live', 'waiting', 'simulated', 'planned', 'fault'])
    expect(new Set(LAMP_STATES.map((s) => LAMP_SPECS[s].glyph)).size).toBe(5)
    expect(new Set(LAMP_STATES.map((s) => LAMP_SPECS[s].token)).size).toBe(5)
    expect(LAMP_STATES.map((s) => LAMP_SPECS[s].label)).toEqual(['LIVE', 'WAITING', 'SIMULATED', 'PLANNED', 'FAULT'])
  })

  it('defaults to WAITING "no report", never LIVE', () => {
    expect(WAITING_DEFAULT).toEqual({ state: 'waiting', since: null, reason: NO_REPORT })
    for (const bad of [undefined, null, {}, { state: 'ok' }, { state: 'LIVE' }, { state: 3 }] as const)
      expect(readingOf(bad as never)).toEqual(WAITING_DEFAULT)
  })

  it('keeps a real report and cleans the parts that are missing', () => {
    expect(readingOf({ state: 'live', since: NOW, reason: ' ok ' })).toEqual({ state: 'live', since: NOW, reason: 'ok' })
    expect(readingOf({ state: 'live' })).toEqual({ state: 'live', since: null, reason: '' })
    expect(readingOf({ state: 'live', since: Number.NaN }).since).toBeNull()
    expect(readingOf({ state: 'fault' }).reason).toBe('no reason given')
    expect(readingOf({ state: 'waiting' }).reason).toBe(NO_REPORT)
  })

  it('only LIVE and SIMULATED may show a number', () => {
    expect(LAMP_STATES.filter(showsNumber)).toEqual(['live', 'simulated'])
  })

  it('words the age and the accessible name', () => {
    expect(sinceText({ state: 'waiting', since: null, reason: NO_REPORT }, NOW)).toBe('no report yet')
    expect(sinceText({ ...live, since: NOW - 2000 }, NOW)).toBe('just now')
    expect(sinceText({ ...live, since: NOW - 30_000 }, NOW)).toBe('30 s ago')
    expect(sinceText({ ...live, since: NOW - 10 * 60_000 }, NOW)).toBe('10 min ago')
    expect(sinceText({ ...live, since: NOW - 3 * 3600_000 }, NOW)).toBe('3 h ago')
    expect(lampName(live, NOW)).toBe('LIVE, board reported, just now')
  })
})

describe('the lamp', () => {
  it('draws five different shapes with no colour in the markup (greyscale test)', () => {
    m = mount(<div>{LAMP_STATES.map((s) => <Lamp key={s} reading={rd(s)} />)}</div>)
    const sigs = [...m.container.querySelectorAll('.lamp-glyph')].map((svg) =>
      svg.innerHTML.replace(/\s+/g, ' '))
    expect(new Set(sigs).size).toBe(5)
    for (const html of sigs) {
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|var\(/i) // the shape differs, the ink is currentColor
      expect(html).toMatch(/currentColor/)
    }
    // the five shapes by element kind: disc, ring+half, diamond path, dashed ring, triangle path
    expect(sigs[0]).toContain('<circle')
    expect(sigs[0]).not.toContain('stroke')
    expect(sigs[1]).toContain('<path d="M8 2a6 6 0 0 0 0 12z"')
    expect(sigs[3]).toContain('stroke-dasharray')
    expect(sigs[2]).toContain('M8 1.5 14.5 8')
    expect(sigs[4]).toContain('M8 1.8 14.6 13.6')
  })

  it('shows the word with the glyph and names itself in full', () => {
    m = mount(<Lamp reading={live} subject="Voice" now={NOW} />)
    const el = m.container.querySelector('.lamp') as HTMLElement
    expect(el.textContent).toBe('LIVE')
    expect(el.getAttribute('aria-label')).toBe('Voice: LIVE, board reported, just now')
    expect(el.getAttribute('role')).toBe('img')
  })

  it('can drop the word (title bar) and keeps the name', () => {
    m = mount(<Lamp reading={rd('fault', 'port closed')} size={16} showLabel={false} subject="Room link" now={NOW} />)
    const el = m.container.querySelector('.lamp') as HTMLElement
    expect(el.textContent).toBe('')
    expect(el.getAttribute('aria-label')).toContain('FAULT, port closed')
    expect(el.dataset.size).toBe('16')
  })
})

describe('Reading: a number only with a state that allows it', () => {
  const draw = (reading: LampReading, value: number | null = 42) => {
    m?.unmount()
    m = mount(<Reading label="Latency" value={value} unit="ms" reading={reading} now={NOW} />)
    return m.container.querySelector('.lamp-reading-value')!.textContent
  }

  it('draws the number for LIVE and SIMULATED', () => {
    expect(draw(live)).toBe('42ms')
    expect(draw(rd('simulated'))).toBe('42ms')
  })

  it('draws an em dash for WAITING, PLANNED and FAULT even when handed a number', () => {
    for (const s of ['waiting', 'planned', 'fault'] as const) expect(draw(rd(s, 'x'))).toBe('—')
  })

  it('draws an em dash for a LIVE reading with no number', () => {
    expect(draw(live, null)).toBe('—')
  })

  it('stamps the state word on the reading itself', () => {
    draw(rd('simulated'))
    const el = m!.container.querySelector('.lamp-reading') as HTMLElement
    expect(el.dataset.state).toBe('simulated')
    expect(el.textContent).toContain('SIMULATED')
    expect(el.textContent).toContain('generated')
  })
})

describe('annunciators', () => {
  it('lists the four JARVIS lamps and the two Well Wisher lamps in order', () => {
    expect(JARVIS_ANNUNCIATORS.map((a) => a.label)).toEqual(['Voice', 'Room link', 'Senses', 'Memory'])
    expect(WW_ANNUNCIATORS.map((a) => a.label)).toEqual(['Phone paired', 'Quiet on'])
  })

  it('shows WAITING for every lamp nobody has reported on', () => {
    m = mount(<Annunciators items={JARVIS_ANNUNCIATORS} readings={{}} now={NOW} />)
    const lamps = [...m.container.querySelectorAll('.lamp')] as HTMLElement[]
    expect(lamps.map((l) => l.dataset.lamp)).toEqual(['waiting', 'waiting', 'waiting', 'waiting'])
    expect(lamps[0].getAttribute('aria-label')).toBe('Voice: WAITING, no report, no report yet')
  })

  it('shows what a source reported and nothing more', () => {
    m = mount(<Annunciators items={JARVIS_ANNUNCIATORS} readings={{ voice: live, senses: rd('simulated') }} now={NOW} />)
    const lamps = [...m.container.querySelectorAll('.lamp')] as HTMLElement[]
    expect(lamps.map((l) => l.dataset.lamp)).toEqual(['live', 'waiting', 'simulated', 'waiting'])
  })
})

describe('the store hooks', () => {
  it('has no reading until a source reports, and the hook reads WAITING', () => {
    expect(useStore.getState().readings).toEqual({})
    function Probe() {
      const r = useCapability('voice')
      return <i data-state={r.state}>{r.reason}</i>
    }
    m = mount(<Probe />)
    expect(m.container.querySelector('i')!.dataset.state).toBe('waiting')
    expect(m.container.querySelector('i')!.textContent).toBe(NO_REPORT)
  })

  it('stamps since when the state changes and keeps it when the same state repeats', () => {
    const { reportCapability } = useStore.getState()
    reportCapability('room', { state: 'live', reason: 'board reported' })
    const first = useStore.getState().readings.room
    expect(first.state).toBe('live')
    expect(first.since).toBeGreaterThan(0)
    const t = first.since
    reportCapability('room', { state: 'live', reason: 'board reported' })
    expect(useStore.getState().readings.room).toBe(first) // unchanged: no new object, no re-render
    reportCapability('room', { state: 'live', reason: 'board reported again' })
    expect(useStore.getState().readings.room.since).toBe(t)
    reportCapability('room', { state: 'fault', reason: 'port closed' })
    expect(useStore.getState().readings.room).toMatchObject({ state: 'fault', reason: 'port closed' })
  })

  it('turns an unusable report into WAITING, not LIVE', () => {
    useStore.getState().reportCapability('memory', { state: 'ok' as never })
    expect(useStore.getState().readings.memory.state).toBe('waiting')
    expect(useStore.getState().readings.memory.reason).toBe(NO_REPORT)
  })

  it('re-renders a lamp when its capability reports', () => {
    function Probe() {
      const r = useCapability('senses')
      return <Lamp reading={r} subject="Senses" now={NOW} />
    }
    m = mount(<Probe />)
    expect((m.container.querySelector('.lamp') as HTMLElement).dataset.lamp).toBe('waiting')
    act(() => useStore.getState().reportCapability('senses', { state: 'simulated', since: NOW, reason: 'replay' }))
    expect((m.container.querySelector('.lamp') as HTMLElement).dataset.lamp).toBe('simulated')
  })
})

// ---- the lint test: no widget renders a number without a state ------------------------------------------------
// A source scan, not a render: it reads the component files of the shared and product kits and fails when a props
// interface carries a reading (`value: number`) with no `state`/`reading` beside it. Files that predate B04 are in
// DEBT, each with the package that retires it; the list may only shrink (the second test fails when an entry is
// fixed but still listed, so the debt cannot hide).
const SRC = resolve(__dirname, '..', '..')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const posix = (p: string) => p.split(sep).join('/')
const WIDGET_ROOTS = ['shared', 'jarvis', 'ww/kit', 'components', 'pages'].map((r) => join(SRC, r))
const PROPS = /export interface (\w+Props)\s*\{([\s\S]*?)\n\}/g
const NUMBER_PROP = /^\s*(?:value|readout|reading|level|amount|percent)\??\s*:\s*[^\n]*\bnumber\b/m
const STATE_PROP = /^\s*(?:state|reading)\??\s*:\s*[^\n]*(?:LampReading|LampState|ArtState)/m // ArtState is an alias of LampState (shared/art/state.tsx)

function unstatedReadings(): string[] {
  const bad: string[] = []
  for (const root of WIDGET_ROOTS) {
    for (const f of walk(root).filter((f) => /\.tsx$/.test(f))) {
      const text = readFileSync(f, 'utf8')
      for (const mm of text.matchAll(PROPS)) {
        if (NUMBER_PROP.test(mm[2]) && !STATE_PROP.test(mm[2])) bad.push(`${posix(relative(SRC, f))}#${mm[1]}`)
      }
    }
  }
  return bad.sort()
}

/** Reading widgets that predate the lamp. Each is retired by the named package; none may be added. */
const DEBT: Record<string, string> = {
  'ww/kit/Data.tsx#StatProps': 'B03b (kit): Stat takes a reading',
  'ww/kit/Data.tsx#MeterProps': 'B03b (kit): Meter takes a reading',
}

describe('no widget renders a number without a state', () => {
  it('finds the lamp widgets and sees them as stated', () => {
    expect(readFileSync(join(SRC, 'shared/lamp/Reading.tsx'), 'utf8')).toMatch(/reading: LampReading/)
    expect(unstatedReadings().filter((b) => b.startsWith('shared/lamp/'))).toEqual([])
  })

  it('fails for any reading prop without a state, other than the listed debt', () => {
    const fresh = unstatedReadings().filter((b) => !(b in DEBT))
    expect(fresh, 'a props interface with a number reading and no state: take a LampReading').toEqual([])
  })

  it('keeps the debt list honest: every entry still exists', () => {
    const now = new Set(unstatedReadings())
    const fixed = Object.keys(DEBT).filter((k) => !now.has(k))
    expect(fixed, 'fixed: delete it from DEBT').toEqual([])
  })

  it('the scanner itself catches a violation', () => {
    const sample = 'export interface FooProps {\n  value: number | null\n  label: string\n}\n'
    const hit = [...sample.matchAll(PROPS)].filter((mm) => NUMBER_PROP.test(mm[2]) && !STATE_PROP.test(mm[2]))
    expect(hit.length).toBe(1)
    const ok = 'export interface FooProps {\n  value: number | null\n  reading: LampReading\n}\n'
    expect([...ok.matchAll(PROPS)].filter((mm) => NUMBER_PROP.test(mm[2]) && !STATE_PROP.test(mm[2]))).toHaveLength(0)
  })
})
