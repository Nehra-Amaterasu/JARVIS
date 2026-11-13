// The three components of D03 in happy-dom: honesty of the numbers, the keyboard paths, the cards and the sheet.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, resetHtml, setHtml, stubMatchMedia } from '../../../../__tests__/ww/_stubs'
import { DetentRack, LedgerTable, SlotList, type Col, type Item, type Opt, type Row } from '..'

let m: ReturnType<typeof mount> | null = null
let restore: (() => void) | null = null
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => {
  m?.unmount()
  m = null
  restore?.()
  restore = null
  resetHtml()
})

const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const click = (el: Element) => act(() => { (el as HTMLElement).click() })
const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel)!
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)]
const type = (el: HTMLInputElement, v: string) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

const cols: Col[] = [
  { key: 'name', label: 'Topic', pinned: true, editable: true },
  { key: 'n', label: 'Blocks', kind: 'number', editable: true },
  { key: 'tr', label: 'Trend', kind: 'spark' },
  { key: 'm', label: 'Covered', kind: 'meter' },
  { key: 's', label: 'Source', kind: 'lamp' },
]
const rows: Row[] = [
  { id: 'a', name: 'Unit 2', n: 9, tr: [1, 2, 3], m: 0.5, s: 'live' },
  { id: 'b', name: 'Unit 1', n: 14, tr: [3, 2, 1], m: 0.9, s: 'simulated' },
  { id: 'c', name: 'Unit 3', n: 4, tr: [], m: 0.1, s: 'waiting' },
]

describe('LedgerTable honesty', () => {
  it('draws numbers, sparks and meters for LIVE and SIMULATED only', () => {
    for (const s of ['live', 'simulated'] as const) {
      m = mount(<LedgerTable columns={cols} rows={rows} state={s} />)
      expect(qa('.d3-num').map((e) => e.textContent)).toEqual(['9', '14', '4'])
      expect(qa('.d3-spark').length).toBe(2)
      expect(qa('.d3-meter').length).toBe(3)
      m.unmount()
      m = null
    }
  })
  it.each(['waiting', 'planned', 'fault'] as const)('%s draws a hollow form for every number and says why', (s) => {
    m = mount(<LedgerTable columns={cols} rows={rows} state={s} reason={s === 'fault' ? 'the log did not answer' : undefined} />)
    expect(qa('.d3-num, .d3-spark, .d3-meter').length).toBe(0)
    expect(qa('.d3-hollow').length).toBe(3 * 3)
    const bar = q('.d3-bar').textContent!
    expect(bar).toContain(s.toUpperCase())
    expect(bar).toContain('Numbers are not drawn')
    if (s === 'fault') expect(bar).toContain('the log did not answer')
    expect(q('.d3-hollow').getAttribute('aria-label')).toContain(s.toUpperCase())
  })
  it('keeps the lamp column honest per row, as a shape and a word', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" />)
    const tags = qa('tbody .d3-lamp')
    expect(tags.map((t) => t.getAttribute('data-lamp'))).toEqual(['live', 'simulated', 'waiting'])
    expect(tags.every((t) => t.querySelector('svg') && t.textContent!.length > 0)).toBe(true)
  })
  it('a number column cannot be edited while the state draws no number', () => {
    const onEdit = vi.fn()
    m = mount(<LedgerTable columns={cols} rows={rows} state="waiting" onEdit={onEdit} />)
    const cell = q('[data-pos="0:2"]')
    act(() => cell.focus())
    key(cell, 'F2')
    expect(qa('.d3-input').length).toBe(0)
  })
  it('loading and empty are hollow forms with a sentence, not grey boxes', () => {
    m = mount(<LedgerTable columns={cols} rows={[]} state="simulated" loading />)
    expect(q('table').getAttribute('aria-busy')).toBe('true')
    expect(qa('.d3-ghost').length).toBe(4)
    m.render(<LedgerTable columns={cols} rows={[]} state="simulated" empty="Nothing logged." />)
    expect(q('.d3-empty').textContent).toBe('Nothing logged.')
  })
})

