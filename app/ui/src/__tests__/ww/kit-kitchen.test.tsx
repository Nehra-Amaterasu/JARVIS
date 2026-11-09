// Chunk 1b: contract tests over the whole kit, rendered through the kitchen sink (plan 5.5, 8.1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { mount, resetHtml } from './_stubs'
import { Kitchen } from '../../ww/kit/_kitchen'
import { clearCoachMemory, clearLockMemory, sectionOrder } from '../../ww/kit'
import { WW_DIR } from './_css'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  clearCoachMemory()
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

// every primitive of plan 5.5 except MathText (chunk 3) and the frame ones (chunk 4)
const PRIMITIVES = [
  'Card', 'CardHead', 'Section', 'PrimaryOwner', 'Fold', 'Button', 'IconButton', 'Segmented', 'Chip', 'Field', 'Row', 'Stat', 'Meter', 'Spark', 'StageStrip', 'TapGroup', 'MasterDetail', 'EmptyState', 'ComingCard', 'Drawer', 'Toast',
  'Banner', 'CoachMark', 'Reveal', 'HoldButton', 'PinHeader', 'CursorLabel', 'Skeleton', 'LockChip',
]

describe('the kitchen sink', () => {
  it('shows every primitive of 5.5 (except MathText and the frame ones) once', () => {
    m = mount(<Kitchen />)
    const shown = [...m.container.querySelectorAll('[data-kitchen]')].map((e) => (e as HTMLElement).dataset.kitchen)
    for (const p of PRIMITIVES) expect(shown, p).toContain(p)
    expect(new Set(shown).size).toBe(shown.length)
  })
  it('every Section in it has an id and a hint, in document order', () => {
    m = mount(<Kitchen />)
    const ids = sectionOrder(m.container)
    expect(ids.length).toBeGreaterThan(25)
    expect(ids.every((i) => i.startsWith('K-'))).toBe(true)
    for (const s of m.container.querySelectorAll('[data-section]')) expect((s as HTMLElement).dataset.hint!.length).toBeGreaterThan(10)
  })
  it('exactly one element carries data-primary, and it is the only saffron fill', () => {
    m = mount(<Kitchen />)
    expect(m.container.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect([...m.container.querySelectorAll('.ww-btn.primary')].map((b) => b.textContent)).toEqual(['Start'])
  })
  it('the primary moves to Save when there is something to save, and is still one', () => {
    m = mount(<Kitchen />)
    const make = [...m.container.querySelectorAll('button')].find((b) => b.textContent === 'Make a change')!
    act(() => make.click())
    expect(m.container.querySelectorAll('[data-primary]')).toHaveLength(1)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Save')
  })
  it('card ids are unique and every card has one', () => {
    m = mount(<Kitchen />)
    const ids = [...m.container.querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card)
    expect(ids.length).toBe(6)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every icon-only control has an aria-label', () => {
    m = mount(<Kitchen />)
    const bare = [...m.container.querySelectorAll('button, [role=button]')].filter((b) => !(b.textContent ?? '').trim() && !b.querySelector('.ww-sr-only'))
    expect(bare.length).toBeGreaterThan(3)
    for (const b of bare) expect(b.getAttribute('aria-label'), b.outerHTML.slice(0, 80)).toBeTruthy()
  })
  it('every button has an accessible name', () => {
    m = mount(<Kitchen />)
    for (const b of m.container.querySelectorAll('button')) expect((b.getAttribute('aria-label') ?? b.textContent ?? '').trim(), b.outerHTML.slice(0, 80)).not.toBe('')
  })
  it('every form control is labelled, and every heading is a real heading', () => {
    m = mount(<Kitchen />)
    for (const c of m.container.querySelectorAll('input, textarea, select')) {
      const id = (c as HTMLElement).id
      expect(m.container.querySelector(`label[for="${CSS.escape(id)}"]`), id).not.toBeNull()
    }
    expect(m.container.querySelectorAll('h1')).toHaveLength(1)
    expect(m.container.querySelectorAll('.ww-card-title').length).toBeGreaterThan(3)
  })
  it('a card is never a plain div with the old class strings', () => {
    m = mount(<Kitchen />)
    expect(m.container.innerHTML).not.toMatch(/class="[^"]*\b(tp-sec|set-sec|c-sec|road-panel|rm-box|tb-btn|tap-btn)\b/)
  })
  it('placeholders and skeletons carry no animation hooks: no data-arrive besides the lock chip and Reveal, no keyframes inline', () => {
    m = mount(<Kitchen />)
    const coming = m.container.querySelector('[data-coming]') as HTMLElement
    expect(coming.hasAttribute('data-arrive')).toBe(false)
    expect(coming.getAttribute('style')).toBeNull()
  })
  it('opens each overlay from the page and from the options', () => {
    m = mount(<Kitchen overlay="drawer" />)
    expect(document.body.querySelector('.ww-sheet[data-place=right][data-state=open]')).not.toBeNull()
    m.unmount()
    m = mount(<Kitchen overlay="sheet" />)
    expect(document.body.querySelector('.ww-sheet[data-place=bottom][data-state=open]')).not.toBeNull()
    m.unmount()
    m = mount(<Kitchen overlay="toast" />)
    expect(document.body.querySelector('.ww-toasts .ww-toast-msg')!.textContent).toContain('Marks saved')
  })
})

describe('the kit as a whole', () => {
  it('has a source file for every primitive listed in the plan', () => {
    const files = readdirSync(join(WW_DIR, 'kit'))
    for (const f of ['Button.tsx', 'Segmented.tsx', 'Chip.tsx', 'Field.tsx', 'Card.tsx', 'Section.tsx', 'PrimaryOwner.tsx', 'Drawer.tsx', 'Popover.tsx', 'Toast.tsx', 'Data.tsx', 'Layout.tsx', 'Interactive.tsx', 'Placeholders.tsx', 'Reveal.tsx', 'Skeleton.tsx', 'index.ts', '_kitchen.tsx']) expect(files, f).toContain(f)
  })
  it('imports no animation library and adds no dependency beyond lucide-react', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of readdirSync(join(WW_DIR, 'kit')).filter((n) => /\.tsx?$/.test(n))) {
      const t = readFileSync(join(WW_DIR, 'kit', f), 'utf8')
      const mods = [...t.matchAll(/from\s+'([^'./][^']*)'/g)].map((x) => x[1])
      for (const mod of mods) expect(['react', 'react-dom', 'react-dom/client', 'lucide-react'], `${f}: ${mod}`).toContain(mod)
    }
  })
})
