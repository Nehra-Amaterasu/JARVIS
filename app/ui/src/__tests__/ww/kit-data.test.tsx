// Chunk 1b, group 4a: Row, Stat, Meter, Spark, StageStrip, Fold, TapGroup, MasterDetail, EmptyState, Banner.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml, stubMatchMedia } from './_stubs'
import { join } from 'node:path'
import { read, WW_DIR } from './_css'
import { Banner, EmptyState, Fold, MasterDetail, Meter, Row, Spark, StageStrip, Stat, TapGroup, clearMasterDetailMemory } from '../../ww/kit'

let m: ReturnType<typeof mount> | null = null
let ios: { cb: IntersectionObserverCallback; els: Set<Element> }[] = []
beforeEach(() => {
  ios = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      cb: IntersectionObserverCallback
      els = new Set<Element>()
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
        ios.push(this)
      }
      observe(e: Element) {
        this.els.add(e)
      }
      unobserve() {}
      disconnect() {
        this.els.clear()
      }
    },
  )
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetHtml()
  clearMasterDetailMemory()
})
const click = (el: Element) => act(() => (el as HTMLElement).click())
const seeIt = () => act(() => ios.forEach((o) => o.cb([...o.els].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), o as never)))

describe('Row', () => {
  it('lays out lead, title, meta and action; a state is a word, not only a colour', () => {
    m = mount(<Row lead="1" title="Maths" meta="Mon 10:00" action={<button>Open</button>} state="behind" />)
    const row = m.container.querySelector('.ww-row') as HTMLElement
    expect(row.dataset.state).toBe('behind')
    expect(row.textContent).toContain('Maths')
    expect(row.textContent).toContain('Mon 10:00')
    expect(row.querySelector('.ww-chip')!.textContent).toBe('Behind')
    expect(row.querySelector('.ww-row-action button')).not.toBeNull()
  })
  it('the default state has no chip', () => {
    m = mount(<Row title="x" />)
    expect(m.container.querySelector('.ww-chip')).toBeNull()
  })
  it('done and overdue also print their word', () => {
    m = mount(
      <div>
        <Row title="a" state="done" />
        <Row title="b" state="overdue" />
      </div>,
    )
    expect([...m.container.querySelectorAll('.ww-chip')].map((c) => c.textContent)).toEqual(['✓ Done', 'Overdue'])
  })
})

describe('Stat', () => {
  it('an unmeasured value says so and shows no number', () => {
    m = mount(<Stat label="Coverage" value={null} />)
    expect(m.container.textContent).toContain('not measured yet')
    expect(m.container.querySelector('.ww-stat')!.getAttribute('data-measured')).toBe('false')
    expect(m.container.textContent).not.toMatch(/\d/)
  })
  it('a zero shows the single next step', () => {
    m = mount(<Stat label="Papers" value={0} next="mark your first paper" />)
    expect(m.container.textContent).toContain('Next: mark your first paper')
  })
  it('a non-zero value has no next-step line, and carries its unit', () => {
    m = mount(<Stat label="Papers" value={4} unit="done" next="x" />)
    expect(m.container.querySelector('.ww-stat-next')).toBeNull()
    expect(m.container.querySelector('.ww-stat-unit')!.textContent).toBe('done')
    expect(m.container.querySelector('.ticker-num')!.textContent).toBe('4')
  })
  it('highlights the tile for one state duration when a measured number changes, not on first measurement', () => {
    vi.useFakeTimers()
    m = mount(<Stat label="x" value={null} />)
    m.render(<Stat label="x" value={3} />)
    expect((m.container.querySelector('.ww-stat') as HTMLElement).dataset.tick).toBeUndefined()
    m.render(<Stat label="x" value={4} />)
    expect((m.container.querySelector('.ww-stat') as HTMLElement).dataset.tick).toBe('on')
    act(() => void vi.advanceTimersByTime(161))
    expect((m.container.querySelector('.ww-stat') as HTMLElement).dataset.tick).toBeUndefined()
  })
  it('under reduced motion a change shows the final value and no highlight', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    m = mount(<Stat label="x" value={3} />)
    m.render(<Stat label="x" value={9} />)
    expect((m.container.querySelector('.ww-stat') as HTMLElement).dataset.tick).toBeUndefined()
    expect(m.container.querySelector('.ticker-num')!.textContent).toBe('9')
    restore()
  })
})

