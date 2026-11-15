// The practice-paper maker, rendered: an honest WAITING desk on the null adapter, the lamp that shows FAULT when a blueprint is
// unbalanced and the refusal that goes with it, keyboard editing, the path from Confirm to the slots to the print step, hollow slots
// drawn hollow, the print sheet's sections, crops and stamp, and the forbidden words in everything a student reads.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { mount } from '../../../../__tests__/ww/_stubs'
import { nullStudyPort } from '../../adapters/null.register'
import { BlueprintTable, Stepper } from '../BlueprintTable'
import { GeneratorDesk, type GeneratorDeskProps } from '../GeneratorDesk'
import { BLUEPRINT_BALANCED, BLUEPRINT_SEVEN, fixtureDraw, fixtureExtras, fixturePort } from '../fixtures'
import { PrintSheet } from '../PrintSheet'
import { SlotStrip } from '../SlotStrip'
import { FORBIDDEN_WORDS } from '../copy'
import { toGen, type GeneratorPort } from '../model'

let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const q = (sel: string) => m!.container.querySelector(sel) as HTMLElement
const qa = (sel: string) => Array.from(m!.container.querySelectorAll<HTMLElement>(sel))
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
const click = (el: Element) => act(() => { (el as HTMLElement).click() })
const byText = (sel: string, text: string) => qa(sel).find((e) => e.textContent?.includes(text)) as HTMLElement

const sim = fixturePort()
const none = nullStudyPort as unknown as GeneratorPort

async function desk(p: GeneratorDeskProps) {
  m = mount(<GeneratorDesk frame={false} {...p} />)
  await settle()
  return m
}

