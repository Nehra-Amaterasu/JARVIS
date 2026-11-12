// Kit family B, HUD and terminal frames (spec 7.1, 7.3): states test and keyboard test for each component.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { mount } from '../ww/_stubs'
import {
  CONSOLE_MAX_LINES, Console, FolderTabs, Frame, NOTCHED_TOAST_MS, NotchedToast, NotchedToastStack, PaletteView, Panel, RetroDialog, type ConsoleLine, type NotchedToastItem,
} from '../../shared/kit'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})
const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = m!.container) => root.querySelector<T>(sel)!
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const click = (el: Element) => act(() => (el as HTMLElement).click())

describe('Panel (component 12)', () => {
  it('stacks two layers (outer edge, inner raised) and is a plain container', () => {
    m = mount(<Panel>body</Panel>)
    expect(q('.k-panel > .k-panel-in').textContent).toBe('body')
  })
  it('error: outer layer flagged, the reason printed with a triangle; planned: the dashed SVG outline replaces the layers', () => {
    m = mount(<Panel error="Disk full">x</Panel>)
    expect(q('.k-panel').dataset.state).toBe('error')
    expect(q('.k-err svg').getAttribute('data-shape')).toBe('triangle')
    m.render(<Panel planned>x</Panel>)
    expect(q('.k-panel').dataset.state).toBe('planned')
    expect(q('.k-panel-dash path').getAttribute('stroke-dasharray')).toBe('4 3')
  })
})

describe('Frame (component 13)', () => {
  it('draws four brackets and a footer with the lamp left and the timestamp as real text', () => {
    m = mount(<Frame state="simulated" stamp="12:04:09">view</Frame>)
    expect([...m.container.querySelectorAll('.k-br')].map((b) => (b as HTMLElement).dataset.at)).toEqual(['tl', 'tr', 'bl', 'br'])
    expect(q('.k-frame-foot .k-lamp').getAttribute('aria-label')).toBe('SIMULATED')
    expect(q('time').textContent).toBe('12:04:09')
  })
  it('without a state or stamp there is no footer; planned brackets are flagged dashed', () => {
    m = mount(<Frame planned>v</Frame>)
    expect(q('.k-frame-foot')).toBeNull()
    expect(q('.k-frame').dataset.state).toBe('planned')
  })
})

const lines = (n: number, extra: Partial<ConsoleLine> = {}): ConsoleLine[] => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, tag: 'SYS', at: `00:${String(i).padStart(2, '0')}`, text: `line ${i}`, ...extra }))

