// Package O, 27 Nov: a draft's unit and topic can be corrected before accepting (R-52 takes both), and the import tray opens on a press,
// not under a resting pointer, on a touch-width screen. Scripted client, invented data.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, stubMatchMedia } from '../../../../__tests__/ww/_stubs'
import type { ClientReply, DraftPatch, DraftRow, PyqClient } from '../../adapters/types'
import { DraftsPanel } from '../DraftsPanel'
import { ImportTray } from '../ImportTray'
import { PAPER_ACCEPT } from '../PaperDrop'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers() })

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const click = async (el: Element | null | undefined) => { expect(el, 'element to click').toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush(0) }
const type = async (el: Element | null | undefined, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { set.call(el, v); el!.dispatchEvent(new Event('input', { bubbles: true })) })
}
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement | null
const byText = (sel: string, t: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.trim() === t)

const DRAFT: DraftRow = {
  id: 'd-1', subject: 'signals', unit: 2, topic: 'Sampling', text: 'State the sampling theorem and one condition it needs.', marks: 4, status: 'pending', origin: 'model-draft',
  sources: [], copied: false, similarity: 0.31, made: '2026-11-27T10:05:00', reason: '', questionId: null, edited: false,
}
const live = <T,>(data: T): ClientReply<T> => ({ state: 'live', reason: '', since: 1, data })

function fake() {
  const calls: string[] = []
  const client: PyqClient = {
    ocrStatus: async () => ({ state: 'waiting', reason: 'No page is waiting for OCR.', since: 1, data: null }),
    ocrStart: async () => ({ state: 'waiting', reason: '', since: 1, data: null }),
    ocrStop: async () => ({ state: 'waiting', reason: '', since: 1, data: null }),
    draftsMake: async () => ({ state: 'waiting', reason: '', since: 1, data: null }),
    draftsList: async () => live([DRAFT]),
    draftsDecide: async (id: string, p: DraftPatch) => { calls.push(`decide:${id}:${JSON.stringify(p)}`); return live({ ...DRAFT, status: 'accepted' as const }) },
    abortAll: () => undefined,
  }
  return { client, calls }
}

describe('editing a draft unit and topic before accepting', () => {
  it('Edit then accept shows Unit and Topic; the PATCH carries them only when they changed', async () => {
    const f = fake()
    m = mount(<DraftsPanel client={f.client} subject="signals" defaultOpen />)
    await flush(0)
    await click(byText('button', 'Edit then accept'))
    const inputs = Array.from(m.container.querySelectorAll<HTMLInputElement>('.pp-draft-where input'))
    expect(inputs).toHaveLength(2)
    expect(inputs[0].value).toBe('2')
    expect(inputs[1].value).toBe('Sampling')
    await type(inputs[0], '3')
    await type(inputs[1], 'Aliasing')
    await click(byText('button', 'Accept edited'))
    expect(f.calls[0]).toBe('decide:d-1:{"status":"accepted","marks":4,"unit":3,"topic":"Aliasing"}')
  })
  it('an edit that changes neither sends neither', async () => {
    const f = fake()
    m = mount(<DraftsPanel client={f.client} subject="signals" defaultOpen />)
    await flush(0)
    await click(byText('button', 'Edit then accept'))
    await click(byText('button', 'Accept edited'))
    expect(f.calls[0]).toBe('decide:d-1:{"status":"accepted","marks":4}')
  })
})

describe('the import tray on a touch-width screen', () => {
  const hover = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })) })
  it('opens on a press or a focus, not under a resting pointer', async () => {
    const restore = stubMatchMedia({ 'max-width: 700px': true })
    m = mount(<ImportTray routes={[]} queued={[]} onFiles={() => undefined} accept={PAPER_ACCEPT} />)
    hover(q('.pp-drop-btn')!)
    expect(q('.pp-tray')!.dataset.open).toBe('false')
    await act(async () => { q('.pp-drop-btn')!.focus() })
    expect(q('.pp-tray')!.dataset.open).toBe('true')
    restore()
  })
  it('above 700 px a hover still opens it', () => {
    const restore = stubMatchMedia({ 'max-width: 700px': false })
    m = mount(<ImportTray routes={[]} queued={[]} onFiles={() => undefined} accept={PAPER_ACCEPT} />)
    hover(q('.pp-drop-btn')!)
    expect(q('.pp-tray')!.dataset.open).toBe('true')
    restore()
  })
})
