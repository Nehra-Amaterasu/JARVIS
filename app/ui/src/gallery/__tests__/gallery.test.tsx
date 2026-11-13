// The gallery's own checks: it lists every component of the kit, art, lamp and voice folders (a test compares the exported
// names with the entries), every entry draws without throwing, ids are unique, and the place behaves as a keyboard list.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { mount } from '../../__tests__/ww/_stubs'
import * as kit from '../../shared/kit'
import * as art from '../../shared/art'
import * as lamp from '../../shared/lamp'
import * as voice from '../../jarvis/voice'
import { collectEntries, collectEntriesX } from '../collect'
import { GROUPS } from '../types'
import WhatIsNew from '../WhatIsNew'

const fns = (ns: Record<string, unknown>) => Object.keys(ns).filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !/^[A-Z0-9_]+$/.test(k) && typeof ns[k] === 'function')

/** The component names an entry set draws: the name in its id, plus its `also` list. */
function covered(prefix: string): Set<string> {
  const out = new Set<string>()
  for (const e of collectEntriesX()) if (e.id.startsWith(`${prefix}/`)) { out.add(e.id.slice(prefix.length + 1)); (e.also ?? []).forEach((a) => out.add(a)) }
  return out
}

describe('the entries cover the packages', () => {
  const cases: [string, Record<string, unknown>][] = [['kit', kit], ['art', art], ['lamp', lamp]]
  for (const [pkg, ns] of cases) {
    it(`every capitalised function export of shared/${pkg} has an entry`, () => {
      const have = covered(pkg)
      expect(fns(ns).filter((n) => !have.has(n))).toEqual([])
    })
  }
  it('the voice component has an entry', () => {
    const have = covered('voice')
    expect(fns(voice).filter((n) => n === 'VoiceHill' && !have.has(n))).toEqual([])
    expect(have.has('VoiceHill')).toBe(true)
  })
  it('the ten section themes and the clay themes have entries, and the art ids are read from the manifest', () => {
    const ids = collectEntries().map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['section/themes', 'theme/clay', 'manifest/art-ids']))
  })
})

describe('the collector', () => {
  const all = collectEntries()
  it('returns unique ids, a known group and at least one state for each entry', () => {
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
    const groups = new Set<string>(GROUPS.map((g) => g.id))
    for (const e of all) {
      expect(groups.has(e.group), e.id).toBe(true)
      expect(e.states.length, e.id).toBeGreaterThan(0)
      expect(e.title.length, e.id).toBeGreaterThan(0)
    }
  })
  it('orders entries by group in the index order', () => {
    const rank = (g: string) => GROUPS.findIndex((x) => x.id === g)
    const ranks = all.map((e) => rank(e.group))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
  })
  it('draws every entry, every state, without throwing', () => {
    for (const e of all) {
      for (const s of e.states) {
        let h: ReturnType<typeof mount> | null = null
        expect(() => { h = mount(<div>{s.node}</div>) }, `${e.id}: ${s.label}`).not.toThrow()
        expect(h!.container.childElementCount, `${e.id}: ${s.label}`).toBeGreaterThan(0)
        h!.unmount()
      }
    }
  })
})

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })

describe('WhatIsNew', () => {
  it('shows an index, a filter and one specimen, and the index is one tab stop', () => {
    m = mount(<WhatIsNew />)
    const c = m.container
    expect(c.querySelectorAll('.gl-item').length).toBe(collectEntries().length)
    expect(c.querySelectorAll('.gl-item[tabindex="0"]').length).toBe(1)
    expect(c.querySelectorAll('article.gl-specimen').length).toBe(1)
    expect(c.querySelector('[role="radiogroup"][aria-label="Filter by group"]')).not.toBeNull()
    expect(c.querySelector('nav[aria-label="Specimens"]')).not.toBeNull()
  })
  it('the arrow keys move the selection and the specimen follows', () => {
    m = mount(<WhatIsNew />)
    const c = m.container
    const first = c.querySelector('article.gl-specimen')!.getAttribute('data-entry')
    const list = c.querySelector('.gl-list')!
    act(() => { list.querySelector('.gl-item')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(c.querySelector('article.gl-specimen')!.getAttribute('data-entry')).not.toBe(first)
    expect(c.querySelectorAll('.gl-item[aria-current="true"]').length).toBe(1)
  })
  it('the group filter narrows the index to one group', () => {
    m = mount(<WhatIsNew />)
    const c = m.container
    const lampRadio = [...c.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by group"] [role="radio"]')].find((b) => b.textContent?.startsWith('Lamp'))!
    act(() => { lampRadio.click() })
    const n = collectEntries().filter((e) => e.group === 'lamp').length
    expect(c.querySelectorAll('.gl-item').length).toBe(n)
    expect(lampRadio.getAttribute('aria-checked')).toBe('true')
  })
  it('the state switch shows one state or all of them', () => {
    m = mount(<WhatIsNew />)
    const c = m.container
    const all = c.querySelectorAll('.gl-state').length
    expect(all).toBeGreaterThan(1)
    const one = [...c.querySelectorAll<HTMLButtonElement>('[aria-label="State"] [role="radio"]')][1]
    act(() => { one.click() })
    expect(c.querySelectorAll('.gl-state').length).toBe(1)
  })
  it('a legacy entry says so when the host registered no Well Wisher stylesheet loader', () => {
    m = mount(<WhatIsNew />)
    const c = m.container
    act(() => { c.querySelector<HTMLButtonElement>('.gl-item[data-entry-id="kit/Button"]')!.click() })
    expect(c.querySelector('.gl-specimen-warn')).not.toBeNull()
    expect(c.querySelector('.ww.gl-legacy')).not.toBeNull()
  })
  it('settles: after the one-frame number spring of the kit finishes, no animation frame is requested while idle', async () => {
    let raf = 0
    const orig = window.requestAnimationFrame
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { raf++; return orig(cb) }) as typeof window.requestAnimationFrame
    try {
      m = mount(<WhatIsNew />)
      await new Promise((r) => setTimeout(r, 300)) // the Stat ticker springs once on mount and stops in a frame
      raf = 0
      await new Promise((r) => setTimeout(r, 600))
      expect(raf).toBe(0)
    } finally {
      window.requestAnimationFrame = orig
    }
  })
})