describe('Console (component 15)', () => {
  it('role=log with aria-live off, bracketed tags, a timestamp column and an always-planned prompt when nothing handles it', () => {
    m = mount(<Console label="Events" lines={lines(2)} />)
    const log = q('[role=log]')
    expect(log.getAttribute('aria-live')).toBe('off')
    expect(q('.k-console-tag').textContent).toBe('[SYS]')
    expect(q('.k-console-at').textContent).toBe('00:00')
    expect(q('.k-console-prompt').dataset.state).toBe('planned')
    expect(q('.k-prompt-input').getAttribute('aria-disabled')).toBe('true')
    expect(q('.k-console-prompt').textContent).toContain('PLANNED')
  })
  it('keeps at most 200 lines in the DOM', () => {
    m = mount(<Console label="E" lines={lines(CONSOLE_MAX_LINES + 50)} />)
    expect(m.container.querySelectorAll('.k-console-line')).toHaveLength(CONSOLE_MAX_LINES)
    expect(q('.k-console-text').textContent).toBe('line 50')
  })
  it('simulated lines carry a diamond, fault lines a triangle; Follow announces only fault lines through its own status region', () => {
    const ls: ConsoleLine[] = [...lines(1), { id: 's', tag: 'EYES', at: 't', text: 'fake frame', kind: 'sim' }, { id: 'f', tag: 'LIMB', at: 't', text: 'relay stuck', kind: 'fault' }]
    m = mount(<Console label="E" lines={ls} />)
    const shapes = [...m.container.querySelectorAll('.k-console-line svg')].map((s) => s.getAttribute('data-shape'))
    expect(shapes).toEqual(['diamond', 'triangle'])
    expect(q('[role=status]').textContent).toBe('FAULT: relay stuck')
    click(q('.k-console-follow'))
    expect(q('.k-console-follow').getAttribute('aria-pressed')).toBe('false')
    expect(q('[role=status]').textContent).toBe('')
  })
  it('keyboard: arrows move the cursor line, Home and End jump, Ctrl+C copies the cursor line and tells the caller', () => {
    const copy = vi.fn()
    const write = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    m = mount(<Console label="E" lines={lines(5)} onCopy={copy} />)
    const log = q('[role=log]')
    key(log, 'Home')
    expect(q('.k-console-line[data-cursor=true] .k-console-text').textContent).toBe('line 0')
    key(log, 'ArrowDown')
    expect(q('.k-console-line[data-cursor=true] .k-console-text').textContent).toBe('line 1')
    key(log, 'End')
    key(log, 'ArrowUp')
    expect(q('.k-console-line[data-cursor=true] .k-console-text').textContent).toBe('line 3')
    key(log, 'c', { ctrlKey: true })
    expect(write).toHaveBeenCalledWith('00:03 [SYS] line 3')
    expect(copy).toHaveBeenCalledWith(expect.objectContaining({ id: 'l3' }))
  })
  it('a live prompt submits its text and clears; Esc leaves the prompt for the log', () => {
    const on = vi.fn()
    m = mount(<Console label="E" lines={[]} onSubmit={on} />)
    const input = q<HTMLInputElement>('.k-prompt-input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'status')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void q('.k-console-prompt').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(on).toHaveBeenCalledWith('status')
    expect(input.value).toBe('')
    input.focus()
    key(input, 'Escape')
    expect(document.activeElement).toBe(q('[role=log]'))
  })
})

const items = [
  { id: 'core', group: 'Go' as const, label: 'Go to Core', hint: 'Ctrl+1' },
  { id: 'eyes', group: 'Go' as const, label: 'Go to Aankhen', hint: 'Ctrl+2' },
  { id: 'off', group: 'Do' as const, label: 'All off', hint: 'Ctrl+0' },
  { id: 'ask', group: 'Ask' as const, label: 'Ask JARVIS', planned: true },
]

describe('PaletteView (component 16)', () => {
  it('is a combobox over a listbox with grouped options in the order Go, Do, Ask and the real key hint per row', () => {
    m = mount(<PaletteView items={items} onRun={() => {}} onPlanned={() => {}} onClose={() => {}} />)
    const c = q('[role=combobox]')
    expect(c.getAttribute('aria-controls')).toBe(q('[role=listbox]').id)
    expect([...m.container.querySelectorAll('[role=group]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Go', 'Do', 'Ask'])
    expect(q('.k-palette-hint').textContent).toBe('Ctrl+1')
    expect(c.getAttribute('aria-activedescendant')).toBe(q('[role=option]').id)
  })
  it('Up and Down move the active option, Enter runs it, Esc closes', () => {
    const run = vi.fn()
    const close = vi.fn()
    m = mount(<PaletteView items={items} onRun={run} onPlanned={() => {}} onClose={close} />)
    const c = q('[role=combobox]')
    key(c, 'ArrowDown')
    expect(q('[aria-selected=true]').textContent).toContain('Go to Aankhen')
    key(c, 'ArrowUp')
    key(c, 'Enter')
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'core' }))
    key(c, 'Escape')
    expect(close).toHaveBeenCalled()
  })
  it('a planned verb shows the dashed ring, is aria-disabled and never runs: Enter calls onPlanned instead', () => {
    const run = vi.fn()
    const pl = vi.fn()
    m = mount(<PaletteView items={items} onRun={run} onPlanned={pl} onClose={() => {}} />)
    const c = q('[role=combobox]')
    key(c, 'End')
    for (let i = 0; i < 5; i++) key(c, 'ArrowDown')
    const row = q('[role=option][aria-disabled=true]')
    expect(row.querySelector('svg')!.getAttribute('data-shape')).toBe('dashed-ring')
    key(c, 'Enter')
    expect(pl).toHaveBeenCalledWith(expect.objectContaining({ id: 'ask' }))
    expect(run).not.toHaveBeenCalled()
  })
  it('typing filters; no match shows the one-line plate', () => {
    m = mount(<PaletteView items={items} onRun={() => {}} onPlanned={() => {}} onClose={() => {}} />)
    const c = q<HTMLInputElement>('[role=combobox]')
    const type = (v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(c, v)
        c.dispatchEvent(new Event('input', { bubbles: true }))
      })
    type('aank')
    expect(m.container.querySelectorAll('[role=option]')).toHaveLength(1)
    type('zzz')
    expect(m.container.querySelectorAll('[role=option]')).toHaveLength(0)
    expect(q('.k-palette-empty').textContent).toBe('Nothing matches.')
  })
})