describe('LedgerTable keyboard', () => {
  it('is one tab stop and the arrows rove', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" />)
    expect(qa('[data-pos][tabindex="0"]').length).toBe(1)
    const first = q('[data-pos="0:1"]')
    act(() => first.focus())
    key(first, 'ArrowDown')
    expect(document.activeElement).toBe(q('[data-pos="1:1"]'))
    expect(qa('[data-pos][tabindex="0"]').length).toBe(1)
    key(document.activeElement!, 'Home', { ctrlKey: true })
    expect(document.activeElement).toBe(q('[data-pos="-1:1"]'))
  })
  it('sorts from the header and keeps the glyph in text', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" />)
    const head = q('th[data-kind="number"] button')
    click(head)
    expect(q('th[data-kind="number"]').getAttribute('aria-sort')).toBe('ascending')
    expect(qa('tbody tr').map((r) => r.querySelector('.d3-num')!.textContent)).toEqual(['4', '9', '14'])
    expect(head.textContent).toContain('▲')
    click(head)
    expect(head.textContent).toContain('▼')
    click(head)
    expect(q('th[data-kind="number"]').getAttribute('aria-sort')).toBe('none')
  })
  it('F2 edits, Enter commits a number, Escape cancels, bad text is refused', () => {
    const onEdit = vi.fn()
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" onEdit={onEdit} />)
    const cell = q('[data-pos="0:2"]')
    act(() => cell.focus())
    key(cell, 'F2')
    let input = q('.d3-input') as HTMLInputElement
    expect(input.value).toBe('9')
    type(input, 'abc')
    key(input, 'Enter')
    expect(onEdit).not.toHaveBeenCalled()
    expect(q('.d3-err').textContent).toContain('numbers only')
    type(input, '12,5')
    key(input, 'Enter')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0].id).toBe('a')
    expect(onEdit.mock.calls[0][1].key).toBe('n')
    expect(onEdit.mock.calls[0][2]).toBe(12.5)
    expect(qa('.d3-input').length).toBe(0)
    act(() => q('[data-pos="0:2"]').focus())
    key(q('[data-pos="0:2"]'), 'F2')
    input = q('.d3-input') as HTMLInputElement
    type(input, '77')
    key(input, 'Escape')
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(qa('.d3-input').length).toBe(0)
  })
  it('a text edit passes the trimmed string', () => {
    const onEdit = vi.fn()
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" onEdit={onEdit} />)
    const cell = q('[data-pos="0:1"]')
    act(() => cell.focus())
    key(cell, 'F2')
    const input = q('.d3-input') as HTMLInputElement
    type(input, '  Unit 9  ')
    key(input, 'Enter')
    expect(onEdit.mock.calls[0][2]).toBe('Unit 9')
  })
  it('the row button opens a drawer with every column, and Escape closes it and returns focus', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" renderDetail={(r) => <p className="extra">{String(r.id)}</p>} />)
    const btn = q('[data-pos="0:0"]')
    act(() => btn.focus())
    click(btn)
    const drawer = q('.d3-drawer')
    expect(drawer.getAttribute('data-place')).toBe('side')
    expect(qa('.d3-kv-row', drawer).length).toBe(cols.length)
    expect(q('.extra').textContent).toBe('a')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(q('button', drawer))
    key(q('button', drawer), 'Escape')
    expect(qa('.d3-drawer').length).toBe(0)
    expect(document.activeElement).toBe(q('[data-pos="0:0"]'))
  })
  it('Space selects a row and the selection is a marker in text and a notch, not only a colour', () => {
    const onSelect = vi.fn()
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" onSelect={onSelect} />)
    const cell = q('[data-pos="1:1"]')
    act(() => cell.focus())
    key(cell, ' ')
    expect(onSelect).toHaveBeenCalledWith('b')
    expect(qa('tr[aria-selected="true"]').length).toBe(1)
  })
  it('the column chooser hides a column but never a pinned one', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" defaultChooserOpen />)
    expect(qa('thead th').length).toBe(1 + cols.length)
    const boxes = qa('.d3-choice input') as HTMLInputElement[]
    expect(boxes[0].disabled).toBe(true)
    act(() => boxes[2].click())
    expect(qa('thead th').length).toBe(cols.length)
    expect(q('.d3-key').textContent).toContain('4/5')
  })
})

