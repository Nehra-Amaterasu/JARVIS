// TermWell, TermLine, BootSequence and ScanFrame: the terminal grammar (spec 20.4.3). The well is charcoal in both
// themes because it carries data-scene='immersive', which remaps every role, the five state colours included, to
// the charcoal set (scene.css). The cursor is a solid block: no blink, no scanline, no flicker (spec 10.5).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { LAMP_SPECS, LAMP_STATES, Lamp, LampGlyph, type LampState } from '../../lamp'
import { isReducedMotion } from '../../motion/useReducedMotion'
import { bayerField } from '../ascii/ramps'
import '../grammar.css'

/** The tag words ARE the lamp words (read from LAMP_SPECS, never copied): [LIVE] [WAITING] [SIMULATED] ... */
export const TAG_WORDS: readonly string[] = LAMP_STATES.map((s) => LAMP_SPECS[s].label)
export const tagText = (s: LampState) => `[${LAMP_SPECS[s].label}]`

/**
 * A prompt names the product and the view id, never a person: `ww day.today $` or `jarvis core $`. Anything else
 * is refused and the well shows a bare `$`, so no caller can print a name or a path into the chrome.
 */
const PROMPT_RE = /^(ww|jarvis)(?: ([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*))?(?: \$)?$/
export function promptParts(prompt: string): { product: string; view: string } | null {
  const m = PROMPT_RE.exec(prompt.trim())
  return m ? { product: m[1], view: m[2] ?? '' } : null
}

export interface TermWellProps {
  prompt: string
  children?: ReactNode
  /** The landmark name (default "Terminal"). */
  label?: string
  /** The block cursor after the prompt (default on). It never blinks. */
  cursor?: boolean
}

function Corners() {
  return <>{(['tl', 'tr', 'bl', 'br'] as const).map((c) => <span key={c} className="g-corner" data-c={c} aria-hidden="true" />)}</>
}

export function TermWell({ prompt, children, label = 'Terminal', cursor = true }: TermWellProps) {
  const p = promptParts(prompt)
  return (
    <section className="g-well" data-scene="immersive" data-grammar="terminal" aria-label={label} data-prompt={p ? 'ok' : 'refused'}>
      <Corners />
      <div className="g-well-body">
        {children}
        <div className="g-prompt">
          {p ? `${p.product}${p.view ? ` ${p.view}` : ''}` : ''}
          <span className="g-ps">{p ? ' $' : '$'}</span>
          {cursor && <span className="g-cursor" aria-hidden="true" />}
        </div>
      </div>
    </section>
  )
}

/** 24 characters per second, at most 600 ms per line (spec 20.4.3). */
export const TYPE_CPS = 24
export const TYPE_CAP_MS = 600
export const typeMs = (chars: number) => Math.min(TYPE_CAP_MS, Math.round((chars / TYPE_CPS) * 1000))

export interface TermLineProps {
  /** The lamp state of a log line: drawn as the lamp glyph plus the lamp word in brackets. */
  tag?: LampState
  /** Type the line once (CSS steps, no timer; calm shows it at once). Only for a plain string child. */
  typed?: boolean
  /** out (default), log (default when tagged), err (`ERR ...`, FAULT tag), prompt (an echoed command). */
  kind?: 'out' | 'log' | 'err' | 'prompt'
  children?: ReactNode
}

export function TermLine({ tag, typed = false, kind, children }: TermLineProps) {
  const k = kind ?? (tag ? 'log' : 'out')
  const t = tag ?? (k === 'err' ? 'fault' : undefined)
  const typable = typed && typeof children === 'string' && children.length > 0
  const text = typable ? (children as string) : ''
  const style = typable ? ({ ['--g-type-ms' as string]: `${typeMs(text.length)}ms`, ['--g-type-steps' as string]: String(text.length), inlineSize: `${text.length}ch` } as CSSProperties) : undefined
  return (
    <div className="g-line" data-kind={k} data-tag={t} data-typed={typable ? 'true' : 'false'}>
      {k === 'prompt' && <span className="g-ps" aria-hidden="true">$ </span>}
      {t && (
        <span className="g-tag" style={{ ['--g-tag-ink' as string]: `var(${LAMP_SPECS[t].token}, currentColor)` } as CSSProperties}>
          [<LampGlyph state={t} />{LAMP_SPECS[t].label}]
        </span>
      )}
      {k === 'err' && <span className="g-err">ERR </span>}
      {typable ? <span className="g-typed" style={style}>{text}</span> : children}
    </div>
  )
}

export interface BootSequenceProps {
  /** The rows, "heard", "working", "done" (C01-14). Read once, at mount: a new array does not restart it. */
  rows: string[]
  onDone(): void
}

/**
 * Types its rows once at 24 characters per second inside a 600 ms cap, then calls onDone exactly once. Any key or
 * pointer press skips to the end; a hidden page skips to the end (nothing runs unseen); calm shows every row at
 * once. One interval at most, cleared on finish and on unmount; onDone is never called after unmount.
 */
export function BootSequence({ rows, onDone }: BootSequenceProps) {
  const rowsRef = useRef(rows.slice(0, 12).map((r) => String(r).slice(0, 120)))
  const total = rowsRef.current.reduce((n, r) => n + r.length, 0)
  const [shown, setShown] = useState(() => (isReducedMotion() ? total : 0))
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    let finished = false
    let timer: ReturnType<typeof setInterval> | null = null
    const finish = () => {
      if (finished) return
      finished = true
      if (timer !== null) clearInterval(timer)
      timer = null
      window.removeEventListener('keydown', finish, true)
      window.removeEventListener('pointerdown', finish, true)
      document.removeEventListener('visibilitychange', onVis)
      setShown(total)
      doneRef.current()
    }
    const onVis = () => { if (document.hidden) finish() }
    if (isReducedMotion() || total === 0 || document.hidden) {
      finish()
      return () => { finished = true }
    }
    const duration = Math.min(TYPE_CAP_MS, (total / TYPE_CPS) * 1000)
    const start = performance.now()
    timer = setInterval(() => {
      const t = (performance.now() - start) / duration
      if (t >= 1) finish()
      else setShown(Math.floor(t * total))
    }, 40)
    window.addEventListener('keydown', finish, true)
    window.addEventListener('pointerdown', finish, true)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      // unmounted mid-run: stop everything and do NOT report done (the caller is gone)
      finished = true
      if (timer !== null) clearInterval(timer)
      window.removeEventListener('keydown', finish, true)
      window.removeEventListener('pointerdown', finish, true)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [total])
  let left = shown
  const complete = shown >= total
  return (
    <div className="g-boot" data-grammar="terminal" data-done={complete ? 'true' : 'false'}>
      <div aria-hidden="true">
        {rowsRef.current.map((r, i) => {
          const part = r.slice(0, Math.max(0, left))
          left -= r.length
          const rowDone = part.length === r.length
          return (
            <div key={i} className="g-boot-row" data-done={rowDone ? 'true' : 'false'}>
              {'> '}{part}{!rowDone && part.length > 0 && <span className="g-cursor" />}
            </div>
          )
        })}
      </div>
      <div className="g-sr" role="status">{complete ? rowsRef.current.join('. ') : ''}</div>
    </div>
  )
}