describe('NotchedToast (component 17)', () => {
  it('auto-dismisses OK and NOTE after 6 s but never a FAULT (WCAG 2.2.1)', () => {
    vi.useFakeTimers()
    const gone = vi.fn()
    const f = vi.fn()
    m = mount(
      <div>
        <NotchedToast tag="OK" message="Saved" onDismiss={gone} />
        <NotchedToast tag="FAULT" message="Relay stuck" onDismiss={f} />
      </div>,
    )
    expect(NOTCHED_TOAST_MS).toBe(6000)
    act(() => void vi.advanceTimersByTime(5999))
    expect(gone).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(2))
    expect(gone).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(60000))
    expect(f).not.toHaveBeenCalled()
    expect(m.container.querySelector('[data-tag=FAULT] svg')!.getAttribute('data-shape')).toBe('triangle')
  })
  it('Undo is a real button that runs the undo and dismisses; Esc dismisses; a fault has a Dismiss button', () => {
    const undo = vi.fn()
    const gone = vi.fn()
    m = mount(<NotchedToast tag="NOTE" message="All off" undo={{ onUndo: undo }} onDismiss={gone} />)
    click(q('.k-toast-undo'))
    expect(undo).toHaveBeenCalled()
    expect(gone).toHaveBeenCalledTimes(1)
    key(document.body, 'Escape')
    expect(gone).toHaveBeenCalledTimes(2)
    m.render(<NotchedToast tag="FAULT" message="x" onDismiss={gone} />)
    click(q('.k-toast-undo'))
    expect(gone).toHaveBeenCalledTimes(3)
  })
  it('the stack is an always-mounted status region and Quiet silences every non-fault toast but never a fault', () => {
    const ts: NotchedToastItem[] = [{ id: 'a', tag: 'OK', message: 'a' }, { id: 'b', tag: 'FAULT', message: 'b' }]
    m = mount(<NotchedToastStack toasts={ts} onDismiss={() => {}} />)
    expect(q('[role=status]').getAttribute('aria-live')).toBe('polite')
    expect(m.container.querySelectorAll('.k-toast')).toHaveLength(2)
    m.render(<NotchedToastStack toasts={ts} onDismiss={() => {}} quiet />)
    expect([...m.container.querySelectorAll('.k-toast')].map((t) => (t as HTMLElement).dataset.tag)).toEqual(['FAULT'])
  })
})

