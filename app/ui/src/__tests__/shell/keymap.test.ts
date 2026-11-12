// A.B05: the one binding table. The rail, Ctrl+1..5 and the palette read shell/ids.ts and shell/keymap.ts; this
// test pins both to the spec's frozen id table (docs/design/jarvis-product-overhaul.md 3.2), parsed from the doc
// itself, so an order change has to be made in both places or it fails. It also proves "no hint without a
// binding": every hint the palette or the shortcuts sheet can show is the text of a real binding.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SECTIONS, sectionsOf, parseRoute, homeOf } from '../../shell/ids'
import { BINDINGS, comboText, hintFor, matchBinding, sectionForSlot, slotBindingOf } from '../../shell/keymap'
import { filterRows, goRows, hintOf, pageOf, shellRows, PAGE_ROWS } from '../../shell/commands'
import { HOSTS, placeOfFrame } from '../../shell/hosts'

const SPEC = resolve(__dirname, '../../../../../docs/design/jarvis-product-overhaul.md')

/** The rows of the 3.2 "Sections and views" table: section id and its view ids, in the doc's order. */
function specTable(): { section: string; views: string[] }[] {
  const text = readFileSync(SPEC, 'utf8')
  const start = text.indexOf('### 3.2 Stable ids (frozen)')
  const end = text.indexOf('**Order of the table', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const rows: { section: string; views: string[] }[] = []
  for (const line of text.slice(start, end).split('\n')) {
    const m = /^\| `([a-z]+)`(?: \(sheet\))? \| (.+) \|$/.exec(line.trim())
    if (!m) continue
    const views = [...m[2].matchAll(/`([a-z]+)\.([a-z]+)`/g)].map((v) => v[2])
    rows.push({ section: m[1], views })
  }
  return amendV2(rows.filter((r) => r.section !== 'proof' && r.section !== 'settings'))
}

/** 3.2 is "superseded in part by 20.2 (D-V2-10)": Day gains `month` after `week` (20.6: today, week, month, body,
 *  close) and Focus gains `drill` (A.Y02: start, session, rest, drill). The amendment is checked against the doc
 *  text too, so the test fails if the decision is withdrawn there. */
function amendV2(rows: { section: string; views: string[] }[]) {
  const text = readFileSync(SPEC, 'utf8')
  expect(text).toMatch(/D-V2-10 \| The Life calendar is the new named view `day\.month`/)
  expect(text).toContain('Day gets five views (`today`, `week`, `month`, `body`, `close`)')
  return rows.map((r) =>
    r.section === 'day' ? { ...r, views: ['today', 'week', 'month', 'body', 'close'] }
      : r.section === 'focus' ? { ...r, views: [...r.views, 'drill'] } : r)
}

const key = (k: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean }> = {}, code?: string) => ({
  key: k, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: false,
})

describe('the section order equals the 3.2 id table', () => {
  it('parses ten sections out of the spec', () => {
    expect(specTable()).toHaveLength(10)
  })

  it('sections and views are in the same order as the spec, row by row', () => {
    expect(SECTIONS.map((s) => ({ section: s.id, views: [...s.views] }))).toEqual(specTable())
  })

  it('the rail order is the 3.1.2 order: JARVIS Core..Console, Well Wisher Day, Focus, Study, Tree, Career', () => {
    expect(sectionsOf('jarvis').map((s) => s.id)).toEqual(['core', 'room', 'senses', 'memory', 'console'])
    expect(sectionsOf('ww').map((s) => s.id)).toEqual(['day', 'focus', 'study', 'tree', 'career'])
  })

  it('Ctrl+n and Alt+n open section n of the product in rail order', () => {
    for (const p of ['jarvis', 'ww'] as const)
      sectionsOf(p).forEach((s, i) => {
        expect(sectionForSlot(p, i + 1)).toBe(s.id)
        expect(slotBindingOf(p, s.id)).toBe(`slot.${i + 1}`)
        expect(matchBinding(key(String(i + 1), { ctrl: true }), false)?.id).toBe(`slot.${i + 1}`)
        expect(matchBinding(key(String(i + 1), { alt: true }, `Digit${i + 1}`), false)?.id).toBe(`slot.${i + 1}`)
      })
  })

  it('every view has a host, and no host names a view outside the table', () => {
    const ids = SECTIONS.flatMap((s) => s.views.map((v) => `${s.id}.${v}`))
    expect(Object.keys(HOSTS).sort()).toEqual([...ids].sort())
  })
})

