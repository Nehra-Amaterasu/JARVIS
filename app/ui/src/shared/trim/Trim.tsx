/**
 * Trim (spec 20.6.6, A.L02): a setting lives where its variable is used. A 44 px key with a slider glyph sits beside
 * the thing it tunes and opens a popover (at most 320 x 360) with the control, the value now, the default, Reset and
 * one line saying what reads it. Esc closes it and puts focus back on the key. No page, no route.
 *
 * Not a Popover from the kit: that one is drawn by the Well Wisher sheet and hangs on a fixed `.ww-portal`, and a
 * shared trim has to look the same in both products. The Esc stack and the focus helpers are the kit's own.
 */
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../kit/clay.css'
import { focusables, useEscStack } from '../kit/overlay'
import './trim.css'
import { placePopover, type PopPlace } from './layout'
import { trimMounted } from './mounted'
import { resolveSetting } from './registry'
import { valueText, type SettingDef } from './types'

export interface TrimProps {
  /** The id in the registry (a `*.settings.ts` file). A Trim whose id is not registered is reported by the audit. */
  settingId: string
  /** What the setting is called: the key's accessible name and the popover heading. */
  label: string
  /** One line: what reads this value, in the owner's words ("the drift check reads it every minute"). */
  readsBy: string
  /** The control. It changes the variable itself; the Trim only frames it and shows the value read back. */
  children?: ReactNode
  /** The definition when it is not in the globbed registry (the gallery and tests pass their own). */
  def?: SettingDef
}

/** The slider glyph: three tracks, three caps at different heights. Currentcolor, no number. */
function SliderGlyph() {
  return (
    <svg className="tr-glyph" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      <path d="M2 5h16M2 10h16M2 15h16" />
      <rect className="tr-cap" x="11" y="3" width="4" height="4" rx="1" />
      <rect className="tr-cap" x="4.5" y="8" width="4" height="4" rx="1" />
      <rect className="tr-cap" x="9" y="13" width="4" height="4" rx="1" />
    </svg>
  )
}

export function Trim({ settingId, label, readsBy, children, def: given }: TrimProps) {
  const def = given ?? resolveSetting(settingId)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<PopPlace | null>(null)
  const [armed, setArmed] = useState(false)
  const [said, setSaid] = useState('')
  const [, reread] = useReducer((n: number) => n + 1, 0)
  const key = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const uid = useId()
  const popId = `${uid}-pop`

  useEffect(() => trimMounted(settingId), [settingId])

  const close = (refocus: boolean) => {
    setOpen(false)
    setArmed(false)
    setSaid('')
    if (refocus) key.current?.focus({ preventScroll: true })
  }

  // placed once when it opens, from the key's rectangle: no scroll listener (lint-banned), so a resize closes it
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      return
    }
    const a = key.current?.getBoundingClientRect()
    if (a) setPlace(placePopover(a, window.innerWidth, window.innerHeight))
  }, [open])

  // focus moves into the popover once it is drawn: the control first, the panel itself when there is none
  useEffect(() => {
    if (!open || !place || !box.current) return
    const first = focusables(box.current.querySelector('.tr-well') ?? box.current)[0] ?? box.current
    first.focus({ preventScroll: true })
  }, [open, place])

  useEscStack(open, () => close(true))
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || key.current?.contains(t)) return
      close(false)
    }
    const resize = () => close(false)
    document.addEventListener('pointerdown', down)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down)
      window.removeEventListener('resize', resize)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const atDefault = !!def?.isDefault?.()
  const risky = def?.risk
  const reset = () => {
    if (!def || atDefault) return
    if (risky && !armed) {
      setArmed(true)
      setSaid(`Press again to confirm. This is a ${risky} setting.`)
      return
    }
    def.reset()
    setArmed(false)
    setSaid('Back to the default.')
    reread()
  }

  // Tab stays inside the popover: it is a small dialog, and the page behind it is still there to be reached after Esc
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return
    const items = focusables(box.current)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <button
        ref={key}
        type="button"
        className="k-key tr-key"
        aria-label={`${label} setting`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-trim={settingId}
        data-open={open ? 'true' : 'false'}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <SliderGlyph />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={box}
            id={popId}
            className="tr-pop"
            role="dialog"
            aria-label={`${label} setting`}
            tabIndex={-1}
            data-side={place.side}
            data-risk={risky}
            style={{ insetInlineStart: place.left, insetBlockStart: place.top, inlineSize: place.width, maxBlockSize: place.maxHeight }}
            onKeyDown={trap}
          >
            <header className="tr-head">
              <span className="tr-tag" aria-hidden="true">TRIM</span>
              <h2 className="tr-title">{label}</h2>
              <button type="button" className="k-btn tr-x" aria-label={`Close ${label}`} onClick={() => close(true)}>
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </header>
            <div className="tr-well" onChangeCapture={() => queueMicrotask(reread)} onClickCapture={() => queueMicrotask(reread)}>
              {children}
            </div>
            {def ? (
              <dl className="tr-vals">
                <div>
                  <dt>Set to</dt>
                  <dd data-testid="trim-value">{valueText(def)}</dd>
                </div>
                {def.defaultText !== undefined && (
                  <div>
                    <dt>Default</dt>
                    <dd>{def.defaultText}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="tr-orphan">Not in the settings registry yet, so it cannot be reset or found from the palette.</p>
            )}
            <p className="tr-reads">
              <span aria-hidden="true">{'>'} </span>
              Read by: {readsBy}
            </p>
            <div className="tr-foot">
              <button type="button" className="k-btn tr-reset" data-armed={armed ? 'true' : undefined} aria-disabled={!def || atDefault ? 'true' : undefined} onClick={reset}>
                {armed ? 'Confirm reset' : 'Reset'}
              </button>
              <span className="tr-said" role="status">
                {atDefault && !said ? 'Already at the default.' : said}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