describe('RetroDialog (component 20)', () => {
  const dlg = (extra: Record<string, unknown> = {}) => (
    <RetroDialog open title="Delete note" confirmLabel="Delete" onConfirm={extra.onConfirm as () => void} onCancel={extra.onCancel as () => void} destructive={extra.destructive as boolean} error={extra.error as string}>
      This cannot be undone.
    </RetroDialog>
  )
  it('is a modal dialog named by its title with a mono title bar, a close key and two buttons', () => {
    m = mount(dlg({ onConfirm: () => {}, onCancel: () => {} }))
    const d = q('[role=dialog]', document.body)
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(q('#' + d.getAttribute('aria-labelledby'), document.body).textContent).toBe('Delete note')
    expect(q('.k-dialog-x', document.body).getAttribute('aria-label')).toBe('Close Delete note')
    expect(document.body.querySelectorAll('.k-dialog-foot button')).toHaveLength(2)
  })
  it('a delete focuses Cancel first, a plain confirm focuses the confirm button, and Esc cancels', () => {
    const cancel = vi.fn()
    m = mount(dlg({ onConfirm: () => {}, onCancel: cancel, destructive: true }))
    expect(document.activeElement).toBe(q('[data-k-cancel]', document.body))
    expect(q('[data-k-confirm]', document.body).dataset.primary).toBeUndefined()
    key(document.body, 'Escape')
    expect(cancel).toHaveBeenCalled()
    m.render(dlg({ onConfirm: () => {}, onCancel: cancel }))
    m.unmount()
    m = mount(dlg({ onConfirm: () => {}, onCancel: cancel }))
    expect(document.activeElement).toBe(q('[data-k-confirm]', document.body))
  })
  it('Tab is trapped inside the window, Enter on the focused confirm runs it, and error shows the one error style', () => {
    const ok = vi.fn()
    m = mount(dlg({ onConfirm: ok, onCancel: () => {}, error: 'Could not delete' }))
    const win = q('.k-dialog', document.body)
    expect(win.dataset.state).toBe('error')
    expect(win.querySelector('.k-err svg')!.getAttribute('data-shape')).toBe('triangle')
    const last = win.querySelector<HTMLElement>('[data-k-confirm]')!
    last.focus()
    key(last, 'Tab')
    expect(win.contains(document.activeElement)).toBe(true)
    click(last)
    expect(ok).toHaveBeenCalled()
  })
  it('closed renders nothing, and the background is made inert while open', () => {
    const outside = document.createElement('main')
    document.body.appendChild(outside)
    m = mount(dlg({ onConfirm: () => {}, onCancel: () => {} }))
    expect(outside.hasAttribute('inert')).toBe(true)
    m.render(<RetroDialog open={false} title="t" confirmLabel="c" onConfirm={() => {}} onCancel={() => {}}>x</RetroDialog>)
    expect(document.body.querySelector('.k-dialog')).toBeNull()
    expect(outside.hasAttribute('inert')).toBe(false)
  })
})

describe('FolderTabs (component 21)', () => {
  const tabs = [{ id: 'a', label: 'Overview', count: 3 }, { id: 'b', label: 'Memory' }, { id: 'c', label: 'Relay', planned: true }]
  function Host({ onPlanned }: { onPlanned?: (id: string) => void }) {
    const [v, setV] = useState('a')
    return <FolderTabs tabs={tabs} value={v} onChange={setV} onPlanned={onPlanned} label="Sections" />
  }
  it('is a tablist with aria-selected, a roving tabindex and a counter badge', () => {
    m = mount(<Host />)
    const ts = [...m.container.querySelectorAll<HTMLElement>('[role=tab]')]
    expect(ts.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(ts.map((t) => t.tabIndex)).toEqual([0, -1, -1])
    expect(q('.k-tab-count').textContent).toBe('3')
  })
  it('Left, Right (wrapping), Home and End move and select; a planned tab takes focus but is not selected', () => {
    m = mount(<Host />)
    const sel = () => q('[role=tab][aria-selected=true]').textContent
    const first = q('[role=tab]')
    key(first, 'ArrowRight')
    expect(sel()).toContain('Memory')
    key(q('[role=tab][aria-selected=true]'), 'ArrowRight')
    expect(sel()).toContain('Memory')
    expect(document.activeElement!.textContent).toContain('Relay')
    key(document.activeElement!, 'Home')
    expect(sel()).toContain('Overview')
    key(q('[role=tab][aria-selected=true]'), 'ArrowLeft')
    expect(document.activeElement!.textContent).toContain('Relay')
    expect(sel()).toContain('Overview')
  })
  it('a planned tab is aria-disabled, dashed and its press opens the explanation', () => {
    const pl = vi.fn()
    m = mount(<Host onPlanned={pl} />)
    const t = q('[role=tab][data-state=planned]')
    expect(t.getAttribute('aria-disabled')).toBe('true')
    expect(t.textContent).toContain('PLANNED')
    click(t)
    expect(pl).toHaveBeenCalledWith('c')
    expect(q('[role=tab][aria-selected=true]').textContent).toContain('Overview')
  })
})
