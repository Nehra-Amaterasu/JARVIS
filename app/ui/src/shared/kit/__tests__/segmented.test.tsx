// KIT1: Segmented, one test per pose (rest, hover, pressed, focus, checked, disabled), the keyboard path, the travelling thumb and the
// drag. A test DOM has no layout and no stylesheet, so the geometry is stubbed (four options of 80, 100, 120 and 90 px in a channel with
// 4 px of padding and 8 px gaps) and the poses that only CSS draws (hover, pressed, focus) are read from clay.css as text, the way
// src/__tests__/kit/kit-css.test.ts reads it: a pose is a rule that exists and differs from its neighbours. The pictures themselves
// are measured in a browser by e2e/kit-poses.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount, resetHtml, setHtml, stubMatchMedia } from '../../../__tests__/ww/_stubs'
import { Segmented } from '../Segmented'

const css = readFileSync(join(__dirname, '..', 'clay.css'), 'utf8').replace(/\r\n/g, '\n')
const motion = readFileSync(join(__dirname, '..', '..', 'motion', 'kit-motion.css'), 'utf8').replace(/\r\n/g, '\n')
/** The body (between the braces) of the first rule whose selector line contains `sel`. The clay rules are one line each or a short block. */
const rule = (sel: string): string => {
  const at = css.split('\n').findIndex((l) => l.includes(sel))
  if (at < 0) return ''
  const from = css.split('\n').slice(at).join('\n')
  return from.slice(from.indexOf('{') + 1, from.indexOf('}'))
}

const OPTS = [
  { id: 'a', label: 'Day' },
  { id: 'b', label: 'Week' },
  { id: 'c', label: 'Month', disabledReason: 'not built' },
  { id: 'd', label: 'Year' },
]
const WIDTHS = [80, 100, 120, 90]
const left = (i: number) => 4 + WIDTHS.slice(0, i).reduce((s, w) => s + w + 8, 0)

let m: ReturnType<typeof mount> | null = null
let restoreMq: (() => void) | null = null
const saved: [string, PropertyDescriptor | undefined][] = []
const stubLayout = () => {
  const optIndex = (el: HTMLElement) => (el.classList.contains('ww-seg-opt') ? [...(el.parentElement?.querySelectorAll('.ww-seg-opt') ?? [])].indexOf(el) : -1)
  const defs: Record<string, (el: HTMLElement) => unknown> = {
    offsetParent: (el) => (optIndex(el) >= 0 ? el.closest('.ww-seg') : null),
    offsetLeft: (el) => (optIndex(el) >= 0 ? left(optIndex(el)) : 0),
    offsetTop: (el) => (optIndex(el) >= 0 ? 4 : 0),
    offsetWidth: (el) => (optIndex(el) >= 0 ? WIDTHS[optIndex(el)] : 0),
    offsetHeight: (el) => (optIndex(el) >= 0 ? 44 : 0),
  }
  for (const [k, f] of Object.entries(defs)) {
    saved.push([k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)])
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get(this: HTMLElement) {
        return f(this)
      },
    })
  }
}
beforeEach(() => {
  restoreMq = stubMatchMedia({ 'hover: hover': true })
})
afterEach(() => {
  m?.unmount()
  m = null
  restoreMq?.()
  for (const [k, d] of saved.splice(0)) {
    if (d) Object.defineProperty(HTMLElement.prototype, k, d)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k]
  }
  resetHtml()
})

const radios = () => [...(m!.container.querySelectorAll('[role=radio]') as NodeListOf<HTMLElement>)]
const thumb = () => m!.container.querySelector('.ww-seg-thumb') as HTMLElement
const group = () => m!.container.querySelector('[role=radiogroup]') as HTMLElement
const seg = (name: string) => thumb().style.getPropertyValue(name)
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const click = (el: Element) => act(() => void (el as HTMLElement).click())
const pointer = (el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', clientX: number, extra: Record<string, unknown> = {}) =>
  act(() => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    for (const [k, v] of Object.entries({ clientX, clientY: 20, button: 0, pointerId: 1, pointerType: 'mouse', ...extra })) Object.defineProperty(e, k, { value: v })
    el.dispatchEvent(e)
  })

