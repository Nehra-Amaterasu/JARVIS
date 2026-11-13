// Shared sample data for the entries. Everything here is a FIXTURE: the gallery draws components, it never reads the app's
// state, and nothing on it is a measurement. Samples that carry a number are drawn with their lamp (SIMULATED or LIVE of a
// fixed clock), never as a reading of the house.
import type { ReactNode } from 'react'
import { LAMP_STATES, type LampReading, type LampState } from '../shared/lamp'

/** A fixed clock so a screenshot is the same on every run (Fri 13 Nov 2026, noon UTC). */
export const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)
export const noop = () => {}

export const read = (state: LampState, reason = ''): LampReading => ({ state, since: state === 'waiting' ? null : NOW - 42_000, reason })
export const STATE_REASON: Record<LampState, string> = {
  live: '',
  waiting: 'no report',
  simulated: 'generated sample',
  planned: 'not built',
  fault: 'relay did not answer',
}

/** One cell per lamp state, in the order of LAMP_STATES; the cell carries the attribute the bench reads. */
export function States({ children }: { children: (s: LampState) => ReactNode }) {
  return (
    <>
      {LAMP_STATES.map((s) => (
        <span key={s} className="bn-cell" data-state-cell={s}>
          {children(s)}
        </span>
      ))}
    </>
  )
}

/** The `?open=` switch of the bench page; in the app there is no such parameter and it is ''. */
export function openParam(): string {
  try {
    return new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('open') ?? ''
  } catch {
    return ''
  }
}