describe('Meter', () => {
  it('is a named meter with a value and a text reading', () => {
    m = mount(<Meter value={0.5} label="Coverage" />)
    const el = m.container.querySelector('[role=meter]')!
    expect(el.getAttribute('aria-label')).toBe('Coverage')
    expect(el.getAttribute('aria-valuenow')).toBe('0.5')
    expect(el.getAttribute('aria-valuetext')).toBe('50 percent')
  })
  it('fills from zero when it scrolls into view, then holds; the fill is a scale, never a width', () => {
    m = mount(<Meter value={0.6} label="x" />)
    const fill = m.container.querySelector('.ww-meter-fill') as HTMLElement
    expect(fill.classList.contains('ww-fill')).toBe(true)
    expect(fill.style.getPropertyValue('--v')).toBe('0')
    expect(fill.style.width).toBe('')
    seeIt()
    expect(fill.style.getPropertyValue('--v')).toBe('0.6')
  })
  it('after the first fill only the change animates (the value is applied directly)', () => {
    m = mount(<Meter value={0.2} label="x" />)
    seeIt()
    m.render(<Meter value={0.8} label="x" />)
    expect((m.container.querySelector('.ww-meter-fill') as HTMLElement).style.getPropertyValue('--v')).toBe('0.8')
  })
  it('an unmeasured value draws no fill at all and says "not measured"', () => {
    m = mount(<Meter value={null} label="x" />)
    expect(m.container.querySelector('.ww-meter-fill')).toBeNull()
    expect(m.container.querySelector('[role=meter]')!.getAttribute('aria-valuetext')).toBe('not measured')
    expect(m.container.querySelector('[role=meter]')!.hasAttribute('aria-valuenow')).toBe(false)
  })
  it('clamps to 0..1; reduced motion shows the value at once without observing', () => {
    const restore = stubMatchMedia({ 'prefers-reduced-motion': true })
    m = mount(<Meter value={3} label="x" />)
    expect((m.container.querySelector('.ww-meter-fill') as HTMLElement).style.getPropertyValue('--v')).toBe('1')
    expect(ios).toHaveLength(0)
    restore()
  })
})