describe('the desk on the null adapter', () => {
  it('is an honest empty step: WAITING with the reason, no row, nothing invented', async () => {
    await desk({ port: none })
    expect(q('.gx-empty .k-lamp-word')!.textContent).toBe('WAITING')
    expect(q('.gx-empty')!.textContent).toContain('No blueprint yet')
    expect(q('.gx-empty')!.textContent).toContain('Waiting: a blueprint is inferred from a paper on file')
    expect(qa('.gx-row')).toHaveLength(0)
    expect(qa('.gx-slot')).toHaveLength(0)
  })
  it('inferring is disabled with its reason, and a hand-built draft cannot be confirmed because saving is not connected', async () => {
    await desk({ port: none })
    const infer = byText('.gx-empty button', 'Infer from a paper')
    expect(infer.getAttribute('aria-disabled')).toBe('true')
    await click(byText('.gx-empty button', 'Start by hand'))
    expect(qa('.gx-row')).toHaveLength(1)
    const cta = byText('button', 'Confirm and draw a paper')
    expect(cta.getAttribute('aria-disabled')).toBe('true')
    expect(m!.container.textContent).toContain('saving a blueprint is not connected yet')
  })
  it('steps 2 and 3 are disabled until a paper is drawn, each with its reason', async () => {
    await desk({ port: none })
    const slots = byText('[role="radio"]', '2 Slots')
    const print = byText('[role="radio"]', '3 Print')
    expect(slots.getAttribute('aria-disabled')).toBe('true')
    expect(print.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('the blueprint step', () => {
  it('a balanced invented blueprint: three rows, SIMULATED on every lamp, balanced: 60 marks, 2.0 minutes per mark', async () => {
    await desk({ port: sim, extras: fixtureExtras })
    expect(qa('.gx-row')).toHaveLength(3)
    expect(q('.gx-inv')!.textContent).toContain('balanced: 60 marks')
    expect(q('.gx-inv .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(q('.gx-bt-lamp .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(q('.gx-fact-mpm .gx-fact-v')!.textContent).toBe('2.0')
    expect(q('.gx-fact-mpm .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(qa('[data-primary]')).toHaveLength(1)
  })
  it('an unbalanced one shows FAULT with the reason and refuses to draw', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { blueprintId: 'bp-b' } })
    expect(q('.gx-inv .k-lamp-word')!.textContent).toBe('FAULT')
    expect(q('.gx-issues')!.textContent).toContain('The sections add up to 55 marks, the total says 60 (5 short).')
    const cta = byText('button', 'Confirm and draw a paper')
    expect(cta.getAttribute('aria-disabled')).toBe('true')
    await click(cta)
    expect(q('[data-step]')!.getAttribute('data-step')).toBe('blueprint')
    expect(byText('[role="radio"]', '2 Slots').getAttribute('aria-disabled')).toBe('true')
  })
  it('a stepper is a spinbutton: arrows change it, the lamp follows, and the old value balances again', async () => {
    await desk({ port: sim, extras: fixtureExtras })
    const set = q('[role="spinbutton"][aria-label="Questions set, Section A"]')
    await key(set, 'ArrowUp')
    expect(set.getAttribute('aria-valuenow')).toBe('11')
    expect(q('.gx-inv .k-lamp-word')!.textContent).toBe('FAULT')
    expect(q('.gx-issues')!.textContent).toContain('62 marks')
    await key(set, 'ArrowDown')
    expect(q('.gx-inv .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(qa('.gx-issues')).toHaveLength(0)
  })
  it('Use the sections’ sum settles a total that disagrees', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { blueprintId: 'bp-b' } })
    await click(byText('.gx-issues button', 'Use the sections'))
    expect(q('.gx-inv .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(q('.gx-inv')!.textContent).toContain('balanced: 55 marks')
  })
  it('seven sections is the most, and the add button then says so', async () => {
    await desk({ port: fixturePort([BLUEPRINT_SEVEN]), extras: fixtureExtras })
    expect(qa('.gx-row')).toHaveLength(7)
    expect(q('.gx-bt')!.getAttribute('data-dense')).toBe('true')
    expect(q('.gx-add')!.getAttribute('aria-disabled')).toBe('true')
    expect(m!.container.textContent).toContain('At most 7 sections')
  })
  it('Alt and Down moves the chosen section', async () => {
    await desk({ port: sim, extras: fixtureExtras })
    const first = qa('.gx-row')[0]
    await key(first, 'ArrowDown', { altKey: true })
    expect((qa('.gx-name')[1] as HTMLInputElement).value).toBe('Section A')
  })
  it('a rule can propose a blueprint: it stays RULE, not saved, until it is confirmed', async () => {
    await desk({ port: none, extras: fixtureExtras, initial: { infer: true } })
    expect(q('.gx-chip-rule')!.textContent).toContain('RULE, not saved')
    expect(qa('.gx-row')).toHaveLength(3)
  })
})

describe('the slots step', () => {
  it('Confirm draws a seeded paper: the slots, the SIMULATED lamp, one hollow slot with its reason and the printed seed', async () => {
    await desk({ port: sim, extras: fixtureExtras })
    await click(byText('button', 'Confirm and draw a paper'))
    await settle()
    expect(q('[data-step]')!.getAttribute('data-step')).toBe('slots')
    expect(q('.gx-ss-status')!.textContent).toContain('17 of 18 slots filled')
    expect(q('.gx-ss-status .k-lamp-word')!.textContent).toBe('SIMULATED')
    expect(qa('.gx-slot')).toHaveLength(10)
    expect((q('input[inputmode="numeric"]') as HTMLInputElement).value).toBe('48271')
    await click(qa('[role="tab"]')[2])
    const hollow = qa('.gx-slot[data-hollow="true"]')
    expect(hollow).toHaveLength(1)
    expect(hollow[0].textContent).toContain('too few reviewed questions')
    expect(hollow[0].querySelector('.gx-src')!.textContent).toContain('HOLLOW')
  })
  it('Reseed draws another paper with a new printed seed', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { step: 'slots' } })
    await settle()
    const before = qa('.gx-slot-main b').map((e) => e.textContent).join('|')
    await click(byText('button', 'Reseed'))
    await settle()
    const input = q('input[inputmode="numeric"]') as HTMLInputElement
    expect(input.value).not.toBe('48271')
    expect(qa('.gx-slot-main b').map((e) => e.textContent).join('|')).not.toBe(before)
  })
  it('a bad seed is refused in words and nothing is drawn', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { step: 'slots' } })
    await settle()
    const input = q('input[inputmode="numeric"]') as HTMLInputElement
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'abc')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byText('button', 'Draw with this seed'))
    expect(m!.container.textContent).toContain('A seed is a whole number from 1 to 2147483646.')
  })
  it('the rail is one tab stop and Down moves to the next section', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { step: 'slots' } })
    await settle()
    const tabs = qa('[role="tab"]')
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    await key(tabs[0], 'ArrowDown')
    expect(qa('[role="tab"]')[1].getAttribute('aria-selected')).toBe('true')
  })
  it('a MODEL slot is dashed and says it is not the student’s decision yet; a swap button appears only when a swap exists', () => {
    const p = fixtureDraw(toGen(BLUEPRINT_BALANCED), 48271, { withModel: true })
    m = mount(<SlotStrip sections={p.sections!} state="simulated" initialSection={1} />)
    const model = q('.gx-slot[data-src="model"]')
    expect(model.textContent).toContain('not yet your decision')
    expect(model.querySelector('.gx-src')!.getAttribute('data-src')).toBe('model')
    expect(qa('.gx-slot-swap')).toHaveLength(0)
    m.render(<SlotStrip sections={p.sections!} state="simulated" initialSection={1} onSwap={() => undefined} />)
    expect(qa('.gx-slot-swap').length).toBeGreaterThan(0)
  })
})

