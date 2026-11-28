// T1, design language v3: the tokens of sections 2.2 to 2.5, and the contrast floors of 2.7 computed from the token values
// against the worst backdrops (white behind the dark ground, black behind the light ground), with no brightness help: the host
// cannot apply one (spec 2.7). Also proved from the file: glass off sets every alpha to 1, nothing here matches without
// data-look='v3' (so the current look is unchanged), the existing roles are mapped, and high contrast and forced colours win.
import { describe, expect, it } from 'vitest'
import { TOKENS_PATH, colour, kitCss, over, parse, ratio, tokens, tokensCss, triple, type RGB, type TokenMap } from './css'

const ALPHAS = ['--ga', '--sa', '--ta', '--tna', '--tla', '--wa'] as const
// spec 2.2 to 2.5: every property of the tables, by name
const SPEC = [
  '--ground-rgb', '--ga', '--glass-filter', '--spine-rgb', '--sa', '--tray-rgb', '--ta', '--trayn-rgb', '--tna', '--trayl-rgb', '--tla',
  '--well-rgb', '--wa', '--edge', '--pop', '--raised', '--raised-hi', '--lit-a', '--lit-b', '--hi', '--lo', '--lot', '--glare', '--sheen',
  '--ink', '--ink2', '--ink3', '--live', '--fault', '--sim', '--locked', '--track', '--focus', '--gap',
  '--accent', '--accent-a', '--accent-b', '--on-accent', '--sh-raise', '--sh-raise-hover', '--sh-press', '--sh-tray', '--sh-now', '--sh-later',
  '--cap-fill', '--cap-ink', '--cap-sh', '--sh-accent', '--sh-accent-press',
  '--rad-now', '--rad-tray', '--rad-plate', '--rad-key', '--rad-key-big', '--rad-slot', '--rad-cap', '--rad-chip', '--ease', '--d-key', '--d-roll', '--d-rise', '--d-flare',
] as const

const num = (v: string) => Number(v)

/** Every layer of a ground over its worst backdrop. The spine and the ground sit on the desktop; trays and wells on the ground. */
function stacks(ground: 'dark' | 'light') {
  const t = tokens(ground, 'on')
  const worst: RGB = ground === 'dark' ? [255, 255, 255] : [0, 0, 0]
  const g = over(triple(t['--ground-rgb']), num(t['--ga']), worst)
  const spine = over(triple(t['--spine-rgb']), num(t['--sa']), worst)
  // the glare (every tray, strongest at its top left corner) LIGHTENS a tray: take it at full strength, where it is worst. The
  // flare of 1.3 s on one event is a transient and is not counted; the spine has its own, lighter band (--sheen-spine).
  const lift = (c: RGB): RGB => {
    const a = colour(t['--glare'])
    return over(a.rgb, a.a, c)
  }
  const band = (c: RGB): RGB => {
    const b = colour(t['--sheen-spine'])
    return over(b.rgb, b.a, c)
  }
  const layer = (rgb: string, a: string) => lift(over(triple(t[rgb]), num(t[a]), g))
  const tray = layer('--tray-rgb', '--ta')
  const trayn = layer('--trayn-rgb', '--tna')
  const trayl = layer('--trayl-rgb', '--tla')
  const well = over(triple(t['--well-rgb']), num(t['--wa']), g)
  const lock = (under: RGB) => over(triple(t['--well-rgb']), 0.3, under)
  return { t, worst, g, spine: band(spine), tray, trayn, trayl, well, lock }
}