describe('Spark', () => {
  it('draws a line through the points with a name that says where it starts and ends', () => {
    m = mount(<Spark points={[1, 4, 2, 6]} label="Weekly minutes" />)
    expect(m.container.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(4)
    expect(m.container.querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Weekly minutes: from 1 to 6')
  })
  it('with no data it draws a dashed baseline and says "no history"', () => {
    m = mount(<Spark points={[]} label="Weekly minutes" />)
    expect(m.container.querySelector('polyline')).toBeNull()
    expect(m.container.querySelector('.ww-spark-base')).not.toBeNull()
    expect(m.container.textContent).toContain('no history')
  })
  it('a flat series does not divide by zero', () => {
    m = mount(<Spark points={[2, 2, 2]} label="x" />)
    expect(m.container.querySelector('polyline')!.getAttribute('points')).not.toMatch(/NaN|Infinity/)
  })
})

describe('StageStrip', () => {
  it('marks the current stage and prints "not measured" for an unknown one', () => {
    m = mount(
      <StageStrip
        label="Paper stages"
        stages={[
          { id: 'a', label: 'Learn', count: 4, state: 'done' },
          { id: 'b', label: 'Practise', count: 2, state: 'current' },
          { id: 'c', label: 'Mark', state: 'unknown' },
          { id: 'd', label: 'Review', count: 0, state: 'todo' },
        ]}
      />,
    )
    const items = [...m.container.querySelectorAll('li')]
    expect(items.map((i) => i.dataset.state)).toEqual(['done', 'current', 'unknown', 'todo'])
    expect(items[1].getAttribute('aria-current')).toBe('step')
    expect(items[2].textContent).toContain('not measured')
    expect(items[0].querySelector('.ww-stage-count')!.textContent).toBe('4')
  })
})

describe('Fold', () => {
  it('is a button in a heading with aria-expanded, closed by default; the body is hidden, not animated', () => {
    m = mount(<Fold title="Why this">body</Fold>)
    const b = m.container.querySelector('h3 button')!
    expect(b.getAttribute('aria-expanded')).toBe('false')
    const body = m.container.querySelector('.ww-fold-body') as HTMLElement
    expect(body.hidden).toBe(true)
    expect(b.getAttribute('aria-controls')).toBe(body.id)
    click(b)
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
  })
  it('lazy mounts nothing until first opened, and keeps it after', () => {
    const Heavy = vi.fn(() => <p>heavy</p>)
    m = mount(
      <Fold title="T" lazy>
        <Heavy />
      </Fold>,
    )
    expect(Heavy).not.toHaveBeenCalled()
    click(m.container.querySelector('button')!)
    expect(Heavy).toHaveBeenCalled()
    click(m.container.querySelector('button')!)
    expect(m.container.textContent).toContain('heavy')
  })
  it('can be controlled and reports toggles', () => {
    const on = vi.fn()
    m = mount(
      <Fold title="T" open onToggle={on}>
        x
      </Fold>,
    )
    click(m.container.querySelector('button')!)
    expect(on).toHaveBeenCalledWith(false)
    expect(m.container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true') // the parent has not changed it
  })
})

describe('TapGroup', () => {
  const OPTS = [
    { id: 'p', label: 'P' },
    { id: 'a', label: 'A' },
    { id: 'c', label: 'C' },
  ]
  it('is a named group of 44 px buttons with exactly one pressed', () => {
    m = mount(<TapGroup label="Maths" options={OPTS} value="a" onTap={() => {}} />)
    const bs = [...m.container.querySelectorAll('button')]
    expect(bs.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    expect(bs.every((b) => b.dataset.grouped === 'true')).toBe(true)
    expect(m.container.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Maths')
  })
  it('is optimistic: the display moves on the tap, before the reply', () => {
    let resolve!: () => void
    m = mount(<TapGroup label="x" options={OPTS} value={null} onTap={() => new Promise<void>((r) => (resolve = r))} />)
    click(m.container.querySelectorAll('button')[0])
    expect(m.container.querySelectorAll('button')[0].getAttribute('aria-pressed')).toBe('true')
    resolve()
  })
  it('the same tap clears', () => {
    const on = vi.fn()
    m = mount(<TapGroup label="x" options={OPTS} value="p" onTap={on} />)
    click(m.container.querySelectorAll('button')[0])
    expect(on).toHaveBeenCalledWith(null)
    expect(m.container.querySelectorAll('button')[0].getAttribute('aria-pressed')).toBe('false')
  })
  it('a rejected save rolls the display back and reports it', async () => {
    const rb = vi.fn()
    m = mount(<TapGroup label="x" options={OPTS} value="p" onTap={() => Promise.reject(new Error('offline'))} onRollback={rb} />)
    click(m.container.querySelectorAll('button')[1])
    await act(async () => {})
    expect(m.container.querySelectorAll('button')[0].getAttribute('aria-pressed')).toBe('true')
    expect(m.container.querySelectorAll('button')[1].getAttribute('aria-pressed')).toBe('false')
    expect(rb).toHaveBeenCalledTimes(1)
  })
  it('a stored value that changes under an optimistic one wins', () => {
    m = mount(<TapGroup label="x" options={OPTS} value={null} onTap={() => new Promise(() => {})} />)
    click(m.container.querySelectorAll('button')[0])
    m.render(<TapGroup label="x" options={OPTS} value="c" onTap={() => new Promise(() => {})} />)
    expect(m.container.querySelectorAll('button')[2].getAttribute('aria-pressed')).toBe('true')
    expect(m.container.querySelectorAll('button')[0].getAttribute('aria-pressed')).toBe('false')
  })
  it('pressed is a filled background in CSS, never an inset shadow', () => {
    const css = read(join(WW_DIR, 'kit/data.css'))
    const rule = /\.ww-tapopt\[data-active='true'\]\s*\{([^}]*)\}/.exec(css)![1]
    expect(rule).toMatch(/background:/)
    expect(rule).not.toMatch(/inset/)
  })
})

describe('MasterDetail', () => {
  const Md = (p: { memoryKey?: string; selectedId?: string | null }) => (
    <MasterDetail
      listLabel="Papers"
      detailLabel="Paper detail"
      memoryKey={p.memoryKey}
      selectedId={p.selectedId}
      list={(select, sel) => (
        <div>
          {['a', 'b'].map((id) => (
            <button key={id} id={id} data-sel={sel === id} onClick={() => select(id)}>
              {id}
            </button>
          ))}
        </div>
      )}
      detail={(sel) => <p id="detail">{sel ?? 'none'}</p>}
    />
  )
  it('renders both panes as named regions and shows the selection in the detail', () => {
    m = mount(<Md />)
    expect(m.container.querySelector('[aria-label="Papers"]')).not.toBeNull()
    expect(m.container.querySelector('#detail')!.textContent).toBe('none')
    click(m.container.querySelector('#b')!)
    expect(m.container.querySelector('#detail')!.textContent).toBe('b')
  })
  it('remembers the selection per key across a remount', () => {
    m = mount(<Md memoryKey="study" />)
    click(m.container.querySelector('#a')!)
    m.unmount()
    m = mount(<Md memoryKey="study" />)
    expect(m.container.querySelector('#detail')!.textContent).toBe('a')
    m.unmount()
    m = mount(<Md memoryKey="life" />)
    expect(m.container.querySelector('#detail')!.textContent).toBe('none')
  })
  it('a controlled selection is the parent\'s', () => {
    m = mount(<Md selectedId="b" />)
    click(m.container.querySelector('#a')!)
    expect(m.container.querySelector('#detail')!.textContent).toBe('b')
  })
  it('stacks under 720 px of its own width via a container query, not the viewport', () => {
    const css = read(join(WW_DIR, 'kit/data.css'))
    expect(css).toMatch(/\.ww-md\s*\{[^}]*container-type:\s*inline-size/)
    expect(css).toMatch(/@container \(min-width: 720px\)/)
  })
})

describe('EmptyState and Banner', () => {
  it('EmptyState states what is empty, why, and offers a real first action', () => {
    m = mount(<EmptyState title="No questions yet" body="The bank is empty." reason="Nothing has been added." action={<button>Add questions</button>} />)
    expect(m.container.querySelector('[role=status]')!.textContent).toContain('No questions yet')
    expect(m.container.querySelector('.ww-empty-reason')!.textContent).toBe('Nothing has been added.')
    expect(m.container.querySelector('.ww-empty-action button')).not.toBeNull()
  })
  it('Banner is a note with words first and an optional action', () => {
    m = mount(<Banner tone="sim" action={<button>Confirm dates</button>}>Dates are tentative.</Banner>)
    const b = m.container.querySelector('[role=note]')!
    expect(b.textContent).toContain('Dates are tentative.')
    expect(b.querySelector('.ww-banner-action button')).not.toBeNull()
  })
})
