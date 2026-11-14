// A.L02: the Trim key and popover, the registry, the audit and the palette mode. The rendered side (44 px, the ring,
// forced colours, 390 px) is e2e/l02-trim.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount } from '../../../__tests__/ww/_stubs'
import { ALIASES, SETTINGS, SettingsIndex, Trim, auditTrims, collectSettings, danglingAliases, groupSettings, mountedTrimIds, placePopover, resolveSetting, searchSettings, valueText } from '..'
import { POP_MAX_H, POP_MAX_W } from '../layout'
import { collectModes, modeOf } from '../../../shell/modes'
import { mode as settingsMode, settingRows } from '../../../shell/modes/settings.mode'
import * as fixtures from './fixture.settings'
import { chime, density, fixtureState, resetFixtures } from './fixture.settings'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => resetFixtures())
afterEach(() => {
  m?.unmount()
  m = null
})
const fx = collectSettings({ './fixture.settings.ts': fixtures })
const press = (el: Element) => act(() => void (el as HTMLElement).click())
const key = (el: Element, k: string, extra: KeyboardEventInit = {}) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })))
const pop = () => document.querySelector<HTMLElement>('.tr-pop')

/** The two fixtures, each with its own control: a slider for density, a checkbox for the chime. */
function Surface({ skip = '', extra = '' }: { skip?: string; extra?: string }) {
  return (
    <div>
      {skip !== density.id && (
        <Trim settingId={density.id} label="Ring density" readsBy="the Core ring draws that many segments" def={density}>
          <input aria-label="Density" type="range" min={10} max={100} defaultValue={fixtureState.density} onChange={(e) => (fixtureState.density = Number(e.target.value))} />
        </Trim>
      )}
      {skip !== chime.id && (
        <Trim settingId={chime.id} label="Block chime" readsBy="the day timer plays it at the end of a block" def={chime}>
          <input aria-label="Chime" type="checkbox" defaultChecked={fixtureState.chime} />
        </Trim>
      )}
      {extra && <Trim settingId={extra} label="Stray" readsBy="nothing registered" />}
    </div>
  )
}

describe('the registry', () => {
  it('collects the fixtures in section order, with no error', () => {
    expect(fx.errors).toEqual([])
    expect(fx.list.map((d) => d.id)).toEqual(['core.density', 'day.chime'])
  })
  it('reports an incomplete def, a repeated id and a file with no setting, and keeps the good ones', () => {
    const c = collectSettings({
      './a.settings.ts': { default: { id: 'x', label: 'x' } },
      './b.settings.ts': { settings: [density, { ...density }] },
      './c.settings.ts': {},
    })
    expect(c.list.map((d) => d.id)).toEqual(['core.density'])
    expect(c.errors).toHaveLength(3)
  })
  it('the product registry holds no fixture (they sit under __tests__) and has no collection error', () => {
    expect(SETTINGS.list.some((d) => d.id === density.id)).toBe(false)
    expect(SETTINGS.errors).toEqual([])
  })
  it('the alias table resolves, and every alias points at a registered id', () => {
    expect(ALIASES).toEqual({})
    expect(danglingAliases()).toEqual([])
    const withAlias = { 'settings.density': 'core.density' }
    expect(resolveSetting('settings.density', fx, withAlias)?.id).toBe('core.density')
    expect(resolveSetting('core.density', fx, withAlias)?.id).toBe('core.density')
    expect(resolveSetting('nope', fx, withAlias)).toBeNull()
    expect(danglingAliases(fx, { 'settings.gone': 'core.missing' })).toEqual(['settings.gone'])
    expect(resolveSetting('toString', fx, withAlias)).toBeNull() // a prototype key is not an alias
  })
  it('search needs every word and looks in label, id, section and view', () => {
    expect(searchSettings('ring', fx.list).map((d) => d.id)).toEqual(['core.density'])
    expect(searchSettings('day chime', fx.list).map((d) => d.id)).toEqual(['day.chime'])
    expect(searchSettings('day ring', fx.list)).toEqual([])
    expect(searchSettings('  ', fx.list)).toHaveLength(2)
  })
  it('valueText reads a boolean as words, uses the def format, and survives a throwing read', () => {
    expect(valueText(density)).toBe('50 segments')
    expect(valueText(chime)).toBe('on')
    expect(valueText({ ...chime, read: () => { throw new Error('x') } })).toBe('unreadable')
    expect(valueText({ ...chime, read: () => null })).toBe('not set')
  })
})