/** The sweep runs at most this long (two passes of 1.5 s), then the frame says "still scanning" and stays still. */
export const SCAN_CAP_MS = 3000

export interface ScanFrameProps {
  label: string
  state: 'scanning' | 'waiting'
  children?: ReactNode
}

export function ScanFrame({ label, state, children }: ScanFrameProps) {
  const [capped, setCapped] = useState(() => state !== 'scanning' || isReducedMotion())
  useEffect(() => {
    if (state !== 'scanning') { setCapped(true); return }
    if (isReducedMotion() || document.hidden) { setCapped(true); return }
    setCapped(false)
    const t = setTimeout(() => setCapped(true), SCAN_CAP_MS)
    const onVis = () => { if (document.hidden) setCapped(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [state])
  const reason = state === 'waiting' ? 'no report' : capped ? 'still scanning' : 'scanning'
  return (
    <section
      className="g-scan" data-grammar="terminal sigil" data-state={state} data-capped={capped ? 'true' : 'false'}
      aria-label={label} aria-busy={state === 'scanning' && !capped ? 'true' : 'false'}
    >
      <Corners />
      <span className="g-scan-label" aria-hidden="true">{label}</span>
      {state === 'scanning' && !capped && <span className="g-sweep" aria-hidden="true" />}
      {state === 'waiting' && <pre className="g-bayer" aria-hidden="true">{bayerField(48, 4, 0.3)}</pre>}
      {children}
      <div className="g-scan-status">
        <Lamp reading={{ state: 'waiting', since: null, reason }} />
        <span>{state === 'waiting' ? 'Waiting for a report' : capped ? 'Still scanning' : 'Scanning'}</span>
      </div>
    </section>
  )
}
