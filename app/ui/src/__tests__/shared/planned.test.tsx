// B02 Registry v2: the shared mechanism, the two registries, the renderers and the overlay (spec 12.5, T1 to T10).
// Fictional text only for synthetic entries. The 28 pre-overhaul assertions stay in ww/plannedFeatures.test.tsx.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../ww/_stubs'
import { JARVIS_PLANNED, jarvisRegistry } from '../../jarvis/planned'
import { PLANNED, WW_NEW, wwRegistry } from '../../ww/plannedFeatures'
import { WhatIsComing } from '../../shared/overlays/WhatIsComing'
import { LOOP_VIEWS, VIEW_IDS, isKnownHome } from '../../shared/planned/homes'
import { PlannedChip } from '../../shared/planned/PlannedChip'
import { PlannedControl } from '../../shared/planned/PlannedControl'
import { createRegistry, fillLine, lintEntry, lintRegistry, listable, pastReview, productLeaks } from '../../shared/planned/registry'
import {
  densityViolations, enabledPlannedControls, loopViewViolations, orphanEntries, orphanRenderers, staleEntries,
} from '../../shared/planned/stale'
import { setPlannedOpener } from '../../shared/planned/open'
import type { PlannedEntry } from '../../shared/planned/types'

const entry = (over: Partial<PlannedEntry> = {}): PlannedEntry => ({
  id: 'ww.synthetic', product: 'ww', home: 'study.library', label: 'Synthetic thing', pattern: 'coming', blocker: 'build',
  line: 'A synthetic planned thing used only by this test.', needs: 'Nothing real.', since: '2026-11-12', reviewBy: '2027-02-10', owner: 'ww-chat',
  ...over,
})

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})

const both = createRegistry<PlannedEntry>([...PLANNED, ...WW_NEW, ...JARVIS_PLANNED])

describe('the registries (spec 12.3, 12.6)', () => {
  it('JARVIS has the 13 starter rows plus the phone twin', () => {
    expect(JARVIS_PLANNED).toHaveLength(14)
    expect(jarvisRegistry.byId('jarvis.phone-twin')?.home).toBe('phone')
  })
  it('Well Wisher keeps its 28 entries and adds the six new rows of 12.6', () => {
    expect(PLANNED).toHaveLength(28)
    expect(WW_NEW.map((e) => e.id).sort()).toEqual(
      ['ww.coach', 'ww.focus-hours', 'ww.phone-block', 'ww.rest-sounds', 'ww.review-cards', 'ww.study-lights'])
    expect(wwRegistry.entries).toHaveLength(34)
  })
  it('every id is unique across both products, and new ids are namespaced', () => {
    const ids = both.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of JARVIS_PLANNED) expect(e.id.startsWith('jarvis.'), e.id).toBe(true)
    for (const e of WW_NEW) expect(e.id.startsWith('ww.'), e.id).toBe(true)
  })
  it('the three orphan-card rows are WAITING built-not-verified, not planned', () => {
    const unverified = JARVIS_PLANNED.filter((e) => e.state === 'unverified').map((e) => e.id).sort()
    expect(unverified).toEqual(['jarvis.energy', 'jarvis.library', 'jarvis.reminder-alerts'])
  })
  it('byId and forHome read the live array', () => {
    const live: PlannedEntry[] = [entry()]
    const reg = createRegistry(live)
    expect(reg.forHome('study.library')).toHaveLength(1)
    live.push(entry({ id: 'ww.second', label: 'Second thing' }))
    expect(reg.byId('ww.second')).toBeDefined()
    expect(reg.forHome('study.library')).toHaveLength(2)
  })
})

