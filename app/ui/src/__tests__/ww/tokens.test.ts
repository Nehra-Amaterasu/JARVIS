// The contrast table of plan 5.2 and the 18 workspace combinations of 5.7.5, recomputed from the
// real token files with the WCAG relative-luminance formula (see _css.ts for how the cascade is
// applied). Nothing here is copied from the plan: if a token file changes, these numbers change.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { computeTokens, contrast, designFilesInOrder, over, parseColor, read, WW_DIR } from './_css'

const css = designFilesInOrder().map(read).join('\n')
const THEMES = ['ash', 'paper', 'indigo'] as const
const WORKSPACES = ['study', 'tree', 'life', 'career', 'focus', 'setup'] as const
const html = (theme: string): Record<string, string> => (theme === 'ash' ? {} : { 'data-theme': theme })
const root = (theme: string) => computeTokens(css, { html: html(theme) }, 'root')
const centre = (theme: string, ws: string) => computeTokens(css, { html: html(theme), ws }, 'centre')
const col = (t: Record<string, string>, name: string) => parseColor(t[name])
const surfaces = (t: Record<string, string>) => [0, 1, 2, 3].map((n) => col(t, `--surface-${n}`))
const minOver = (fg: string, t: Record<string, string>, bgs = surfaces(t)) => Math.min(...bgs.map((bg) => contrast(parseColor(fg), bg)))
const min = (t: Record<string, string>, name: string) => minOver(t[name], t)

describe('the token files resolve', () => {
  it('every semantic token of the plan is defined in every theme', () => {
    const names = ['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--ink-1', '--ink-2', '--ink-3', '--ink-off', '--ink-disabled',
      '--line', '--line-ui', '--accent', '--accent-hi', '--on-accent', '--accent-wash', '--selected-bg', '--selected-ink', '--focus-ring',
      '--live', '--sim', '--fault', '--behind', '--scrim', '--glass-bg', '--glass-edge']
    for (const th of THEMES) {
      const t = root(th)
      for (const n of names) expect(t[n], `${th} ${n}`).toBeTruthy()
    }
  })
  it('provenance colours keep their meaning: fixed in Ash and Indigo, darkened for Paper', () => {
    expect(root('ash')['--live']).toBe('#5ce1ff')
    expect(root('indigo')['--live']).toBe('#5ce1ff')
    expect(root('indigo')['--sim']).toBe('#ffb020')
    expect(root('indigo')['--fault']).toBe('#ff453a')
    expect(root('paper')['--live']).toBe('#0a6a85')
  })
})

describe.each(THEMES)('contrast table, theme %s', (theme) => {
  const t = root(theme)
  it('ink-1, ink-2 and ink-3 pass body text (4.5) on all four surfaces', () => {
    expect(min(t, '--ink-1')).toBeGreaterThanOrEqual(4.5)
    expect(min(t, '--ink-2')).toBeGreaterThanOrEqual(4.5)
    expect(min(t, '--ink-3')).toBeGreaterThanOrEqual(4.5)
  })
  it('--line-ui passes the 3:1 non-text rule (WCAG 1.4.11)', () => {
    expect(min(t, '--line-ui')).toBeGreaterThanOrEqual(3)
  })
  it('accent as text passes 4.5 on surface-0..3; --on-accent on --accent passes 4.5', () => {
    expect(min(t, '--accent')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(col(t, '--on-accent'), col(t, '--accent'))).toBeGreaterThanOrEqual(4.5)
  })
  it('provenance text colours pass 4.5; --behind passes 4.5; --focus-ring passes 3', () => {
    for (const n of ['--live', '--sim', '--fault', '--behind']) expect(min(t, n), n).toBeGreaterThanOrEqual(4.5)
    expect(min(t, '--focus-ring')).toBeGreaterThanOrEqual(3)
  })
  it('selected states: ink-1 and ink-3 on --selected-bg pass 4.5 on every surface it can sit on', () => {
    const sel = col(t, '--selected-bg')
    const worst1 = Math.min(...surfaces(t).map((s) => contrast(col(t, '--selected-ink'), over(sel, s))))
    const worst3 = Math.min(...surfaces(t).map((s) => contrast(col(t, '--ink-3'), over(sel, s))))
    expect(worst1).toBeGreaterThanOrEqual(4.5)
    expect(worst3).toBeGreaterThanOrEqual(4.5)
  })
  it('--ink-disabled passes 4.5:1 on all four surfaces and is quieter than --ink-3', () => {
    expect(min(t, '--ink-disabled')).toBeGreaterThanOrEqual(4.5)
    expect(Number(/,\s*([\d.]+)\)$/.exec(t['--ink-disabled'])![1])).toBeLessThan(Number(/,\s*([\d.]+)\)$/.exec(t['--ink-3'])![1]))
  })
  it('--ink-off is decoration only: it fails 3:1, so it can never pass as text', () => {
    expect(min(t, '--ink-off')).toBeLessThan(3)
  })
  it('--accent-hi is not claimed as text: Paper fails it, the others only use it as a ring', () => {
    if (theme === 'paper') expect(minOver(t['--accent-hi'], t)).toBeLessThan(4.5)
  })
})

