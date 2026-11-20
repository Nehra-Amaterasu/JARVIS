// T1, design language v3: the kit pieces (behaviour, honesty, the stylesheet's own lint, sizes). The rendered size and target
// checks in a real browser are e2e/v3-kit.spec.ts; this is the part that can be proved from the markup and the file.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../ww/_stubs'
import { Chip, Counter, Dial, Gauge, Group, Key, Ledger, LockedKey, Mark, Plate, PressKey, Sigil, StepLabel, arcPath, asciiRule, fraction } from '../../shared/kit/v3'
import { LAMP_WORD } from '../../shared/kit'
import { LAMP_STATES } from '../../shared/lamp'
import { KIT_PATH, kitCss, parse, resolve, tokens } from './css'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
const click = (el: Element) => act(() => void (el as HTMLElement).click())
const q = <T extends Element = HTMLElement>(sel: string) => m!.container.querySelector<T>(sel)!
const all = (sel: string) => [...m!.container.querySelectorAll(sel)]

describe('Key', () => {
  it('is a 44 px button type=button; a press calls onClick', () => {
    const on = vi.fn()
    m = mount(<Key onClick={on}>Open</Key>)
    expect(q('button').getAttribute('type')).toBe('button')
    click(q('button'))
    expect(on).toHaveBeenCalledTimes(1)
  })
  it('lit is the neutral ON state: a toggle carries aria-pressed, a plain lit key does not, and lit is never the accent', () => {
    m = mount(
      <>
        <Key lit toggle>Frosted</Key>
        <Key lit>Current</Key>
        <Key accent>Go</Key>
      </>,
    )
    const [a, b, c] = all('button')
    expect(a.getAttribute('aria-pressed')).toBe('true')
    expect(a.getAttribute('data-accent')).toBeNull()
    expect(b.getAttribute('aria-pressed')).toBeNull()
    expect(b.getAttribute('data-lit')).toBe('true')
    expect(c.getAttribute('data-accent')).toBe('true')
    expect(c.getAttribute('data-lit')).toBeNull()
  })
  it('caps are drawn as pressed-in wells (kbd) after the label, never as outlined chips', () => {
    m = mount(<Key accent caps={['CTRL', 'SHIFT', 'SPACE']}>Wake JARVIS</Key>)
    expect(all('kbd.v3-cap').map((k) => k.textContent)).toEqual(['CTRL', 'SHIFT', 'SPACE'])
    expect(q('button').textContent).toBe('Wake JARVISCTRLSHIFTSPACE')
    m.unmount()
    m = mount(<PressKey>CTRL</PressKey>)
    expect(q('kbd').className).toBe('v3-cap')
  })
  it('a still pose is painted by data-demo, and rest paints nothing', () => {
    m = mount(
      <>
        <Key pose="hover">a</Key>
        <Key pose="pressed">b</Key>
        <Key pose="focus">c</Key>
        <Key pose="rest">d</Key>
      </>,
    )
    expect(all('button').map((b) => b.getAttribute('data-demo'))).toEqual(['hover', 'pressed', 'focus', null])
  })
  it('a busy key keeps its place, says so, and a press does nothing', () => {
    const on = vi.fn()
    m = mount(<Key busy onClick={on}>Checking…</Key>)
    click(q('button'))
    expect(on).not.toHaveBeenCalled()
    expect(q('button').getAttribute('aria-busy')).toBe('true')
  })
})

describe('LockedKey', () => {
  it('is aria-disabled, stays focusable, prints its reason as real text and describes the key by it, and a press does nothing', () => {
    m = mount(<LockedKey reason="needs the steward to answer first.">Start JARVIS</LockedKey>)
    const b = q<HTMLButtonElement>('button')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.disabled).toBe(false)
    const why = q('.v3-locked-why')
    expect(why.textContent).toBe('Locked: needs the steward to answer first.')
    expect(b.getAttribute('aria-describedby')).toBe(why.id)
    expect(q('svg[data-glyph="lock"]')).toBeTruthy()
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void b.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(true)
  })
  it('is drawn without a raise or a press shadow, and carries no accent and no lit state', () => {
    const css = kitCss()
    const rule = parse(css).find((r) => r.selectors.includes(".v3-key[data-kind='locked']"))!
    expect(rule.decls['box-shadow']).toBe('var(--sh-locked)')
    expect(rule.decls['transform']).toBe('none')
    const t = tokens('dark', 'on')
    expect(t['--sh-locked']).not.toBe(t['--sh-raise'])
    expect(t['--sh-locked']).not.toBe(t['--sh-press'])
    m = mount(<LockedKey reason="x">Y</LockedKey>)
    expect(q('button').getAttribute('data-accent')).toBeNull()
    expect(q('button').getAttribute('data-lit')).toBeNull()
  })
})

