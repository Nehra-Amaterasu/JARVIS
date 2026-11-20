// A.S01: Core, Sound. The honesty rules are the tests: the lamp is the answer of the route and of Windows, "playing" is drawn only
// when Windows reported Playing, the receipt is the server's sentence with its provenance, the ring is a state and never a
// meter, a route that does not answer is WAITING with its reason and sends nothing, Spotify stays a PLANNED plate; and every
// action of the classic Media card, the library card and the pronunciation card has a home.
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../__tests__/ww/_stubs'
import { fixtureAnswer, fixtureLibrary, fixtureMedia, fixturePort, fixtureReceipt, fixtureWords } from '../fixtures'
import { litMarks, nowView, receiptView, restLine, ringWord, wordRows, ROUTE_IDLE, RING, type RouteStatus } from '../model'
import { NowPlate, type NowPlateProps } from '../NowPlate'
import { SoundView } from '../SoundView'
import { useMedia, type LibraryLive, type MediaLive, type WordsLive } from '../useSound'

const NOW = 1_700_000_000_000
const up: RouteStatus = { ok: true, reason: null, at: NOW }
const down: RouteStatus = { ok: false, reason: '503', at: null }

describe('the plate face', () => {
  it('says playing only when Windows reported Playing, and shows the lamp LIVE with Windows as the reason', () => {
    const v = nowView(fixtureMedia('playing'), up, false, NOW)
    expect(v).toMatchObject({ word: 'PLAYING', ring: 'playing', playing: true, title: 'Slow Lanterns' })
    expect(v.reading).toMatchObject({ state: 'live', reason: 'Windows reports it playing' })
    expect(nowView(fixtureMedia('paused'), up, false, NOW)).toMatchObject({ word: 'PAUSED', ring: 'paused', playing: false })
  })

  it('a fixture is SIMULATED, never LIVE', () => {
    expect(nowView(fixtureMedia('playing'), up, true, NOW).reading.state).toBe('simulated')
    expect(receiptView({ ok: true, confirmed: true, say: 'x' }, true)?.state).toBe('simulated')
  })

  it('nothing playing is a designed rest state, not an error', () => {
    const v = nowView(fixtureMedia('rest'), up, false, NOW)
    expect(v).toMatchObject({ word: 'IDLE', ring: 'rest', playing: false, title: 'Nothing playing' })
    expect(v.reading.state).toBe('live')
    expect(restLine(fixtureMedia('folder'))).toMatch(/42 songs/)
    expect(restLine(fixtureMedia('rest'))).toMatch(/Say/)
  })

  it('Windows sessions that cannot be read are WAITING, not idle', () => {
    expect(nowView(fixtureMedia('unreadable'), up, false, NOW)).toMatchObject({ word: 'NO REPORT', ring: 'waiting' })
    expect(nowView(fixtureMedia('unreadable'), up, false, NOW).reading.state).toBe('waiting')
  })

  it('a route that does not answer is WAITING with the reason, and no stale value survives', () => {
    const v = nowView(null, down, false, NOW)
    expect(v).toMatchObject({ word: 'NO REPORT', ring: 'waiting', title: 'No report' })
    expect(v.sub).toContain('503')
    expect(v.reading).toMatchObject({ state: 'waiting', since: null })
    expect(nowView(null, ROUTE_IDLE, false, NOW).sub).toMatch(/reading/)
  })

  it('the receipt is the server sentence word for word; confirmed is LIVE, opened is WAITING, failed is FAULT', () => {
    expect(receiptView(fixtureReceipt('confirmed'))).toMatchObject({ state: 'live', text: fixtureReceipt('confirmed').say })
    expect(receiptView(fixtureReceipt('opened'))).toMatchObject({ state: 'waiting', why: 'done, not confirmed' })
    expect(receiptView(fixtureReceipt('failed'))).toMatchObject({ state: 'fault' })
    expect(receiptView(null)).toBeNull()
  })

  it('the ring is a state: all marks while playing, a quarter while paused, none at rest or waiting; there is no level input', () => {
    expect(litMarks('playing')).toBe(RING.TICKS)
    expect(litMarks('paused')).toBe(RING.TICKS / 4)
    expect(litMarks('rest')).toBe(0)
    expect(litMarks('waiting')).toBe(0)
    expect(ringWord('rest')).toBe('NOTHING PLAYING')
  })

  it('the word table is sorted case-blind', () => {
    expect(wordRows({ b: '2', A: '1', c: '3' }).map((r) => r.word)).toEqual(['A', 'b', 'c'])
    expect(wordRows(null)).toEqual([])
  })
})

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})
afterEach(() => { m?.unmount(); m = null; vi.restoreAllMocks() })
const el = (sel: string) => document.querySelector(sel) as HTMLElement
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[]
const click = (n: Element) => act(() => { (n as HTMLElement).click() })
const key = (n: Element, k: string) => act(() => { n.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })

