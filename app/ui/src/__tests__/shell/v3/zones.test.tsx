// The three-tray frame, the numbered step labels, the ruler, the phone pills and sheets, and the dock contract a view uses.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { mount } from '../../ww/_stubs'
import { ChromeProvider, ViewChrome, ZONE_RATIOS, ratioOf, useChromeSpec, type DockSpec } from '../../../shell/v3/contract'
import { Dock } from '../../../shell/v3/Dock'
import { PhonePeeks } from '../../../shell/v3/Sheets'
import { asciiRuler } from '../../../shell/v3/Tray'
import { Zones } from '../../../shell/v3/Zones'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)
const qa = (sel: string) => [...m!.container.querySelectorAll<HTMLElement>(sel)]
const click = (el: Element | null) => act(() => void (el as HTMLElement).click())
const el = createElement

const zones = (extra: Record<string, unknown> = {}, firstChildren: unknown = 'first') =>
  el(Zones, {
    first: { job: 'WAKE', chip: 'chip', children: firstChildren },
    second: { job: 'CONVERSATION', peek: { name: 'Conversation', lamp: 'waiting', note: '0 turns' }, children: 'second' },
    third: { job: 'VOICE PATH', children: 'third' },
    ...extra,
  } as never)

describe('Zones', () => {
  it('draws three trays left to right with the default ratio 1.85 : 1.05 : .95', () => {
    m = mount(zones())
    expect(qa('.s3-tray').map((t) => t.dataset.step)).toEqual(['1', '2', '3'])
    expect(q('.s3-zones')!.style.gridTemplateColumns).toBe('1.85fr 1.05fr 0.95fr')
  })

  it('takes the named ratios for Core and Console, or three numbers of its own', () => {
    expect(ZONE_RATIOS.core).toEqual([1.85, 1.05, 0.8])
    expect(ZONE_RATIOS.console).toEqual([1.6, 1.15, 1])
    expect(ratioOf(undefined)).toEqual([1.85, 1.05, 0.95])
    expect(ratioOf([2, 1, 1])).toEqual([2, 1, 1])
    m = mount(zones({ ratio: 'core' }))
    expect(q('.s3-zones')!.style.gridTemplateColumns).toBe('1.85fr 1.05fr 0.8fr')
    m.render(zones({ ratio: 'console' }))
    expect(q('.s3-zones')!.style.gridTemplateColumns).toBe('1.6fr 1.15fr 1fr')
  })

  it('a tray head is a numbered step label and the job: "1 WAKE", never NOW, NEXT or LATER', () => {
    m = mount(zones())
    const heads = qa('.s3-step')
    expect(heads.map((h) => h.querySelector('.s3-num')!.textContent)).toEqual(['1', '2', '3'])
    expect(heads.map((h) => h.querySelector('.s3-job')!.textContent!.replace('Step ', '').replace(/^\d: /, ''))).toEqual(['WAKE', 'CONVERSATION', 'VOICE PATH'])
    expect(m.container.textContent).not.toMatch(/\b(NOW|NEXT|LATER)\b/)
    expect(q('.s3-step')!.textContent).toBe('1Step 1: WAKE')
    expect(qa('.s3-tray')[0].getAttribute('aria-labelledby')).toBe(q('.s3-step')!.id)
  })

  it('the head carries the state chip at its right edge', () => {
    m = mount(zones())
    expect(q('.s3-tray[data-step="1"] .s3-headchip')!.textContent).toBe('chip')
    expect(q('.s3-tray[data-step="3"] .s3-headchip')).toBeNull()
  })

  it('the ruler belongs to the first tray only', () => {
    m = mount(zones())
    expect(qa('.s3-ruler')).toHaveLength(1)
    expect(q('.s3-tray[data-step="1"] .s3-ruler')).not.toBeNull()
    m.render(zones({ first: { job: 'WAKE', ruler: false, children: 'x' } }))
    expect(qa('.s3-ruler')).toHaveLength(0)
  })

  it('the first tray flares only when told to, and again each time the number changes', () => {
    m = mount(zones({ first: { job: 'WAKE', flare: 0, children: 'x' } }))
    expect(q('.s3-flare')).toBeNull()
    m.render(zones({ first: { job: 'WAKE', flare: 1, children: 'x' } }))
    const a = q('.s3-flare')!
    expect(a).not.toBeNull()
    m.render(zones({ first: { job: 'WAKE', flare: 2, children: 'x' } }))
    expect(q('.s3-flare')).not.toBe(a)
  })
})

describe('the asciiRuler', () => {
  it('ends on a full bar at every width', () => {
    for (const w of [120, 333, 500, 641, 900]) {
      const s = asciiRuler(w, 6.6)
      expect(s, String(w)).toMatch(/^(\|····:····)*\|$/)
      expect(s.length * 6.6).toBeLessThanOrEqual(w + 6.6)
    }
    expect(asciiRuler(0, 6.6)).toBe('|')
    expect(asciiRuler(300, 0)).toBe('|')
  })
})