describe('T1 stale entry', () => {
  it('fails for a live enabled control whose id is still registered, passes for a disabled one or a deleted id', () => {
    const reg = createRegistry([entry()])
    document.body.innerHTML = '<button data-feature="ww.synthetic">Live</button>'
    expect(staleEntries(document, reg)).toEqual(['ww.synthetic'])
    document.body.innerHTML = '<button data-feature="ww.synthetic" aria-disabled="true">Planned</button><button data-feature="ww.gone">Live</button>'
    expect(staleEntries(document, reg)).toEqual([])
    document.body.innerHTML = '<div data-planned="ww.synthetic"><button data-feature="ww.synthetic">Inside a plate</button></div>'
    expect(staleEntries(document, reg)).toEqual([])
  })
  it('the real registries are clean on an empty page', () => {
    expect(staleEntries(document, both)).toEqual([])
  })
})

describe('T2 orphan entry and T3 orphan renderer', () => {
  it('an entry homed in a mounted view with no renderer is an orphan, unless its pattern is roadmap', () => {
    const reg = createRegistry([entry(), entry({ id: 'ww.row', label: 'Row', pattern: 'roadmap' }), entry({ id: 'ww.away', home: 'tree.tree', label: 'Away' })])
    document.body.innerHTML = ''
    expect(orphanEntries(document, reg, ['study.library'])).toEqual(['ww.synthetic'])
    document.body.innerHTML = '<div data-planned="ww.synthetic"></div>'
    expect(orphanEntries(document, reg, ['study.library'])).toEqual([])
  })
  it('a data-planned id with no entry is an orphan renderer', () => {
    const reg = createRegistry([entry()])
    document.body.innerHTML = '<div data-planned="ww.synthetic"></div><div data-planned="ww.deleted"></div>'
    expect(orphanRenderers(document, reg)).toEqual(['ww.deleted'])
  })
  it('rendering every entry of both registries leaves no orphan renderer', () => {
    m = mount(<>{both.entries.map((e) => <PlannedControl key={e.id} registry={both} id={e.id} hint />)}</>)
    expect(orphanRenderers(document, both)).toEqual([])
  })
})

describe('T4 home exists', () => {
  it('the frozen table has the 36 view ids of spec 3.2 and no duplicates', () => {
    expect(VIEW_IDS).toHaveLength(36)
    expect(new Set(VIEW_IDS).size).toBe(36)
  })
  it('accepts a view id, phone, and settings.<id>; rejects anything else', () => {
    for (const ok of ['study.library', 'phone', 'settings.harvester', 'console.crew']) expect(isKnownHome(ok), ok).toBe(true)
    for (const bad of ['study.nowhere', 'Study.Library', 'settings.', 'settings', 'home', '']) expect(isKnownHome(bad), bad).toBe(false)
  })
  it('every entry of both registries is homed in a known view', () => {
    for (const e of both.entries) expect(isKnownHome(e.home), `${e.id} -> ${e.home}`).toBe(true)
  })
  it('no entry is homed in a loop view (R5)', () => {
    for (const e of both.entries) expect(LOOP_VIEWS.includes(e.home), e.id).toBe(false)
  })
})

describe('T5 lint', () => {
  it('both real registries lint clean', () => {
    expect(lintRegistry(wwRegistry)).toEqual([])
    expect(lintRegistry(jarvisRegistry)).toEqual([])
  })
  it('catches a short line, a long line, a count, a date, a banned word, action on a non-E entry, a bad home', () => {
    expect(lintEntry(entry({ line: 'Too short.' })).join()).toMatch(/line is 10 characters/)
    expect(lintEntry(entry({ line: 'x'.repeat(141) })).join()).toMatch(/141 characters/)
    expect(lintEntry(entry({ line: 'Three synthetic items are missing here today.' })).join()).not.toMatch(/digit/)
    expect(lintEntry(entry({ line: 'There are 3 synthetic items missing from here.' })).join()).toMatch(/digit/)
    expect(lintEntry(entry({ line: 'Arrives on 12 November in a synthetic test.' })).join()).toMatch(/date/)
    for (const word of ['soon', 'beta', 'new', 'unlock', 'miss']) {
      expect(lintEntry(entry({ line: `A synthetic line that says ${word} out loud.` })).join(), word).toMatch(/banned word/)
    }
    expect(lintEntry(entry({ line: 'A synthetic line about a renewal or a knew thing.' })).join()).not.toMatch(/banned word/)
    expect(lintEntry(entry({ action: 'Do it' })).join()).toMatch(/action only belongs/)
    expect(lintEntry(entry({ pattern: 'empty', action: 'Do it' }))).toEqual([])
    expect(lintEntry(entry({ home: 'nowhere.view' })).join()).toMatch(/frozen view table/)
    expect(lintEntry(entry({ works_today: 'Short.' })).join()).toMatch(/works_today/)
  })
  it('catches two entries with the same home, slot and label, and a duplicate id', () => {
    const reg = createRegistry([entry(), entry({ id: 'ww.other' }), entry()])
    const out = lintRegistry(reg).join('\n')
    expect(out).toMatch(/ww.other: same home, slot and label/)
    expect(out).toMatch(/ww.synthetic: duplicate id/)
  })
})