/** A page's own state around the control, so a pick changes the value the way it does in the app. */
function Harness({ options = OPTS, onPick }: { options?: typeof OPTS; onPick?: (id: string) => void }) {
  const [v, setV] = useState('a')
  return (
    <Segmented
      label="View"
      options={options}
      value={v}
      onChange={(id) => {
        onPick?.(id)
        setV(id)
      }}
    />
  )
}

describe('Segmented poses', () => {
  it('rest: a named radio group, one roving tab stop on the checked option, an unchecked option is plain', () => {
    m = mount(<Segmented label="View" options={OPTS} value="a" onChange={() => {}} />)
    expect(group().getAttribute('aria-label')).toBe('View')
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
    expect(rule(":root[data-theme^='clay'] .ww-seg-opt {")).toMatch(/background-color: transparent/)
  })

  it('hover: a PREVIEW rule for an unchecked option (lit face, full ink, 1 px up), which is neither the focus ring nor the accent fill', () => {
    const sel = ".ww-seg-opt:is(:hover, [data-demo='hover']):not([aria-checked='true'], [aria-disabled='true'])"
    const hover = rule(sel)
    expect(hover).toMatch(/--surface-raised-hi/)
    expect(hover).toMatch(/translateY\(-1px\)/)
    expect(hover).not.toMatch(/outline/)
    expect(hover).not.toMatch(/--k-on-fill/)
  })

  it('pressed: the face sinks (1 px down, 98 percent, the pressed shade) for unchecked and checked options alike', () => {
    expect(rule(".ww-seg-opt:is(:active, [data-demo='pressed']):not([aria-checked='true'], [aria-disabled='true'])")).toMatch(/translateY\(1px\) scale\(\.98\)[^;]*;\s*box-shadow: var\(--elev-pressed/)
    expect(rule(".ww-seg-opt[aria-checked='true']:is(:active, [data-demo='pressed'])")).toMatch(/translateY\(1px\) scale\(\.98\)/)
  })

  it('focus: focusing an option makes it the active element and the tab stop; the ring is the 2 px token ring at a 2 px offset', () => {
    m = mount(<Segmented label="View" options={OPTS} value="a" onChange={() => {}} />)
    act(() => radios()[0].focus())
    expect(document.activeElement).toBe(radios()[0])
    const ring = rule(".ww-seg-opt:is(:focus-visible, [data-demo='focus'])")
    expect(ring).toMatch(/outline: 2px solid var\(--focus-ring\)/)
    expect(ring).toMatch(/outline-offset: 2px/)
  })

  it('checked: aria-checked true, the accent fill and its ink, and the thumb sits under it', () => {
    stubLayout()
    m = mount(<Segmented label="View" options={OPTS} value="b" onChange={() => {}} />)
    expect(radios()[1].getAttribute('aria-checked')).toBe('true')
    const fill = rule(":root[data-theme^='clay'] .ww-seg-opt[aria-checked='true'] {")
    expect(fill).toMatch(/--k-on-fill/)
    expect(fill).toMatch(/--k-on-ink/)
    expect(group().getAttribute('data-thumb')).toBe('on')
    expect(seg('--seg-x')).toBe(`${left(1)}px`)
    expect(seg('--seg-w')).toBe('100px')
    expect(thumb().hasAttribute('data-moving')).toBe(false) // at rest it is not drawn: the checked option's own fill is the state
  })

  it('disabled with a reason: stays focusable, selects nothing, says why, and the thumb does not go there', () => {
    stubLayout()
    const on = vi.fn()
    m = mount(<Segmented label="View" options={OPTS} value="a" onChange={on} />)
    const dis = radios()[2]
    expect(dis.getAttribute('aria-disabled')).toBe('true')
    expect((dis as HTMLButtonElement).disabled).toBe(false)
    click(dis)
    expect(on).not.toHaveBeenCalled()
    expect(m.container.querySelector('[role=status]')!.textContent).toBe('Month: not built')
    expect(seg('--seg-x')).toBe(`${left(0)}px`)
  })

  it('no thumb without a measurable channel (a test DOM, a hidden tab): the checked option is drawn as before', () => {
    // the layout stubs are not installed here, so every width is 0
    m = mount(<Segmented label="View" options={OPTS} value="a" onChange={() => {}} />)
    expect(group().hasAttribute('data-thumb')).toBe(false)
    expect(css).toMatch(/\.ww-seg-thumb \{ display: none; \}/)
  })
})

describe('Segmented keyboard path and travel', () => {
  beforeEach(stubLayout)

  it('arrow keys select and the thumb TRAVELS to the new option (data-moving, new x and width); a disabled option is focused, never selected', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    expect(seg('--seg-x')).toBe(`${left(0)}px`)
    key(radios()[0], 'ArrowRight')
    expect(picks).toEqual(['b'])
    expect(radios()[1].getAttribute('aria-checked')).toBe('true')
    expect(thumb().getAttribute('data-moving')).toBe('true')
    expect(seg('--seg-x')).toBe(`${left(1)}px`)
    expect(seg('--seg-w')).toBe('100px')
    key(radios()[1], 'ArrowRight')
    expect(picks).toEqual(['b'])
    expect(document.activeElement).toBe(radios()[2])
    key(radios()[1], 'End')
    expect(picks).toEqual(['b', 'd'])
    expect(seg('--seg-x')).toBe(`${left(3)}px`)
    key(radios()[3], 'Home')
    expect(picks).toEqual(['b', 'd', 'a'])
    expect(seg('--seg-x')).toBe(`${left(0)}px`)
  })

  it('a click travels the same way as a key', () => {
    m = mount(<Harness />)
    click(radios()[1])
    expect(thumb().getAttribute('data-moving')).toBe('true')
    expect(seg('--seg-x')).toBe(`${left(1)}px`)
  })

  it("reduced motion (data-motion='calm'): the thumb jumps, it never travels", () => {
    setHtml({ 'data-motion': 'calm' })
    m = mount(<Harness />)
    key(radios()[0], 'ArrowRight')
    expect(radios()[1].getAttribute('aria-checked')).toBe('true')
    expect(thumb().hasAttribute('data-moving')).toBe(false)
    expect(seg('--seg-x')).toBe(`${left(1)}px`)
  })

  it('reduced motion (the OS flag): the same, and the kit timings collapse to 0 s in the token file for both switches', () => {
    restoreMq?.()
    restoreMq = stubMatchMedia({ 'prefers-reduced-motion': true, 'hover: hover': true })
    m = mount(<Harness />)
    key(radios()[0], 'ArrowRight')
    expect(thumb().hasAttribute('data-moving')).toBe(false)
    expect(motion).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-motion='full'\]\) \{[^}]*--dur-thumb: 0s/)
    expect(motion).toMatch(/:root\[data-motion='calm'\] \{[^}]*--dur-thumb: 0s/)
  })

  it('the travel is bound to the motion tokens: no literal duration or easing in the Segmented thumb rules', () => {
    const thumbCss = css.slice(css.indexOf('/* THE THUMB (KIT1)'), css.indexOf('/* Chip: a small low pill')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(thumbCss).toMatch(/transition: translate var\(--dur-thumb\) var\(--ease-thumb\)/)
    expect(thumbCss).not.toMatch(/\d\s*ms\b|cubic-bezier|ease-out|ease-in/)
    expect(motion).toMatch(/--dur-thumb: 180ms/) // inside the 240 ms of principle 5
    expect(motion).toMatch(/--ease-thumb: cubic-bezier\(0\.34, 1\.3, 0\.64, 1\)/) // the soft back curve: one overshoot, by construction
  })
})

