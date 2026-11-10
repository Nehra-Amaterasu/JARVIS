// Chunk 1b, group 2: Card, CardHead, Section, PrimaryOwner, Reveal, Skeleton (plan 5.5, 3.3, 7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { mount, resetHtml, stubMatchMedia } from './_stubs'
import { Card, CardHead, PrimaryButton, PrimaryOwner, Reveal, Section, SectionOrder, Skeleton, sectionOrder } from '../../ww/kit'
import { join } from 'node:path'
import { parseCss, read, WW_DIR } from './_css'

let m: ReturnType<typeof mount> | null = null
let io: StubIO[] = []
class StubIO {
  cb: IntersectionObserverCallback
  els = new Set<Element>()
  disconnected = false
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    io.push(this)
  }
  observe(el: Element) {
    this.els.add(el)
  }
  unobserve(el: Element) {
    this.els.delete(el)
  }
  disconnect() {
    this.disconnected = true
    this.els.clear()
  }
  fire(isIntersecting: boolean) {
    act(() => this.cb([...this.els].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry), this as never))
  }
}
beforeEach(() => {
  io = []
  vi.stubGlobal('IntersectionObserver', StubIO)
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetHtml()
})
const click = (el: Element) => act(() => (el as HTMLElement).click())

describe('Card', () => {
  it('requires data-card by type', () => {
    // @ts-expect-error data-card is required
    const bad = <Card title="x" />
    expect(bad.type).toBe(Card)
  })
  it('carries data-card, names itself by its heading and renders a real h2 (h3 on request)', () => {
    m = mount(
      <div>
        <Card data-card="c1" title="Next paper" kicker="Practice">
          body
        </Card>
        <Card data-card="c2" title="Inner" level={3} />
      </div>,
    )
    const c1 = m.container.querySelector('[data-card=c1]')!
    expect(c1.querySelector('h2')!.textContent).toBe('Next paper')
    expect(c1.getAttribute('aria-labelledby')).toBe(c1.querySelector('h2')!.id)
    expect(c1.querySelector('.ww-kicker')!.textContent).toBe('Practice')
    expect(m.container.querySelector('[data-card=c2] h3')).not.toBeNull()
  })
  it('throws in development when two mounted cards share an id, and lets a unmounted id be reused', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      m = mount(
        <div>
          <Card data-card="dup" />
          <Card data-card="dup" />
        </div>,
      )
    }).toThrow(/share data-card="dup"/)
    m = null
    spy.mockRestore()
    m = mount(<Card data-card="dup" />) // the failed mount unwound and released the id
    expect(m.container.querySelector('[data-card=dup]')).not.toBeNull()
  })
  it('loading shows a Skeleton only after 200 ms; a load that finishes first never flashes one', () => {
    vi.useFakeTimers()
    m = mount(<Card data-card="l" title="T" loading />)
    expect(m.container.querySelector('[data-skeleton]')).toBeNull()
    expect(m.container.querySelector('[data-card=l]')!.getAttribute('aria-busy')).toBe('true')
    act(() => void vi.advanceTimersByTime(201))
    expect(m.container.querySelector('[data-skeleton]')).not.toBeNull()
  })
  it('error shows a message in words and a Retry that calls back', () => {
    const retry = vi.fn()
    m = mount(<Card data-card="e" title="T" error="Could not load the plan." onRetry={retry} />)
    expect(m.container.querySelector('[role=alert]')!.textContent).toContain('Error: Could not load the plan.')
    click(m.container.querySelector('[role=alert] button')!)
    expect(retry).toHaveBeenCalled()
  })
  it('a child that throws costs that card, not the page, and Retry draws it again', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let boom = true
    const Bad = () => {
      if (boom) throw new Error('x')
      return <p>fine now</p>
    }
    m = mount(
      <div>
        <Card data-card="bad" title="Bad">
          <Bad />
        </Card>
        <Card data-card="ok" title="Ok">
          still here
        </Card>
      </div>,
    )
    expect(m.container.querySelector('[data-card=bad] [role=alert]')).not.toBeNull()
    expect(m.container.querySelector('[data-card=ok]')!.textContent).toContain('still here')
    boom = false
    click(m.container.querySelector('[data-card=bad] [role=alert] button')!)
    expect(m.container.querySelector('[data-card=bad]')!.textContent).toContain('fine now')
    spy.mockRestore()
  })
  it('lift puts the lift class on the stationary outer box and the lift face inside', () => {
    m = mount(<Card data-card="lf" lift />)
    const outer = m.container.querySelector('[data-card=lf]')!
    expect(outer.classList.contains('ww-lift')).toBe(true)
    expect(outer.firstElementChild!.classList.contains('ww-lift-face')).toBe(true)
  })
  it('arrive: with an index, the card sets data-arrive once when 25 % is in view, at its stagger slot', () => {
    m = mount(<Card data-card="a" index={5} revealCap={3} />)
    const el = m.container.querySelector('[data-card=a]') as HTMLElement
    expect(el.hasAttribute('data-arrive')).toBe(false)
    expect((io[0] as unknown as { els: Set<Element> }).els.has(el)).toBe(true)
    io[0].fire(false)
    expect(el.hasAttribute('data-arrive')).toBe(false)
    io[0].fire(true)
    expect(el.getAttribute('data-arrive')).toBe('in')
    expect(el.style.getPropertyValue('--i')).toBe('2') // index 5 past a cap of 3 shares the last slot
    expect(io[0].disconnected).toBe(true) // one-shot
  })
  it('a card with no index never observes, and reduced motion observes nothing at all', () => {
    m = mount(<Card data-card="n" />)
    expect(io).toHaveLength(0)
    m.unmount()
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    m = mount(<Card data-card="r" index={0} />)
    expect(io).toHaveLength(0)
    restore()
  })
})