describe('LedgerTable forms', () => {
  it('under 900 px it is key-value cards with three fields and a Details button', () => {
    restore = stubMatchMedia({ 'max-width': true })
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" />)
    expect(q('.d3-ledger').getAttribute('data-layout')).toBe('cards')
    expect(qa('table').length).toBe(0)
    const card = q('.d3-card')
    expect(qa('.d3-kv-row', card).length).toBe(3)
    expect(card.querySelector('.d3-lamp')).not.toBeNull()
    click(q('.d3-card-more', card))
    expect(q('.d3-drawer').getAttribute('data-place')).toBe('sheet')
    key(q('.d3-drawer button'), 'Escape')
    expect(qa('.d3-drawer').length).toBe(0)
  })
  it('layout=table keeps the table even on a narrow screen', () => {
    restore = stubMatchMedia({ 'max-width': true })
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" layout="table" />)
    expect(qa('table').length).toBe(1)
  })
  it('dense is 28 px by attribute, one table-level source lamp sits in the bar', () => {
    m = mount(<LedgerTable columns={cols} rows={rows} state="simulated" density="dense" />)
    expect(q('.d3-ledger').getAttribute('data-density')).toBe('dense')
    expect(q('.d3-bar .d3-lamp').getAttribute('data-lamp')).toBe('simulated')
  })
})