describe('Chip', () => {
  it.each(LAMP_STATES)('%s: the shared lamp word and the shared glyph, nothing redrawn', (s) => {
    m = mount(<Chip state={s} />)
    expect(q('.v3-chip-word').textContent).toBe(LAMP_WORD[s])
    expect(q('.k-lamp-glyph').getAttribute('data-state')).toBe(s)
    expect(q('.k-lamp-glyph').getAttribute('data-shape')).toBeTruthy()
  })
  it('a tag with no state is only its text', () => {
    m = mount(<Chip>MIC · NO LEVEL</Chip>)
    expect(q('.v3-chip').getAttribute('data-kind')).toBe('tag')
    expect(m.container.querySelector('svg')).toBeNull()
  })
})

describe('Ledger', () => {
  const rows = [
    { id: 'a', label: 'Voice core', reason: 'core not started', state: 'waiting' as const, value: 42 },
    { id: 'b', label: 'Sample', reason: 'generated sample', state: 'simulated' as const, value: '0.2' },
    { id: 'c', label: 'Steward', reason: 'a very long reason that has to wrap on a narrow column and never end in an ellipsis at all', state: 'fault' as const, action: <Key accent>Check steward</Key> },
  ]
  it('prints a number only under LIVE or SIMULATED; a waiting row with a value still prints a dash', () => {
    m = mount(<Ledger label="rows" rows={rows} />)
    const vals = all('.v3-ledger-value').map((v) => v.textContent)
    expect(vals[0]).toContain('–')
    expect(vals[0]).not.toContain('42')
    expect(vals[1]).toBe('0.2')
  })
  it('every row carries its state word and its reason as text, whole (a state is never cut)', () => {
    m = mount(<Ledger label="rows" rows={rows} />)
    expect(all('.v3-ledger-row').map((r) => r.querySelector('.v3-chip-word')!.textContent)).toEqual(['WAITING', 'SIMULATED', 'FAULT'])
    expect(all('.v3-ledger-reason').map((r) => r.textContent)).toEqual(rows.map((r) => r.reason))
  })
  it('a fault and its remedy share one row', () => {
    m = mount(<Ledger label="rows" rows={rows} />)
    const fault = all('.v3-ledger-row')[2]
    expect(fault.querySelector('.v3-ledger-act button')!.textContent).toBe('Check steward')
  })
  it('rows become keys that select when onSelect is given: one pressed, the selected row is the lit cap', () => {
    const on = vi.fn()
    m = mount(<Ledger label="rows" rows={rows} selectedId="b" onSelect={on} />)
    const mains = all('.v3-ledger-main')
    expect(mains.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    expect(all('.v3-ledger-row').map((r) => r.getAttribute('data-selected'))).toEqual([null, 'true', null])
    click(mains[0])
    expect(on).toHaveBeenCalledWith('a')
  })
})

describe('Dial and Gauge: a reading is drawn only when something produced it', () => {
  it.each(['waiting', 'planned', 'fault'] as const)('%s: the WAITING pose, a dash, no arc, no needle, the state chip, a reason', (s) => {
    m = mount(
      <>
        <Dial name="Count" state={s} value={5} max={10} reason="needs what it heard" />
        <Gauge name="GPU memory" state={s} value={0.2} max={6} unit="GB" reason="brain not loaded" />
      </>,
    )
    expect(all('[data-pose="waiting"]')).toHaveLength(2)
    expect(all('.v3-arc, .v3-needle, .v3-hub')).toHaveLength(0)
    expect(all('.v3-dial-num, .v3-gauge-num').map((n) => n.textContent)[0]).toBe('–')
    expect(all('.v3-chip-word').map((w) => w.textContent)).toEqual([LAMP_WORD[s], LAMP_WORD[s]])
    expect(all('.v3-dial-why').map((w) => w.textContent)).toEqual(['needs what it heard', 'brain not loaded'])
    expect(m.container.textContent).not.toMatch(/\b0\.2\b|\b5\b/)
  })
  it('waiting with no reason says "no report"', () => {
    m = mount(<Dial name="Count" state="waiting" max={10} />)
    expect(q('.v3-dial-why').textContent).toBe('no report')
  })
  it('simulated: the arc, the number, and the SIMULATED chip together', () => {
    m = mount(<Gauge name="GPU memory" state="simulated" value={0.2} max={6} unit="GB" />)
    expect(q('.v3-gauge').getAttribute('data-pose')).toBe('drawn')
    expect(q('.v3-chip-word').textContent).toBe('SIMULATED')
    expect(q('.v3-gauge-num').textContent).toContain('0.2')
    expect(q('.v3-gauge-num').textContent).toContain('of 6.0 GB')
    expect(q('svg').getAttribute('aria-label')).toContain('SIMULATED')
  })
  it('a missing, non-finite or unscaled value is not drawn even when LIVE', () => {
    m = mount(
      <>
        <Dial name="a" state="live" max={10} />
        <Dial name="b" state="live" value={Number.NaN} max={10} />
        <Dial name="c" state="live" value={3} max={0} />
      </>,
    )
    expect(all('[data-pose="drawn"]')).toHaveLength(0)
  })
  it('the arithmetic: fraction clamps, and the arc path is a clockwise arc of the right size', () => {
    expect(fraction(5, 10)).toBe(0.5)
    expect(fraction(20, 10)).toBe(1)
    expect(fraction(-1, 10)).toBe(0)
    expect(fraction(null, 10)).toBeNull()
    expect(fraction(1, 0)).toBeNull()
    expect(arcPath(80, 76, 60, 135, 405)).toMatch(/^M[\d.]+ [\d.]+A60 60 0 1 1 [\d.]+ [\d.]+$/)
    expect(arcPath(12, 12, 5, -50, 50)).toMatch(/A5 5 0 0 1/)
  })
})

describe('Sigil and Mark', () => {
  it('a mic arc is drawn only with a level: no level, only the empty track', () => {
    m = mount(<Sigil />)
    expect(q('.v3-sigil').getAttribute('data-level')).toBe('none')
    expect(all('.v3-mic-val')).toHaveLength(0)
    expect(all('.v3-mic-track')).toHaveLength(1)
    m.unmount()
    m = mount(<Sigil level={0.4} simulated />)
    expect(q('.v3-sigil').getAttribute('data-level')).toBe('simulated')
    expect(all('.v3-mic-val')).toHaveLength(1)
  })
  it('asleep it breathes, awake it turns and does not breathe', () => {
    m = mount(<Sigil />)
    expect([q('.v3-sigil').getAttribute('data-awake'), q('.v3-sigil').getAttribute('data-breathe')]).toEqual(['false', 'true'])
    m.unmount()
    m = mount(<Sigil awake />)
    expect([q('.v3-sigil').getAttribute('data-awake'), q('.v3-sigil').getAttribute('data-breathe')]).toEqual(['true', 'false'])
  })
  it('the four marks differ, Well Wisher is ASCII, a mark is decorative unless named', () => {
    const kinds = ['jarvis', 'aankhen', 'yadaash'] as const
    const shapes = kinds.map((k) => {
      const h = mount(<Mark kind={k} />)
      const s = h.container.querySelector('svg')!.innerHTML
      h.unmount()
      return s
    })
    expect(new Set(shapes).size).toBe(3)
    m = mount(<Mark kind="wellwisher" />)
    expect(q('.v3-mark-ascii').textContent).toBe('[•]')
    expect(q('.v3-mark-ascii').getAttribute('aria-hidden')).toBe('true')
    m.unmount()
    m = mount(<Mark kind="jarvis" label="JARVIS" disc lit />)
    expect(q('svg').getAttribute('role')).toBe('img')
    expect(q('.v3-mark-disc').getAttribute('data-lit')).toBe('true')
  })
})

describe('Plate, Group, StepLabel', () => {
  it('a plate with a step and a job is a labelled region headed "1 WAKE", read as "Step 1 of 3: WAKE"', () => {
    m = mount(
      <Plate tier="first" step={1} job="WAKE" chip={<Chip state="waiting" />} ruler="sigil">
        body
      </Plate>,
    )
    const p = q('.v3-plate')
    expect(p.getAttribute('data-tier')).toBe('first')
    const head = q('.v3-step')
    expect(p.getAttribute('aria-labelledby')).toBe(head.id)
    expect(head.textContent).toBe('Step 1 of 3: 1WAKE')
    expect(q('.v3-step-n').getAttribute('aria-hidden')).toBe('true')
    expect(all('.v3-ruler i')).toHaveLength(24)
  })
  it('the three dots are gone: the head has no dots, the words NOW, NEXT and LATER are not printed', () => {
    m = mount(
      <>
        <Plate tier="first" step={1} job="START" />
        <Plate step={2} job="FOLLOW-UPS" />
        <Plate tier="third" step={3} job="EVIDENCE" />
      </>,
    )
    expect(all('.dots, i.on')).toHaveLength(0)
    expect(m.container.textContent).not.toMatch(/\b(NOW|NEXT|LATER)\b/)
    expect(all('.v3-step-n').map((n) => n.textContent)).toEqual(['1', '2', '3'])
  })
  it('Well Wisher draws [n] in ASCII instead of the numeral well', () => {
    m = mount(<StepLabel n={2} job="FOLLOW-UPS" mark="bracket" />)
    expect(q('.v3-step-n').textContent).toBe('[2]')
    expect(all('.v3-step-tick')).toHaveLength(0)
  })
  it('rise sets the stagger index and flare and glint remount on a new value', () => {
    m = mount(<Plate rise={2} flare="a" glint="a">x</Plate>)
    expect(q('.v3-plate').style.getPropertyValue('--rise-i')).toBe('2')
    const first = q('.v3-flare')
    m.render(<Plate rise={2} flare="b" glint="b">x</Plate>)
    expect(q('.v3-flare')).not.toBe(first)
  })
  it('a group is captioned by its own heading; the state chip sits in the caption', () => {
    m = mount(
      <Group label="Counters" chip={<Chip state="simulated" />}>
        <p>row</p>
      </Group>,
    )
    const g = q('.v3-group')
    expect(g.getAttribute('aria-labelledby')).toBe(q('.v3-group-cap').id)
    expect(q('.v3-group-cap .v3-chip-word').textContent).toBe('SIMULATED')
    expect(g.getAttribute('data-variant')).toBe('well')
  })
  it('the ASCII rule ends on a full bar at any measured width and is empty when it cannot fit', () => {
    for (const n of [2, 11, 23, 41, 80]) {
      const r = asciiRule(n)
      expect(r).toHaveLength(n)
      expect(r[0]).toBe('|')
      expect(r[n - 1]).toBe('|')
    }
    expect(asciiRule(21)).toBe('|····:····|····:····|')
    expect(asciiRule(1)).toBe('')
  })
})

describe('Counter', () => {
  it('a real zero is "0" and "no taps yet"; a waiting source is a dash; a tap calls back and the digit rolls', () => {
    const on = vi.fn()
    m = mount(<Counter name="Chai" count={0} onTap={on} />)
    expect(q('.v3-counter-dial').textContent).toBe('0')
    expect(q('small').textContent).toBe('no taps yet')
    click(q('button'))
    expect(on).toHaveBeenCalledTimes(1)
    expect(q('button').getAttribute('aria-label')).toBe('+1 Chai')
    m.render(<Counter name="Chai" count={3} onTap={on} />)
    expect(q('small').textContent).toBe('3 so far today')
    expect(q('.v3-roll').textContent).toBe('3')
    m.render(<Counter name="Chai" count={null} onTap={on} />)
    expect(q('.v3-counter-dial').textContent).toBe('–')
  })
})

// ---------------------------------------------------------------------------------------------- the stylesheet's own lint
describe('shared/kit/glass.css lint (the repo-wide rules, applied to the new sheet)', () => {
  const css = kitCss()
  const rules = parse(css)
  const decls = rules.flatMap((r) => Object.entries(r.decls).map(([k, v]) => ({ sel: r.selectors.join(', '), k, v })))
  it('no colour literal: no hex, rgb(a), hsl(a), color-mix', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|color-mix\(/)
  })
  it('no px literal for font-size, border-radius, padding, margin or gap (0 and 1px excepted)', () => {
    for (const d of decls) {
      if (!/^(font-size|border-radius|padding|margin|gap|row-gap|column-gap)(-[\w-]+)?$/.test(d.k)) continue
      const px = (d.v.match(/(?<![\w.])(\d*\.?\d+)px/g) ?? []).filter((x) => x !== '0px' && x !== '1px')
      expect(px, `${d.sel} { ${d.k}: ${d.v} }`).toEqual([])
    }
  })
  it('no px literal inside the font shorthand, so no text size is hidden from the 11 px check', () => {
    for (const d of decls) if (d.k === 'font') expect(d.v, d.sel).not.toMatch(/\d+px/)
  })
  it('no literal duration and no literal easing (every motion is a token)', () => {
    const noKf = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    expect(noKf).not.toMatch(/(^|[^\w-])\d*\.?\d+m?s\b(?!\w)/)
    expect(css).not.toMatch(/cubic-bezier\(|(?<![-\w])ease(-in|-out|-in-out)?(?![-\w])|(?<![-\w])linear(?![-\w])|steps\(/)
  })
  it('every transition names its properties; none is "all"', () => {
    for (const d of decls) {
      if (d.k !== 'transition' && d.k !== 'transition-property') continue
      expect(d.v, d.sel).not.toMatch(/\ball\b/)
      expect(d.v, d.sel).toMatch(/^none$|\b(transform|box-shadow|stroke-dasharray|opacity|background|color)\b/)
    }
  })
  it('no !important, no will-change, no cursor: none, no outline: none', () => {
    expect(css).not.toMatch(/!important|will-change|cursor\s*:\s*none|outline\s*:\s*(none|0)\b/)
  })
  it('no hairline on a labelled control: every border is 0, transparent or --hair, except the decorative step tick', () => {
    for (const d of decls) {
      if (!/^border(-top|-left|-right|-bottom)?$/.test(d.k)) continue
      if (/^(0|none)$/.test(d.v)) continue
      if (d.sel.includes('v3-step-tick')) continue
      expect(d.v, `${d.sel} { ${d.k}: ${d.v} }`).toMatch(/var\(--hair\)|0 /)
    }
  })
  it('reads only tokens that glass.css or the shared kit declare, or that it declares itself', () => {
    const known = new Set([...Object.keys(tokens('dark', 'on')), '--c-ground', '--c-spine', '--c-tray', '--c-trayn', '--c-trayl', '--c-well', '--c-well-solid', '--c-slot', '--c-lock', '--c-group', '--rise-i', '--v3-size', '--v3-fs', '--font-mono', '--sheen-spine'])
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].map((x) => x[1])
    expect([...new Set(used)].filter((u) => !known.has(u))).toEqual([])
  })
})

describe('sizes: text is 11 px or more, controls are 44 px or more', () => {
  const t = tokens('dark', 'on')
  const css = kitCss()
  const rules = parse(css)
  const px = (v: string) => parseFloat(resolve(v, t))
  it('every font-size and font shorthand resolves to 11 px or more', () => {
    let n = 0
    for (const r of rules)
      for (const [k, v] of Object.entries(r.decls)) {
        let size: number | null = null
        if (k === 'font-size') size = px(v)
        if (k === 'font' && v !== 'inherit') size = parseFloat(/(\d+(?:\.\d+)?px)\s*(?:\/|$)/.exec(resolve(v, t))?.[1] ?? 'NaN')
        if (size === null) continue
        n++
        expect(size, `${r.selectors.join(', ')} { ${k}: ${v} }`).toBeGreaterThanOrEqual(11)
      }
    expect(n).toBeGreaterThan(15)
  })
  it('the type tokens: the smallest is 11 px', () => {
    const sizes = Object.entries(t).filter(([k]) => /^--t-\d+$/.test(k)).map(([, v]) => parseFloat(v))
    expect(Math.min(...sizes)).toBe(11)
  })
  it('the key is 44 px on both sides through --hit, and the big key is taller; the +1 key is 52 wide', () => {
    expect(t['--hit']).toBe('44px')
    const key = rules.find((r) => r.selectors.includes('.v3-key') && r.decls['min-height'])!
    expect(key.decls['min-height']).toBe('var(--hit)')
    expect(key.decls['min-width']).toBe('var(--hit)')
    expect(px(rules.find((r) => r.selectors.includes(".v3-key[data-size='big']"))!.decls['min-height'])).toBeGreaterThanOrEqual(44)
    expect(px(rules.find((r) => r.selectors.includes('.v3-counter .v3-key'))!.decls['width'])).toBe(52)
    expect(px(rules.find((r) => r.selectors.includes(".v3-ledger-main[data-button='true']"))!.decls['min-height'])).toBeGreaterThanOrEqual(44)
  })
  it('the lamp shape is 14 px', () => {
    const g = rules.find((r) => r.selectors.includes('.v3-chip .k-lamp-glyph'))!
    expect([g.decls['width'], g.decls['height']]).toEqual(['14px', '14px'])
  })
})

describe('reduced motion and forced colours: the stills', () => {
  const css = kitCss()
  const rules = parse(css)
  it('every animated class is switched off under prefers-reduced-motion and under data-motion=calm', () => {
    const animated = rules.filter((r) => r.at.length === 0 && 'animation' in r.decls && r.decls['animation'] !== 'none').flatMap((r) => r.selectors)
    expect(animated.length).toBeGreaterThanOrEqual(8)
    const reduced = rules.filter((r) => r.at.some((a) => /prefers-reduced-motion/.test(a)) && r.decls['animation'] === 'none').flatMap((r) => r.selectors.map((s) => s.replace(":root:not([data-motion='full']) ", '')))
    const calm = rules.filter((r) => r.decls['animation'] === 'none' && r.selectors.some((s) => s.includes("[data-motion='calm']"))).flatMap((r) => r.selectors.map((s) => s.replace(":root[data-motion='calm'] ", '')))
    for (const a of animated) {
      const base = a.replace(/\[data-[^\]]+\]/g, (m) => (m === "[data-rise]" ? m : ''))
      expect(reduced.some((s) => s === a || s === base || a.startsWith(s) || s.startsWith(base)), `reduced: ${a}`).toBe(true)
      expect(calm.some((s) => s === a || s === base || a.startsWith(s) || s.startsWith(base)), `calm: ${a}`).toBe(true)
    }
  })
  it('has no infinite animation except the two continuous motions of section 5: the breathing ring and the awake turn', () => {
    const inf = rules.filter((r) => /infinite/.test(r.decls['animation'] ?? '')).flatMap((r) => r.selectors)
    expect(inf.every((s) => /v3-sigil/.test(s))).toBe(true)
  })
  it('forced colours: the key keeps an edge and a Highlight focus ring, and the ground is dropped', () => {
    const f = rules.filter((r) => r.at.some((a) => /forced-colors/.test(a)))
    expect(f.flatMap((r) => r.selectors).join(' ')).toContain('.v3-key')
    expect(f.some((r) => r.decls['outline'] === '2px solid Highlight')).toBe(true)
    expect(f.some((r) => r.selectors.includes('.v3-ground') && r.decls['display'] === 'none')).toBe(true)
  })
})

describe('the folder', () => {
  it('shared/kit/v3 has the pieces of the brief and the kit index does not re-export them (they would clash with the clay Key and Chip)', () => {
    const dir = join(dirname(KIT_PATH), 'v3')
    const files = readdirSync(dir)
    expect(files).toEqual(expect.arrayContaining(['Plate.tsx', 'Keys.tsx', 'Data.tsx', 'Forms.tsx', 'Marks.tsx', 'index.ts']))
    expect(readFileSync(join(dirname(KIT_PATH), 'index.ts'), 'utf8')).not.toMatch(/\/v3/)
  })
})