describe('the audit: no orphan entry and no unregistered field', () => {
  it('every registry entry has a mounted Trim', () => {
    m = mount(<Surface />)
    expect(auditTrims(fx.list, mountedTrimIds())).toEqual({ unmounted: [], unregistered: [] })
  })
  it('FAILS when a registry entry has no mounted Trim (the test the spec asks for)', () => {
    m = mount(<Surface skip={chime.id} />)
    expect(auditTrims(fx.list, mountedTrimIds()).unmounted).toEqual(['day.chime'])
  })
  it('names a Trim whose id is not in the registry', () => {
    m = mount(<Surface extra="day.stray" />)
    expect(auditTrims(fx.list, mountedTrimIds()).unregistered).toEqual(['day.stray'])
  })
  it('a Trim leaves the mounted set when it unmounts, and two Trims for one id count as two', () => {
    m = mount(<div><Trim settingId="a.one" label="A" readsBy="x" /><Trim settingId="a.one" label="A" readsBy="x" /></div>)
    expect(mountedTrimIds()).toEqual(['a.one'])
    m.unmount()
    m = null
    expect(mountedTrimIds()).toEqual([])
  })
})

describe('Trim', () => {
  it('is a 44 px named key with a slider glyph and no popover until pressed', () => {
    m = mount(<Surface />)
    const k = m.container.querySelector<HTMLButtonElement>('[data-trim="core.density"]')!
    expect(k.getAttribute('aria-label')).toBe('Ring density setting')
    expect(k.getAttribute('aria-expanded')).toBe('false')
    expect(k.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(readFileSync(join(__dirname, '..', 'trim.css'), 'utf8')).toMatch(/\.tr-key \{ --key-size: 44px; \}/)
    expect(pop()).toBeNull()
  })
  it('opens with the control, the value now, the default, Reset and what reads it; focus goes to the control', () => {
    m = mount(<Surface />)
    const k = m.container.querySelector<HTMLButtonElement>('[data-trim="core.density"]')!
    press(k)
    const p = pop()!
    expect(p.getAttribute('role')).toBe('dialog')
    expect(k.getAttribute('aria-expanded')).toBe('true')
    expect(p.querySelector('input[type=range]')).toBeTruthy()
    expect(p.querySelector('[data-testid=trim-value]')?.textContent).toBe('50 segments')
    expect(p.textContent).toContain('Default')
    expect(p.textContent).toContain('50 segments')
    expect(p.textContent).toContain('Read by: the Core ring draws that many segments')
    expect([...p.querySelectorAll('button')].some((b) => b.textContent === 'Reset')).toBe(true)
    expect(document.activeElement).toBe(p.querySelector('input[type=range]'))
  })
  it('Esc closes it and returns focus to the key; a press outside closes without stealing focus', () => {
    m = mount(<Surface />)
    const k = m.container.querySelector<HTMLButtonElement>('[data-trim="core.density"]')!
    press(k)
    key(document.activeElement!, 'Escape')
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(k)
    press(k)
    act(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    expect(pop()).toBeNull()
  })
  it('Tab wraps inside the popover in both directions', () => {
    m = mount(<Surface />)
    press(m.container.querySelector('[data-trim="core.density"]')!)
    const p = pop()!
    const items = [...p.querySelectorAll<HTMLElement>('button, input')]
    const last = items[items.length - 1]
    last.focus()
    key(last, 'Tab')
    expect(document.activeElement).toBe(items[0])
    key(items[0], 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
  it('Reset puts the value back, re-reads it, and says so; at the default it is inert and says why', () => {
    fixtureState.density = 80
    m = mount(<Surface />)
    press(m.container.querySelector('[data-trim="core.density"]')!)
    const p = pop()!
    expect(p.querySelector('[data-testid=trim-value]')?.textContent).toBe('80 segments')
    const reset = [...p.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!
    press(reset)
    expect(fixtureState.density).toBe(50)
    expect(p.querySelector('[data-testid=trim-value]')?.textContent).toBe('50 segments')
    expect(p.querySelector('[role=status]')?.textContent).toBe('Back to the default.')
    press(reset)
    expect(reset.getAttribute('aria-disabled')).toBe('true')
  })
  it('a hardware setting keeps its confirm step: the first Reset press arms, the second resets', () => {
    fixtureState.chime = false
    m = mount(<Surface />)
    press(m.container.querySelector('[data-trim="day.chime"]')!)
    const p = pop()!
    const reset = () => [...p.querySelectorAll('button')].find((b) => /reset/i.test(b.textContent ?? ''))!
    press(reset())
    expect(fixtureState.chime).toBe(false)
    expect(reset().textContent).toBe('Confirm reset')
    expect(p.querySelector('[role=status]')?.textContent).toContain('hardware')
    press(reset())
    expect(fixtureState.chime).toBe(true)
  })
  it('a Trim for an unregistered id still frames its control and says it is not registered', () => {
    m = mount(<Trim settingId="x.none" label="Stray" readsBy="nothing">{<input aria-label="c" />}</Trim>)
    press(m.container.querySelector('[data-trim="x.none"]')!)
    expect(pop()!.textContent).toContain('Not in the settings registry yet')
  })
  it('the popover is capped at 320 x 360 in CSS and in the placement function', () => {
    const css = readFileSync(join(__dirname, '..', 'trim.css'), 'utf8')
    expect(css).toContain('max-inline-size: 320px')
    expect(css).toContain('max-block-size: 360px')
    expect([POP_MAX_W, POP_MAX_H]).toEqual([320, 360])
  })
})

describe('placePopover', () => {
  const box = (l: number, t: number) => ({ left: l, top: t, right: l + 44, bottom: t + 44 })
  it('hangs below the key and never exceeds 320 x 360', () => {
    const p = placePopover(box(100, 100), 1366, 768)
    expect(p).toMatchObject({ left: 100, top: 152, width: 320, side: 'below' })
    expect(p.maxHeight).toBeLessThanOrEqual(360)
  })
  it('flips above when below is short and above has more room', () => {
    const p = placePopover(box(100, 700), 1366, 768)
    expect(p.side).toBe('above')
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(700)
  })
  it('stays inside a 390 px phone, 8 px from each edge', () => {
    const p = placePopover(box(340, 100), 390, 844)
    expect(p.width).toBe(320)
    expect(p.left + p.width).toBeLessThanOrEqual(390 - 8)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(placePopover(box(0, 0), 300, 500).width).toBe(284)
  })
  it('keeps a minimum height so the control and Reset are reachable by scrolling inside', () => {
    expect(placePopover(box(10, 380), 800, 440).maxHeight).toBeGreaterThanOrEqual(120)
  })
})

describe('SettingsIndex and the palette mode ":"', () => {
  it('draws the empty state when the registry is empty, and the groups with their values when it is not', () => {
    m = mount(<SettingsIndex defs={[]} />)
    expect(m.container.textContent).toContain('No settings are registered yet')
    m.unmount()
    m = mount(<SettingsIndex defs={fx.list} />)
    const groups = groupSettings(fx.list)
    expect(groups.map((g) => g.section)).toEqual(['core', 'day'])
    expect(m.container.querySelectorAll('.tr-index-row')).toHaveLength(2)
    expect(m.container.textContent).toContain('50 segments')
  })
  it('a row reports the setting to go to', () => {
    let got = ''
    m = mount(<SettingsIndex defs={fx.list} onGo={(d) => (got = `${d.section}.${d.view}`)} />)
    press(m.container.querySelector('[data-setting="day.chime"]')!)
    expect(got).toBe('day.today')
  })
  it('the mode file is a valid ShellMode on ":" and collects with the others', () => {
    const c = collectModes({ './settings.mode.ts': { default: settingsMode } })
    expect(c.errors).toEqual([])
    expect(modeOf(':drift', c)?.rest).toBe('drift')
    expect(settingsMode.prefix).toBe(':')
  })
  it('rows go to the product, section and view of each setting, and say so when there is nothing to list', () => {
    const rows = settingRows('', fx)
    expect(rows.map((r) => r.go)).toEqual([
      { product: 'jarvis', section: 'core', view: 'talk' },
      { product: 'ww', section: 'day', view: 'today' },
    ])
    expect(rows[0].detail).toContain('50 segments')
    expect(settingRows('chime', fx)).toHaveLength(1)
    expect(settingRows('zzz', fx)[0]).toMatchObject({ id: 'setting.nomatch', absent: true })
    expect(settingRows('', { list: [], errors: [] })[0]).toMatchObject({ id: 'setting.none', absent: true })
  })
})

describe('the folder keeps its seams', () => {
  const SRC = resolve(__dirname, '..', '..', '..')
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
  it('reaches out of its folder only to shared/kit (a test of the wave contract: no D01 to D05, no J01, no products)', () => {
    const own = walk(join(SRC, 'shared', 'trim')).filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'))
    const out = own.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from\s+'(\.\.[^']+)'/g)].map((x) => x[1]))
    expect(out.filter((s) => !s.startsWith('../kit/'))).toEqual([])
  })
})