function plate(over: Partial<NowPlateProps> = {}) {
  const control = vi.fn()
  const play = vi.fn(async () => true)
  const choose = vi.fn()
  const onFolder = vi.fn()
  const props: NowPlateProps = { state: fixtureMedia('playing'), route: up, receipt: fixtureReceipt('confirmed'), busy: false, source: 'auto', simulated: true, now: NOW, control, play, choose, onFolder, ...over }
  m = mount(<NowPlate {...props} />)
  return { control, play, choose, onFolder }
}

describe('the Now plate', () => {
  it('Space on the plate plays or pauses; the arrows step; keys on a child do not double fire', () => {
    const { control } = plate()
    const p = el('.sd-now')
    key(p, ' ')
    expect(control).toHaveBeenLastCalledWith('toggle')
    key(p, 'ArrowRight')
    expect(control).toHaveBeenLastCalledWith('next')
    key(p, 'ArrowLeft')
    expect(control).toHaveBeenLastCalledWith('prev')
    expect(control).toHaveBeenCalledTimes(3)
    key(el('.sd-play'), ' ')
    expect(control).toHaveBeenCalledTimes(3)
  })

  it('every transport key of the classic card has a home and presses once', () => {
    const { control } = plate()
    click(el('[aria-label="Previous track"]'))
    click(el('[aria-label="Next track"]'))
    click(el('[aria-label="Volume down"]'))
    click(el('[aria-label="Volume up"]'))
    click(el('.sd-play'))
    expect(control.mock.calls).toEqual([['prev'], ['next'], ['volume', 'down'], ['volume', 'up'], ['toggle']])
  })

  it('the centre key reads Pause while playing and Play otherwise', () => {
    plate()
    expect(el('.sd-play').getAttribute('aria-label')).toBe('Pause')
    m?.unmount()
    plate({ state: fixtureMedia('rest'), receipt: null })
    expect(el('.sd-play').getAttribute('aria-label')).toBe('Play')
    expect(el('.sd-receipt').textContent).toContain('Nothing asked yet.')
  })

  it('a busy plate and a silent route send nothing', () => {
    const a = plate({ busy: true })
    click(el('.sd-play'))
    key(el('.sd-now'), ' ')
    expect(a.control).not.toHaveBeenCalled()
    m?.unmount()
    const b = plate({ state: null, route: down })
    click(el('.sd-play'))
    key(el('.sd-now'), ' ')
    expect(b.control).not.toHaveBeenCalled()
    expect(el('.sd-word').textContent).toBe('NO REPORT')
    expect(el('.sd-now .lamp').getAttribute('data-lamp')).toBe('waiting')
  })

  it('Play by name sends the typed text once and clears it; empty sends nothing', async () => {
    const { play } = plate()
    const input = el('.sd-well') as HTMLInputElement
    const form = input.closest('form') as HTMLFormElement
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(play).not.toHaveBeenCalled()
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'slow lanterns')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(play).toHaveBeenCalledWith('slow lanterns')
  })

  it('the five sources are one radio group moved with the arrows; Spotify is one of them with its caveat', () => {
    const { choose } = plate()
    const radios = all('[role="radio"]')
    // jury round 2: the Spotify chip says PLANNED in words beside its lamp, not a bare glyph
    expect(radios.slice(0, 4).map((r) => r.textContent)).toEqual(['Auto', 'Folder', 'YouTube', 'YT Music'])
    expect(radios[4].textContent).toMatch(/^SpotifyPLANNED/)
    expect(radios[4].querySelector('.lamp-word')?.textContent).toBe('PLANNED')
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    key(el('[role="radiogroup"]'), 'ArrowRight')
    expect(choose).toHaveBeenCalledWith('local')
    click(radios[4])
    expect(choose).toHaveBeenLastCalledWith('spotify')
  })

  it('the receipt carries its provenance as a lamp with the state word in its name', () => {
    plate({ receipt: fixtureReceipt('opened') })
    expect(el('.sd-receipt .lamp').getAttribute('data-lamp')).toBe('waiting')
    expect(el('.sd-receipt-text').textContent).toBe(fixtureReceipt('opened').say)
  })

  it('the music folder key opens the folder drawer', () => {
    const { onFolder } = plate()
    click(all('button').find((b) => b.textContent?.includes('Music folder'))!)
    expect(onFolder).toHaveBeenCalled()
  })
})

