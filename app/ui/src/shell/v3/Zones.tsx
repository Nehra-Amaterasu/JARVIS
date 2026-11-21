/**
 * The three-tray frame every section view builds on (design-language-v3.md 4.1): `<Zones first second third ratio />`.
 * Left to right: the first act and its object (widest, most lifted), what follows from it, reference (the glassiest, smallest,
 * furthest). Reading order and importance are the same on the desktop and on the phone, where the second and third tray
 * become sheets behind two pills (Sheets.tsx). The grid rises in order (0, 70, 140 ms) each time the place changes: the shell
 * keys the stage on the place, so a new place mounts a new Zones.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ratioOf, type TraySpec, type ZoneRatio } from './contract'
import { PeekCtx, PhonePeeks, type PeekApi } from './Sheets'
import { Tray } from './Tray'
import './shell-v3.css'

export interface ZonesProps {
  first: TraySpec
  second: TraySpec
  third: TraySpec
  /** `default` 1.85 : 1.05 : .95, `core` 1.85 : 1.05 : .8, `console` 1.6 : 1.15 : 1, or three numbers of your own. */
  ratio?: ZoneRatio
  className?: string
}

export function Zones({ first, second, third, ratio, className }: ZonesProps) {
  const [open, setOpen] = useState<2 | 3 | null>(null)
  const [claimed, setClaimed] = useState(false)
  const [a, b, c] = ratioOf(ratio)
  const claim = useCallback((on: boolean) => setClaimed(on), [])
  const opener = useRef<HTMLElement | null>(null)

  // a sheet returns focus to the pill that opened it, and Esc closes it
  const set = useCallback((n: 2 | 3 | null) => {
    if (n) opener.current = document.activeElement as HTMLElement | null
    setOpen(n)
  }, [])
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open && wasOpen.current) opener.current?.focus()
    wasOpen.current = !!open
  }, [open])

  const api = useMemo<PeekApi>(() => ({ second, third, open, setOpen: set, claim }), [second, third, open, set, claim])
  const style = { gridTemplateColumns: `${a}fr ${b}fr ${c}fr` } as CSSProperties
  return (
    <PeekCtx.Provider value={api}>
      <div className={`s3-zones${className ? ` ${className}` : ''}`} style={style} data-sheet={open ? open : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            set(null)
            return
          }
          // an open sheet is modal: Tab and Shift+Tab wrap inside it instead of walking into the spine, plate and dock behind the scrim
          if (e.key === 'Tab' && open) {
            const tray = e.currentTarget.querySelector<HTMLElement>(`.s3-tray[data-step='${open}']`)
            const keys = tray ? [...tray.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])')] : []
            if (!keys.length) return
            const first = keys[0]
            const last = keys[keys.length - 1]
            const at = document.activeElement
            if (e.shiftKey && (at === first || !tray?.contains(at))) {
              e.preventDefault()
              last.focus()
            } else if (!e.shiftKey && (at === last || !tray?.contains(at))) {
              e.preventDefault()
              first.focus()
            }
          }
        }}>
        <Tray step={1} {...first} />
        {!claimed && <PhonePeeksFallback />}
        <Tray step={2} {...second} sheet={open === 2} onDone={() => set(null)} />
        <Tray step={3} {...third} sheet={open === 3} onDone={() => set(null)} />
        <div className="s3-scrim" aria-hidden="true" onClick={() => set(null)} />
      </div>
    </PeekCtx.Provider>
  )
}

/** When the view placed no <PhonePeeks />, the pills sit under the first tray (phone only; the desktop draws no pills). */
function PhonePeeksFallback() {
  return <div className="s3-peeks-fallback"><PhonePeeks fallback /></div>
}
