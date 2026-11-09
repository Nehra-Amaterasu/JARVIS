// Chunk 1b, group 3: Drawer, Sheet, Popover, Toast (plan 5.5, 5.7.3 #3, 5.7.6).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createRef, useRef, useState } from 'react'
import { mount, resetHtml } from './_stubs'
import { Drawer, Popover, Sheet, Toast, ToastStack, TOAST_MS } from '../../ww/kit'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  resetHtml()
  document.body.innerHTML = ''
})
const click = (el: Element) => act(() => (el as HTMLElement).click())
const key = (k: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })))
const panel = () => document.body.querySelector('.ww-sheet') as HTMLElement
const adv = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('Drawer', () => {
  it('renders nothing until it has been opened once', () => {
    m = mount(<Drawer open={false} onClose={() => {}} title="Settings" />)
    expect(document.body.querySelector('.ww-sheet')).toBeNull()
  })
  it('portals to <body> as a modal dialog named by its heading, inside .ww-portal', () => {
    m = mount(<Drawer open onClose={() => {}} title="Settings">body</Drawer>)
    const p = panel()
    expect(p.closest('.ww-portal')!.parentElement).toBe(document.body)
    expect(m.container.contains(p)).toBe(false)
    expect(p.getAttribute('role')).toBe('dialog')
    expect(p.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(p.getAttribute('aria-labelledby')!)!.textContent).toBe('Settings')
    expect(p.dataset.state).toBe('open')
    expect(document.body.querySelector('.ww-scrim')!.getAttribute('data-state')).toBe('open')
  })
  it('make the rest of the page inert while open and release it on close', () => {
    vi.useFakeTimers()
    m = mount(<Drawer open onClose={() => {}} title="S" />)
    expect(m.container.hasAttribute('inert')).toBe(true)
    expect(panel().closest('.ww-portal')!.hasAttribute('inert')).toBe(false)
    m.render(<Drawer open={false} onClose={() => {}} title="S" />)
    adv(250)
    expect(m.container.hasAttribute('inert')).toBe(false)
  })
  it('exits through closing (200 ms), then parks inert and hidden, and stays mounted', () => {
    vi.useFakeTimers()
    m = mount(<Drawer open onClose={() => {}} title="S" />)
    m.render(<Drawer open={false} onClose={() => {}} title="S" />)
    expect(panel().dataset.state).toBe('closing')
    expect(panel().hasAttribute('inert')).toBe(false)
    adv(201)
    expect(panel().dataset.state).toBe('closed')
    expect(panel().hasAttribute('inert')).toBe(true) // never only pointer-events: none
  })
  it('Esc closes it; and only the top of two stacked overlays', () => {
    const a = vi.fn()
    const b = vi.fn()
    m = mount(
      <div>
        <Drawer open onClose={a} title="Lower" />
        <Drawer open onClose={b} title="Upper" />
      </div>,
    )
    key('Escape')
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })
  it('the scrim and the close button close it; the close button is named', () => {
    const on = vi.fn()
    m = mount(<Drawer open onClose={on} title="Reader" />)
    click(document.body.querySelector('.ww-scrim')!)
    click(document.body.querySelector('button[aria-label="Close Reader"]')!)
    expect(on).toHaveBeenCalledTimes(2)
  })
  it('moves focus in on open (first control that is not Close) and back to the opener on close', () => {
    vi.useFakeTimers()
    const Page = () => {
      const [o, setO] = useState(false)
      return (
        <div>
          <button id="opener" onClick={() => setO(true)}>
            Open
          </button>
          <Drawer open={o} onClose={() => setO(false)} title="Edit">
            <input id="first" />
          </Drawer>
        </div>
      )
    }
    m = mount(<Page />)
    const opener = m.container.querySelector('#opener') as HTMLElement
    act(() => opener.focus())
    click(opener)
    expect(document.activeElement!.id).toBe('first')
    key('Escape')
    adv(250)
    expect(document.activeElement).toBe(opener)
  })
  it('Tab wraps inside the panel in both directions', () => {
    m = mount(
      <Drawer open onClose={() => {}} title="T">
        <button id="a">a</button>
        <button id="z">z</button>
      </Drawer>,
    )
    const z = document.getElementById('z')!
    act(() => z.focus())
    key('Tab', z)
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Close T') // first focusable is the header's Close
    key('Tab', document.activeElement!, { shiftKey: true })
    expect(document.activeElement).toBe(z)
  })
  it('place is an attribute the CSS positions and animates from; Sheet defaults to bottom', () => {
    m = mount(
      <div>
        <Drawer open onClose={() => {}} title="L" place="left" />
        <Sheet open onClose={() => {}} title="B" />
      </div>,
    )
    expect([...document.body.querySelectorAll('.ww-sheet')].map((e) => (e as HTMLElement).dataset.place)).toEqual(['left', 'bottom'])
  })
  it('the header is flat and opaque: no glass class, no inline filter', () => {
    m = mount(<Drawer open onClose={() => {}} title="S" />)
    const head = document.body.querySelector('.ww-sheet-head') as HTMLElement
    expect(head.getAttribute('style')).toBeNull()
    expect(head.className).toBe('ww-sheet-head')
  })
})

