// Sigil, SigilFrame, GlyphRule and Seal: the sigil grammar as components (spec 20.4.1). A sigil never replaces a
// lamp (the lamp, shape plus word, always sits beside it): every drawing here is aria-hidden unless the caller
// names what it stands for, and none of them carries a number.
import type { CSSProperties, ReactNode } from 'react'
import { LAMP_SPECS, LampGlyph } from '../../lamp'
import { sealModel, sigilModel, type SigilFold, type SigilModel, type SigilSize } from './generate'
import '../grammar.css'

const REACT_ATTR: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'vector-effect': 'vectorEffect',
  pathLength: 'pathLength',
  fill: 'fill',
  stroke: 'stroke',
}

/** The model as React elements, attribute for attribute the same as modelToSvg (a parity test checks it). */
function SigilSvg({ m }: { m: SigilModel }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width={m.size} height={m.size} fill="none" stroke="currentColor"
      strokeLinecap="butt" strokeLinejoin="miter" aria-hidden="true" focusable="false" data-seed={m.seed} data-fold={m.fold}
    >
      {m.paths.map((p) => {
        const attrs: Record<string, string> = {}
        for (const [k, v] of p.attrs) attrs[REACT_ATTR[k] ?? k] = v
        return <path key={p.cls} className={p.cls} {...attrs} d={p.d} />
      })}
    </svg>
  )
}

const FOLDS: readonly number[] = [2, 4, 6, 8]

export interface SigilProps {
  seed: string
  size?: SigilSize
  /** 2, 4, 6 or 8; anything else is ignored and the seed picks the fold. */
  fold?: number
  tone?: 'ink' | 'accent'
  /** The one-shot draw-in (400 ms per weight). Calm and the OS reduce flag show the finished drawing. */
  drawn?: boolean
  mode?: 'seed' | 'growth'
  /** growth only: 0 to 1, bound to a real count by the caller. */
  stage?: number
  /** When the glyph stands for something (a person, a tree node), its name; otherwise it is decoration. */
  label?: string
}

export function Sigil({ seed, size = 48, fold, tone = 'ink', drawn = false, mode, stage, label }: SigilProps) {
  const f = fold !== undefined && FOLDS.includes(fold) ? (fold as SigilFold) : undefined
  const m = sigilModel(seed, { size, fold: f, mode, stage })
  return (
    <span
      className="g-sigil" data-grammar="sigil" data-tone={tone} data-drawn={drawn ? 'true' : 'false'} data-size={size}
      style={{ ['--g-size' as string]: `${size}px` } as CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <SigilSvg m={m} />
    </span>
  )
}

type Side = 't' | 'r' | 'b' | 'l'
export interface SigilFrameProps {
  /** The sides that carry a tick ruler (default: the left, like the terminal well). Corners always get brackets. */
  sides?: Side[]
  /** Bracket arm in px (default --bracket-arm, 8 px). */
  arm?: number
  /** PLANNED: dashed brackets. The PLANNED lamp itself is the caller's: a frame never says a state alone. */
  planned?: boolean
  children?: ReactNode
  className?: string
}

export function SigilFrame({ sides = ['l'], arm, planned = false, children, className }: SigilFrameProps) {
  const style = arm ? ({ ['--g-arm' as string]: `${Math.max(4, Math.min(24, arm))}px` } as CSSProperties) : undefined
  return (
    <div className={`g-frame${className ? ` ${className}` : ''}`} data-grammar="sigil" data-planned={planned ? 'true' : 'false'} style={style}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => <span key={c} className="g-corner" data-c={c} aria-hidden="true" />)}
      {[...new Set(sides)].map((s) => <span key={s} className="g-ruler" data-side={s} aria-hidden="true" />)}
      {children}
    </div>
  )
}

export interface GlyphRuleProps {
  /** Diamonds in the chain, 3 to 7 (default 5). */
  length?: number
  /** 0 to 1: 0 is the bare chain; from 0.34 X marks cap it; from 0.67 stripe blocks and brackets join (C01-18). */
  density?: number
}

/** The divider: a diamond chain with a 1 px hairline both sides, 12 px high, full width. Deterministic, no seed. */
export function GlyphRule({ length = 5, density = 0.5 }: GlyphRuleProps) {
  const n = Math.max(3, Math.min(7, Math.round(length)))
  const dens = Math.max(0, Math.min(1, density))
  const parts: string[] = []
  const fills: string[] = []
  let x = 0
  const diamond = (cx: number) => `M${cx} 1L${cx + 4} 6L${cx} 11L${cx - 4} 6Z`
  if (dens >= 0.67) { parts.push(`M${x} 2L${x} 10M${x + 3} 2L${x + 3} 10M${x + 6} 2L${x + 6} 10`); x += 11 }
  if (dens >= 0.34) { parts.push(`M${x} 2L${x + 8} 10M${x + 8} 2L${x} 10`); x += 13 }
  for (let i = 0; i < n; i++) {
    const cx = x + 4 + i * 9
    // the middle diamond is a filled 4 px cell: the chain has a centre, as the references do
    if (i === Math.floor(n / 2)) fills.push(diamond(cx))
    else parts.push(diamond(cx))
  }
  x += n * 9 - 1
  if (dens >= 0.34) { x += 5; parts.push(`M${x} 2L${x + 8} 10M${x + 8} 2L${x} 10`); x += 8 }
  if (dens >= 0.67) { x += 5; parts.push(`M${x} 2L${x} 10M${x + 3} 2L${x + 3} 10M${x + 6} 2L${x + 6} 10`); x += 6 }
  return (
    <div className="g-rule" role="separator" data-grammar="sigil" data-density={dens}>
      <span className="g-hair" aria-hidden="true" />
      <svg viewBox={`-1 0 ${x + 2} 12`} width={x + 2} height="12" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
        <path className="sg-w2" strokeWidth="1.5" vectorEffect="non-scaling-stroke" d={parts.join('')} />
        {fills.length > 0 && <path className="sg-fill" fill="currentColor" stroke="none" d={fills.join('')} />}
      </svg>
      <span className="g-hair" aria-hidden="true" />
    </div>
  )
}

export interface SealProps {
  id: string
  earned: boolean
  /** Generated, not measured (a bench fixture): the seal carries the SIMULATED lamp glyph and word. */
  simulated?: boolean
  /** What the seal is for ("Unit 3 finished"); it leads the accessible name. */
  label?: string
}

/** A closed ring plus the bilateral seed glyph, 32 px. Earned: solid. Not yet: hollow (dashed), never hidden. */
export function Seal({ id, earned, simulated = false, label }: SealProps) {
  const m = sealModel(id, earned)
  const name = `${label ?? 'Seal'}: ${earned ? 'earned' : 'not yet earned'}${simulated ? `, ${LAMP_SPECS.simulated.label}` : ''}`
  return (
    <span className="g-seal" role="img" aria-label={name} data-grammar="sigil" data-earned={earned ? 'true' : 'false'} data-simulated={simulated ? 'true' : 'false'}>
      <SigilSvg m={m} />
      {simulated && (
        <span className="g-stamp" aria-hidden="true">
          <LampGlyph state="simulated" /> {LAMP_SPECS.simulated.label}
        </span>
      )}
    </span>
  )
}