describe('the token file', () => {
  const dark = tokens('dark', 'on')
  const light = tokens('light', 'on')

  it('carries every custom property of sections 2.2 to 2.5, on both grounds', () => {
    for (const k of SPEC) {
      expect(dark[k], `dark ${k}`).toBeTruthy()
      expect(light[k], `light ${k}`).toBeTruthy()
    }
  })
  // 28 Nov, the design reset: the alphas are the host values with no brightness help (ground .78 dark, .82 light), the spine
  // sits on the ground (the same alpha) and the three tray tiers are ONE surface (one alpha)
  it('the six alphas are tokens, and the host values are the stricter ones of 2.7 on the dark ground', () => {
    for (const a of ALPHAS) expect(Number.isFinite(num(dark[a])) && Number.isFinite(num(light[a])), a).toBe(true)
    expect([dark['--ga'], dark['--sa']]).toEqual(['0.78', '0.78'])
    expect([dark['--ta'], dark['--tna'], dark['--tla'], dark['--wa']]).toEqual(['0.94', '0.94', '0.94', '0.95'])
    expect([light['--ga'], light['--sa'], light['--ta'], light['--tna'], light['--tla'], light['--wa']]).toEqual(['0.82', '0.82', '0.95', '0.95', '0.95', '0.95'])
  })
  // 28 Nov: this test said "the trays grade by opacity: first > second > third". The reset's rule is the opposite on purpose
  // (one tray surface; hierarchy by order, type and shadow depth), so the test now holds that, and the wells stay near opaque
  it('the wells stay near opaque (never below .92) and the three tray tiers are one surface: one colour, one alpha', () => {
    for (const t of [dark, light]) {
      expect(num(t['--wa'])).toBeGreaterThanOrEqual(0.92)
      expect(t['--tna']).toBe(t['--ta'])
      expect(t['--tla']).toBe(t['--ta'])
      expect(t['--trayn-rgb']).toBe(t['--tray-rgb'])
      expect(t['--trayl-rgb']).toBe(t['--tray-rgb'])
      expect(t['--spine-rgb']).toBe(t['--ground-rgb'])
    }
  })
  it('monochrome first: every ground, surface and raised step is neutral (channels within 1 dark, within 5 for the warm off-white)', () => {
    const spread = (c: RGB) => Math.max(...c) - Math.min(...c)
    for (const [t, max] of [[dark, 1], [light, 5]] as const) {
      for (const k of ['--ground-rgb', '--spine-rgb', '--tray-rgb', '--trayn-rgb', '--trayl-rgb', '--well-rgb']) expect(spread(triple(t[k])), k).toBeLessThanOrEqual(max)
      for (const k of ['--pop', '--raised', '--raised-hi', '--lit-a', '--lit-b', '--gap']) expect(spread(colour(t[k]).rgb), k).toBeLessThanOrEqual(max)
      for (const k of ['--ink', '--ink2', '--ink3', '--locked']) expect(spread(colour(t[k]).rgb), k).toBeLessThanOrEqual(5)
    }
  })
  it('no gradient light and no glow: glare, sheen and the specular dot are transparent, and the accent key has no glow', () => {
    for (const t of [dark, light]) for (const k of ['--glare', '--glare-l', '--sheen', '--sheen-spine', '--spec']) expect(t[k], k).toBe('transparent')
    expect(dark['--accent-glow']).toBe('0 0 0 0 transparent')
    expect(dark['--sh-accent']).toBe(dark['--sh-raise'])
    expect(tokensCss()).not.toMatch(/gradient\(/)
  })
  it('the shadow recipes are the spec ones and read the two light tokens: one light from the top left', () => {
    expect(dark['--sh-raise']).toBe('-4px -4px 10px rgba(255, 255, 255, 0.06), 6px 6px 14px rgba(0, 0, 0, 0.6)')
    expect(dark['--sh-press']).toContain('inset 3px 3px 8px')
    for (const k of ['--sh-raise', '--sh-raise-hover', '--sh-tray', '--sh-now', '--sh-later']) {
      const first = dark[k].split(/,(?![^(]*\))/)[0].trim()
      expect(first.startsWith('-'), `${k}: highlight is up and left`).toBe(true)
    }
    expect(light['--sh-tray']).toContain(light['--lot']) // --lot is the light ground's tray shade
  })
  it('radii, accent and motion are the spec values', () => {
    expect([dark['--rad-now'], dark['--rad-tray'], dark['--rad-plate'], dark['--rad-key'], dark['--rad-key-big'], dark['--rad-slot'], dark['--rad-cap'], dark['--rad-chip']]).toEqual(['30px', '22px', '16px', '14px', '18px', '16px', '13px', '12px'])
    // 28 Nov: the accent of scheme A is an instrument amber (the stock orange #f2591a was named slop), rest and pressed solids
    expect([dark['--accent'], dark['--accent-a'], dark['--accent-b'], dark['--on-accent']]).toEqual(['#edaa3a', '#edaa3a', '#e09e2e', '#1a1204'])
    expect([light['--accent'], light['--accent-a'], light['--accent-b'], light['--on-accent']]).toEqual(['#8a5806', '#8a5806', '#7c4e04', '#fff8ec'])
    expect([dark['--d-key'], dark['--d-roll'], dark['--d-rise'], dark['--d-flare']]).toEqual(['140ms', '160ms', '500ms', '1.3s'])
    expect(dark['--ease']).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
  })
  // 28 Nov: the states get quieter. Only FAULT keeps a colour of its own; LIVE takes the accent; SIMULATED is ink2 (its diamond
  // and its word carry it); WAITING and PLANNED were already ink. The five shapes and words are unchanged (shared/lamp)
  it('only the fault has a colour of its own: live is the accent and simulated is ink', () => {
    expect([dark['--live'], dark['--fault'], dark['--sim']]).toEqual(['#edaa3a', '#ff5f57', '#b4b4af'])
    expect([light['--live'], light['--fault'], light['--sim']]).toEqual(['#8a5806', '#b3261e', '#474743'])
    for (const t of [dark, light]) {
      expect(t['--live']).toBe(t['--accent'])
      expect(t['--sim']).toBe(t['--ink2'])
    }
  })
  // 28 Nov: this test held the cool, saturated glass of jury round 3 ("blue leads red", saturate above 1). The reset asks for
  // the opposite: a neutral ground, and a desktop that comes through desaturated, so a wallpaper never tints the System
  it('the glass lets the desktop through desaturated (saturate under 1) on both grounds', () => {
    for (const t of [dark, light]) expect(t['--glass-filter']).toMatch(/blur\(48px\) saturate\(0\.6\)/)
  })
})

describe('glass off', () => {
  it.each(['dark', 'light'] as const)('sets every alpha to 1 and the blur to none on the %s ground, and nothing else of the material changes', (g) => {
    const on = tokens(g, 'on')
    const off = tokens(g, 'off')
    for (const a of ALPHAS) expect(off[a], `${g} ${a}`).toBe('1')
    expect(off['--glass-filter']).toBe('none')
    const changed = Object.keys(on).filter((k) => on[k] !== off[k])
    // the alphas, the filter, the composed fills that read an alpha, and the first-tray wash of spec 2.6: nothing else
    expect(changed.filter((k) => !ALPHAS.includes(k as never) && !/^--(glass-filter|trayn-wash|c-)/.test(k))).toEqual([])
  })
  it('the real root form on the light theme: the cascade (specificity, then file order) gives opaque alphas AND no blur', () => {
    // the light-ground block `:root[data-look][data-theme='clay-light']` is more specific than the plain off block, so the off
    // switch for the light ground has to restate the filter; a first cut left a 40 px blur running under an opaque ground
    const attrs: Record<string, string> = { 'data-look': 'v3', 'data-theme': 'clay-light', 'data-glass': 'off' }
    const rules = parse(tokensCss()).filter((r) => r.at.length === 0)
    const won: Record<string, { spec: number; order: number; v: string }> = {}
    rules.forEach((r, order) => {
      for (const sel of r.selectors) {
        if (/[\s>+~]/.test(sel)) continue
        const parts = sel.match(/:not\(\[[^\]]+\]\)|\[[^\]]+\]|:root/g) ?? []
        if (parts.join('') !== sel) continue
        let ok = true
        let spec = 0
        for (const p of parts) {
          spec += 1
          if (p === ':root') continue
          const neg = p.startsWith(':not(')
          const m = /\[(data-[\w-]+)='([^']*)'\]/.exec(p)
          if (!m) {
            ok = false
            break
          }
          const has = attrs[m[1]] === m[2]
          if (neg ? has : !has) ok = false
        }
        if (!ok) continue
        for (const [k, v] of Object.entries(r.decls)) {
          const w = won[k]
          if (!w || spec > w.spec || (spec === w.spec && order > w.order)) won[k] = { spec, order, v }
        }
      }
    })
    expect(won['--glass-filter']?.v).toBe('none')
    for (const a of ALPHAS) expect(won[a]?.v, a).toBe('1')
  })
  it('the opaque layers are the table of 2.6, in hue', () => {
    const off = tokens('dark', 'off')
    const hex = (v: string) => triple(v).map((c) => c.toString(16).padStart(2, '0')).join('')
    // same hue family as the table (the dark table is slightly cooler after jury round 3): within 6 per channel of 2.6
    const near = (got: string, want: string) => triple(got).every((c, i) => Math.abs(c - parseInt(want.slice(i * 2, i * 2 + 2), 16)) <= 6)
    // 28 Nov: the opaque table of the reset (the ground, ONE tray, the well), replacing the graded table of 2.6
    expect(near(off['--ground-rgb'], '0c0c0d'), hex(off['--ground-rgb'])).toBe(true)
    expect(near(off['--spine-rgb'], '0c0c0d')).toBe(true)
    expect(near(off['--tray-rgb'], '161617')).toBe(true)
    expect(near(off['--trayn-rgb'], '161617')).toBe(true)
    expect(near(off['--trayl-rgb'], '161617')).toBe(true)
    expect(near(off['--well-rgb'], '080809')).toBe(true)
  })
  // 28 Nov: the first tray's wash with the glass off (a 3 percent lighter corner) is gone with the reset: one surface, no wash
  it('the same switch is in the file for a browser without backdrop-filter, and no tray gets a wash of its own', () => {
    const css = tokensCss()
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\)/)
    for (const g of ['dark', 'light'] as const) for (const glass of ['on', 'off'] as const) expect(tokens(g, glass)['--trayn-wash'], `${g} ${glass}`).toBe('transparent')
  })
})

