// L01 day drawer: three folds on the fixture port, Done turns the hollow mark solid, "Not now" is a carried outline with no word of
// failure, Undo and Delete take a row out, a WAITING port draws hollow with its reason and claims no save, Esc closes, and the
// surface and ink are the drawer's own. The kit Drawer portals to <body>, so every query is on the document.
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayDrawer } from '../DayDrawer'
import { collectFolds } from '../folds'
import { nullDayPort } from '../../adapters/null.register'
import { createFixturePort } from '../../month/fixtures'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(cleanup)
const TODAY = '2026-11-18'

const open = async (date: string, port = createFixturePort(TODAY)) => {
  const onClose = vi.fn()
  render(<DayDrawer date={date} onClose={onClose} port={port} />)
  await flush(5)
  return { port, onClose }
}
const body = () => document.body
const rows = () => [...body().querySelectorAll<HTMLElement>('.dd-row')]

describe('the day drawer', () => {
  it('opens with the date as its name and the three folds', async () => {
    await open('2026-11-19')
    const dialog = body().querySelector('[role="dialog"].dd-sheet')!
    expect(dialog.querySelector('h2')!.textContent).toBe('Thursday 19 November 2026')
    expect([...dialog.querySelectorAll('.ww-fold-btn')].map((b) => b.textContent)).toEqual(['Happened', 'Planned', 'Intents'])
    expect(dialog.querySelector('.k-lamp')!.getAttribute('data-state')).toBe('simulated')
  })

  it('lists what happened with Undo and Delete, and what is planned with Done, Move and Not now', async () => {
    await open(TODAY)
    const happened = rows().filter((r) => r.querySelector('.alm-mark[data-done="true"]') && !r.getAttribute('data-status'))
    expect(happened.length).toBeGreaterThan(0)
    expect(buttons(happened[0], /^Undo/).length).toBe(1)
    expect(buttons(happened[0], /^Delete/).length).toBe(1)
    const planned = rows().filter((r) => r.getAttribute('data-status') === 'planned')
    expect(planned.length).toBeGreaterThan(0)
    for (const name of [/^Done/, /^Move/, /^Not now/]) expect(buttons(planned[0], name).length).toBe(1)
  })

  it('Done turns the hollow mark solid', async () => {
    const { port } = await open(TODAY)
    const row = rows().find((r) => r.getAttribute('data-status') === 'planned')!
    const id = row.querySelector('.dd-text')!.textContent
    expect(row.querySelector('.alm-mark')!.getAttribute('data-done')).toBe('false')
    click(buttons(row, /^Done/)[0])
    await flush(5)
    const after = rows().find((r) => r.querySelector('.dd-text')!.textContent === id)!
    expect(after.getAttribute('data-status')).toBe('done')
    expect(after.querySelector('.alm-mark')!.getAttribute('data-done')).toBe('true')
    expect(buttons(after, /^Done/).length).toBe(0)
    expect(port.calls.map((c) => c.op)).toEqual(['done'])
  })

  it('"Not now" makes a carried outline: still hollow, the word Carried, and no word of failure', async () => {
    const { port } = await open(TODAY)
    const row = rows().find((r) => r.getAttribute('data-status') === 'planned')!
    const text = row.querySelector('.dd-text')!.textContent!
    click(buttons(row, /^Not now/)[0])
    await flush(5)
    const after = rows().find((r) => r.querySelector('.dd-text')!.textContent!.startsWith(text.split('Carried')[0]))!
    expect(after.getAttribute('data-status')).toBe('carried')
    expect(after.querySelector('.alm-mark')!.getAttribute('data-done')).toBe('false')
    expect(after.querySelector('.dd-carried')!.textContent).toBe('Carried')
    expect(/(fail|failed|miss|missed|skip|skipped|late|overdue|behind|lost)/i.test(body().querySelector('.dd')!.textContent!)).toBe(false)
    expect(port.calls[0].op).toBe('notNow')
  })

  it('Move sends a planned row to tomorrow, Undo and Delete take a happened row out', async () => {
    const { port } = await open(TODAY)
    const happened = rows().filter((r) => r.querySelector('.alm-mark[data-done="true"]') && !r.getAttribute('data-status'))
    const n = happened.length
    click(buttons(happened[0], /^Undo/)[0])
    await flush(5)
    expect(rows().filter((r) => r.querySelector('.alm-mark[data-done="true"]') && !r.getAttribute('data-status')).length).toBe(n - 1)
    click(buttons(rows().filter((r) => !r.getAttribute('data-status') && r.querySelector('.alm-mark[data-done="true"]'))[0], /^Delete/)[0])
    await flush(5)
    const moving = rows().find((r) => r.getAttribute('data-status') === 'planned')!
    click(buttons(moving, /^Move/)[0])
    await flush(5)
    expect(port.calls.map((c) => c.op)).toEqual(['undo', 'delete', 'move'])
    expect(port.calls[2].to).toBe('2026-11-19')
  })

  it('shows the intents of the day with an Edit key that changes nothing and says so', async () => {
    await open('2026-11-04')
    const intent = rows().find((r) => r.getAttribute('data-kind') === 'intent')!
    expect(intent.querySelector('.alm-mark')!.getAttribute('data-shape')).toBe('diamond-dashed')
    click(buttons(intent, /^Edit/)[0])
    await flush()
    expect(body().querySelector('.dd-note')!.textContent).toContain('Nothing was changed')
    expect(body().querySelector('.dd-next')!.textContent).toContain('Next time')
  })

  it('on a WAITING port draws the folds hollow with the reason, and claims no save', async () => {
    await open(TODAY, nullDayPort as never)
    expect(body().querySelector('.dd')!.getAttribute('data-state')).toBe('waiting')
    expect(body().querySelector('.dd-why')!.textContent).toContain('not connected')
    expect(body().querySelectorAll('.dd-empty').length).toBe(3)
    click(buttons(body(), 'Add intent')[0])
    await flush()
    expect(body().querySelector('.dd-note')!.textContent).toMatch(/Nothing was saved/)
    expect(body().querySelector('.dd-note')!.getAttribute('data-applied')).toBeNull()
  })

  it('closes on Esc', async () => {
    const { onClose } = await open(TODAY)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    keyDown(body().querySelector('[role="dialog"]')!, 'Escape')
    expect(onClose).toHaveBeenCalled()
  })

  it('is the phone sheet at the bottom when asked', async () => {
    render(<DayDrawer date={TODAY} onClose={() => {}} port={createFixturePort(TODAY)} form="phone" />)
    await flush(5)
    expect(body().querySelector('.dd-sheet')!.getAttribute('data-place')).toBe('bottom')
    expect(body().querySelector('.dd')!.getAttribute('data-form')).toBe('phone')
  })
})

describe('the fold host', () => {
  const Body = () => null
  it('orders folds, keeps the first of a repeated id and skips a file with no fold', () => {
    const folds = collectFolds({
      './b.fold.tsx': { fold: { id: 'b', title: 'B', order: 5, Body } },
      './a.fold.tsx': { default: { id: 'a', title: 'A', order: 3, Body } },
      './a2.fold.tsx': { fold: { id: 'a', title: 'A again', order: 1, Body } },
      './x.fold.tsx': {},
    })
    expect(folds.map((f) => f.id)).toEqual(['a', 'b'])
    expect(folds[0].title).toBe('A')
  })
})