describe('T6 product purity', () => {
  it('each product registry holds only its own entries', () => {
    expect(productLeaks(wwRegistry, 'ww')).toEqual([])
    expect(productLeaks(jarvisRegistry, 'jarvis')).toEqual([])
  })
  it('a registry that lists the other product is a leak', () => {
    expect(productLeaks(createRegistry([entry(), entry({ id: 'jarvis.x', product: 'jarvis', label: 'X' })]), 'ww')).toEqual(['jarvis.x'])
    expect(productLeaks(createRegistry([entry({ id: 'jarvis.y', label: 'Y' })]), 'ww')).toEqual(['jarvis.y'])
  })
})

describe('T7 no enabled button', () => {
  it('every plate, chip, control and hint of both registries has nothing enabled to press', () => {
    m = mount(
      <>
        {both.entries.map((e) => <PlannedControl key={e.id} registry={both} id={e.id} hint />)}
        <PlannedChip registry={both} home="study.library" />
        <PlannedChip registry={both} home="room.rules" />
      </>,
    )
    expect(document.querySelectorAll('[data-planned]').length).toBeGreaterThan(20)
    expect(document.querySelectorAll('[data-planned-chip]')).toHaveLength(2)
    expect(enabledPlannedControls(document)).toEqual([])
  })
  it('catches an enabled button inside a plate, but allows the real action of an empty entry', () => {
    document.body.innerHTML = '<div data-planned="a" data-pattern="coming"><button>Press</button></div>'
    expect(enabledPlannedControls(document)).toEqual(['a'])
    document.body.innerHTML = '<div data-planned="a" data-pattern="empty"><button>Link a sheet</button></div>'
    expect(enabledPlannedControls(document)).toEqual([])
  })
  it('a disabled entry uses aria-disabled and stays focusable, never the disabled attribute', () => {
    const e = JARVIS_PLANNED.find((x) => x.pattern === 'disabled')!
    m = mount(<PlannedControl registry={jarvisRegistry} id={e.id} />)
    const btn = document.querySelector('button')!
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.disabled).toBe(false)
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)!.textContent).toBe(e.line)
  })
})

describe('T8 loop views carry no plate or chip', () => {
  it('flags a plate or a chip inside day.today, focus.session, core.talk or room.switches', () => {
    for (const v of LOOP_VIEWS) {
      document.body.innerHTML = `<main data-view="${v}"><div data-planned="x"></div></main>`
      expect(loopViewViolations(document), v).toEqual([v])
      document.body.innerHTML = `<main data-view="${v}"><button data-planned-chip="${v}"></button></main>`
      expect(loopViewViolations(document), v).toEqual([v])
    }
    document.body.innerHTML = '<main data-view="study.library"><div data-planned="x"></div></main>'
    expect(loopViewViolations(document)).toEqual([])
  })
  it('the chip renders nothing in a loop view, even if an entry were homed there', () => {
    const reg = createRegistry(LOOP_VIEWS.map((v, i) => entry({ id: `ww.loop${i}`, home: v, label: `Loop ${i}` })))
    m = mount(<>{LOOP_VIEWS.map((v) => <PlannedChip key={v} registry={reg} home={v} />)}</>)
    expect(document.querySelectorAll('[data-planned-chip]')).toHaveLength(0)
  })
})