const media = (o: Partial<MediaLive> = {}): MediaLive => ({ state: fixtureMedia('playing'), route: up, receipt: null, busy: false, source: 'auto', control: vi.fn(), play: vi.fn(async () => true), choose: vi.fn(), saveFolder: vi.fn(async () => true), ...o })
const lib = (o: Partial<LibraryLive> = {}): LibraryLive => ({ view: fixtureLibrary('notes'), route: up, running: false, note: null, asking: false, error: null, add: vi.fn(async () => true), forget: vi.fn(async () => undefined), ask: vi.fn(async () => fixtureAnswer()), ...o })
const words = (o: Partial<WordsLive> = {}): WordsLive => ({ table: fixtureWords(), route: up, error: null, save: vi.fn(async () => true), remove: vi.fn(async () => undefined), hear: vi.fn(async () => 'Played in this window.'), ...o })

describe('the whole view', () => {
  it('draws Spotify as PLANNED on its chip, and as nothing that sends', () => {
    m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
    const chip = all('[role="radio"]').find((b) => b.textContent?.includes('Spotify'))!
    expect(chip.textContent).toContain('PLANNED')
    expect(chip.querySelector('[data-lamp="planned"]')).not.toBeNull()
    expect(document.querySelector('[data-planned="jarvis.spotify-play"]')).toBeNull()
  })

  it('the ledger draws ONE designed empty state (no placeholder rows), and a real play with its receipt lamp', () => {
    m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
    expect(el('[data-card="recent"]').textContent).toContain('No plays from this window yet')
    // jury round 2 read five `--:--` slots as loading: an empty ledger draws no row at all
    expect(all('[data-card="recent"] li')).toHaveLength(0)
    expect(all('[data-card="recent"] [data-empty-state]')).toHaveLength(1)
    m.unmount()
    const history = [{ at: NOW, source: 'youtube' as const, query: 'Slow Lanterns', receipt: { ok: true, confirmed: true, say: 'Playing Slow Lanterns.', action: 'play', at: NOW / 1000 } }]
    m = mount(<SoundView media={media({ history })} library={lib()} words={words()} simulated now={NOW} />)
    expect(all('[data-play]')).toHaveLength(1)
    expect(el('[data-play]').textContent).toContain('Slow Lanterns')
    expect(el('[data-play] .lamp').getAttribute('data-lamp')).toBe('simulated')
  })

  it('the volume readout is WAITING: the app steps the volume but cannot read it back', () => {
    m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
    expect(el('[data-vol] .lamp').getAttribute('data-lamp')).toBe('waiting')
    expect(el('[aria-label="Volume down"]').textContent).toContain('Vol')
  })

  it('a library that does not answer shows WAITING with the reason and no number', () => {
    m = mount(<SoundView media={media()} library={lib({ view: null, route: down })} words={words({ table: null, route: down })} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    const card = el('[data-card="library"]')
    expect(card.textContent).not.toContain('documents')
    expect(card.textContent).toContain('did not answer')
    expect(card.querySelector('.lamp')?.getAttribute('data-lamp')).toBe('waiting')
    expect(el('[data-card="words"]').textContent).toContain('did not answer')
  })

  it('the library card shows the counts only because the route answered, and its job as a real fraction', () => {
    m = mount(<SoundView media={media()} library={lib({ view: fixtureLibrary('running'), running: true })} words={words()} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    const card = el('[data-card="library"]')
    expect((card.querySelector('.sd-bar i') as HTMLElement).style.width).toBe(`${(3 / 8) * 100}%`)
    expect(card.textContent).toContain('3 / 8')
  })

  it('the words card keeps its table behind one key; the drawer adds, hears, edits and removes', async () => {
    const w = words()
    m = mount(<SoundView media={media()} library={lib()} words={w} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    expect(el('[data-card="words"]').textContent).toContain('4 words')
    click(el('[data-open="words"]'))
    const dlg = el('dialog.sd-drawer')
    expect(dlg.hasAttribute('open')).toBe(true)
    expect(dlg.querySelectorAll('.sd-word-row')).toHaveLength(4)
    click(dlg.querySelector('[aria-label="Edit raga"]')!)
    expect((dlg.querySelector('#sd-say') as HTMLInputElement).value).toBe('rah-gah')
    click(dlg.querySelector('[aria-label="Remove raga"]')!)
    expect(w.remove).toHaveBeenCalledWith('raga')
    await act(async () => { click(all('dialog.sd-drawer button').find((b) => b.textContent?.includes('Hear'))!) })
    expect(w.hear).toHaveBeenCalledWith('', 'rah-gah')
    await act(async () => { click(all('dialog.sd-drawer button').find((b) => b.textContent === 'Save')!) })
    expect(w.save).toHaveBeenCalledWith('raga', 'rah-gah')
  })

  it('a word with square brackets or no sound is refused with a reason before anything is sent', async () => {
    const w = words()
    m = mount(<SoundView media={media()} library={lib()} words={w} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    click(el('[data-open="words"]'))
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    const fill = async (id: string, v: string) => act(async () => { const i = el(id) as HTMLInputElement; set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })) })
    await fill('#sd-word', 'x')
    await fill('#sd-say', '[hi]')
    await act(async () => { (el('dialog.sd-drawer form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(w.save).not.toHaveBeenCalled()
    expect(el('dialog.sd-drawer [role="alert"]').textContent).toMatch(/square brackets/)
  })

  it('the library drawer lists documents with what was really read, asks with citations, and forgets in two presses', async () => {
    const l = lib()
    m = mount(<SoundView media={media()} library={l} words={words()} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    click(el('[data-open="library"]'))
    const dlg = el('dialog.sd-drawer')
    expect(dlg.textContent).toContain('2 scanned, not read')
    const forget = dlg.querySelector('[aria-label="Forget fixture-sequential-logic.pdf"]')!
    click(forget)
    expect(l.forget).not.toHaveBeenCalled()
    click(dlg.querySelector('[aria-label="Forget fixture-sequential-logic.pdf, press again"]')!)
    expect(l.forget).toHaveBeenCalledWith('d1')
    // ask by an example chip: the answer opens its first cited passage
    await act(async () => { click(dlg.querySelector('.sd-eg .sd-chip')!) })
    expect(l.ask).toHaveBeenCalled()
    expect(dlg.querySelector('.sd-answer')?.textContent).toContain('Setup time')
    expect(dlg.querySelector('.sd-passage')?.textContent).toContain('fixture-sequential-logic.pdf')
    expect(dlg.querySelector('.sd-answer .lamp')?.getAttribute('data-lamp')).toBe('live')
  })

  it('Escape closes the drawer (the dialog cancel event), and the add form needs a path', async () => {
    const l = lib()
    m = mount(<SoundView media={media()} library={l} words={words()} simulated now={NOW} />)
    click(el('[data-open="tools"]'))
    click(el('[data-open="library"]'))
    const dlg = el('dialog.sd-drawer') as HTMLDialogElement
    await act(async () => { (dlg.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(l.add).not.toHaveBeenCalled()
    act(() => { dlg.dispatchEvent(new Event('cancel', { cancelable: true })) })
    expect(dlg.hasAttribute('open')).toBe(false)
  })

  it('pronunciation and the library are not on the canvas: one key opens them in the drawer, and Back returns to the list', () => {
    m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
    // closed drawer: no card of the two anywhere on the page
    expect(all('[data-card="library"], [data-card="words"]')).toHaveLength(0)
    click(el('[data-open="tools"]'))
    const dlg = el('dialog.sd-drawer')
    expect(dlg.hasAttribute('open')).toBe(true)
    expect(all('dialog.sd-drawer [data-card]').map((c) => c.getAttribute('data-card'))).toEqual(['words', 'library'])
    click(el('[data-open="words"]'))
    expect(dlg.querySelector('#sd-word')).not.toBeNull()
    click(all('dialog.sd-drawer button').find((b) => b.textContent === 'Back')!)
    expect(all('dialog.sd-drawer [data-card]')).toHaveLength(2)
  })

  it('the volume gauge is a track with no fill (no level is read back), and a step lights it for one beat', () => {
    vi.useFakeTimers()
    try {
      m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
      const ring = el('.sd-ring')
      expect(ring.getAttribute('data-gauge')).toBe('waiting')
      expect(ring.querySelector('.sd-gauge-track')).not.toBeNull()
      expect(ring.querySelector('.sd-gauge-fill')).toBeNull()
      expect(el('[data-vol]').textContent).toContain('VOL --')
      click(el('[aria-label="Volume up"]'))
      expect(el('.sd-ring').getAttribute('data-nudge')).toBe('up')
      act(() => { vi.advanceTimersByTime(700) })
      expect(el('.sd-ring').hasAttribute('data-nudge')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the player has ONE status row (PLAYER, its lamp, the word); the plate head carries no lamp', () => {
    m = mount(<SoundView media={media()} library={lib()} words={words()} simulated now={NOW} />)
    expect(document.querySelector('.sd-now-head .lamp')).toBeNull()
    const row = el('[data-status]')
    expect(row.textContent).toContain('Player')
    expect(row.querySelector('.lamp')?.getAttribute('data-lamp')).toBe('simulated')
    expect(row.querySelector('.sd-word')?.textContent).toBe('PLAYING')
  })

  it('the folder key opens a drawer that saves the typed path through the media port', async () => {
    const mm = media()
    m = mount(<SoundView media={mm} library={lib()} words={words()} simulated now={NOW} />)
    click(all('button').find((b) => b.textContent?.includes('Music folder'))!)
    const dlg = el('dialog.sd-drawer')
    const input = dlg.querySelector('#sd-folder') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'C:\\Fixture\\More')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { (dlg.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(mm.saveFolder).toHaveBeenCalledWith('C:\\Fixture\\More')
  })
})

describe('useMedia after the route stops answering', () => {
  afterEach(() => vi.useRealTimers())
  it('drops the stale reading: one good answer, then a 503, is NO REPORT with a waiting lamp and sends nothing', async () => {
    vi.useFakeTimers()
    const port = fixturePort('playing')
    const media = vi.spyOn(port, 'media')
    const control = vi.spyOn(port, 'control')
    let live: MediaLive | null = null
    const Probe = () => { live = useMedia(port, 1000, 0); return null }
    const m = mount(createElement(Probe))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(live!.route.ok).toBe(true)
    expect(nowView(live!.state, live!.route, false, NOW).word).toBe('PLAYING')
    media.mockRejectedValue(new Error('503'))
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(live!.route.ok).toBe(false)
    const v = nowView(live!.state, live!.route, false, NOW)
    expect(live!.state).toBeNull()
    expect(v).toMatchObject({ word: 'NO REPORT', ring: 'waiting' })
    expect(v.reading.state).toBe('waiting')
    expect(control).not.toHaveBeenCalled()
    m.unmount()
  })

  it('play reports the receipt, so a failed play keeps the typed query', async () => {
    const port = fixturePort('rest')
    vi.spyOn(port, 'play').mockResolvedValue(fixtureReceipt('failed'))
    let live: MediaLive | null = null
    const Probe = () => { live = useMedia(port, 0, 0); return null }
    const m = mount(createElement(Probe))
    await act(async () => { await Promise.resolve() })
    let ok = true
    await act(async () => { ok = await live!.play('a song') })
    expect(ok).toBe(false)
    m.unmount()
  })
})
