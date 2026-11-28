/**
 * One tray of the three-tray frame (design-language-v3.md 4.1 rules 1 to 4). It draws the head (a numbered step label:
 * "1 WAKE", jury round 3 replaced the three dots, which read as carousel pagination), the ruler on the first tray only, and
 * the graded material (tint, radius, shadow and type size per step, in shell-v3.css). A view does not style its trays: it
 * passes a TraySpec to <Zones> and puts its content inside.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { StepNumber, TraySpec } from './contract'
import './shell-v3.css'

/** The ASCII rule `|····:····|` for the light ground, built to end on a full bar: n whole 10-character segments and a closing bar. */
export function asciiRuler(widthPx: number, charPx: number): string {
  const chars = charPx > 0 ? Math.floor(widthPx / charPx) : 0
  const n = Math.max(0, Math.floor((chars - 1) / 10))
  return '|····:····'.repeat(n) + '|'
}

/**
 * The station ruler, drawn for both grounds and shown for one by CSS. Dark (JARVIS, Aankhen, Yadaash): a rail of small
 * formed marks, the cybersigil language, not Well Wisher's ASCII (jury round 3). Light: the ASCII rule, measured from the
 * width so it ends on a full bar.
 */
export function Ruler() {
  // one pattern id per ruler: a view may turn the ruler on for two trays, and a duplicate id would resolve to the first one
  // (which can sit inside a hidden svg on the light ground and paint nothing)
  const pid = `s3-ruler-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const host = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const [text, setText] = useState('|')
  useEffect(() => {
    const el = host.current
    const p = probe.current
    if (!el || !p) return
    const fit = () => {
      const cw = p.getBoundingClientRect().width / 10
      const w = el.getBoundingClientRect().width
      if (cw > 0 && w > 0) setText(asciiRuler(w, cw))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="s3-ruler" ref={host} aria-hidden="true">
      <svg className="s3-ruler-marks" width="100%" height="10" focusable="false">
        <defs>
          <pattern id={pid} width="12" height="10" patternUnits="userSpaceOnUse">
            <path d="M3 9 6 3l3 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </pattern>
        </defs>
        <rect width="100%" height="10" fill={`url(#${pid})`} />
      </svg>
      <span className="s3-ruler-ascii">{text}</span>
      <span className="s3-ruler-probe" ref={probe}>0123456789</span>
    </div>
  )
}

/** A light band that crosses the hero object once when the place changes (spec 5, "Glint"). Place it as the last child of the hero. */
export function Glint() {
  return <span className="s3-glint" aria-hidden="true" />
}

/**
 * The edges of a scroller that have more content beyond them (28 Nov: several trays clipped their content with no way to reach
 * it). Read from the real scroll position, the scroll height and the box, on scroll and on every resize of the box or its
 * content, so the soft edge shows exactly where there is more and never where there is not. 2 px of slack absorbs the
 * sub-pixel rounding of a zoomed window. Returns nothing: it writes data-more-up and data-more-down on the element, so a
 * scroll never re-renders the view inside.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const read = () => {
      raf = 0
      const up = el.scrollTop > 2
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2
      const u = up ? '1' : '0'
      const d = down ? '1' : '0'
      if (el.dataset.moreUp !== u) el.dataset.moreUp = u
      if (el.dataset.moreDown !== d) el.dataset.moreDown = d
    }
    const soon = () => {
      if (!raf) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(read) : (read(), 0)
    }
    read()
    el.addEventListener('scroll', soon, { passive: true })
    let ro: ResizeObserver | null = null
    let mo: MutationObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(soon)
      ro.observe(el)
      for (const c of el.children) ro.observe(c)
    }
    // content that arrives later (a list that loads) changes the scroll height without resizing the box
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        if (ro) for (const c of el.children) ro.observe(c)
        soon()
      })
      mo.observe(el, { childList: true })
    }
    return () => {
      el.removeEventListener('scroll', soon)
      ro?.disconnect()
      mo?.disconnect()
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [ref])
}

export interface TrayProps extends TraySpec {
  step: StepNumber
  /** Phone: this tray is the open sheet. */
  sheet?: boolean
  onDone?: () => void
}

export function Tray({ step, job, chip, ruler, flare, label, className, children, sheet, onDone }: TrayProps) {
  const id = useId()
  const done = useRef<HTMLButtonElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useScrollEdges(body)
  useEffect(() => {
    if (sheet) done.current?.focus()
  }, [sheet])
  // the glare plays only when the number RISES while the tray is on screen: a tray that mounts with flare > 0 (every place
  // change remounts Zones) stays quiet
  const seen = useRef(flare ?? 0)
  const [fired, setFired] = useState(0)
  useEffect(() => {
    const f = flare ?? 0
    if (f > seen.current && f > 0) setFired(f)
    seen.current = f
  }, [flare])
  const rule = ruler ?? step === 1
  const sheetProps: { role?: string; 'aria-modal'?: boolean } = sheet ? { role: 'dialog', 'aria-modal': true } : {}
  return (
    <section className={`s3-tray${className ? ` ${className}` : ''}`} data-step={step} data-sheet={sheet ? 'open' : undefined}
      aria-labelledby={label ? undefined : `${id}-h`} aria-label={label} {...sheetProps}>
      <header className="s3-thead">
        <h2 className="s3-step" id={`${id}-h`}>
          <span className="s3-num" aria-hidden="true">{step}</span>
          <span className="s3-job"><span className="s3-vis">Step {step}: </span>{job}</span>
        </h2>
        {chip != null && <span className="s3-headchip">{chip}</span>}
      </header>
      {rule && <Ruler />}
      <div className="s3-body" ref={body}>{children as ReactNode}</div>
      {step === 1 && fired > 0 && <span className="s3-flare" key={fired} data-flare={fired} aria-hidden="true" />}
      {step !== 1 && (
        <button type="button" className="s3-done" ref={done} onClick={onDone}>Done</button>
      )}
    </section>
  )
}