describe('SlotList', () => {
  const items: Item[] = [
    { id: 'a', label: 'Read', meta: '25 min', state: 'live' },
    { id: 'b', label: 'Solve' },
    { id: 'c', label: 'Check' },
  ]
  const row = (id: string) => q(`[data-id="${id}"] .d3s-row`)

  it('Alt+Down and Alt+Up ask for one step and say where the row went', () => {
    const onReorder = vi.fn()
    m = mount(<SlotList items={items} onReorder={onReorder} />)
    act(() => row('b').focus())
    key(row('b'), 'ArrowDown', { altKey: true })
    expect(onReorder).toHaveBeenLastCalledWith(1, 2)
    expect(q('[role="status"]').textContent).toBe('Solve moved to position 3 of 3')
    key(row('b'), 'ArrowUp', { altKey: true })
    expect(onReorder).toHaveBeenLastCalledWith(1, 0)
  })
  it('does not move past an end', () => {
    const onReorder = vi.fn()
    m = mount(<SlotList items={items} onReorder={onReorder} />)
    key(row('a'), 'ArrowUp', { altKey: true })
    expect(onReorder).not.toHaveBeenCalled()
    expect(q('[role="status"]').textContent).toContain('already first')
  })
  it('Space lifts a row over a dashed plate, arrows carry it, Space puts it down, Escape puts it back', () => {
    const onReorder = vi.fn()
    m = mount(<SlotList items={items} onReorder={onReorder} />)
    key(row('a'), ' ')
    expect(qa('.d3s-plate').length).toBe(1)
    expect(q('[data-id="a"]').hasAttribute('data-lifting')).toBe(true)
    key(row('a'), 'ArrowDown')
    key(row('a'), 'ArrowDown')
    expect(qa('.d3s-label').map((e) => e.textContent)).toEqual(['Solve', 'Check', 'Read'])
    key(row('a'), 'Escape')
    expect(qa('.d3s-plate').length).toBe(0)
    expect(onReorder).not.toHaveBeenCalled()
    key(row('a'), ' ')
    key(row('a'), 'ArrowDown')
    key(row('a'), ' ')
    expect(onReorder).toHaveBeenCalledWith(0, 1)
    expect(qa('.d3s-plate').length).toBe(0)
  })
  it('arrows alone move focus between rows, one tab stop', () => {
    m = mount(<SlotList items={items} onReorder={() => {}} />)
    expect(qa('.d3s-row[tabindex="0"]').length).toBe(1)
    act(() => row('a').focus())
    key(row('a'), 'ArrowDown')
    expect(document.activeElement).toBe(row('b'))
    key(row('b'), 'End')
    expect(document.activeElement).toBe(row('c'))
  })
  it('with no onReorder the order is fixed: no grip, no lift, and the hint says so', () => {
    m = mount(<SlotList items={items} />)
    expect(qa('.d3s-grip').length).toBe(0)
    key(row('a'), ' ')
    expect(qa('.d3s-plate').length).toBe(0)
    expect(q('.d3s-hint').textContent).toContain('fixed')
  })
  it('names each row with its position and lamp for a screen reader', () => {
    m = mount(<SlotList items={items} onReorder={() => {}} />)
    expect(row('a').getAttribute('aria-label')).toBe('Read, 25 min, position 1 of 3, LIVE')
  })
  it('a removed row leaves by collapsing its slot, and goes at once with reduced motion', () => {
    m = mount(<SlotList items={items} onReorder={() => {}} />)
    m.render(<SlotList items={items.slice(1)} onReorder={() => {}} />)
    const ghost = q('[data-leaving]')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    act(() => { ghost.dispatchEvent(new Event('animationend', { bubbles: true })) })
    expect(qa('[data-leaving]').length).toBe(0)
    m.unmount()
    setHtml({ 'data-motion': 'calm' })
    m = mount(<SlotList items={items} onReorder={() => {}} />)
    m.render(<SlotList items={items.slice(1)} onReorder={() => {}} />)
    expect(qa('[data-leaving]').length).toBe(0)
    expect(qa('[data-seat]').length).toBe(0)
  })
  it('new rows seat in with an index for the stagger; empty says so in a sentence', () => {
    m = mount(<SlotList items={items} />)
    expect(qa('[data-seat]').length).toBe(3)
    expect(qa('[data-seat]').map((e) => e.style.getPropertyValue('--i'))).toEqual(['0', '1', '2'])
    m.render(<SlotList items={[]} empty="Nothing planned." />)
    expect(q('.d3s-empty').textContent).toBe('Nothing planned.')
  })
})

