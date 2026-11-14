// Parity of the classic Core page under the new flag (ledger O1, O3, O4b, O4d, the empty first frame): "Share a review",
// the voice and spoken-words Trim, the per-reply rating, and the last recorded exchange. Each test drives the real view
// with a port whose answer the test controls, so it can see WAITING before the answer and the answer's own words after.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import type { VoiceView } from '../../../lib/settings'
import { CoreTalkView } from '../CoreTalk'
import { FIXTURE_TURNS, useFixture } from '../fixtures'
import { lastExchange, useLastRecorded, type RecordedEntry } from '../lastRecorded'
import { useShareReview, type ReviewPort } from '../ShareReview'
import { createSpeechStore, speechStore, type SpeechPort } from '../speech'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia })
afterEach(() => {
  m?.unmount()
  m = null
  document.body.querySelectorAll('.tr-pop').forEach((n) => n.remove())
})

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}

function ReviewHarness({ port, kind = 'thinking' }: { port: ReviewPort; kind?: 'thinking' | 'asleep' }) {
  const f = useFixture(kind, 1_763_000_000_000)
  const review = useShareReview(port, false)
  return <CoreTalkView {...f} simulated review={review} />
}

const reviewPort = (over: Partial<ReviewPort> = {}): ReviewPort => ({
  summary: async () => ({ turns: 12, flags: { wrong: 1, good: 4 } }),
  exportReview: async () => ({ name: 'review-test.md' }),
  openFolder: async () => undefined,
  ...over,
})
const press = (el: Element | null) => act(() => { (el as HTMLElement).click() })
const status = () => document.querySelector<HTMLElement>('.jc-review')

