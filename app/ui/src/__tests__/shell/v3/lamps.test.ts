// The lamp table, the lamp pill's ordering and count, and the spine's state lines: one source (lamps.ts), so the pill and
// the spine cannot disagree (jury round 3).
import { describe, expect, it } from 'vitest'
import { JARVIS_ANNUNCIATORS, WW_ANNUNCIATORS } from '../../../shared/lamp'
import type { LampReading } from '../../../shared/lamp'
import { LAMP_TABLE, collectLamps, pillParts, pillText, projectState } from '../../../shell/v3/lamps'
import { SUBPROJECTS } from '../../../shell/v3/subprojects'

const r = (state: LampReading['state'], reason = ''): LampReading => ({ state, since: 1, reason })
const DOT = '·'

describe('the lamp table', () => {
  it('holds every lamp of the shared table (both products) and the steward', () => {
    const ids = LAMP_TABLE.map((l) => l.id)
    for (const a of [...JARVIS_ANNUNCIATORS, ...WW_ANNUNCIATORS]) expect(ids).toContain(a.id)
    expect(ids).toContain('steward')
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('puts every lamp in one of the four sub-projects and gives it a section to open', () => {
    for (const l of LAMP_TABLE) {
      expect(SUBPROJECTS.some((p) => p.id === l.project), l.id).toBe(true)
      expect(l.home, l.id).toBeTruthy()
    }
  })
})

describe('collectLamps and the pill', () => {
  it('with no report every lamp is WAITING with what it waits for, never LIVE', () => {
    const rows = collectLamps({})
    expect(rows).toHaveLength(LAMP_TABLE.length)
    expect(rows.every((x) => x.reading.state === 'waiting')).toBe(true)
    expect(rows.every((x) => x.reason.length > 8)).toBe(true)
    expect(pillText(pillParts(rows))).toBe(`${LAMP_TABLE.length} WAITING`)
  })
  it('a fault sorts first and the pill names the worst state first', () => {
    const rows = collectLamps({ steward: r('fault', 'Ollama is not answering') })
    expect(rows[0].def.id).toBe('steward')
    expect(rows[0].reason).toBe('Ollama is not answering')
    expect(pillText(pillParts(rows))).toBe(`1 FAULT ${DOT} ${LAMP_TABLE.length - 1} WAITING`)
  })
  it('orders fault, waiting, simulated, planned, live, and keeps the table order inside a state', () => {
    const rows = collectLamps({ voice: r('live', 'core up'), room: r('simulated', 'demo board'), senses: r('planned', 'later'), memory: r('fault', 'store unreadable') })
    const order = ['fault', 'waiting', 'simulated', 'planned', 'live']
    const idx = rows.map((x) => order.indexOf(x.reading.state))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    const waiting = rows.filter((x) => x.reading.state === 'waiting').map((x) => x.def.id)
    expect(waiting).toEqual(LAMP_TABLE.map((l) => l.id).filter((id) => waiting.includes(id)))
    expect(pillText(pillParts(rows))).toBe(`1 FAULT ${DOT} ${waiting.length} WAITING ${DOT} 1 SIMULATED ${DOT} 1 PLANNED ${DOT} 1 LIVE`)
  })
  it('counts every lamp: the parts add up to the table', () => {
    const rows = collectLamps({ steward: r('fault', 'x'), voice: r('live') })
    expect(pillParts(rows).reduce((n, p) => n + p.count, 0)).toBe(LAMP_TABLE.length)
  })
  it('a fault with no reason still shows words: the meaning of the state', () => {
    const rows = collectLamps({ steward: r('fault', '') })
    expect(rows[0].reason.length).toBeGreaterThan(0)
  })
})

describe('the spine reads the same rows', () => {
  it('a project state is its worst lamp: JARVIS shows FAULT, steward; the others WAITING with their short reason', () => {
    const rows = collectLamps({ steward: r('fault', 'Ollama is not answering') })
    expect(projectState('jarvis', rows)).toMatchObject({ state: 'fault', text: `FAULT ${DOT} steward` })
    expect(projectState('aankhen', rows).text).toBe(`WAITING ${DOT} no sensor`)
    expect(projectState('yadaash', rows).text).toBe(`WAITING ${DOT} not read`)
    expect(projectState('wellwisher', rows).text).toBe(`WAITING ${DOT} no phone`)
  })
  it('the lamps the spine shows (the union over the projects) are exactly the lamps the pill counts', () => {
    const rows = collectLamps({})
    const union = SUBPROJECTS.flatMap((p) => rows.filter((x) => x.def.project === p.id))
    expect(union.map((x) => x.def.id).sort()).toEqual(rows.map((x) => x.def.id).sort())
  })
  it('a reported reason replaces the idle words on the tile', () => {
    const rows = collectLamps({ voice: r('waiting', 'microphone busy'), steward: r('live', 'checked 1 min ago') })
    expect(projectState('jarvis', rows).text).toBe(`WAITING ${DOT} microphone busy`)
  })
})