describe('one binding table', () => {
  it('binding ids are unique and no two bindings share a combo', () => {
    expect(new Set(BINDINGS.map((b) => b.id)).size).toBe(BINDINGS.length)
    const combos = BINDINGS.flatMap((b) => b.combos.map(comboText))
    expect(new Set(combos).size).toBe(combos.length)
  })

  it('Alt+0 swaps the product; Ctrl+0 is left to the browser zoom reset (decision I1)', () => {
    expect(matchBinding(key('0', { alt: true }, 'Digit0'), false)?.id).toBe('product.swap')
    expect(matchBinding(key('0', { ctrl: true }, 'Digit0'), false)).toBeNull()
  })

  it('single keys never fire inside a text field', () => {
    expect(matchBinding(key(']'), false)?.id).toBe('view.next')
    expect(matchBinding(key(']'), true)).toBeNull()
    expect(matchBinding(key('?', { shift: true }), true)).toBeNull()
    expect(matchBinding(key('k', { ctrl: true }), true)?.id).toBe('palette')
  })

  it('a plain letter with Shift is not its Ctrl binding', () => {
    expect(matchBinding(key('K', { ctrl: true, shift: true }), false)).toBeNull()
  })
})

describe('no hint without a binding', () => {
  const allHints = new Set(BINDINGS.flatMap((b) => b.combos.map(comboText)))
  for (const current of ['jarvis', 'ww'] as const) {
    it(`${current}: every palette hint is the text of a real binding, and Ctrl+n hints sit on the current product only`, () => {
      const rows = [...goRows(['jarvis', 'ww'], current), ...shellRows(['jarvis', 'ww'])]
      for (const r of rows) {
        const h = hintOf(r)
        if (h === undefined) continue
        expect(allHints.has(h), `${r.id} shows "${h}"`).toBe(true)
      }
      const withSlot = rows.filter((r) => r.bindingId?.startsWith('slot.'))
      expect(withSlot.map((r) => r.go!.product)).toEqual(Array(5).fill(current))
      expect(withSlot.map((r) => hintOf(r))).toEqual(['Ctrl 1', 'Ctrl 2', 'Ctrl 3', 'Ctrl 4', 'Ctrl 5'])
    })
  }

  it('a row without a binding has no hint', () => {
    expect(hintFor('no.such.binding')).toBeUndefined()
    const views = goRows(['jarvis'], 'jarvis').filter((r) => r.id.split('.').length === 3)
    expect(views.length).toBeGreaterThan(0)
    expect(views.every((r) => hintOf(r) === undefined)).toBe(true)
  })

  it('a single-product build lists no swap row', () => {
    expect(shellRows(['jarvis']).some((r) => r.bindingId === 'product.swap')).toBe(false)
  })
})

describe('routes, filters and the frame mapping', () => {
  it('parses #/<section>/<view> and falls back to the first view', () => {
    expect(parseRoute('#/study/practice')).toEqual({ product: 'ww', section: 'study', view: 'practice' })
    expect(parseRoute('#/room/nope')).toEqual({ product: 'jarvis', section: 'room', view: 'switches' })
    expect(parseRoute('#t=abc')).toBeNull()
    expect(homeOf('ww')).toEqual({ product: 'ww', section: 'day', view: 'today' })
  })

  it('filters keep order and pages hold seven rows', () => {
    const rows = goRows(['jarvis'], 'jarvis')
    expect(filterRows(rows, 'console').every((r) => /console/i.test(r.label))).toBe(true)
    expect(PAGE_ROWS).toBe(7)
    expect([pageOf(0), pageOf(6), pageOf(7), pageOf(13), pageOf(14)]).toEqual([0, 0, 1, 1, 2])
  })

  it('a jump inside the Well Wisher frame maps back to a shell view', () => {
    expect(placeOfFrame('focus', 'drill')).toBe('focus.drill') // D-V2-11: Drill lives in Focus
    expect(placeOfFrame('study', 'library')).toBe('study.library')
    expect(placeOfFrame('tree', null)).toBe('tree.tree')
    expect(placeOfFrame('career', 'plan')).toBe('career.ladder')
    expect(placeOfFrame('life', 'unknown')).toBe('day.today')
  })
})