describe('the phone: two pills, two sheets', () => {
  it('draws the pills under the first tray when the view placed none, led by a state, not by a count', () => {
    m = mount(zones())
    const pills = qa('.s3-pill')
    expect(pills.map((p) => p.dataset.peek)).toEqual(['2', '3'])
    expect(pills[0].textContent).toContain('Conversation')
    expect(pills[0].textContent).toContain('WAITING')
    expect(pills[0].textContent).toContain('0 turns')
    expect(pills[1].textContent).toContain('Voice path')
    expect(q('.s3-peeks-fallback')).not.toBeNull()
  })

  it('a view that places <PhonePeeks /> takes the pills in its own order and the fallback goes away', () => {
    m = mount(zones({}, el('div', null, el('button', { type: 'button' }, 'ACCENT'), el(PhonePeeks))))
    expect(q('.s3-peeks-fallback')).toBeNull()
    expect(qa('.s3-pill')).toHaveLength(2)
    expect(q('.s3-tray[data-step="1"] .s3-peeks')).not.toBeNull()
  })

  it('a pill opens its tray as a dialog sheet with a Done key, Esc closes it and focus returns to the pill', () => {
    m = mount(zones())
    const pill = q<HTMLButtonElement>('.s3-pill[data-peek="3"]')!
    pill.focus()
    click(pill)
    expect(q('.s3-zones')!.dataset.sheet).toBe('3')
    const sheet = q('.s3-tray[data-step="3"]')!
    expect(sheet.dataset.sheet).toBe('open')
    expect(sheet.getAttribute('role')).toBe('dialog')
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(pill.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(sheet.querySelector('.s3-done'))
    act(() => void sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(q('.s3-zones')!.dataset.sheet).toBeUndefined()
    expect(document.activeElement).toBe(pill)
  })

  it('Done and the scrim close the sheet', () => {
    m = mount(zones())
    click(q('.s3-pill[data-peek="2"]'))
    expect(q('.s3-zones')!.dataset.sheet).toBe('2')
    click(q('.s3-tray[data-step="2"] .s3-done'))
    expect(q('.s3-zones')!.dataset.sheet).toBeUndefined()
    click(q('.s3-pill[data-peek="2"]'))
    click(q('.s3-scrim'))
    expect(q('.s3-zones')!.dataset.sheet).toBeUndefined()
  })
})

describe('the dock contract', () => {
  const SPEC: DockSpec = {
    modes: [{ id: 'capture', label: 'Capture', prefix: '>', example: 'spent 120 chai', action: 'Add' }],
    onSubmit: vi.fn(),
  }
  const withSpec = (spec: DockSpec) => {
    function Probe() {
      const s = useChromeSpec()
      return el(Dock, { spec: s?.dock ?? null, onAsk: () => undefined })
    }
    return el(ChromeProvider, null, el(ViewChrome, { dock: spec }), el(Probe))
  }

  it('a view registers its mode and the dock shows it beside Ask, with a dimmed e.g. example', () => {
    m = mount(withSpec(SPEC))
    expect(qa('.s3-mode button').map((b) => b.textContent)).toEqual(['Capture', 'Ask'])
    expect(q('.s3-mode [aria-pressed="true"]')!.textContent).toBe('Capture')
    expect(q('.s3-wellin input')!.getAttribute('placeholder')).toBe('e.g. spent 120 chai')
    expect(q('.s3-prompt')!.textContent).toBe('>')
    expect((q('.s3-wellin input') as HTMLInputElement).value).toBe('')
  })

  it('submitting calls the view with the mode id and the text, then clears the input; an empty line cannot be sent', () => {
    const onSubmit = vi.fn()
    m = mount(withSpec({ ...SPEC, onSubmit }))
    expect(q<HTMLButtonElement>('.s3-send')!.disabled).toBe(true)
    const input = q<HTMLInputElement>('.s3-wellin input')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'spent 120 chai')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(q<HTMLButtonElement>('.s3-send')!.disabled).toBe(false)
    click(q('.s3-send'))
    expect(onSubmit).toHaveBeenCalledWith('capture', 'spent 120 chai')
    expect(input.value).toBe('')
  })

  it('the Ask mode shows its own example and submitting it asks the shell, not the view', () => {
    const onSubmit = vi.fn()
    const onAsk = vi.fn()
    function Probe() {
      const s = useChromeSpec()
      return el(Dock, { spec: s?.dock ?? null, onAsk })
    }
    m = mount(el(ChromeProvider, null, el(ViewChrome, { dock: { ...SPEC, onSubmit } }), el(Probe)))
    click(q('.s3-mode [data-mode="ask"]'))
    expect(q('.s3-prompt')!.textContent).toBe('ask>')
    click(q('.s3-send'))
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('the registration is removed when the view unmounts', () => {
    function Probe() {
      const s = useChromeSpec()
      return el('span', { 'data-dock': s?.dock ? 'yes' : 'no' })
    }
    m = mount(el(ChromeProvider, null, el(ViewChrome, { dock: SPEC }), el(Probe)))
    expect(q('[data-dock]')!.dataset.dock).toBe('yes')
    m.render(el(ChromeProvider, null, el(Probe)))
    expect(q('[data-dock]')!.dataset.dock).toBe('no')
  })
})
