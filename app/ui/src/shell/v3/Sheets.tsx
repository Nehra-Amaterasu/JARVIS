/**
 * The phone's two pills and their sheets (design-language-v3.md 3.6). Under the accent key of the first tray two pills carry
 * the names of the second and third tray; each opens that tray as an opaque bottom sheet over a scrim with a Done key, so the
 * order of operations survives on the phone and nothing hides behind a scroll. Jury round 3: a pill is led by a state, not by a
 * count of empty slots ("Ahead · WAITING, 3 rows, none dated", not "Ahead · 3" over an empty day).
 *
 * Zones owns the open sheet; PhonePeeks only draws the pills. A view places <PhonePeeks /> where the order wants it (after the
 * accent action). When it does not, Zones draws the pills under the first tray.
 */
import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'
import { LAMP_SPECS } from '../../shared/lamp/types'
import type { TraySpec } from './contract'
import { StateGlyph } from './Glyphs'

export interface PeekApi {
  second: TraySpec
  third: TraySpec
  open: 2 | 3 | null
  setOpen: (n: 2 | 3 | null) => void
  claim: (on: boolean) => void
}

export const PeekCtx = createContext<PeekApi | null>(null)

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase()

function Pill({ n, spec, api }: { n: 2 | 3; spec: TraySpec; api: PeekApi }) {
  const lamp = spec.peek?.lamp
  const name = spec.peek?.name ?? titleCase(spec.job)
  return (
    <button type="button" className="s3-pill" data-peek={n} aria-haspopup="dialog" aria-expanded={api.open === n}
      onClick={() => api.setOpen(api.open === n ? null : n)}>
      <span className="s3-pill-name">
        {lamp && <span className="s3-pill-lamp" data-state={lamp}><StateGlyph state={lamp} size={14} /></span>}
        {name}
        {lamp && <span className="s3-pill-word">{LAMP_SPECS[lamp].label}</span>}
      </span>
      {spec.peek?.note && <span className="s3-pill-note">{spec.peek.note}</span>}
    </button>
  )
}

export function PhonePeeks({ className, fallback }: { className?: string; fallback?: boolean }): ReactNode {
  const api = useContext(PeekCtx)
  const claim = api?.claim // stable per Zones, so the claim is made once, not on every render
  useLayoutEffect(() => {
    if (fallback) return // the fallback row must not claim, or it would remove itself and come back
    claim?.(true)
    return () => claim?.(false)
  }, [claim, fallback])
  if (!api) return null
  return (
    <div className={`s3-peeks${className ? ` ${className}` : ''}`} role="group" aria-label="More of this view">
      <Pill n={2} spec={api.second} api={api} />
      <Pill n={3} spec={api.third} api={api} />
    </div>
  )
}