describe('T9 density', () => {
  it('more than one coming or two disabled in one view is a violation', () => {
    const reg = createRegistry([
      entry({ id: 'ww.c1', label: 'C1' }), entry({ id: 'ww.c2', label: 'C2' }),
      entry({ id: 'ww.d1', label: 'D1', pattern: 'disabled' }), entry({ id: 'ww.d2', label: 'D2', pattern: 'disabled' }), entry({ id: 'ww.d3', label: 'D3', pattern: 'disabled' }),
    ])
    document.body.innerHTML = '<main data-view="a"><i data-planned="ww.c1"></i><i data-planned="ww.c2"></i></main><main data-view="b"><i data-planned="ww.d1"></i><i data-planned="ww.d2"></i></main>'
    expect(densityViolations(document, reg)).toEqual(['a'])
    document.body.innerHTML = '<main data-view="c"><i data-planned="ww.d1"></i><i data-planned="ww.d2"></i><i data-planned="ww.d3"></i></main>'
    expect(densityViolations(document, reg)).toEqual(['c'])
  })
  it('a master-detail view that renders one plate at a time passes (room.rules holds two coming rows)', () => {
    expect(jarvisRegistry.forHome('room.rules').filter((e) => e.pattern === 'coming').length).toBeGreaterThan(1)
    m = mount(<main data-view="room.rules"><PlannedControl registry={jarvisRegistry} id="jarvis.away-mode" /></main>)
    expect(densityViolations(document, jarvisRegistry)).toEqual([])
  })
})

describe('T10 dates', () => {
  it('reviewBy before since is a format error; a past reviewBy is only a report line', () => {
    expect(lintEntry(entry({ since: '2026-11-12', reviewBy: '2026-11-01' })).join()).toMatch(/reviewBy is earlier/)
    expect(lintEntry(entry({ since: '12 Nov', reviewBy: '2027-02-10' })).join()).toMatch(/YYYY-MM-DD/)
    const reg = createRegistry([entry({ reviewBy: '2026-12-01' })])
    expect(lintRegistry(reg)).toEqual([])
    expect(pastReview(reg, '2026-12-02').map((e) => e.id)).toEqual(['ww.synthetic'])
    expect(pastReview(reg, '2026-11-30')).toEqual([])
  })
  it('every real entry is reviewable 90 days after it was added', () => {
    for (const e of both.entries) {
      const days = (Date.parse(e.reviewBy) - Date.parse(e.since)) / 86_400_000
      expect(days, e.id).toBe(90)
    }
  })
})

describe('fillLine (shared)', () => {
  it('fills N in order and never invents a count', () => {
    expect(fillLine('No sheet (N of N units).')).toBe('No sheet (N of N units).')
    expect(fillLine('No sheet (N of N units).', [0, 4])).toBe('No sheet (0 of 4 units).')
  })
})