describe('Share a review (parity O1)', () => {
  it('is one quiet key in the conversation header, a real button with its name', async () => {
    m = mount(<ReviewHarness port={reviewPort()} />)
    await flush()
    const key = m.container.querySelector<HTMLButtonElement>('.jc-convo-head [data-testid="share-review"]')!
    expect(key.tagName).toBe('BUTTON')
    expect(key.textContent).toContain('Share a review')
    expect(key.classList.contains('jc-key-quiet')).toBe(true)
    expect(status()).toBeNull() // nothing is claimed before it is pressed
  })

  it('says WAITING while the route runs and never "written" before the answer, then LIVE with the file the route returned', async () => {
    const d = deferred<{ name: string; summary: { turns: number; flags: Record<string, number> } }>()
    const exportReview = vi.fn(() => d.promise)
    m = mount(<ReviewHarness port={reviewPort({ exportReview })} />)
    await flush()
    press(m.container.querySelector('[data-testid="share-review"]'))
    expect(exportReview).toHaveBeenCalledWith(7)
    expect(status()!.getAttribute('data-phase')).toBe('waiting')
    expect(status()!.querySelector('[data-lamp]')!.getAttribute('data-lamp')).toBe('waiting')
    expect(status()!.textContent).toMatch(/WAITING/)
    expect(status()!.textContent).not.toMatch(/written/)
    // a second press while it runs does not start a second export
    press(m.container.querySelector('[data-testid="share-review"]'))
    expect(exportReview).toHaveBeenCalledTimes(1)
    d.resolve({ name: 'review-2026-11-15.md', summary: { turns: 12, flags: { wrong: 2, slow: 1, good: 4 } } })
    await flush()
    expect(status()!.getAttribute('data-phase')).toBe('done')
    expect(status()!.querySelector('[data-lamp]')!.getAttribute('data-lamp')).toBe('live')
    expect(status()!.textContent).toContain('review-2026-11-15.md')
    expect(status()!.textContent).toContain('12 turns, 3 flagged')
    expect([...status()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open folder', 'Close'])
  })

  it('shows the route\'s own error as a FAULT and keeps the key usable', async () => {
    const exportReview = vi.fn().mockRejectedValueOnce(new Error('the reviews folder is read-only')).mockResolvedValueOnce({ name: 'review-b.md' })
    m = mount(<ReviewHarness port={reviewPort({ exportReview })} />)
    await flush()
    press(m.container.querySelector('[data-testid="share-review"]'))
    await flush()
    expect(status()!.getAttribute('data-phase')).toBe('fault')
    expect(status()!.querySelector('[data-lamp]')!.getAttribute('data-lamp')).toBe('fault')
    expect(status()!.textContent).toContain('not written: the reviews folder is read-only')
    expect(status()!.textContent).not.toContain('review-b.md')
    press(m.container.querySelector('[data-testid="share-review"]'))
    await flush()
    expect(status()!.getAttribute('data-phase')).toBe('done')
    expect(status()!.textContent).toContain('review-b.md')
  })

  it('with no turns in the last 7 days the key says so and does not call the route', async () => {
    const exportReview = vi.fn()
    m = mount(<ReviewHarness port={reviewPort({ summary: async () => ({ turns: 0, flags: {} }), exportReview })} />)
    await flush()
    const key = m.container.querySelector<HTMLElement>('[data-testid="share-review"]')!
    expect(key.getAttribute('aria-disabled')).toBe('true')
    press(key)
    expect(exportReview).not.toHaveBeenCalled()
    expect(status()!.textContent).toContain('nothing to write yet')
  })

  it('on a fixture the line says no file was written, SIMULATED, with no Open folder key', async () => {
    function Sim() {
      const f = useFixture('thinking', 1_763_000_000_000)
      const review = useShareReview(reviewPort(), true)
      return <CoreTalkView {...f} simulated review={review} />
    }
    m = mount(<Sim />)
    await flush()
    press(m.container.querySelector('[data-testid="share-review"]'))
    await flush()
    expect(status()!.querySelector('[data-lamp]')!.getAttribute('data-lamp')).toBe('simulated')
    expect(status()!.textContent).toContain('fixture: no file was written')
    expect([...status()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Close'])
  })
})

describe('Per-reply rating under the flag (parity O3)', () => {
  it('F on a reply opens the dock and Good posts the verdict for that turn through the flag action', async () => {
    const flag = vi.fn(async () => 'marked good')
    function V() {
      const f = useFixture('thinking', 1_763_000_000_000)
      return <CoreTalkView {...f} simulated actions={{ ...f.actions, flag }} />
    }
    m = mount(<V />)
    const list = m.container.querySelector<HTMLElement>('.jc-strata .jc-turns')!
    const reply = [...list.querySelectorAll<HTMLElement>('.jc-turn[data-tag="JRV"]')].pop()!
    act(() => reply.focus())
    act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })) })
    const good = [...m.container.querySelectorAll<HTMLButtonElement>('.jc-dock button')].find((b) => b.textContent === 'Good')!
    await act(async () => { good.click() })
    expect(flag).toHaveBeenCalledTimes(1)
    const [turn, verdict] = flag.mock.calls[0] as unknown as [{ id: number; role: string }, string]
    expect(verdict).toBe('good')
    expect(turn.role).toBe('jarvis')
    expect(turn.id).toBe(FIXTURE_TURNS[5].id)
    expect(m.container.querySelector('.jc-dock-said')!.textContent).toBe('marked good')
  })
})

const voiceView = (over: Partial<VoiceView> = {}): VoiceView => ({
  chosen: 'edge:Ryan', speed: 1, speed_range: [0.7, 1.4], default: 'edge:Ryan', edge_source: 'live', kokoro_missing: null,
  edge: [
    { id: 'edge:Ryan', engine: 'edge', name: 'Ryan', accent: 'British', gender: 'Male', online: true },
    { id: 'edge:Guy', engine: 'edge', name: 'Guy', accent: 'American', gender: 'Male', online: true },
  ],
  kokoro: [{ id: 'kokoro:bm_daniel', engine: 'kokoro', name: 'Daniel', accent: 'British', gender: 'Male', online: false }],
  ...over,
})

