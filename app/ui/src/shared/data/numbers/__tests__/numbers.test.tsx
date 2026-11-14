// The four number forms drawn: every one takes a state, has a hollow form, never draws a figure for WAITING, PLANNED
// or FAULT, says no scolding words, and keeps the Odometer's roll off when it should be off.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { LAMP_STATES, showsNumber, type LampState } from '../../../lamp'
import { Dumbbell, Jar, LedgerTape, Odometer } from '..'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { document.body.innerHTML = ''; document.documentElement.removeAttribute('data-motion') })
afterEach(() => { m?.unmount(); m = null })

const root = (sel: string) => document.querySelector(sel) as HTMLElement
const states = [...LAMP_STATES]

describe('Odometer', () => {
  it('draws one wheel per well for LIVE, with the value spoken and the state on the root', () => {
    m = mount(<Odometer value={41} unit="questions" state="live" />)
    const el = root('[data-component="odometer"]')
    expect(el.dataset.state).toBe('live')
    expect(el.dataset.form).toBe('digits')
    expect(el.getAttribute('aria-label')).toBe('41 questions')
    expect(el.querySelectorAll('.d1-strip')).toHaveLength(4)
    expect([...el.querySelectorAll<HTMLElement>('.d1-strip')].map((s) => s.style.getPropertyValue('--d'))).toEqual(['0', '0', '4', '1'])
  })
  it('SIMULATED draws digits and a stamp', () => {
    m = mount(<Odometer value={7} unit="blocks" state="simulated" />)
    expect(root('.d1-stamp').textContent).toBe('SIMULATED')
    expect(document.querySelectorAll('.d1-strip')).toHaveLength(4)
  })
  it.each(states.filter((s) => !showsNumber(s)))('%s draws four dashed wells, "--" in the label, no digits and the reason', (s: LampState) => {
    m = mount(<Odometer value={99} unit="blocks" state={s} reason={s === 'fault' ? 'source did not answer' : undefined} />)
    const el = root('[data-component="odometer"]')
    expect(el.dataset.form).toBe('hollow')
    expect(el.querySelectorAll('.d1-well[data-hollow="true"]')).toHaveLength(4)
    expect(el.querySelectorAll('.d1-strip')).toHaveLength(0)
    expect(el.getAttribute('aria-label')).not.toMatch(/99/)
    expect(el.textContent).not.toMatch(/99/)
    expect(el.textContent).toContain(s.toUpperCase())
  })
  it('a negative or non-finite value is the hollow form even when LIVE', () => {
    m = mount(<Odometer value={-3} unit="blocks" state="live" />)
    expect(root('[data-component="odometer"]').dataset.form).toBe('hollow')
  })
  it('compact is 28 px and hero is 72 px', () => {
    m = mount(<><Odometer value={1} unit="a" state="live" size="compact" /><Odometer value={1} unit="b" state="live" /></>)
    const [a, b] = [...document.querySelectorAll<HTMLElement>('.d1-odo')]
    expect(a.style.getPropertyValue('--d1-h')).toBe('28px')
    expect(b.style.getPropertyValue('--d1-h')).toBe('72px')
  })
  it('grows the rack past four digits and says when it is full', () => {
    m = mount(<Odometer value={123456} unit="a" state="live" />)
    expect(document.querySelectorAll('.d1-strip')).toHaveLength(6)
    m.render(<Odometer value={99999999} unit="a" state="live" />)
    expect(document.querySelectorAll('.d1-strip')).toHaveLength(7)
    expect(root('.d1-odo').textContent).toContain('rack full')
  })
  it('prints the ASCII delta only with a since', () => {
    m = mount(<Odometer value={41} unit="q" state="live" delta={3} since="09:00" />)
    expect(root('.d1-delta').textContent).toBe('+3 since 09:00')
    m.render(<Odometer value={41} unit="q" state="live" delta={3} />)
    expect(document.querySelector('.d1-delta')).toBeNull()
  })
  it('is not focusable unless it opens something; then it is one button that Enter and click use', () => {
    m = mount(<Odometer value={4} unit="q" state="live" />)
    expect(document.querySelector('button')).toBeNull()
    expect(document.querySelector('[tabindex]')).toBeNull()
    const fn = vi.fn()
    m.render(<Odometer value={4} unit="q" state="live" onOpen={fn} />)
    const b = root('button.d1-odo')
    act(() => b.click())
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('rolls only when roll is allowed: on by default, off in Calm', async () => {
    m = mount(<Odometer value={1} unit="q" state="live" />)
    expect(root('.d1-odo').dataset.roll).toBe('on')
    await act(async () => { document.documentElement.setAttribute('data-motion', 'calm'); await Promise.resolve() })
    expect(root('.d1-odo').dataset.roll).toBe('off')
  })
  it('keeps wheel keys stable by place value so a change moves a wheel, not remounts it', () => {
    m = mount(<Odometer value={41} unit="q" state="live" />)
    const before = [...document.querySelectorAll('.d1-strip')]
    m.render(<Odometer value={42} unit="q" state="live" />)
    const after = [...document.querySelectorAll('.d1-strip')]
    expect(after.every((n, i) => n === before[i])).toBe(true)
    expect((after[3] as unknown as HTMLElement).style.getPropertyValue('--d')).toBe('2')
  })
})

describe('Dumbbell', () => {
  const rows = [{ label: 'physics', before: 30, after: 50 }, { label: 'maths', before: 40, after: 38 }]
  it('draws rails sorted by gap with a table beside them', () => {
    m = mount(<Dumbbell rows={rows} scale={[0, 80]} state="live" />)
    expect([...document.querySelectorAll('.d1-db-label')].map((n) => n.textContent)).toEqual(['physics', 'maths'])
    expect([...document.querySelectorAll('.d1-db-gap')].map((n) => n.textContent)).toEqual(['+20', '-2'])
    expect(document.querySelectorAll('table.d1-sr tbody tr')).toHaveLength(2)
    expect(document.querySelectorAll('.d1-ring.d1-db-mark')).toHaveLength(2)
    expect(document.querySelectorAll('.d1-disc.d1-db-mark')).toHaveLength(2)
  })
  it.each(states.filter((s) => !showsNumber(s)))('%s draws hollow rails and no number', (s: LampState) => {
    m = mount(<Dumbbell rows={rows} scale={[0, 80]} state={s} />)
    const el = root('[data-component="dumbbell"]')
    expect(el.dataset.form).toBe('hollow')
    expect(el.querySelectorAll('.d1-db-mark')).toHaveLength(0)
    expect(el.querySelector('table')).toBeNull()
    expect(el.textContent).not.toMatch(/[+-]20/)
  })
  it('has no field for another person, and says "earlier"', () => {
    const src = readFileSync(resolve(__dirname, '..', 'Dumbbell.tsx'), 'utf8')
    const props = /export interface DumbbellProps\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
    expect(props).toMatch(/before/)
    expect(props).not.toMatch(/peer|league|classmate|average|others?\b/i)
    m = mount(<Dumbbell rows={rows} scale={[0, 80]} state="live" />)
    expect(root('.d1-db-title').textContent).toMatch(/EARLIER SELF/)
  })
})

describe('LedgerTape', () => {
  const entries = [{ label: 'chai', amount: 120 }, { label: 'lunch', amount: 150 }]
  it('draws one text line per entry, a total in wheels and a torn end', () => {
    m = mount(<LedgerTape entries={entries} total={270} state="live" />)
    const lines = [...document.querySelectorAll('.d1-tape-line')]
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toMatch(/^chai ·+ 120$/)
    expect(document.querySelectorAll('.d1-tape-total .d1-strip')).toHaveLength(4)
    expect(document.querySelector('.d1-tape-tear .d1-tape-edge')).not.toBeNull()
    expect(document.querySelector('.d1-tape-total .d1-lamp')).toBeNull()
  })
  it('says so when the total does not match the lines', () => {
    m = mount(<LedgerTape entries={entries} total={300} state="live" />)
    expect(root('[role="note"]').textContent).toBe('the lines add up to 270; the total says 300')
  })
  it('an empty live tape is one sentence', () => {
    m = mount(<LedgerTape entries={[]} total={0} state="live" />)
    expect(root('.d1-tape-blank .d1-why').textContent).toBe('nothing taped yet')
  })
  it.each(states.filter((s) => !showsNumber(s)))('%s prints no amount and no total', (s: LampState) => {
    m = mount(<LedgerTape entries={entries} total={270} state={s} />)
    const el = root('[data-component="ledger-tape"]')
    expect(el.dataset.form).toBe('hollow')
    expect(el.textContent).not.toMatch(/120|150|270/)
    expect(el.querySelectorAll('.d1-tape-total .d1-strip')).toHaveLength(0)
  })
  it('draws at most 60 lines and counts the older ones', () => {
    const many = Array.from({ length: 75 }, (_, i) => ({ label: `i${i}`, amount: 1 }))
    m = mount(<LedgerTape entries={many} total={75} state="live" />)
    expect(document.querySelectorAll('li.d1-tape-line')).toHaveLength(60)
    expect(root('.d1-tape-more').textContent).toBe('+ 15 earlier lines not drawn')
  })
  it('tears the same way for the same tape', () => {
    m = mount(<LedgerTape entries={entries} total={270} state="live" />)
    const a = root('.d1-tape-edge').getAttribute('d')
    m.render(<LedgerTape entries={entries} total={270} state="live" />)
    expect(root('.d1-tape-edge').getAttribute('d')).toBe(a)
  })
})

describe('Jar', () => {
  it('under: dots, a notch and "80 left"', () => {
    m = mount(<Jar label="chai" level={320} plan={400} state="live" />)
    const el = root('[data-component="jar"]')
    expect(el.dataset.mode).toBe('under')
    expect(root('.d1-jar-line').textContent).toBe('80 left')
    expect(el.querySelector('.d1-jar-over')).toBeNull()
    expect(el.querySelector('.d1-jar-notch')).not.toBeNull()
  })
  it('over: a hatch past the notch and the text "120 over", with no red wording', () => {
    m = mount(<Jar label="snacks" level={520} plan={400} state="live" />)
    const el = root('[data-component="jar"]')
    expect(el.dataset.mode).toBe('over')
    expect(el.querySelector('.d1-jar-over')).not.toBeNull()
    expect(el.querySelector('pattern line.d1-jar-hatch')).not.toBeNull()
    expect(root('.d1-jar-line').textContent).toBe('120 over')
    expect(el.textContent).not.toMatch(/budget|warning|danger|exceed/i)
  })
  it('empty: an empty well and a sentence', () => {
    m = mount(<Jar label="travel" level={0} plan={600} state="live" />)
    expect(root('[data-component="jar"]').dataset.mode).toBe('empty')
    expect(root('.d1-jar-line').textContent).toBe('nothing in it yet')
  })
  it.each(states.filter((s) => !showsNumber(s)))('%s draws the hollow jar and no figure', (s: LampState) => {
    m = mount(<Jar label="chai" level={320} plan={400} state={s} />)
    const el = root('[data-component="jar"]')
    expect(el.dataset.form).toBe('hollow')
    expect(el.querySelector('.d1-jar-under')).toBeNull()
    expect(el.textContent).not.toMatch(/320|400|left|over/)
    expect(el.getAttribute('aria-label')).toContain('no value')
  })
  it('gives each jar its own pattern ids', () => {
    m = mount(<><Jar label="a" level={1} plan={2} state="live" /><Jar label="b" level={3} plan={2} state="live" /></>)
    const ids = [...document.querySelectorAll('pattern')].map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the folder as a whole', () => {
  const dir = resolve(__dirname, '..')
  const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f))
  const text = (f: string) => readFileSync(join(dir, f), 'utf8')
  it('every component carries data-component and a data-state', () => {
    for (const f of ['Odometer.tsx', 'Dumbbell.tsx', 'LedgerTape.tsx', 'Jar.tsx']) {
      expect(text(f)).toMatch(/data-component=/)
      expect(text(f)).toMatch(/data-state=/)
    }
  })
  it('no animation frame, no timer, no keyframes, no red, no hex colour, no streak word', () => {
    for (const f of files) {
      const t = text(f)
      expect(t, f).not.toMatch(/requestAnimationFrame|setInterval|setTimeout|@keyframes/)
      expect(t, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^\n]*\burl)/)
      expect(t, f).not.toMatch(/(?:color|fill|stroke|background|border|outline)[^;\n]*\bred\b|var\(--state-fault\)|--p-red/)
    }
    for (const f of files.filter((f) => /\.tsx$/.test(f))) expect(text(f), f).not.toMatch(/streak|broken|over budget|dangerouslySetInnerHTML|innerHTML|eval\(/i)
  })
  it('imports only the folders the contract allows', () => {
    for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
      for (const m of text(f).matchAll(/from '(\.\.?\/[^']+)'/g)) {
        const spec = m[1]
        if (spec.startsWith('./')) continue
        expect(spec, f).toMatch(/^\.\.\/\.\.\/(kit|lamp|grammar|motion)(\/|$)/)
      }
    }
  })
})