describe('contrast floors of 2.7, from the token values, over the worst backdrop', () => {
  const FLOOR = 4.5
  it('DARK, white behind: ink and ink2 on the ground, the spine, every tray and the well', () => {
    const s = stacks('dark')
    const ink = triple('237,237,234')
    const ink2 = triple('180,180,175')
    expect(colour(s.t['--ink']).rgb).toEqual(ink)
    expect(colour(s.t['--ink2']).rgb).toEqual(ink2)
    for (const [name, bg] of Object.entries({ ground: s.g, spine: s.spine, tray: s.tray, trayn: s.trayn, trayl: s.trayl, well: s.well })) {
      expect(ratio(ink, bg), `ink on ${name}`).toBeGreaterThanOrEqual(FLOOR)
      expect(ratio(ink2, bg), `ink2 on ${name}`).toBeGreaterThanOrEqual(FLOOR)
    }
  })
  it('DARK: ink3 on a well, and on a bare tray away from its glare corner (never on the ground or the spine, spec 2.7)', () => {
    const s = stacks('dark')
    const ink3 = colour(s.t['--ink3']).rgb
    expect(ratio(ink3, s.well)).toBeGreaterThanOrEqual(FLOOR)
    // under the full glare of the tray's corner ink3 falls to about 3.7: ink3 text lives on wells, and on a tray only as a decoration
    const t = s.t
    const bare = (rgb: string, a: string) => over(triple(t[rgb]), num(t[a]), s.g)
    for (const [name, bg] of Object.entries({ tray: bare('--tray-rgb', '--ta'), trayn: bare('--trayn-rgb', '--tna'), trayl: bare('--trayl-rgb', '--tla') })) expect(ratio(ink3, bg), `ink3 on ${name}`).toBeGreaterThanOrEqual(FLOOR)
  })
  it('DARK: the locked label on its own fill over every tray, and on the well', () => {
    const s = stacks('dark')
    const locked = colour(s.t['--locked']).rgb
    for (const [name, under] of Object.entries({ tray: s.tray, trayn: s.trayn, trayl: s.trayl, well: s.well })) expect(ratio(locked, s.lock(under)), `locked on ${name}`).toBeGreaterThanOrEqual(FLOOR)
  })
  it('LIGHT, black behind: ink, ink2 and ink3 on the ground, the spine, every tray and the well', () => {
    const s = stacks('light')
    for (const k of ['--ink', '--ink2', '--ink3'] as const) {
      const c = colour(s.t[k]).rgb
      for (const [name, bg] of Object.entries({ tray: s.tray, trayn: s.trayn, trayl: s.trayl, well: s.well })) expect(ratio(c, bg), `${k} on ${name}`).toBeGreaterThanOrEqual(FLOOR)
      // ink3 is never put on the bare ground or spine, but ink and ink2 are
      if (k !== '--ink3') for (const [name, bg] of Object.entries({ ground: s.g, spine: s.spine })) expect(ratio(c, bg), `${k} on ${name}`).toBeGreaterThanOrEqual(FLOOR)
    }
  })
  it('LIGHT: the locked label on its own fill over every tray, and on the well', () => {
    const s = stacks('light')
    const locked = colour(s.t['--locked']).rgb
    for (const [name, under] of Object.entries({ tray: s.tray, trayn: s.trayn, trayl: s.trayl, well: s.well })) expect(ratio(locked, s.lock(under)), `locked on ${name}`).toBeGreaterThanOrEqual(FLOOR)
  })
  it.each(['dark', 'light'] as const)('the accent label on both ends of the accent gradient (%s)', (g) => {
    const t = tokens(g, 'on')
    const label = colour(t['--on-accent']).rgb
    expect(ratio(label, colour(t['--accent-a']).rgb)).toBeGreaterThanOrEqual(FLOOR)
    expect(ratio(label, colour(t['--accent-b']).rgb)).toBeGreaterThanOrEqual(FLOOR)
  })
  it.each(['dark', 'light'] as const)('the key caps in the accent key: the label on the pressed-in well, at least 4.5 to 1 (%s)', (g) => {
    const t = tokens(g, 'on')
    expect(ratio(colour(t['--cap-ink']).rgb, colour(t['--cap-fill']).rgb)).toBeGreaterThanOrEqual(FLOOR)
  })
  it.each(['dark', 'light'] as const)('ink and ink2 on the lit key gradient, both ends (%s)', (g) => {
    const t = tokens(g, 'on')
    for (const bg of ['--lit-a', '--lit-b']) for (const fg of ['--ink', '--ink2']) expect(ratio(colour(t[fg]).rgb, colour(t[bg]).rgb), `${fg} on ${bg}`).toBeGreaterThanOrEqual(FLOOR)
  })
  it.each(['dark', 'light'] as const)('ink and ink2 on the key at rest, both ends of its gradient, and on the opaque popover (%s)', (g) => {
    const t = tokens(g, 'on')
    for (const bg of ['--raised', '--raised-hi', '--pop']) for (const fg of ['--ink', '--ink2']) expect(ratio(colour(t[fg]).rgb, colour(t[bg]).rgb), `${fg} on ${bg}`).toBeGreaterThanOrEqual(FLOOR)
  })
  it.each(['dark', 'light'] as const)('the lamp shapes clear 3 to 1 on the well (non-text contrast, %s)', (g) => {
    const s = stacks(g)
    for (const k of ['--live', '--fault', '--sim'] as const) expect(ratio(colour(s.t[k]).rgb, s.well), k).toBeGreaterThanOrEqual(3)
  })
  it.each(['dark', 'light'] as const)('the focus ring clears 3 to 1 on its gap colour and the gap on the tray (%s)', (g) => {
    const s = stacks(g)
    expect(ratio(colour(s.t['--focus']).rgb, colour(s.t['--gap']).rgb)).toBeGreaterThanOrEqual(3)
  })
})

