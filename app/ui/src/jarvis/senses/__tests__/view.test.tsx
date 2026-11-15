// The three Senses views on fixtures (A.J03 accept list): at most one canvas per view, the amber stamp on simulated frames,
// every form hollow with no frames, no digit in the arc before the held-out check, the twin only when 3D is selected, and
// no forbidden word anywhere in the rendered text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { copyProblems } from '../model'
import { fixtureState, fixtureStore, type FixtureKind } from '../fixtures'
import { PresenceView } from '../PresenceView'
import { SignalView } from '../SignalView'
import { TeachView } from '../TeachView'

// the twin pulls WebGL in, which the test does not need: a stand-in marks where it would be
vi.mock('../TwinStage', () => ({ default: () => <div data-testid="twin-host" /> }))

let m: ReturnType<typeof mount> | null = null
// no server in a unit test: every call the desk makes on mount fails quietly, as it does with the app closed
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals() })

const store = fixtureStore()
const view = (v: 'presence' | 'signal' | 'teach', kind: FixtureKind, fixture = true) => {
  const props = { state: fixtureState(kind), store, fixture }
  return v === 'presence' ? <PresenceView {...props} /> : v === 'signal' ? <SignalView {...props} /> : <TeachView {...props} />
}
const text = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ')

describe('Presence', () => {
  it('holds one canvas, stamps simulated frames and draws the arc without a digit before the held-out check', () => {
    m = mount(view('presence', 'simulated'))
    const c = m.container
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
    expect(c.querySelector('.js-stamp-sim')?.textContent).toBe('SIMULATED')
    expect(c.querySelector('.js-arc')?.getAttribute('data-trusted')).toBe('false')
    const core = text(c.querySelector('.js-core')!)
    expect(core).toContain('PREDICTING')
    expect(core).toContain('signal estimate, 3 of 7 drill days')
    expect(core).not.toMatch(/\d+ ?%/)
    expect(c.querySelector('.js-terrain-legend')).toBeNull()
  })
  it('prints the one honest sentence', () => {
    m = mount(view('presence', 'simulated'))
    expect(m.container.querySelector('[data-testid="senses-sentence"]')?.textContent).toBe('Detects motion of anyone in range, identifies no one. One link, no pose.')
  })
  it('with no frames every form is hollow, with the reason in words, and no stamp', () => {
    m = mount(view('presence', 'none'))
    const c = m.container
    expect(c.querySelector('.js-terrain-legend')?.textContent).toBe('NO SIGNAL: shape is a placeholder')
    expect(c.querySelector('.js-stamp-sim')).toBeNull()
    expect(c.querySelectorAll('.js-dot-hollow')).toHaveLength(51)
    expect(text(c.querySelector('.js-core')!)).toContain('NO SIGNAL')
    expect(c.querySelector('.js-terrain')?.getAttribute('data-source')).toBe('none')
    // the Start key is the one accent fill while no source runs
    expect(c.querySelectorAll('.js-primary')).toHaveLength(1)
  })
  it('after the held-out day the number appears, as a model estimate', () => {
    m = mount(view('presence', 'trusted'))
    const core = text(m.container.querySelector('.js-core')!)
    expect(core).toContain('74 %')
    expect(core).toContain('model estimate, held-out day passed')
    expect(core).not.toContain('PREDICTING')
  })
  it('a server that does not answer is a FAULT lamp and draws no source', () => {
    m = mount(view('presence', 'offline'))
    expect(m.container.querySelector('.js-core [data-lamp="fault"]')).not.toBeNull()
    expect(m.container.querySelector('.js-presence')?.getAttribute('data-source')).toBe('none')
  })
  it('the tape is hatched for paused and blank is not proof: its caption says so', () => {
    m = mount(view('presence', 'simulated'))
    const c = m.container
    act(() => { [...c.querySelectorAll<HTMLElement>('.js-choice-sm button')].find((b) => b.textContent === 'Tape')!.click() })
    expect(c.querySelector('[data-testid="motion-tape"]')).not.toBeNull()
    expect(c.querySelector('.js-tape-seen')).not.toBeNull()
    expect(c.querySelector('.js-tape-paused')).not.toBeNull()
    expect(text(c.querySelector('.js-tape-caption')!)).toContain('Blank means nothing was seen, not that no one was there.')
  })
  it('the 3D twin mounts only when 3D is pressed, and the terrain canvas goes first', async () => {
    m = mount(view('presence', 'simulated', false))
    const c = m.container
    expect(c.querySelector('[data-testid="twin-host"]')).toBeNull()
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
    const key = [...c.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === '3D')!
    await act(async () => { key.click(); await new Promise((r) => setTimeout(r, 20)) })
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
    expect(c.querySelector('[data-testid="twin-host"]')).not.toBeNull()
    await act(async () => { key.click() })
    expect(c.querySelectorAll('canvas')).toHaveLength(1)
  })
  it('in a specimen the 3D key says why it does nothing', () => {
    m = mount(view('presence', 'simulated'))
    const key = [...m.container.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === '3D')!
    expect(key.getAttribute('aria-disabled')).toBe('true')
    expect(key.getAttribute('title')).toMatch(/not drawn in a specimen/)
  })
  it('every control is a real button, select or switch with a name', () => {
    m = mount(view('presence', 'simulated'))
    const unnamed = [...m.container.querySelectorAll<HTMLElement>('button, select, [role="radio"]')].filter((e) => !(e.getAttribute('aria-label') || e.textContent?.trim() || e.getAttribute('title')))
    expect(unnamed).toHaveLength(0)
  })
})