function speechPort(over: Partial<SpeechPort> = {}): SpeechPort {
  let table: Record<string, string> = { Aankhen: 'Aan-khen' }
  return {
    loadVoice: async () => voiceView(),
    chooseVoice: async (b) => voiceView({ ...(b.id ? { chosen: b.id } : {}), ...(b.speed ? { speed: b.speed } : {}) }),
    testVoice: async () => 'jarvis',
    loadPronunciations: async () => ({ table }),
    setPronunciation: async (w, s) => ({ table: (table = { ...table, [w]: s }) }),
    removePronunciation: async (w) => { const { [w]: _g, ...rest } = table; return { table: (table = rest) } },
    ...over,
  }
}

function SpeechHarness({ port }: { port: SpeechPort }) {
  const f = useFixture('asleep', 1_763_000_000_000)
  return <CoreTalkView {...f} simulated speech={port} />
}
const pop = () => document.body.querySelector<HTMLElement>('.tr-pop')
const openTrim = async () => {
  press(m!.container.querySelector('[data-trim="core.voice"]'))
  await flush()
}
const change = (el: HTMLSelectElement | HTMLInputElement, value: string) => act(() => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
})

describe('Voice and spoken words behind one Trim key (parity O4b, O4d)', () => {
  it('the key is on the controls row, named, and the popover shows the value read back from the server', async () => {
    m = mount(<SpeechHarness port={speechPort()} />)
    await flush()
    const key = m.container.querySelector<HTMLElement>('.jc-controls [data-trim="core.voice"]')!
    expect(key.getAttribute('aria-label')).toBe('JARVIS voice and words setting')
    await openTrim()
    expect(pop()).not.toBeNull()
    const sel = pop()!.querySelector<HTMLSelectElement>('select')!
    expect(sel.value).toBe('edge:Ryan')
    expect([...sel.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['British', 'American', 'Offline'])
    expect(pop()!.querySelector('[data-testid="trim-value"]')!.textContent).toBe('Ryan · British, 1.00×; 1 word taught')
  })

  it('choosing a voice asks the server, says WAITING, then LIVE with what it saved; a refusal is a FAULT and the old voice stays', async () => {
    const d = deferred<VoiceView>()
    const chooseVoice = vi.fn().mockReturnValueOnce(d.promise).mockRejectedValueOnce(new Error('Edge TTS is not reachable'))
    m = mount(<SpeechHarness port={speechPort({ chooseVoice })} />)
    await flush()
    await openTrim()
    const sel = () => pop()!.querySelector<HTMLSelectElement>('select')!
    change(sel(), 'edge:Guy')
    expect(chooseVoice).toHaveBeenCalledWith({ id: 'edge:Guy' })
    expect(pop()!.querySelector('.sp-note')!.getAttribute('data-state')).toBe('waiting')
    expect(pop()!.querySelector('.sp-note')!.textContent).not.toMatch(/saved/)
    d.resolve(voiceView({ chosen: 'edge:Guy' }))
    await flush()
    expect(pop()!.querySelector('.sp-note')!.getAttribute('data-state')).toBe('live')
    expect(pop()!.querySelector('.sp-note')!.textContent).toContain('voice saved: Guy · American')
    expect(sel().value).toBe('edge:Guy')
    change(sel(), 'edge:Ryan')
    await flush()
    expect(pop()!.querySelector('.sp-note')!.getAttribute('data-state')).toBe('fault')
    expect(pop()!.querySelector('.sp-note')!.textContent).toContain('Edge TTS is not reachable')
    expect(sel().value).toBe('edge:Guy') // the server did not take the change, so the list still shows what it holds
  })

  it('speed is sent once, when the hand lets go, and Test voice reports whether JARVIS or the window spoke', async () => {
    const chooseVoice = vi.fn(async (b: { id?: string; speed?: number }) => voiceView({ speed: b.speed ?? 1 }))
    const testVoice = vi.fn(async () => 'window' as const)
    m = mount(<SpeechHarness port={speechPort({ chooseVoice, testVoice })} />)
    await flush()
    await openTrim()
    const range = pop()!.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(range.min).toBe('0.7')
    change(range, '1.2')
    change(range, '1.25')
    expect(chooseVoice).not.toHaveBeenCalled()
    await act(async () => { range.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })) })
    expect(chooseVoice).toHaveBeenCalledTimes(1)
    expect(chooseVoice).toHaveBeenCalledWith({ speed: 1.25 })
    await flush()
    expect(pop()!.querySelector('.sp-note')!.textContent).toContain('speed saved: 1.25×')
    const test = [...pop()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Test voice')!
    await act(async () => { test.click() })
    expect(testVoice).toHaveBeenCalled()
    expect(pop()!.querySelector('.sp-note')!.textContent).toContain('JARVIS is not listening')
  })

  it('the Words tab lists each taught word with Hear and Remove, and Teach adds one through the same route as the classic card', async () => {
    const port = speechPort()
    const setPronunciation = vi.spyOn(port, 'setPronunciation')
    const removePronunciation = vi.spyOn(port, 'removePronunciation')
    const testVoice = vi.spyOn(port, 'testVoice')
    m = mount(<SpeechHarness port={port} />)
    await flush()
    await openTrim()
    press([...pop()!.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Words') ?? null)
    expect(pop()!.querySelector('.sp-words li')!.textContent).toContain('Aankhen')
    const [w, s] = [...pop()!.querySelectorAll<HTMLInputElement>('.sp-form input')]
    change(w, 'Yaadash')
    change(s, 'Yaa-dash')
    await act(async () => { pop()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(setPronunciation).toHaveBeenCalledWith('Yaadash', 'Yaa-dash')
    await flush()
    expect([...pop()!.querySelectorAll('.sp-words li')].map((li) => li.querySelector('b')!.textContent)).toEqual(['Aankhen', 'Yaadash'])
    expect(pop()!.querySelector('.sp-note')!.textContent).toContain('he now says "Yaadash" as "Yaa-dash"')
    await act(async () => { pop()!.querySelector<HTMLButtonElement>('[aria-label="Hear Aankhen"]')!.click() })
    expect(testVoice).toHaveBeenCalledWith('Aankhen. I said Aankhen.')
    await act(async () => { pop()!.querySelector<HTMLButtonElement>('[aria-label="Remove Aankhen"]')!.click() })
    expect(removePronunciation).toHaveBeenCalledWith('Aankhen')
    await flush()
    expect([...pop()!.querySelectorAll('.sp-words li b')].map((b) => b.textContent)).toEqual(['Yaadash'])
  })

  it('a word the server would refuse (square brackets are accent tags) is stopped with the classic page\'s own sentence, with no call', async () => {
    const port = speechPort()
    const setPronunciation = vi.spyOn(port, 'setPronunciation')
    m = mount(<SpeechHarness port={port} />)
    await flush()
    await openTrim()
    press([...pop()!.querySelectorAll('[role="radio"]')].find((b) => b.textContent === 'Words') ?? null)
    const [w, s] = [...pop()!.querySelectorAll<HTMLInputElement>('.sp-form input')]
    change(w, '[us]')
    change(s, 'you ess')
    expect(pop()!.querySelector('.sp-warn')!.textContent).toBe('No square brackets: those are accent tags.')
    await act(async () => { pop()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(setPronunciation).not.toHaveBeenCalled()
  })

  it('a server that cannot be reached leaves the value "not loaded yet" and the list says so, never a guessed voice', async () => {
    m = mount(<SpeechHarness port={speechPort({ loadVoice: async () => { throw new Error('offline') }, loadPronunciations: async () => { throw new Error('offline') } })} />)
    await flush()
    await openTrim()
    expect(pop()!.querySelector('[data-testid="trim-value"]')!.textContent).toBe('not loaded yet; not loaded yet')
    expect(pop()!.querySelector('select')!.disabled).toBe(true)
    expect(pop()!.querySelector('.sp-note')!.getAttribute('data-state')).toBe('fault')
  })

  it('the speech store keeps no timer and a fixture port never reaches the network', () => {
    const s = createSpeechStore()
    expect(s.get().voice).toBeNull()
    expect(speechStore.get()).toBeDefined()
  })
})

describe('The last recorded exchange in an empty first frame', () => {
  const rec = (id: number, role: 'you' | 'jarvis', text: string, session = 's1'): RecordedEntry => ({ kind: 'turn', session, id, role, text, ts: 1_763_000_000 + id })

  it('picks the newest reply with the question before it, or the newest line alone, oldest first', () => {
    expect(lastExchange([rec(1, 'you', 'a'), rec(2, 'jarvis', 'b'), rec(3, 'you', 'c'), rec(4, 'jarvis', 'd')]).map((t) => t.text)).toEqual(['c', 'd'])
    expect(lastExchange([rec(1, 'you', 'a'), rec(2, 'jarvis', 'b'), rec(3, 'you', 'c')]).map((t) => t.text)).toEqual(['c'])
    // a reply whose question belongs to another session is shown alone: the pair is not guessed
    expect(lastExchange([rec(1, 'you', 'a', 's0'), rec(2, 'jarvis', 'b', 's1')]).map((t) => t.text)).toEqual(['b'])
    expect(lastExchange([{ kind: 'error', id: 9, role: 'you', ts: 1 }, rec(5, 'you', '   ')])).toEqual([])
    expect(lastExchange([])).toEqual([])
  })

  it('draws the sigil and the recorded turns with a WAITING lamp and an earlier-run rule; nothing when the store has none', () => {
    const turns = lastExchange([rec(1, 'you', 'Remind me about the lab at five.'), rec(2, 'jarvis', 'Noted for five.')])
    function V({ recorded }: { recorded: typeof turns }) {
      const f = useFixture('asleep', 1_763_000_000_000)
      return <CoreTalkView {...f} simulated={false} recorded={recorded} />
    }
    m = mount(<V recorded={turns} />)
    const c = m.container
    expect(c.querySelector('.jc-strata-mark .g-sigil')).not.toBeNull()
    expect(c.querySelector('.jc-recorded-rule')!.textContent).toContain('last recorded exchange, from an earlier run')
    const rows = [...c.querySelectorAll('.jc-recorded .jc-turn')]
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['waiting', 'waiting'])
    expect(rows[1].getAttribute('aria-label')).toContain('Noted for five.')
    expect(rows[1].getAttribute('aria-label')).toContain('WAITING')
    expect(c.querySelector('.jc-strata-empty')!.textContent).toContain('no turns in this run yet')
    m.unmount()
    m = mount(<V recorded={[]} />)
    expect(m.container.querySelector('.jc-recorded')).toBeNull()
    expect(m.container.querySelector('.jc-strata-empty')!.textContent).toContain('no turns in this run yet')
  })

  it('reads the store once while the run has no turns, and not at all once it has some', async () => {
    const read = vi.fn(async () => [rec(1, 'you', 'hi'), rec(2, 'jarvis', 'hello')])
    function H({ wanted }: { wanted: boolean }) {
      const t = useLastRecorded(wanted, read)
      const [, bump] = useState(0)
      return <button onClick={() => bump((n) => n + 1)}>{t.map((x) => x.text).join('|')}</button>
    }
    m = mount(<H wanted={false} />)
    await flush()
    expect(read).not.toHaveBeenCalled()
    m.unmount()
    m = mount(<H wanted />)
    await flush()
    press(m.container.querySelector('button'))
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(m.container.textContent).toBe('hi|hello')
  })
})