describe('Popover', () => {
  const Host = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const ref = useRef<HTMLButtonElement>(null)
    return (
      <div>
        <button ref={ref} id="anchor">
          Day shape
        </button>
        <Popover open={open} onClose={onClose} anchor={ref} label="Day shape">
          <button id="inside">in</button>
        </Popover>
      </div>
    )
  }
  it('opens as a labelled dialog in a portal, placed below its anchor', () => {
    m = mount(<Host open onClose={() => {}} />)
    const pop = document.body.querySelector('.ww-popover') as HTMLElement
    expect(pop.getAttribute('aria-label')).toBe('Day shape')
    expect(pop.dataset.state).toBe('open')
    expect(pop.style.insetBlockStart).not.toBe('')
  })
  it('closes on Esc, returning focus to the anchor, and on a press outside but not inside or on the anchor', () => {
    const on = vi.fn()
    m = mount(<Host open onClose={on} />)
    const down = (t: Element) => act(() => void t.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    down(document.getElementById('inside')!)
    down(document.getElementById('anchor')!)
    expect(on).not.toHaveBeenCalled()
    down(document.body)
    expect(on).toHaveBeenCalledTimes(1)
    key('Escape')
    expect(on).toHaveBeenCalledTimes(2)
    expect(document.activeElement!.id).toBe('anchor')
  })
  it('leaves in 120 ms and unmounts', () => {
    vi.useFakeTimers()
    m = mount(<Host open onClose={() => {}} />)
    m.render(<Host open={false} onClose={() => {}} />)
    expect((document.body.querySelector('.ww-popover') as HTMLElement).dataset.state).toBe('closing')
    adv(121)
    expect(document.body.querySelector('.ww-popover')).toBeNull()
  })
  it('anchor ref type accepts an empty ref without throwing', () => {
    const ref = createRef<HTMLElement>()
    m = mount(<Popover open onClose={() => {}} anchor={ref} label="x" />)
    expect(document.body.querySelector('.ww-popover')).not.toBeNull()
  })
})

describe('Toast', () => {
  it('a stack is a polite live region, always mounted', () => {
    m = mount(<ToastStack toasts={[]} onDismiss={() => {}} />)
    const r = document.body.querySelector('[aria-live=polite]')!
    expect(r.getAttribute('role')).toBe('region')
    expect(r.getAttribute('aria-label')).toBe('Notifications')
  })
  it('shows each message; the tone is a dot and the words carry the meaning', () => {
    m = mount(<ToastStack toasts={[{ id: '1', tone: 'fault', message: 'Could not save marks.' }]} onDismiss={() => {}} />)
    expect(document.body.querySelector('.ww-toast')!.textContent).toBe('Could not save marks.')
    expect(document.body.querySelector('.ww-toast .ww-chip-dot')).not.toBeNull()
  })
  it('leaves after its time with a 180 ms exit, then asks to be removed', () => {
    vi.useFakeTimers()
    const on = vi.fn()
    m = mount(<Toast message="Saved." onDismiss={on} />)
    adv(TOAST_MS.plain - 1)
    expect(m.container.querySelector('[data-leave]')).toBeNull()
    adv(1)
    expect(m.container.querySelector('.ww-toast')!.getAttribute('data-leave')).toBe('out')
    expect(on).not.toHaveBeenCalled()
    adv(181)
    expect(on).toHaveBeenCalledTimes(1)
  })
  it('an action gives Undo, runs it once, and stays longer than a plain toast', () => {
    vi.useFakeTimers()
    const undo = vi.fn()
    const on = vi.fn()
    m = mount(<Toast message="Reel deleted." action={{ label: 'Undo', onAction: undo }} onDismiss={on} />)
    adv(TOAST_MS.plain + 10)
    expect(m.container.querySelector('[data-leave]')).toBeNull()
    click(m.container.querySelector('button')!)
    expect(undo).toHaveBeenCalledTimes(1)
    adv(200)
    expect(on).toHaveBeenCalledTimes(1)
  })
})