describe('Signal', () => {
  it('is SVG only: no canvas, 51 bars, the narration and the sentence', () => {
    m = mount(view('signal', 'simulated'))
    const c = m.container
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
    expect(c.querySelectorAll('.js-bar')).toHaveLength(51)
    expect(c.querySelector('.js-narration')?.textContent).toContain('Simulated: Motion score 3.2x against a threshold of 1.8x')
    expect(c.querySelector('[data-testid="senses-sentence"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="motion-score"]')?.textContent).toBe('3.2x')
  })
  it('with no frames the bars are hollow, the number is a dash and nothing is invented', () => {
    m = mount(view('signal', 'none'))
    const c = m.container
    expect(c.querySelectorAll('.js-bar[data-hollow="true"]')).toHaveLength(51)
    expect(c.querySelector('[data-testid="motion-score"]')?.textContent).toBe('--')
    expect(c.querySelector('.js-narration')?.textContent).toContain('No frames are arriving')
    expect(c.querySelector('.js-trace-hollow')).not.toBeNull()
  })
})

describe('Teach', () => {
  it('shows four rings with a real fraction each and says predicting until the last is lit', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    const rings = [...c.querySelectorAll('.js-ring')]
    expect(rings.map((r) => r.getAttribute('data-ring'))).toEqual(['room', 'quiet', 'drill', 'heldout'])
    expect(rings[2].querySelectorAll('.js-ring-seg')).toHaveLength(7)
    expect(rings[2].querySelectorAll('.js-ring-seg[data-on="true"]')).toHaveLength(3)
    expect(text(c)).toContain('Until the last ring is lit it says predicting.')
    expect(c.querySelectorAll('canvas')).toHaveLength(0)
  })
  it('with the readiness unread every ring is hollow and says so', () => {
    m = mount(view('teach', 'unread'))
    const c = m.container
    expect([...c.querySelectorAll('.js-ring')].every((r) => r.getAttribute('data-known') === 'false')).toBe(true)
    expect(c.querySelectorAll('.js-ring-seg[data-on="true"]')).toHaveLength(0)
  })
  it('has the teach desk, the spatial model and one accent key', () => {
    m = mount(view('teach', 'simulated'))
    const c = m.container
    expect(c.querySelector('.js-p-desk')).not.toBeNull()
    expect(c.querySelector('.js-p-learned')).not.toBeNull()
    expect(c.querySelectorAll('.js-primary')).toHaveLength(1)
    // predicting: the learned rows carry no digit
    expect(text(c.querySelector('.js-p-learned')!)).not.toMatch(/\d+ ?%/)
  })
})

describe('the words on screen', () => {
  const cases: ['presence' | 'signal' | 'teach', FixtureKind][] = [
    ['presence', 'simulated'], ['presence', 'none'], ['presence', 'trusted'], ['presence', 'offline'],
    ['signal', 'simulated'], ['signal', 'none'], ['teach', 'simulated'], ['teach', 'unread'],
  ]
  it.each(cases)('%s (%s) says no forbidden word and no pose', (v, kind) => {
    m = mount(view(v, kind))
    const t = text(m.container)
    expect(copyProblems(t)).toEqual([])
    expect(t).not.toMatch(/\b(face|skeleton|pose estimate|silhouette)\b/i)
  })
})
