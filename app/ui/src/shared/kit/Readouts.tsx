// Readings (spec 7.2 components 6 and 7, 7.3 components 14, 18 and 19). The rule of 6.6: no number without a
// state. `state` is a required prop in TypeScript, and the value is drawn only for LIVE and SIMULATED; WAITING,
// PLANNED and FAULT print "--" and the reason, never a stale or invented figure. SIMULATED stamps a diamond and
// the word; a LIVE value older than `staleAfterS` seconds adds "last seen".
import { useId, type ReactNode } from 'react'
import { Lamp, LampGlyph, lampText, showsValue, type LampState } from './Lamp'
import { cx } from './util'

export const NO_VALUE = '--'

/** What to print for a reading: the value for LIVE and SIMULATED, "--" otherwise. One place, so no widget can leak a number. */
export function readingText(state: LampState, value: string | number | null | undefined): string {
  return showsValue(state) && value !== null && value !== undefined && value !== '' ? String(value) : NO_VALUE
}

interface Reading {
  state: LampState
  /** Why the state is what it is ("no report", "built, not verified", "relay did not answer"). */
  reason?: string
  /** Seconds since the source last reported; shown as "last seen" for a stale LIVE value. */
  ageS?: number
}

const STALE_AFTER_S = 30

const staleText = (r: Reading) => (r.state === 'live' && r.ageS !== undefined && r.ageS > STALE_AFTER_S ? `last seen ${Math.round(r.ageS)} s ago` : null)

// ---------------------------------------------------------------------------------------------- Readout

export interface ReadoutProps extends Reading {
  label: string
  value?: string | number | null
  unit?: string
  className?: string
}

/** Component 6, the Recessed Readout (LCD well): a group named by its label, the value in an <output>, the lamp in the corner. */
export function Readout({ label, value, unit, state, reason, ageS, className }: ReadoutProps) {
  const id = useId()
  const stale = staleText({ state, ageS })
  const shown = readingText(state, value)
  return (
    <div className={cx('k-readout', className)} role="group" aria-labelledby={id} data-state={state} data-stale={stale ? 'true' : undefined}>
      <span id={id} className="k-readout-label">
        {label}
      </span>
      <span className="k-readout-lamp">
        <Lamp state={state} reason={reason} bare />
      </span>
      <output className="k-readout-value">
        {shown}
        {shown !== NO_VALUE && unit && <small className="k-unit"> {unit}</small>}
      </output>
      {state === 'simulated' && <span className="k-stamp">SIMULATED</span>}
      {state !== 'live' && state !== 'simulated' && <span className="k-readout-why">{lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined))}</span>}
      {stale && <span className="k-readout-why">{stale}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Numerals

export interface NumeralsProps extends Reading {
  label: string
  value?: string | number | null
  size?: 56 | 72
  className?: string
}

/**
 * Component 7, the Segmented Display: Doto numerals in a sunk well. Read-only, one per view. The colon is a plain
 * static glyph (no blink, so there is no infinite animation). A value not yet reported shows "--".
 */
export function Numerals({ label, value, state, reason, ageS, size = 56, className }: NumeralsProps) {
  const shown = readingText(state, value)
  const stale = staleText({ state, ageS })
  return (
    <div className={cx('k-numerals', className)} data-size={size} data-state={state} role="group" aria-label={label}>
      <output className="k-numerals-value k-doto">{shown}</output>
      {state === 'simulated' && <span className="k-stamp">SIMULATED</span>}
      {shown === NO_VALUE && <span className="k-readout-why">{lampText(state, reason ?? (state === 'waiting' ? 'no report' : undefined))}</span>}
      {stale && <span className="k-readout-why">{stale}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- ReadoutLines

export interface ReadoutLine {
  key: string
  value: string | number | null | undefined
  state: LampState
  reason?: string
}

/**
 * Component 14, the Scanline Readout, drawn flat: a recessed mono block of key-value lines. No scanlines, no glow,
 * no flicker (spec 10.5). An update replaces the line in place. `announce` makes it a status region; leave it off
 * unless the change is meaningful (live-region spam).
 */
export function ReadoutLines({ lines, announce, label }: { lines: ReadoutLine[]; announce?: boolean; label?: string }) {
  return (
    <div className="k-lines" role={announce ? 'status' : undefined} aria-label={label}>
      {lines.map((l) => (
        <div key={l.key} className="k-line-row" data-state={l.state}>
          <span className="k-line-key">{l.key}</span>
          <span className="k-line-value">{readingText(l.state, l.value)}</span>
          {l.state === 'simulated' && <LampGlyph state="simulated" size={12} />}
          {l.state === 'fault' && <LampGlyph state="fault" size={12} />}
          {!showsValue(l.state) && <span className="k-readout-why">{lampText(l.state, l.reason)}</span>}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- TelemetryRail

export interface RailRow extends Reading {
  id: string
  label: string
  value?: string | number | null
  /** Actionable rows are buttons with a 44 px hit area; the rest are 28 px. */
  onPress?: () => void
}

/** Component 18, the Telemetry Rail: key-value rows, a lamp in the gutter, each row carries a state, a planned row is dashed. */
export function TelemetryRail({ rows, label }: { rows: RailRow[]; label: string }) {
  return (
    <ul className="k-rail" aria-label={label}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="k-rail-lamp">
              <Lamp state={r.state} reason={r.reason} bare />
            </span>
            <span className="k-rail-label">{r.label}</span>
            <span className="k-rail-value">{readingText(r.state, r.value)}</span>
          </>
        )
        return (
          <li key={r.id} className="k-rail-row" data-state={r.state} data-actionable={r.onPress ? 'true' : undefined}>
            {r.onPress ? (
              <button type="button" className="k-rail-btn" onClick={r.onPress}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------- ProgressBar

export interface ProgressBarProps {
  label: string
  /** Where the percent comes from. Required: a bar is a reading, and only LIVE and SIMULATED may draw one. */
  state: LampState
  /** 0 to 100. Absent (unknown duration): no bar and no fake percent, the word "working" instead. */
  value?: number
  className?: string
  children?: ReactNode
}

/** Component 19, the Registration Progress Bar: where progress is real (a file copy, a model load). Indeterminate is never drawn. */
export function ProgressBar({ label, state, value, className }: ProgressBarProps) {
  const known = showsValue(state) && typeof value === 'number' && Number.isFinite(value)
  const pct = known ? Math.min(100, Math.max(0, value as number)) : 0
  return (
    <div
      className={cx('k-progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? pct : undefined}
      aria-busy={!known || undefined}
      data-known={known ? 'true' : 'false'}
      data-state={state}
    >
      {known ? (
        <>
          <span className="k-progress-track" aria-hidden="true">
            <span className="k-progress-fill" style={{ width: `${pct}%` }} />
            <span className="k-progress-ticks">
              {Array.from({ length: 11 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </span>
          {state === 'simulated' && <LampGlyph state="simulated" size={12} />}
          <span className="k-progress-value">{Math.round(pct)}%</span>
        </>
      ) : (
        <span className="k-progress-value">{showsValue(state) ? 'working' : lampText(state, state === 'waiting' ? 'no report' : undefined)}</span>
      )}
    </div>
  )
}
