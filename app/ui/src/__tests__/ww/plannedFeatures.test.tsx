// Chunk 5: the carcass registry (plan 7, 8.1 "Overlays and roadmap"). Fictional text only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, resetHtml } from './_stubs'
import { clearLockMemory } from '../../ww/kit'
import { Planned } from '../../ww/Planned'
import { LINE_MAX, LINE_MIN, PLANNED, fillLine, plannedById, plannedFor, staleEntries, type Pattern } from '../../ww/plannedFeatures'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  clearLockMemory()
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

describe('registry coverage (plan 7)', () => {
  it('has all 28 entries, with unique ids', () => {
    expect(PLANNED).toHaveLength(28)
    expect(new Set(PLANNED.map((p) => p.id)).size).toBe(28)
  })
  it('plan items 7 to 19 appear once each, and no other row carries an item number', () => {
    const items = PLANNED.filter((p) => p.planItem !== undefined).map((p) => p.planItem)
    expect(items.slice().sort((a, b) => a! - b!)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(PLANNED.filter((p) => p.planItem === undefined)).toHaveLength(15)
  })
  it(`every line is ${LINE_MIN} to ${LINE_MAX} characters, and every entry names what it needs`, () => {
    for (const p of PLANNED) {
      expect(p.line.length, p.id).toBeGreaterThanOrEqual(LINE_MIN)
      expect(p.line.length, p.id).toBeLessThanOrEqual(LINE_MAX)
      expect(p.needs.trim().length, p.id).toBeGreaterThan(0)
    }
  })
  it('no two entries claim the same page and section with the same label', () => {
    const keys = PLANNED.map((p) => `${p.page}|${p.section}|${p.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('every entry has a build chunk, a known pattern, and an action label only on an empty state', () => {
    const patterns: Pattern[] = ['empty', 'disabled', 'coming', 'roadmap']
    for (const p of PLANNED) {
      expect(patterns, p.id).toContain(p.pattern)
      expect(p.chunk, p.id).toBeTruthy()
      if (p.action !== undefined) expect(p.pattern, p.id).toBe('empty')
    }
  })
  it('no line reads as a measured number: digits appear only in a named unit (4-week) and never as a count', () => {
    for (const p of PLANNED) expect(p.line.replace(/\bGATE\b|\bCIE\b|\b4-week\b/g, ''), p.id).not.toMatch(/\d/)
  })
  it('plannedFor finds the entries of a section; plannedById finds one', () => {
    expect(plannedFor('C1', 'S3').map((p) => p.id).sort()).toEqual(['cie-practice', 'drafted-questions', 'gate-tier', 'paste-paper', 'parameterised-numericals'].sort())
    expect(plannedById('sharpen')?.planItem).toBe(8)
    expect(plannedById('nope')).toBeUndefined()
  })
})

describe('fillLine', () => {
  it('replaces each N in order with live values, leaves N alone without them, ignores extras', () => {
    expect(fillLine('No sheet (N of N units).')).toBe('No sheet (N of N units).')
    expect(fillLine('No sheet (N of N units).', [0, 4])).toBe('No sheet (0 of 4 units).')
    expect(fillLine('One N here', [3, 9])).toBe('One 3 here')
    expect(fillLine('Only 1 N', [])).toBe('Only 1 N')
  })
})

describe('the four patterns render', () => {
  const pick = (pattern: Pattern) => PLANNED.find((p) => p.pattern === pattern && p.id !== 'phone-pairing')
  it('empty: the line and the page-supplied real action', () => {
    const e = PLANNED.find((p) => p.pattern === 'empty')!
    m = mount(<Planned id={e.id} action={<button type="button">{e.action}</button>} />)
    const box = document.querySelector(`[data-planned="${e.id}"]`)!
    expect(box.getAttribute('data-pattern')).toBe('empty')
    expect(box.textContent).toContain(fillLine(e.line))
    expect(box.querySelector('button')!.textContent).toBe(e.action)
  })
  it('empty without an action shows the line and no button', () => {
    m = mount(<Planned id="proficiency" />)
    expect(document.querySelector('[data-planned="proficiency"]')!.textContent).toContain('not measured until you mark a paper')
    expect(document.querySelectorAll('button')).toHaveLength(0)
  })
  it('empty fills its N tokens from live data', () => {
    m = mount(<Planned id="sheets-rewritten" fill={[0, 5]} action={<button type="button">Link a sheet</button>} />)
    expect(document.querySelector('[data-planned="sheets-rewritten"]')!.textContent).toContain('(0 of 5 units)')
  })
  it('disabled: a focusable aria-disabled button with the reason as text beside it (not the disabled attribute)', () => {
    const e = pick('disabled')!
    m = mount(<Planned id={e.id} />)
    const btn = document.querySelector(`[data-planned="${e.id}"] button`) as HTMLButtonElement
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.disabled).toBe(false)
    const reason = document.getElementById(btn.getAttribute('aria-describedby')!)!
    expect(reason.textContent).toBe(e.line)
  })
  it('coming: the kit ComingCard fed from the entry (no entry uses it today, so a synthetic one proves the path)', () => {
    const synthetic = { id: 'synthetic-coming', page: 'C1', section: 'S1', label: 'Synthetic', pattern: 'coming', line: 'Synthetic coming card with a fifteen character line.', needs: 'nothing', chunk: '0' }
    ;(PLANNED as unknown as unknown[]).push(synthetic)
    try {
      m = mount(<Planned id="synthetic-coming" />)
      const card = document.querySelector('[data-coming="synthetic-coming"]')!
      expect(card.textContent).toContain('Synthetic coming card')
      expect(card.getAttribute('aria-label')).toBe('Synthetic, not built yet')
    } finally {
      ;(PLANNED as unknown as unknown[]).pop()
    }
  })
  it('roadmap: nothing in the layout, or one muted line with hint', () => {
    const e = pick('roadmap')!
    m = mount(<Planned id={e.id} />)
    expect(document.querySelector('[data-planned]')).toBeNull()
    m.render(<Planned id={e.id} hint />)
    const hint = document.querySelector(`[data-planned="${e.id}"]`)!
    expect(hint.textContent).toBe(e.line)
    expect(hint.querySelector('button')).toBeNull()
  })
  it('an id that was deleted renders nothing and does not throw', () => {
    m = mount(<Planned id="shipped-long-ago" />)
    expect(document.querySelector('[data-planned]')).toBeNull()
  })
})

describe('placeholders are not features', () => {
  it('no placeholder has an enabled button (other than an empty state action), the accent class or a primary mark', () => {
    m = mount(
      <>
        {PLANNED.map((p) => (
          <Planned key={p.id} id={p.id} hint />
        ))}
      </>,
    )
    const planned = [...document.querySelectorAll('[data-planned]')]
    expect(planned.length).toBeGreaterThan(10)
    for (const el of planned) {
      for (const b of el.querySelectorAll('button')) expect(b.getAttribute('aria-disabled'), el.getAttribute('data-planned') ?? '').toBe('true')
      expect(el.querySelector('.primary, [data-primary], [data-has-primary]')).toBeNull()
      expect(el.matches('.primary, [data-primary]')).toBe(false)
    }
  })
  it('placeholders rendered all at once: each entry id appears at most once', () => {
    m = mount(
      <>
        {PLANNED.map((p) => (
          <Planned key={p.id} id={p.id} hint />
        ))}
      </>,
    )
    const ids = [...document.querySelectorAll('[data-planned]')].map((e) => e.getAttribute('data-planned'))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('stale placeholders', () => {
  it('passes while no live control carries a registered feature id', () => {
    m = mount(<Planned id="sharpen" />)
    expect(staleEntries()).toEqual([])
  })
  it('fails when a section holds a live control for a feature whose entry is still registered', () => {
    m = mount(
      <div data-page="C2" data-section="T3">
        <button type="button" data-feature="sharpen">Sharpen</button>
        <Planned id="sharpen" />
      </div>,
    )
    expect(staleEntries()).toEqual(['sharpen'])
  })
  it('a disabled control with the tag (the placeholder itself) is not stale, and neither is a deleted id', () => {
    m = mount(
      <div>
        <button type="button" data-feature="sharpen" aria-disabled="true">Sharpen</button>
        <button type="button" data-feature="a-feature-already-deleted">Live</button>
      </div>,
    )
    expect(staleEntries()).toEqual([])
  })
})
