// RackRow (spec 20.5.2): one 44 px unit of a hardware rack. A chamfered plate with the serial and the device name, a rocker,
// a "confirmed" lamp that lights only after the board has reported, the last-seen time in mono, and a three-glyph ASCII
// pulse that appears only while a report is under a minute old.
//
// The honesty rule is in rack.ts and tested there: `state="confirmed"` with no `reportedAt` draws as unconfirmed, because
// the owner pressing a switch is a command, not a fact. The rocker shows what was commanded (`on`); the lamp shows what the
// board said. They are separate on purpose, so a row can say "on, sent, not acknowledged" and mean it.
import type { ReactNode } from 'react'
import { Rocker } from '../../kit'
import { LampGlyph, PlannedGlyph } from '../../lamp'
import {
  PULSE, RACK_LAMP, RACK_WORD, effectiveRackState, lastSeenText, showsPulse, type RackState,
} from './rack'
import './specimen.css'

export interface RackRowProps {
  device: string
  serial?: string
  state: RackState
  /** Epoch ms of the board's last report. Without it `confirmed` is not drawn (the row falls back to unconfirmed). */
  reportedAt?: number | null
  /** A ready-made last-seen text ("14:03"); by default it is the age of `reportedAt`. */
  lastSeen?: string
  /** What the rocker shows: the commanded state, not the confirmed one. */
  on?: boolean
  /** The rocker was used; the caller sends the command and flips `state` to unconfirmed until the board answers. */
  onToggle?: () => void
  /** FAULT only: the reason, drawn beside the triangle. */
  reason?: string
  /** A fixed clock for the age and the pulse (tests, the gallery). */
  now?: number
}

export function RackRow({ device, serial, state, reportedAt, lastSeen, on = false, onToggle, reason, now }: RackRowProps) {
  const t = now ?? Date.now()
  const eff = effectiveRackState(state, reportedAt)
  const planned = eff === 'planned'
  const word = eff === 'fault' ? `fault: ${reason?.trim() || 'no reason given'}` : RACK_WORD[eff]
  const seen = lastSeenText(lastSeen, reportedAt, t)
  const pulse = showsPulse(eff, reportedAt, t)
  const name = `${device}${serial ? `, serial ${serial}` : ''}: ${on ? 'commanded on' : 'commanded off'}, ${word}${eff === 'planned' ? '' : `, last seen ${seen}`}`
  return (
    <div className="sp-rack-row" role="group" aria-label={name} data-component="rack-row" data-state={eff} data-requested={state !== eff ? state : undefined}>
      <span className="sp-rack-plate">
        {serial && <span className="sp-rack-serial">{serial}</span>}
        <span className="sp-rack-device">{device}</span>
      </span>
      <span className="sp-rack-rocker">
        <Rocker
          on={on}
          onChange={() => onToggle?.()}
          label={`${device} command`}
          planned={planned}
          onPlanned={() => undefined}
        />
      </span>
      <span className="sp-rack-lamp" data-state={eff}>
        {planned ? <PlannedGlyph width={14} height={14} /> : <LampGlyph state={RACK_LAMP[eff]} size={14} />}
        <span className="sp-rack-word">{word}</span>
      </span>
      <span className="sp-rack-seen">{eff === 'planned' ? '—' : seen}</span>
      <span className="sp-rack-pulse" aria-hidden="true" data-on={pulse ? 'true' : undefined}>{pulse ? PULSE : ''}</span>
    </div>
  )
}

export interface RackProps {
  /** The header tile: a mono title such as "RELAY BOARD". */
  title: string
  /** The count line under it, e.g. "6 units"; the caller counts, since the rack does not know the states. */
  note?: string
  children: ReactNode
}

/** The rack the rows stand in: a dot-matrix header tile (C02-33 family) and a list of units. */
export function Rack({ title, note, children }: RackProps) {
  return (
    <section className="sp-rack" data-component="rack" aria-label={title}>
      <header className="sp-rack-head">
        <span className="sp-rack-title" aria-hidden="true">{title}</span>
        <span className="sp-rack-note">{note}</span>
      </header>
      <div className="sp-rack-units" role="group" aria-label={`${title} units`}>{children}</div>
    </section>
  )
}