describe('Segmented drag (desktop pointer, three or more options)', () => {
  beforeEach(stubLayout)
  const carry = (by: number, extra: Record<string, unknown> = {}) => {
    pointer(radios()[0], 'pointerdown', 40, extra)
    pointer(group(), 'pointermove', 40 + by / 2, extra)
    pointer(group(), 'pointermove', 40 + by, extra)
    return () => pointer(group(), 'pointerup', 40 + by, extra)
  }

  it('dragging the thumb follows the pointer, and releasing over the 4th option snaps there', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    const release = carry(left(3) - left(0))
    expect(group().getAttribute('data-dragging')).toBe('true')
    expect(thumb().getAttribute('data-drag')).toBe('true')
    expect(seg('--seg-x')).toBe(`${left(3)}px`)
    expect(radios()[3].getAttribute('data-over')).toBe('true')
    release()
    expect(picks).toEqual(['d'])
    expect(radios()[3].getAttribute('aria-checked')).toBe('true')
    expect(group().hasAttribute('data-dragging')).toBe(false)
    expect(thumb().getAttribute('data-moving')).toBe('true') // it settles into the seat on the same transition a key uses
  })

  it('releasing over a disabled option selects nothing, says why, and the thumb goes back', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    const release = carry(left(2) - left(0))
    release()
    expect(picks).toEqual([])
    expect(radios()[0].getAttribute('aria-checked')).toBe('true')
    expect(m.container.querySelector('[role=status]')!.textContent).toBe('Month: not built')
    expect(seg('--seg-x')).toBe(`${left(0)}px`)
  })

  it('a small movement is a tap, not a drag', () => {
    m = mount(<Harness />)
    pointer(radios()[0], 'pointerdown', 40)
    pointer(group(), 'pointermove', 42)
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('two options keep tap: no drag starts', () => {
    m = mount(<Harness options={OPTS.slice(0, 2)} />)
    pointer(radios()[0], 'pointerdown', 40)
    pointer(group(), 'pointermove', 80)
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('a touch pointer keeps tap even with four options', () => {
    m = mount(<Harness />)
    pointer(radios()[0], 'pointerdown', 40, { pointerType: 'touch' })
    pointer(group(), 'pointermove', 140, { pointerType: 'touch' })
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('without a fine hovering pointer (a phone) there is no drag', () => {
    restoreMq?.()
    restoreMq = stubMatchMedia({ 'hover: hover': false })
    m = mount(<Harness />)
    pointer(radios()[0], 'pointerdown', 40)
    pointer(group(), 'pointermove', 140)
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('only the thumb is grabbed: a press on another option and a move is not a drag', () => {
    m = mount(<Harness />)
    pointer(radios()[1], 'pointerdown', 120)
    pointer(group(), 'pointermove', 200)
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })
})

describe('Segmented drag: focus, selection while dragging, and every way a drag can be cut short', () => {
  beforeEach(stubLayout)
  const down = (extra: Record<string, unknown> = {}) => pointer(radios()[0], 'pointerdown', 40, { buttons: 1, ...extra })
  const move = (by: number, extra: Record<string, unknown> = {}) => {
    pointer(group(), 'pointermove', 40 + by / 2, { buttons: 1, ...extra })
    pointer(group(), 'pointermove', 40 + by, { buttons: 1, ...extra })
  }

  it('aria-checked stays on the original option while dragging and moves only on release', () => {
    m = mount(<Harness />)
    down()
    move(left(3) - left(0))
    expect(group().getAttribute('data-dragging')).toBe('true')
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    pointer(group(), 'pointerup', 40 + left(3) - left(0), { buttons: 0 })
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true'])
  })

  it('after a committed drag the focus and the tab stop are on the same option, so the next arrow starts from it', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    radios()[0].focus()
    down()
    move(left(3) - left(0))
    pointer(group(), 'pointerup', 40 + left(3) - left(0), { buttons: 0 })
    expect(document.activeElement).toBe(radios()[3])
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0])
    key(document.activeElement!, 'ArrowRight') // from the checked option (d) it wraps to a; from the old one it would have gone to b
    expect(picks).toEqual(['d', 'a'])
  })

  it('a cancelled drag (pointercancel) changes nothing and leaves the focus where it was', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    radios()[0].focus()
    down()
    move(left(3) - left(0))
    pointer(group(), 'pointercancel', 40, { buttons: 0 })
    expect(picks).toEqual([])
    expect(group().hasAttribute('data-dragging')).toBe(false)
    expect(document.activeElement).toBe(radios()[0])
    expect(seg('--seg-x')).toBe(`${left(0)}px`)
  })

  it('Escape cancels a drag in progress', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    radios()[0].focus()
    down()
    move(left(3) - left(0))
    key(radios()[0], 'Escape')
    expect(group().hasAttribute('data-dragging')).toBe(false)
    pointer(group(), 'pointerup', 40 + left(3) - left(0), { buttons: 0 })
    expect(picks).toEqual([])
  })

  it('a move with the button already up ends the drag instead of following the hover (a release that never reached the channel)', () => {
    const picks: string[] = []
    m = mount(<Harness onPick={(id) => picks.push(id)} />)
    down()
    move(left(1) - left(0))
    expect(group().getAttribute('data-dragging')).toBe('true')
    pointer(group(), 'pointermove', 300, { buttons: 0 })
    expect(group().hasAttribute('data-dragging')).toBe(false)
    expect(picks).toEqual([])
    pointer(group(), 'pointermove', 400, { buttons: 0 })
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('a new press clears a leftover drag: a stale one cannot start by itself later', () => {
    m = mount(<Harness />)
    down()
    // no release ever arrives; a press on a non-thumb option replaces the stale state
    pointer(radios()[1], 'pointerdown', 120, { buttons: 1 })
    pointer(group(), 'pointermove', 220, { buttons: 1 })
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('options that shrink under a drag end it: nothing throws and nothing is chosen', () => {
    const picks: string[] = []
    function Shrinking() {
      const [n, setN] = useState(4)
      return (
        <>
          <button id="shrink" onClick={() => setN(3)} />
          <Harness options={OPTS.slice(0, n)} onPick={(id) => picks.push(id)} />
        </>
      )
    }
    m = mount(<Shrinking />)
    down()
    move(left(3) - left(0))
    expect(group().getAttribute('data-dragging')).toBe('true')
    click(m.container.querySelector('#shrink')!)
    expect(group().hasAttribute('data-dragging')).toBe(false)
    expect(() => pointer(group(), 'pointerup', 40 + left(3) - left(0), { buttons: 0 })).not.toThrow()
    expect(picks).toEqual([])
  })

  it('a value that is not among the options checks nothing: no thumb, no drag, the tab stop on the first option', () => {
    m = mount(<Segmented label="View" options={OPTS} value="zzz" onChange={() => {}} />)
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false'])
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1])
    expect(group().hasAttribute('data-thumb')).toBe(false)
    pointer(radios()[0], 'pointerdown', 40, { buttons: 1 })
    pointer(group(), 'pointermove', 140, { buttons: 1 })
    expect(group().hasAttribute('data-dragging')).toBe(false)
  })

  it('right-to-left: the arrow keys follow the reading direction', () => {
    const picks: string[] = []
    m = mount(
      <div dir="rtl">
        <Harness onPick={(id) => picks.push(id)} />
      </div>,
    )
    key(radios()[0], 'ArrowLeft')
    expect(picks).toEqual(['b'])
    key(radios()[1], 'ArrowRight')
    expect(picks).toEqual(['b', 'a'])
  })
})