describe('CardHead', () => {
  it('puts the action beside the title', () => {
    m = mount(<CardHead title="Plan" action={<button>Edit</button>} />)
    expect(m.container.querySelector('.ww-card-action button')!.textContent).toBe('Edit')
  })
})

describe('Reveal', () => {
  it('reveals its wrapper once', () => {
    m = mount(
      <Reveal index={1}>
        <span>hi</span>
      </Reveal>,
    )
    io[0].fire(true)
    const el = m.container.firstElementChild!
    expect(el.getAttribute('data-arrive')).toBe('in')
    expect((el as HTMLElement).style.getPropertyValue('--i')).toBe('1')
  })
})

describe('Skeleton', () => {
  it('appears after 200 ms, leaves with an opacity step of one feedback duration, and is then gone', () => {
    vi.useFakeTimers()
    m = mount(<Skeleton lines={2} />)
    expect(m.container.querySelector('[data-skeleton]')).toBeNull()
    act(() => void vi.advanceTimersByTime(200))
    expect(m.container.querySelectorAll('.ww-skeleton-line')).toHaveLength(2)
    m.render(<Skeleton lines={2} loading={false} />)
    expect(m.container.querySelector('[data-skeleton]')!.getAttribute('data-state')).toBe('out')
    act(() => void vi.advanceTimersByTime(101))
    expect(m.container.querySelector('[data-skeleton]')).toBeNull()
  })
  it('never shows if the data arrives inside 200 ms', () => {
    vi.useFakeTimers()
    m = mount(<Skeleton />)
    act(() => void vi.advanceTimersByTime(150))
    m.render(<Skeleton loading={false} />)
    act(() => void vi.advanceTimersByTime(500))
    expect(m.container.querySelector('[data-skeleton]')).toBeNull()
  })
  it('is static in CSS: no animation, and a transition only on its leaving state', () => {
    const rules = parseCss(read(join(WW_DIR, 'kit/card.css'))).rules.filter((r) => r.selectors.some((s) => s.includes('ww-skeleton')))
    for (const r of rules) {
      expect(r.decls['animation']).toBeUndefined()
      if (r.decls['transition']) expect(r.selectors.join()).toContain("[data-state='out']")
    }
  })
})