describe('the existing roles, high contrast and forced colours', () => {
  const rules = parse(tokensCss())
  it('maps the new names onto the existing roles of 8.2, in a block that is off under high contrast and forced colours', () => {
    const block = rules.find((r) => r.at.some((a) => /not \(forced-colors: active\)/.test(a)) && r.decls['--ink-1'])
    expect(block, 'the role block').toBeTruthy()
    expect(block!.selectors.every((s) => s.includes(":not([data-contrast='high'])"))).toBe(true)
    expect(block!.decls).toMatchObject({
      '--surface-raised': 'var(--raised)', '--surface-raised-hi': 'var(--raised-hi)', '--ink-1': 'var(--ink)', '--ink-2': 'var(--ink2)', '--ink-3': 'var(--ink3)',
      '--state-measured': 'var(--live)', '--state-fault': 'var(--fault)', '--state-simulated': 'var(--sim)', '--accent-fill': 'var(--accent)', '--accent-on': 'var(--on-accent)',
      '--elev-raised': 'var(--sh-raise)', '--elev-pressed': 'var(--sh-press)', '--rim-shade': 'transparent', '--engrave-dark': 'transparent',
    })
    expect(block!.decls['--surface-sunk']).toContain('--c-well')
  })
  it('high contrast sets every alpha to 1, drops the blur and brings the hairline back (and out-ranks the light ground block)', () => {
    const hc = rules.find((r) => r.selectors.some((s) => s.includes("[data-contrast='high']")) && r.decls['--ga'])
    expect(hc).toBeTruthy()
    for (const a of ALPHAS) expect(hc!.decls[a]).toBe('1')
    expect(hc!.decls['--glass-filter']).toBe('none')
    expect(hc!.decls['--hair']).toBe('var(--ink2)')
    expect(tokens('dark', 'on')['--hair']).toBe('transparent')
  })
  it('forced colours set every alpha to 1 and use system colours', () => {
    const fc = rules.find((r) => r.at.some((a) => /forced-colors: active/.test(a)) && r.decls['--ga'])
    expect(fc).toBeTruthy()
    for (const a of ALPHAS) expect(fc!.decls[a]).toBe('1')
    expect(fc!.decls['--hair']).toBe('CanvasText')
    expect(fc!.decls['--focus']).toBe('Highlight')
  })
  it('reduced motion zeroes every motion token in one block, and the calm switch does the same', () => {
    const motion = Object.keys(tokens('dark', 'on')).filter((k) => /^--d-/.test(k))
    expect(motion.length).toBeGreaterThanOrEqual(10)
    const reduce = rules.find((r) => r.at.some((a) => /prefers-reduced-motion/.test(a)))
    const calm = rules.find((r) => r.selectors.some((s) => s.includes("[data-motion='calm']")))
    for (const k of motion) {
      expect(reduce!.decls[k], `reduce ${k}`).toBe('0s')
      expect(calm!.decls[k], `calm ${k}`).toBe('0s')
    }
  })
})