describe('DetentRack', () => {
  const opts: Opt[] = [
    { value: 'day', label: 'Today', shortcut: 'T' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: 'This month' },
    { value: 'all', label: 'Everything', disabled: true },
  ]
  const trigger = () => q('.d3r-trigger')
  const active = () => document.getElementById(q('[role="listbox"]').getAttribute('aria-activedescendant')!)!.textContent!

  it('opens on Enter, focuses the listbox and names the active row with aria-activedescendant', () => {
    m = mount(<DetentRack options={opts} value="week" onChange={() => {}} label="Range" />)
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    click(trigger())
    const lb = q('[role="listbox"]')
    expect(document.activeElement).toBe(lb)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(lb.id)
    expect(active()).toContain('This week')
    expect(qa('[role="option"]').filter((o) => o.getAttribute('aria-selected') === 'true').length).toBe(1)
    expect(qa('select').length).toBe(0)
  })
  it('arrows skip a disabled option, Home and End jump, Enter commits and focus returns to the trigger', () => {
    const onChange = vi.fn()
    m = mount(<DetentRack options={opts} value="week" onChange={onChange} label="Range" />)
    click(trigger())
    const lb = q('[role="listbox"]')
    key(lb, 'ArrowDown')
    expect(active()).toContain('This month')
    key(lb, 'ArrowDown')
    expect(active()).toContain('This month') // 'Everything' is disabled and the rack does not wrap
    key(lb, 'Home')
    expect(active()).toContain('Today')
    key(lb, 'End')
    expect(active()).toContain('This month')
    key(lb, 'Enter')
    expect(onChange).toHaveBeenCalledWith('month')
    expect(qa('[role="listbox"]').length).toBe(0)
    expect(document.activeElement).toBe(trigger())
  })
  it('opens from the closed trigger with the arrow keys and with typing', () => {
    m = mount(<DetentRack options={opts} value="week" onChange={() => {}} label="Range" />)
    act(() => trigger().focus())
    key(trigger(), 'ArrowDown')
    expect(qa('[role="listbox"]').length).toBe(1)
    key(q('[role="listbox"]'), 'Escape')
    expect(qa('[role="listbox"]').length).toBe(0)
    key(trigger(), 't') // the next option after 'This week' that starts with t, as a native list does
    expect(active()).toContain('This month')
  })
  it('typeahead moves the active row; Escape closes without changing', () => {
    const onChange = vi.fn()
    m = mount(<DetentRack options={opts} value="day" onChange={onChange} label="Range" />)
    click(trigger())
    const lb = q('[role="listbox"]')
    key(lb, 't')
    key(lb, 'h')
    key(lb, 'i')
    key(lb, 's')
    key(lb, ' ')
    key(lb, 'm')
    expect(active()).toContain('This month')
    key(lb, 'Escape')
    expect(onChange).not.toHaveBeenCalled()
    expect(qa('[role="listbox"]').length).toBe(0)
    expect(document.activeElement).toBe(trigger())
  })
  it('a click on an option picks it', () => {
    const onChange = vi.fn()
    m = mount(<DetentRack options={opts} value="day" onChange={onChange} label="Range" />)
    click(trigger())
    click(qa('[role="option"]')[2])
    expect(onChange).toHaveBeenCalledWith('month')
    click(trigger())
    click(qa('[role="option"]')[3])
    expect(onChange).toHaveBeenCalledTimes(1) // the disabled one does nothing
  })
  it('a disabled rack stays focusable, says why and does not open', () => {
    m = mount(<DetentRack options={opts} value="day" onChange={() => {}} label="Range" disabledReason="Needs a full week of data." />)
    expect(trigger().getAttribute('aria-disabled')).toBe('true')
    expect(trigger().hasAttribute('disabled')).toBe(false)
    expect(q('.d3r-why').textContent).toBe('Needs a full week of data.')
    click(trigger())
    expect(qa('[role="listbox"]').length).toBe(0)
  })
  it('grouped racks draw headings and the tree gutter, ungrouped ones do not', () => {
    const g: Opt[] = [
      { value: 'a', label: 'A', group: 'One' }, { value: 'b', label: 'B', group: 'One' }, { value: 'c', label: 'C', group: 'Two' },
    ]
    m = mount(<DetentRack options={g} value="a" onChange={() => {}} grouped label="G" defaultOpen flow />)
    expect(qa('[role="group"]').length).toBe(2)
    expect(qa('.d3r-gut').map((e) => e.textContent)).toEqual(['├─', '└─', '└─'])
    m.render(<DetentRack options={g} value="a" onChange={() => {}} label="G" defaultOpen flow />)
    expect(qa('[role="group"]').length).toBe(0)
  })
  it('under 900 px it is a bottom sheet in a portal with a Cancel key; Tab stays inside it', () => {
    restore = stubMatchMedia({ 'max-width': true })
    m = mount(<DetentRack options={opts} value="day" onChange={() => {}} label="Range" />)
    click(trigger())
    const sheet = q('.d3r-sheet')
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.closest('.d3r-portal')!.parentElement).toBe(document.body)
    expect(qa('.d3r-scrim').length).toBe(1)
    key(q('[role="listbox"]'), 'Tab')
    expect(document.activeElement).toBe(q('.d3r-cancel'))
    click(q('.d3r-cancel'))
    expect(qa('.d3r-sheet').length).toBe(0)
    expect(document.activeElement).toBe(trigger())
  })
})