describe('Section', () => {
  it('carries data-section, data-hint and, for the primary section, data-has-primary (never data-primary)', () => {
    m = mount(
      <div>
        <Section id="L1" hint="Countdown to the next exam" primary />
        <Section id="L2" hint="Now" as="div" />
      </div>,
    )
    const l1 = m.container.querySelector('[data-section=L1]')!
    expect(l1.getAttribute('data-hint')).toBe('Countdown to the next exam')
    expect(l1.getAttribute('data-has-primary')).toBe('true')
    expect(l1.hasAttribute('data-primary')).toBe(false)
    expect(m.container.querySelector('[data-section=L2]')!.tagName).toBe('DIV')
    expect(m.container.querySelector('[data-section=L2]')!.hasAttribute('data-has-primary')).toBe(false)
  })
  it('sectionOrder reads the ids in document order', () => {
    m = mount(
      <div>
        <Section id="a" hint="x" />
        <Section id="b" hint="x" />
        <Section id="c" hint="x" />
      </div>,
    )
    expect(sectionOrder(m.container)).toEqual(['a', 'b', 'c'])
  })
  it('SectionOrder reports mounted sections in document order, including one that mounts later in the middle', () => {
    const seen: string[][] = []
    const Page = () => {
      const [mid, setMid] = useState(false)
      return (
        <SectionOrder onOrder={(ids) => seen.push(ids)}>
          <Section id="a" hint="x" />
          {mid && <Section id="b" hint="x" />}
          <Section id="c" hint="x" />
          <button onClick={() => setMid(true)}>add</button>
        </SectionOrder>
      )
    }
    m = mount(<Page />)
    expect(seen.at(-1)).toEqual(['a', 'c'])
    click(m.container.querySelector('button')!)
    expect(seen.at(-1)).toEqual(['a', 'b', 'c'])
  })
})

describe('PrimaryOwner', () => {
  const count = (root: ParentNode) => root.querySelectorAll('[data-primary]').length
  it('grants exactly one data-primary to the most specific claim', () => {
    m = mount(
      <PrimaryOwner>
        <PrimaryButton claimId="start" rank="now">
          Start
        </PrimaryButton>
        <PrimaryButton claimId="save" rank="workspace">
          Save
        </PrimaryButton>
      </PrimaryOwner>,
    )
    expect(count(m.container)).toBe(1)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Save')
    expect([...m.container.querySelectorAll('button')].filter((b) => b.classList.contains('primary')).map((b) => b.textContent)).toEqual(['Save'])
  })
  it('an overlay claim beats the workspace, and gives it back when it closes', () => {
    const Page = ({ open }: { open: boolean }) => (
      <PrimaryOwner>
        <PrimaryButton claimId="start" rank="now">
          Start
        </PrimaryButton>
        <PrimaryButton claimId="ws" rank="workspace">
          Save
        </PrimaryButton>
        {open && (
          <PrimaryButton claimId="ov" rank="overlay">
            Confirm
          </PrimaryButton>
        )}
      </PrimaryOwner>
    )
    m = mount(<Page open={false} />)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Save')
    m.render(<Page open />)
    expect(count(m.container)).toBe(1)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Confirm')
    m.render(<Page open={false} />)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Save')
  })
  it('a false precondition withdraws the claim: Setup clean and paired declares none, so Now takes the fill', () => {
    const Page = ({ dirty }: { dirty: boolean }) => (
      <PrimaryOwner>
        <PrimaryButton claimId="start" rank="now">
          Start
        </PrimaryButton>
        <PrimaryButton claimId="save" rank="workspace" when={dirty}>
          Save
        </PrimaryButton>
      </PrimaryOwner>
    )
    m = mount(<Page dirty={false} />)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Start')
    m.render(<Page dirty />)
    expect(m.container.querySelector('[data-primary]')!.textContent).toBe('Save')
    expect(count(m.container)).toBe(1)
  })
  it('the button that receives the fill pops once; the first render does not', () => {
    const Page = ({ dirty }: { dirty: boolean }) => (
      <PrimaryOwner>
        <PrimaryButton claimId="start" rank="now">
          Start
        </PrimaryButton>
        <PrimaryButton claimId="save" rank="workspace" when={dirty}>
          Save
        </PrimaryButton>
      </PrimaryOwner>
    )
    m = mount(<Page dirty={false} />)
    const [start, save] = [...m.container.querySelectorAll('button')]
    expect(start.hasAttribute('data-cycle')).toBe(false)
    m.render(<Page dirty />)
    expect(save.getAttribute('data-cycle')).toBe('pop')
    act(() => void save.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect(save.hasAttribute('data-cycle')).toBe(false)
  })
  it('outside a PrimaryOwner a lone claim is the primary (a demo, not a page)', () => {
    m = mount(
      <PrimaryButton claimId="solo" rank="now">
        Go
      </PrimaryButton>,
    )
    expect(count(m.container)).toBe(1)
  })
})