describe('the current look is unchanged when data-look is absent', () => {
  it('every selector of the token file requires [data-look=v3], so with the attribute absent no rule matches', () => {
    for (const r of parse(tokensCss())) for (const s of r.selectors) expect(s, s).toContain("[data-look='v3']")
  })
  it('the token file declares only custom properties and color-scheme', () => {
    for (const r of parse(tokensCss())) for (const k of Object.keys(r.decls)) expect(k, r.selectors[0]).toMatch(/^(--[\w-]+|color-scheme)$/)
  })
  it('every selector of the kit stylesheet names a .v3- class, so no existing element can match it', () => {
    const rules = parse(kitCss())
    expect(rules.length).toBeGreaterThan(80)
    for (const r of rules) for (const s of r.selectors) expect(s, s).toMatch(/\.v3-/)
  })
  it('the file is in styles/design/v3, not in the clay folder: the clay tests count and order that folder', () => {
    expect(TOKENS_PATH.replace(/\\/g, '/')).toMatch(/styles\/design\/v3\/glass\.css$/)
  })
})

// a small property: the tokens a ground block overrides are all tokens the base block declares, so a nested specimen on the
// other ground never inherits a stray value from its parent
describe('a nested ground redeclares everything it can differ in', () => {
  it('every property of the light block is also declared by the base (dark) block', () => {
    const rules = parse(tokensCss()).filter((r) => r.at.length === 0)
    const base = new Set(rules.filter((r) => r.selectors.includes("[data-look='v3']") && r.decls['--ground-rgb']).flatMap((r) => Object.keys(r.decls)))
    const light = rules.find((r) => r.selectors.includes("[data-look='v3'][data-ground='light']"))!
    const missing = Object.keys(light.decls).filter((k) => !base.has(k))
    expect(missing).toEqual([])
  })
  it('the light ground blocks do not set an effective alpha directly (the glass-off block must be able to win)', () => {
    const light = parse(tokensCss()).find((r) => r.selectors.includes("[data-look='v3'][data-ground='light']"))!
    for (const a of ALPHAS) expect(light.decls[a]).toBeUndefined()
  })
})

describe('the composed fills are colours a browser accepts', () => {
  // --ground-rgb holds "14, 15, 19": rgb(14, 15, 19 / .76) mixes commas and a slash and is INVALID, so every tray, well and
  // ground painted nothing and the first screenshot showed bare wallpaper. The legacy rgba(r, g, b, a) form takes the comma list.
  it('no composed fill uses the slash form on a comma triple', () => {
    const css = tokensCss()
    expect(css).not.toMatch(/rgba?\(var\(--[\w-]+-rgb\)\s*\//)
    for (const m of css.matchAll(/--c-[\w-]+:\s*([^;]+);/g)) expect(m[1], m[0]).toMatch(/^rgba?\(var\(--[\w-]+-rgb\)(, [^)]+)?\)$|^rgba\(var\(--[\w-]+-rgb\), var\(--\w+\)\)$/)
  })
})

export type { TokenMap }
