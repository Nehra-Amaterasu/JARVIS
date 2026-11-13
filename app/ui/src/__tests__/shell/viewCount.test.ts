// A.N02 (h), D-V2-10 and D-V2-11: the id table grows from 34 to 36 views. `day.month` is the Life calendar
// (Day: today, week, month, body, close) and `focus.drill` is Drill inside Focus; the legacy id `drill` resolves
// to `focus.drill`. The count is read from the table itself (shell/ids.ts), never from a copy, so a section
// package that adds a view without its decision fails here first.
import { describe, expect, it } from 'vitest'
import { ALIASES, SECTIONS, VIEW_LABEL, parseRoute, resolveAlias } from '../../shell/ids'
import { HOSTS } from '../../shell/hosts'

const ALL = SECTIONS.flatMap((s) => s.views.map((v) => `${s.id}.${v}`))

describe('the view count (D-V2-10)', () => {
  it('the table holds 36 views in ten sections', () => {
    expect(SECTIONS).toHaveLength(10)
    expect(ALL).toHaveLength(36)
    expect(new Set(ALL).size).toBe(36)
  })

  it('Day has five views with month after week; Focus has four with drill', () => {
    expect(SECTIONS.find((s) => s.id === 'day')!.views).toEqual(['today', 'week', 'month', 'body', 'close'])
    expect(SECTIONS.find((s) => s.id === 'focus')!.views).toEqual(['start', 'session', 'rest', 'drill'])
  })

  it('every view has a label, so no switch prints a bare id', () => {
    for (const s of SECTIONS) for (const v of s.views) expect(VIEW_LABEL[v], `${s.id}.${v}`).toBeTruthy()
  })

  it('the legacy id drill resolves to focus.drill (D-V2-11), as an alias and as a route', () => {
    expect(ALIASES.drill).toBe('focus.drill')
    expect(resolveAlias('drill')).toEqual({ product: 'ww', section: 'focus', view: 'drill' })
    expect(parseRoute('#/drill')).toEqual({ product: 'ww', section: 'focus', view: 'drill' })
    expect(parseRoute('#/day/month')).toEqual({ product: 'ww', section: 'day', view: 'month' })
    // every alias names a view in the table
    for (const [alias, id] of Object.entries(ALIASES)) expect(ALL, alias).toContain(id)
  })

  it('focus.drill is the Drill page; study.practice is its set-up door and says it shares the page', () => {
    expect(HOSTS['focus.drill']).toMatchObject({ kind: 'ww', ws: 'focus', view: 'drill' })
    expect(HOSTS['study.practice']).toMatchObject({ kind: 'ww', ws: 'focus', view: 'drill', shared: true })
  })

  it('day.month has no page yet, so it shows the PLANNED plate, never borrowed content', () => {
    expect(HOSTS['day.month']).toEqual({ kind: 'none' })
  })
})
