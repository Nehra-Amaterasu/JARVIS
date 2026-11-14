// SigilMark (spec 20.5.2): a data sigil, one arm per topic. It is a node face and a callout thumbnail, so it is small, has
// no number on it, and carries a text twin (a visually hidden table) because a radial figure cannot be read by ear. The
// drawing is the engine's own model rendered as React elements (the same elements `Sigil` draws), inside the engine's
// `.g-sigil` wrapper so the grammar stylesheet gives it its strokes, its forced-colours form and its calm form.
import { type CSSProperties } from 'react'
import { ArtTable } from '../../art'
import { LAMP_SPECS, showsNumber, type LampState } from '../../lamp'
import {
  RECENT_WORD, armsDrawn, evidenceWord, sigilMarkHollowModel, sigilMarkModel, MAX_ARMS, type SigilArm,
} from './markModel'
import type { SigilModel } from '../../grammar'
import '../../grammar/grammar.css'
import './specimen.css'

const REACT_ATTR: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'vector-effect': 'vectorEffect',
  pathLength: 'pathLength',
  fill: 'fill',
  stroke: 'stroke',
}

function Drawing({ m }: { m: SigilModel }) {
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

export interface SigilMarkProps {
  arms: SigilArm[]
  /** CSS size in px of the whole figure (default 96; 160 on a specimen). */
  size?: number
  /**
   * The lamp state of the evidence. Arm lengths are drawn for LIVE and SIMULATED only; WAITING, PLANNED and FAULT draw the
   * hollow form (a hub and six dashed stubs) and say why. Default 'live', because the caller hands over measured arms.
   */
  state?: LampState
  reason?: string
  /** What the figure stands for ("Physics, six topics"); it leads the accessible name. */
  label?: string
}

export function SigilMark({ arms, size = 96, state = 'live', reason, label = 'Topic sigil' }: SigilMarkProps) {
  const reading = showsNumber(state) && arms.length > 0
  const drawn = reading ? armsDrawn(arms) : []
  const m = reading ? sigilMarkModel(drawn, size) : sigilMarkHollowModel(size)
  const why = reason ?? (state === 'simulated' ? 'generated, not measured' : arms.length === 0 && showsNumber(state) ? 'no topics yet' : LAMP_SPECS[state].means)
  const name = reading
    ? `${label}: ${drawn.length} topics${arms.length > MAX_ARMS ? ` of ${arms.length}, showing the first ${MAX_ARMS}` : ''}, ${LAMP_SPECS[state].label}`
    : `${label}: no evidence drawn, ${LAMP_SPECS[state].label}, ${why}`
  return (
    <figure className="sp-sigil" data-component="sigil-mark" data-state={reading ? state : arms.length === 0 && state === 'live' ? 'hollow' : state} data-hollow={reading ? undefined : 'true'}>
      <span className="g-sigil" data-grammar="sigil" data-tone="ink" data-size={size} role="img" aria-label={name} style={{ ['--g-size' as string]: `${size}px` } as CSSProperties}>
        <Drawing m={m} />
      </span>
      <ArtTable
        caption={`${label} (arms)`}
        head={['Topic', 'Evidence', 'Practice']}
        rows={reading ? drawn.map((a) => [a.id, evidenceWord(a.length), RECENT_WORD[a.recent]]) : [['No arms drawn', why, LAMP_SPECS[state].label]]}
      />
    </figure>
  )
}