describe('the measured failures are fixed', () => {
  const bg = parseColor('#050506')
  const ink = (a: number) => ({ ...parseColor('#f5f6f8'), a })
  it('--ink-3: 42 % ink was 3.77:1 on the Ash window; 56 % is above 4.5', () => {
    expect(contrast(ink(0.42), bg)).toBeCloseTo(3.77, 1)
    expect(contrast(ink(0.56), bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('--ink-4: 22 % ink was 1.79:1; the semantic tier renames it --ink-off and keeps it under 3', () => {
    expect(contrast(ink(0.22), bg)).toBeCloseTo(1.79, 1)
    expect(min(root('ash'), '--ink-off')).toBeLessThan(3)
  })
  it('white on a saffron fill was 2.60:1; --on-accent on --accent is 7.36', () => {
    expect(contrast(parseColor('#ffffff'), parseColor('#ff7a2e'))).toBeCloseTo(2.6, 1)
    const t = root('ash')
    expect(contrast(col(t, '--on-accent'), col(t, '--accent'))).toBeCloseTo(7.36, 1)
  })
  it('styles/tokens.css --ink-3 now passes 4.5 on both Core window colours', () => {
    const tokens = read(join(WW_DIR, '../styles/tokens.css'))
    const v = /--ink-3:\s*(rgba\([^)]+\))/.exec(tokens)![1]
    for (const bgHex of ['#050506', '#0a0b0d']) expect(contrast(parseColor(v), parseColor(bgHex))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the 18 theme x workspace combinations (5.7.5), recomputed on the tinted surfaces', () => {
  const combos = THEMES.flatMap((th) => WORKSPACES.map((ws) => [th, ws] as const))
  it('there are 18', () => expect(combos).toHaveLength(18))
  describe.each(combos)('%s / %s', (theme, ws) => {
    const t = centre(theme, ws)
    it('accent as text passes 4.5 on the four tinted surfaces', () => {
      expect(min(t, '--accent')).toBeGreaterThanOrEqual(4.5)
    })
    it('--on-accent on --accent passes 4.5', () => {
      expect(contrast(col(t, '--on-accent'), col(t, '--accent'))).toBeGreaterThanOrEqual(4.5)
    })
    it('--ink-3 and --ink-2 pass 4.5 on the tinted surfaces', () => {
      expect(min(t, '--ink-3')).toBeGreaterThanOrEqual(4.5)
      expect(min(t, '--ink-2')).toBeGreaterThanOrEqual(4.5)
    })
    it('the focus ring passes 3 and the kicker colour passes 4.5', () => {
      expect(min(t, '--focus-ring')).toBeGreaterThanOrEqual(3)
      expect(min(t, '--type-kicker')).toBeGreaterThanOrEqual(4.5)
    })
    it('the room declares its tempo and spring; tempo only scales enter and exit within the 400 ms ceiling', () => {
      expect(Number(t['--tempo'])).toBeGreaterThanOrEqual(0.8)
      expect(Number(t['--tempo'])).toBeLessThanOrEqual(1.25)
      expect(240 * Number(t['--tempo'])).toBeLessThanOrEqual(400)
      expect(t['--spring-main']).toMatch(/^linear\(/)
    })
  })
  it('the tint never erases the step between two surfaces: adjacent tinted surfaces still differ in luminance', () => {
    for (const [theme, ws] of combos) {
      const s = surfaces(centre(theme, ws))
      for (let i = 1; i < s.length; i++) expect(contrast(s[i], s[i - 1]), `${theme}/${ws} ${i}`).toBeGreaterThan(1.02)
    }
  })
  it('Focus and Study declare no tint', () => {
    expect(centre('ash', 'focus')['--tint']).toBe('0%')
    expect(centre('ash', 'study')['--tint']).toBe('0%')
    expect(centre('ash', 'tree')['--tint']).toBe('4%')
  })
  it('a workspace never changes the provenance colours', () => {
    for (const [theme, ws] of combos) {
      const r = root(theme)
      const c = centre(theme, ws)
      for (const n of ['--live', '--sim', '--fault', '--behind']) expect(c[n]).toBe(r[n])
    }
  })
})

describe('files', () => {
  it('the shared tier-1 file, the three themes and the workspace layer are imported by base.css in order', () => {
    const order = designFilesInOrder().map((p) => p.split(String.fromCharCode(92)).join('/'))
    expect(order[0].endsWith('/src/styles/design/primitive.css')).toBe(true)
    for (const tail of ['/themes/ash.css', '/themes/paper.css', '/themes/indigo.css', '/themes/workspace.css', '/component.css', '/motion.css']) {
      expect(order.some((p) => p.endsWith(tail)), tail).toBe(true)
    }
  })
})