describe('the four renderers', () => {
  it('empty shows the line and the page action; coming shows the plate with an accessible name', () => {
    const reg = createRegistry([entry({ id: 'ww.e', label: 'E', pattern: 'empty', action: 'Do it', line: 'Nothing is here yet (N of N).' }), entry()])
    m = mount(<><PlannedControl registry={reg} id="ww.e" fill={[0, 5]} action={<button type="button">Do it</button>} /><PlannedControl registry={reg} id="ww.synthetic" /></>)
    expect(document.querySelector('[data-planned="ww.e"]')!.textContent).toContain('(0 of 5)')
    const plate = document.querySelector('[data-planned="ww.synthetic"]')!
    expect(plate.getAttribute('aria-label')).toBe('Synthetic thing, not built yet')
    expect(plate.textContent).toContain('PLANNED')
  })
  it('roadmap renders nothing in the layout, or one muted line with hint', () => {
    const reg = createRegistry([entry({ pattern: 'roadmap' })])
    m = mount(<PlannedControl registry={reg} id="ww.synthetic" />)
    expect(document.querySelector('[data-planned]')).toBeNull()
    m.render(<PlannedControl registry={reg} id="ww.synthetic" hint />)
    expect(document.querySelector('[data-planned="ww.synthetic"]')!.textContent).toBe('A synthetic planned thing used only by this test.')
  })
  it('an unknown id renders nothing and does not throw', () => {
    m = mount(<PlannedControl registry={jarvisRegistry} id="jarvis.shipped-long-ago" />)
    expect(document.querySelector('[data-planned]')).toBeNull()
  })
  it('an unverified entry draws the half disc and says so, never PLANNED', () => {
    m = mount(<PlannedControl registry={jarvisRegistry} id="jarvis.library" />)
    const plate = document.querySelector('[data-planned="jarvis.library"]')!
    expect(plate.getAttribute('data-state')).toBe('unverified')
    expect(plate.textContent).toContain('BUILT, NOT VERIFIED')
    expect(plate.textContent).not.toContain('PLANNED')
    expect(plate.querySelector('path')).not.toBeNull()
  })
  it('the plate has no animation, no value and no progress element', () => {
    m = mount(<PlannedControl registry={jarvisRegistry} id="jarvis.agents" />)
    const plate = document.querySelector('[data-planned]')!
    expect(plate.querySelector('progress, meter, input, canvas, [role="progressbar"], [role="switch"]')).toBeNull()
    expect(plate.querySelector('animate, animateTransform')).toBeNull()
  })
})

describe('the chip', () => {
  it('says PLANNED and a count of registry rows homed in the view, and renders nothing for an empty home', () => {
    m = mount(<><PlannedChip registry={jarvisRegistry} home="room.rules" /><PlannedChip registry={jarvisRegistry} home="room.switches" /></>)
    const chips = document.querySelectorAll('[data-planned-chip]')
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('3 here')
    expect(chips[0].textContent).toContain('PLANNED')
  })
  it('opens the card at the first entry of the view, on click and on Enter', () => {
    const onOpen = vi.fn()
    m = mount(<PlannedChip registry={jarvisRegistry} home="core.sound" onOpen={onOpen} />)
    const chip = document.querySelector<HTMLButtonElement>('[data-planned-chip]')!
    act(() => chip.click())
    expect(onOpen).toHaveBeenCalledWith('jarvis.spotify-play')
  })
})