describe('the print step', () => {
  it('opens on the paper, offers key, marking sheet and all three, and says the night sheet is planned', async () => {
    await desk({ port: sim, extras: fixtureExtras, initial: { step: 'print' } })
    await settle()
    expect(q('[data-step]')!.getAttribute('data-step')).toBe('print')
    expect(qa('.gx-prev [data-print-section]')).toHaveLength(3)
    expect(q('.gx-night .k-lamp-word')!.textContent).toBe('PLANNED')
    expect(qa('[role="radio"]').map((r) => r.textContent)).toEqual(expect.arrayContaining(['Paper', 'Key', 'Marking', 'All three']))
    expect(byText('button', 'Print or save as PDF')).toBeTruthy()
    expect(q('.gx-pfacts')!.textContent).toContain('17 of 18')
  })
})

describe('the printed sheet', () => {
  const paper = fixtureDraw(toGen(BLUEPRINT_BALANCED), 48271)

  it('is the paper: the fixed header, the SIMULATED stamp, the seed in the footer, a section per blueprint section', () => {
    m = mount(<PrintSheet paper={paper} kind="paper" stamp="SIMULATED" />)
    const t = m.container.textContent!
    expect(t).toContain('Practice paper from your bank. Not an official paper.')
    expect(t).toContain('SIMULATED')
    expect(t).toContain('Seed 48271')
    expect(qa('[data-print-section]').map((s) => s.getAttribute('data-print-section'))).toEqual(['Section A', 'Section B', 'Section C'])
    expect(qa('.gx-q')).toHaveLength(18)
  })
  it('a hollow slot prints as a gap with its reason, never as a made-up question', () => {
    m = mount(<PrintSheet paper={paper} kind="paper" />)
    const gaps = qa('.gx-q[data-hollow] .gx-gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].textContent).toContain('too few reviewed questions')
  })
  it('a question whose text is not checked prints as its crop, and a checked one as text', () => {
    m = mount(<PrintSheet paper={paper} kind="paper" />)
    const crops = qa('.gx-q[data-crop]')
    expect(crops.length).toBeGreaterThan(0)
    for (const c of crops) { expect(c.querySelector('img.gx-crop')).toBeTruthy(); expect(c.querySelector('.gx-text')).toBeNull() }
    const texts = qa('.gx-q:not([data-crop]):not([data-hollow])')
    for (const t of texts) expect(t.querySelector('.gx-text')!.textContent!.length).toBeGreaterThan(10)
  })
  it('an unchecked question with no crop cut yet says so instead of printing unchecked text', () => {
    const slot = paper.sections![0].slots[0]
    const p = { ...paper, sections: [{ ...paper.sections![0], slots: [{ ...slot, textStatus: 'unverified' as const, crop: undefined }] }] }
    m = mount(<PrintSheet paper={p} kind="paper" />)
    expect(q('.gx-gap')!.textContent).toContain('page crop of this question has not been cut yet')
    expect(m.container.textContent).not.toContain(slot.text)
  })
  it('the key lists every slot and the marking sheet has a box for every mark', () => {
    m = mount(<PrintSheet paper={paper} kind="key" />)
    expect(qa('.gx-grid tbody tr')).toHaveLength(18)
    expect(m.container.textContent).toContain('answer key')
    m.render(<PrintSheet paper={paper} kind="marking" />)
    expect(qa('.gx-grid tbody tr')).toHaveLength(18)
    expect(qa('.gx-grid tbody .gx-box')).toHaveLength(18)
    expect(m.container.textContent).toContain('marking sheet')
  })
  it('"all three" is three sheets in order, the later ones starting a new page', () => {
    m = mount(<PrintSheet paper={paper} kind="all" />)
    expect(qa('.gx-sheet').map((s) => s.getAttribute('data-sheet'))).toEqual(['paper', 'key', 'marking'])
    expect(qa('.gx-sheet').map((s) => s.getAttribute('data-later'))).toEqual([null, 'true', 'true'])
  })
})

describe('the parts alone', () => {
  it('Stepper clamps at its ends, Home and End jump, Page keys move five steps', () => {
    let v = 5
    const view = (n: number) => <Stepper value={n} min={1} max={9} label="Marks" onChange={(x) => { v = x }} />
    m = mount(view(5))
    const spin = q('[role="spinbutton"]')
    key(spin, 'ArrowUp'); expect(v).toBe(6)
    key(spin, 'PageUp'); expect(v).toBe(9)
    key(spin, 'Home'); expect(v).toBe(1)
    key(spin, 'End'); expect(v).toBe(9)
    m.render(view(9))
    key(q('[role="spinbutton"]'), 'PageDown'); expect(v).toBe(4)
    expect(q('.gx-step-btn[aria-label="Fewer: Marks"]').hasAttribute('disabled')).toBe(false)
  })
  it('a BlueprintTable in the fault state puts a FAULT lamp on the section that breaks a rule', () => {
    const bp = toGen(BLUEPRINT_BALANCED)
    const issues = [{ code: 'set-below-attempt', section: 'Section B', text: 'Section B: 3 set is fewer than 4 to attempt.' }]
    m = mount(<BlueprintTable sections={bp.sections} total={60} duration={120} issues={issues} state="simulated" onChange={() => undefined} />)
    expect(q('.gx-bt')!.getAttribute('data-state')).toBe('fault')
    expect(qa('.gx-row')[1].getAttribute('data-fault')).toBe('true')
    expect(qa('.gx-row')[0].getAttribute('data-fault')).toBeNull()
    expect(qa('.gx-row')[1].querySelector('.k-lamp')!.getAttribute('data-state')).toBe('fault')
  })
})

describe('the words on every screen', () => {
  it('no step says important, likely or expected, and none promises a result', async () => {
    const texts: string[] = []
    for (const props of [{ port: none }, { port: sim, extras: fixtureExtras }, { port: sim, extras: fixtureExtras, initial: { step: 'slots' as const } }, { port: sim, extras: fixtureExtras, initial: { step: 'print' as const } }]) {
      await desk(props)
      await settle()
      texts.push(m!.container.textContent!.toLowerCase())
      m!.unmount(); m = null
    }
    for (const t of texts) {
      for (const w of FORBIDDEN_WORDS) expect(t).not.toContain(w)
      for (const w of ['probability', 'you will pass', 'streak']) expect(t).not.toContain(w)
    }
  })
})
