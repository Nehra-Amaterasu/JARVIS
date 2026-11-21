// The spine's model: every section and view reachable, the open project, the state lines, the keyboard steps, the routes.
import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../../../shell/ids'
import { collectLamps } from '../../../shell/v3/lamps'
import { spineModel } from '../../../shell/v3/Spine'
import {
  SUBPROJECTS, availableSubProjects, hashOfPlace, placeOfHash, reachablePlaces, spineOrder, stepSection, stepViewOf, subProjectOfSection,
} from '../../../shell/v3/subprojects'

describe('the four sub-projects', () => {
  it('are JARVIS, Aankhen, Yadaash and Well Wisher, with the grounds of spec 3.1', () => {
    expect(SUBPROJECTS.map((p) => [p.name, p.ground])).toEqual([['JARVIS', 'dark'], ['Aankhen', 'dark'], ['Yadaash', 'dark'], ['Well Wisher', 'light']])
  })
  it('hold every section of ids.ts exactly once, so none is orphaned and none is doubled', () => {
    const held = SUBPROJECTS.flatMap((p) => [...p.sections]).sort()
    expect(held).toEqual(SECTIONS.map((s) => s.id).sort())
    expect(held).toHaveLength(10)
  })
  it('keep each section on the product of ids.ts (Senses and Memory stay jarvis in the code)', () => {
    for (const p of SUBPROJECTS) for (const s of p.sections) expect(SECTIONS.find((x) => x.id === s)!.product).toBe(p.product)
  })
  it('a single-product build drops the other products tiles', () => {
    expect(availableSubProjects(['ww']).map((p) => p.id)).toEqual(['wellwisher'])
    expect(spineOrder(['jarvis'])).toEqual(['core', 'room', 'console', 'senses', 'memory'])
  })
})

describe('spineModel', () => {
  const rows = collectLamps({})
  const model = (section: string, view: string) => spineModel({ product: SECTIONS.find((s) => s.id === section)!.product, section, view }, rows)
  it('opens exactly one project and marks the current section', () => {
    const m = model('room', 'rules')
    expect(m.filter((t) => t.open).map((t) => t.project.id)).toEqual(['jarvis'])
    expect(m.find((t) => t.open)!.sections.filter((s) => s.current).map((s) => s.id)).toEqual(['room'])
  })
  it('a one-section project is a link, lit when current, with no slot', () => {
    const m = model('senses', 'presence')
    const t = m.find((x) => x.project.id === 'aankhen')!
    expect([t.single, t.open, t.current]).toEqual([true, true, true])
    expect(m.find((x) => x.project.id === 'jarvis')!.current).toBe(false)
  })
  it('every section is reachable from some tile, and every tile carries a state line with a word', () => {
    const all = SECTIONS.flatMap((s) => model(s.id, s.views[0]).flatMap((t) => t.sections.map((x) => x.id)))
    expect(new Set(all)).toEqual(new Set(SECTIONS.map((s) => s.id)))
    for (const t of model('core', 'talk')) expect(t.stateText).toMatch(/^(LIVE|WAITING|SIMULATED|PLANNED|FAULT) · /)
  })
  it('carries the Ctrl+n hint the key table gives (the rail order of ids.ts), only where one exists', () => {
    const jarvis = model('core', 'talk').find((t) => t.open)!
    expect(jarvis.sections.find((s) => s.id === 'core')!.hint).toBe('Ctrl 1')
    expect(jarvis.sections.find((s) => s.id === 'console')!.hint).toBe('Ctrl 5')
  })
  it('the ground follows the project that owns the open section', () => {
    expect(subProjectOfSection('day')!.ground).toBe('light')
    expect(subProjectOfSection('memory')!.ground).toBe('dark')
  })
})

describe('keyboard steps (3.5)', () => {
  it('Alt+Down walks the ten sections in SPINE order, not rail order, and wraps', () => {
    const walked: string[] = []
    let cur = 'core'
    for (let i = 0; i < 10; i++) {
      walked.push(cur)
      cur = stepSection(cur, 1)!
    }
    expect(walked).toEqual(['core', 'room', 'console', 'senses', 'memory', 'day', 'focus', 'study', 'tree', 'career'])
    expect(cur).toBe('core')
    expect(stepSection('core', -1)).toBe('career')
  })
  it('Alt+Right walks the views of the section and wraps; a one-view section has nothing to step', () => {
    expect(stepViewOf('console', 'health', 1)).toBe('events')
    expect(stepViewOf('console', 'crew', 1)).toBe('health')
    expect(stepViewOf('console', 'health', -1)).toBe('crew')
    expect(stepViewOf('tree', 'tree', 1)).toBeNull()
  })
  it('reaches every view of every section', () => {
    expect(reachablePlaces()).toHaveLength(SECTIONS.reduce((n, s) => n + s.views.length, 0))
    for (const s of SECTIONS) {
      const seen = new Set([s.views[0]])
      let v = s.views[0]
      for (let i = 0; i < s.views.length; i++) {
        const next = stepViewOf(s.id, v, 1)
        if (!next) break
        seen.add(next)
        v = next
      }
      expect([...seen].sort(), s.id).toEqual([...s.views].sort())
    }
  })
})

describe('hash routing (3.4)', () => {
  it('#core, #today and #console are the three drawn views', () => {
    expect(placeOfHash('#core')).toEqual({ product: 'jarvis', section: 'core', view: 'talk' })
    expect(placeOfHash('#today')).toEqual({ product: 'ww', section: 'day', view: 'today' })
    expect(placeOfHash('#console')).toEqual({ product: 'jarvis', section: 'console', view: 'health' })
  })
  it('every other place is #section/view, and the old #/section/view form works too', () => {
    expect(placeOfHash('#room/rules')).toEqual({ product: 'jarvis', section: 'room', view: 'rules' })
    expect(placeOfHash('#/study/plan')).toEqual({ product: 'ww', section: 'study', view: 'plan' })
    expect(placeOfHash('#core/sound')).toEqual({ product: 'jarvis', section: 'core', view: 'sound' })
  })
  it('an unknown view falls back to the first view; an unknown section or an empty hash names no place', () => {
    expect(placeOfHash('#room/nope')!.view).toBe('switches')
    expect(placeOfHash('#nope')).toBeNull()
    expect(placeOfHash('')).toBeNull()
  })
  it('hashOfPlace is the inverse for every place', () => {
    for (const p of reachablePlaces()) expect(placeOfHash(hashOfPlace(p))).toEqual(p)
  })
})
