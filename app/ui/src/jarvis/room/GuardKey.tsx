// GuardKey (A.J02, spec 20.9.2): one channel of the wall box, a kit Key with a hinged cover over it for the channels the
// owner flagged as heavy loads. Two acts to turn a flagged channel ON: lift the cover (click it or Space), then press the key
// within 5 s or the cover closes. Turning OFF is always one press with no cover, and a light or fan nobody flagged stays one
// press. The cap is aria-disabled while the cover is down, so a press that skipped the first act does nothing.
//
// The three-phase LED is the lamp contract of the board: asked (WAITING, half disc, the 6 s sweep), confirmed (LIVE, only
// after the board reported), not confirmed (FAULT "asked, no report"). A channel that is not on the board is dashed and says
// "unavailable". `state` is the board's phase; 'open' is the cover's own, drawn when the cover is lifted.
import { Fan, Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Key, LampGlyph, type LampState } from '../../shared/kit'
import { COVER_MS, needsTwoActs } from './model'
import './room.css'

export type GuardState = 'closed' | 'open' | 'asked' | 'confirmed' | 'unconfirmed'

export interface GuardKeyProps {
  /** The owner flagged this channel as a heavy load (a mains load). */
  heavy: boolean
  /** The line under the cover: what the press will do ("turns ON: heater, mains"). */
  summary: string
  state: GuardState
  onPress: () => void
  /** The channel, as the faceplate engraves it. */
  slot: number
  name: string
  kind: 'light' | 'fan' | null
  /** The cap shows pressed when the board reports ON (the saved state never draws it). */
  on: boolean
  lamp: LampState
  word: string
  /** The channel is not on the board: dashed, "unavailable", no press. */
  absent?: boolean
  /** The dial is previewing a mode: the target this key would take, drawn as a dashed outline. Never a lamp. */
  preview?: boolean | null
  /** The cover's own timer, in ms (tests shorten it). */
  coverMs?: number
}

const NUM = (n: number) => String(n).padStart(2, '0')

export function GuardKey({ heavy, summary, state, onPress, slot, name, kind, on, lamp, word, absent, preview = null, coverMs = COVER_MS }: GuardKeyProps) {
  const [lifted, setLifted] = useState(false)
  const cap = useRef<HTMLButtonElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guarded = !absent && needsTwoActs(heavy, !on)

  const close = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setLifted(false)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // The cover only matters while the key would turn ON: if the board turns it on by other means the cover goes away.
  useEffect(() => { if (!guarded && lifted) close() }, [guarded, lifted])

  const lift = () => {
    if (!guarded) return
    setLifted(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(close, coverMs)
    // Space lifts, Enter presses: the focus moves to the cap so the second act is one key away
    requestAnimationFrame(() => cap.current?.focus({ preventScroll: true }))
  }
  const press = () => {
    if (absent) return
    if (guarded && !lifted) return
    close()
    onPress()
  }

  const shown: GuardState = guarded && lifted ? 'open' : state
  const Icon: ReactNode = kind === 'fan'
    ? <Fan size={26} strokeWidth={1.5} aria-hidden="true" fill={on ? 'currentColor' : 'none'} fillOpacity={0.22} />
    : <Lightbulb size={26} strokeWidth={1.5} aria-hidden="true" fill={on ? 'currentColor' : 'none'} fillOpacity={0.3} />
  const said = absent
    ? `Channel ${slot}, ${name}: unavailable, not on the board`
    : `${name}, channel ${slot}: ${word}${heavy ? ', heavy load' : ''}${guarded ? (lifted ? `. Cover lifted, ${summary}. Press within ${Math.round(coverMs / 1000)} seconds` : '. Cover down, lift it first') : ''}`

  return (
    <div className="jr-cell" data-slot={slot} data-state={shown} data-heavy={heavy ? 'true' : undefined} data-absent={absent ? 'true' : undefined} data-on={on ? 'true' : undefined}
      data-preview={preview === null ? undefined : preview ? 'on' : 'off'}>
      <Key
        className="jr-cap"
        label={said}
        pressed={absent ? undefined : on}
        onPress={press}
        disabledReason={absent ? 'unavailable' : guarded && !lifted ? 'lift the cover first' : undefined}
        icon={(
          <span className="jr-face">
            <span className="jr-top"><i className="jr-no">{NUM(slot)}</i><b className="jr-name">{name}</b></span>
            <span className="jr-mid">
              <span className="jr-ico" data-kind={kind ?? 'none'}>{absent ? null : Icon}</span>
              {preview !== null && <span className="jr-prev" aria-hidden="true">{preview ? 'to ON' : 'to OFF'}</span>}
            </span>
            <span className="jr-lamp" data-phase={shown}>
              <span className="jr-led"><LampGlyph state={lamp} size={12} /></span>
              <span className="jr-word">{lifted && guarded ? summary : word}</span>
            </span>
          </span>
        )}
      />
      {/* the cap's own ref: the kit Key renders the button, so the cell finds it */}
      <CapRef cell={cap} />
      {heavy && !absent && (
        <button
          type="button"
          className="jr-cover"
          data-open={lifted && guarded ? 'true' : 'false'}
          data-needed={guarded ? 'true' : 'false'}
          aria-expanded={guarded ? lifted : undefined}
          aria-label={guarded ? `Cover: ${name} is a heavy load, ${summary}. ${lifted ? 'Lifted' : 'Lift it with Space'}` : `${name} is a heavy load; turning it OFF is one press`}
          tabIndex={guarded ? 0 : -1}
          aria-disabled={guarded ? undefined : true}
          onClick={() => (lifted ? close() : lift())}
          onKeyDown={(e) => { if (e.key === 'Escape') close() }}
        >
          <span aria-hidden="true">{guarded ? (lifted ? 'COVER UP, press the key' : 'HEAVY LOAD, lift cover') : 'HEAVY LOAD'}</span>
        </button>
      )}
    </div>
  )
}

/** Finds the kit Key's button inside this cell once it is drawn, so the lift can hand it the focus. */
function CapRef({ cell }: { cell: { current: HTMLButtonElement | null } }) {
  const me = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    cell.current = me.current?.parentElement?.querySelector<HTMLButtonElement>('button.jr-cap') ?? null
  })
  return <span ref={me} hidden />
}