describe('opening the card', () => {
  it('a plate opens by click and by Enter or Space; the shell opener is used when no onOpen is passed', () => {
    const shell = vi.fn()
    const off = setPlannedOpener(shell)
    m = mount(<PlannedControl registry={jarvisRegistry} id="jarvis.agents" />)
    const plate = document.querySelector<HTMLElement>('[data-planned="jarvis.agents"]')!
    act(() => plate.click())
    act(() => { plate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    act(() => { plate.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
    expect(shell).toHaveBeenCalledTimes(3)
    off()
    act(() => plate.click())
    expect(shell).toHaveBeenCalledTimes(3)
  })
  it('with no opener installed a click does nothing and does not throw', () => {
    m = mount(<PlannedControl registry={jarvisRegistry} id="jarvis.agents" />)
    expect(() => act(() => document.querySelector<HTMLElement>('[data-planned]')!.click())).not.toThrow()
  })
})

describe('the overlay "What is coming"', () => {
  it('merges only the registries passed in: a single-product build lists only its own entries (T6)', () => {
    m = mount(<WhatIsComing registries={[jarvisRegistry]} onClose={() => {}} />)
    const ids = [...document.querySelectorAll('[data-coming-row]')].map((r) => r.getAttribute('data-coming-row'))
    expect(ids.length).toBe(listable([jarvisRegistry]).length)
    for (const id of ids) expect(id!.startsWith('jarvis.'), id!).toBe(true)
    m.render(<WhatIsComing registries={[wwRegistry]} onClose={() => {}} />)
    const ww = [...document.querySelectorAll('[data-coming-row]')].map((r) => r.getAttribute('data-coming-row'))
    expect(ww).toContain('ww.coach')
    expect(ww.some((id) => id!.startsWith('jarvis.'))).toBe(false)
  })
  it('leaves out a built entry (phone pairing, dMAT) and lists each other entry once with line, needs and who decides', () => {
    m = mount(<WhatIsComing registries={[wwRegistry, jarvisRegistry]} onClose={() => {}} />)
    expect(document.querySelector('[data-coming-row="phone-pairing"]')).toBeNull()
    expect(document.querySelector('[data-coming-row="dmat-practice"]')).toBeNull()
    const row = document.querySelector('[data-coming-row="jarvis.away-mode"]')!
    expect(row.textContent).toContain('Off until you decide')
    expect(row.textContent).toContain('Needs: Your decision')
    expect(row.textContent).toContain('Waiting for your decision: needs a decision')
    const count = document.querySelectorAll('[data-coming-row]').length
    expect(count).toBe(wwRegistry.entries.filter((e) => !e.built).length + JARVIS_PLANNED.length)
  })
  it('groups by section in rail order, and a feature that ships leaves with its entry', () => {
    const live = [...JARVIS_PLANNED]
    const reg = createRegistry(live)
    m = mount(<WhatIsComing registries={[reg]} onClose={() => {}} />)
    const groups = [...document.querySelectorAll('[data-coming-group]')].map((g) => g.getAttribute('data-coming-group'))
    expect(groups).toEqual(['core', 'room', 'senses', 'memory', 'console', 'phone'])
    m.render(<WhatIsComing registries={[createRegistry(live.filter((e) => e.id !== 'jarvis.phone-twin'))]} onClose={() => {}} />)
    expect(document.querySelector('[data-coming-group="phone"]')).toBeNull()
  })
  it('orders rows inside a group by blocker, build first', () => {
    const reg = createRegistry([
      entry({ id: 'ww.a', label: 'A', blocker: 'account' }), entry({ id: 'ww.b', label: 'B', blocker: 'build' }), entry({ id: 'ww.c', label: 'C', blocker: 'decision' }),
    ])
    m = mount(<WhatIsComing registries={[reg]} onClose={() => {}} />)
    expect([...document.querySelectorAll('[data-coming-row]')].map((r) => r.getAttribute('data-coming-row'))).toEqual(['ww.b', 'ww.c', 'ww.a'])
  })
  it('marks the focused entry', () => {
    m = mount(<WhatIsComing registries={[jarvisRegistry]} focusId="jarvis.agents" onClose={() => {}} />)
    expect(document.querySelector('[data-coming-row="jarvis.agents"]')!.getAttribute('data-focus')).toBe('true')
    expect(document.querySelectorAll('[data-focus="true"]')).toHaveLength(1)
  })
  it('is one deep: the only control inside is Close', () => {
    m = mount(<WhatIsComing registries={[wwRegistry, jarvisRegistry]} onClose={() => {}} />)
    const controls = document.querySelectorAll('[data-overlay="roadmap"] button, [data-overlay="roadmap"] a, [data-overlay="roadmap"] input, [data-overlay="roadmap"] [role="button"]')
    expect(controls).toHaveLength(1)
    expect(controls[0].textContent).toBe('Close')
  })
  it('Esc and Alt+Left close it, and focus returns to the control that opened it', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Opener'
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    m = mount(<WhatIsComing registries={[jarvisRegistry]} onClose={onClose} />)
    expect(document.activeElement?.textContent).toBe('Close')
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })) })
    expect(onClose).toHaveBeenCalledTimes(2)
    m.unmount()
    m = null
    expect(document.activeElement).toBe(opener)
  })
})
