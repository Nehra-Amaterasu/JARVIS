// The material of design language v3 (docs/design/design-language-v3.md 2.1, 2.5, 4.1): the ground, the three graded trays,
// the numbered step label, the station ruler, and a captioned group. Every piece draws only inside [data-look='v3'].
import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from '../util'
import '../glass.css'

/** The three trays: first is the most lifted and most opaque, second one step flatter, third the glassiest (spec 2.5). */
export type PlateTier = 'first' | 'second' | 'third'
/** JARVIS, Aankhen and Yadaash draw a formed corner tick before the numeral; Well Wisher draws [1] in ASCII (jury round 3). */
export type StepMark = 'sigil' | 'bracket'

// ---------------------------------------------------------------------------------------------- Ground

/** The window ground: a sibling behind the content, never its parent, and the only layer that blurs. Decorative. */
export function Ground({ className }: { className?: string }) {
  return <div className={cx('v3-ground', className)} aria-hidden="true" />
}

// ---------------------------------------------------------------------------------------------- Glint

/** A light band that crosses its positioned parent once. Change `on` (any value) to cross again. Still: nothing is drawn. */
export function Glint({ on = 0 }: { on?: string | number }) {
  return <span key={String(on)} className="v3-glint" aria-hidden="true" />
}

// ---------------------------------------------------------------------------------------------- StepLabel

export interface StepLabelProps {
  /** Which step this tray is: 1 is the first act. */
  n: number
  /** The job of the tray in capitals: WAKE, CONVERSATION, VOICE PATH. */
  job: string
  /** How many steps the view has; only spoken. */
  of?: number
  mark?: StepMark
  id?: string
}

/** "1 WAKE": the numeral in a pressed 20 px well (or [1]) and the job of the tray. Replaces the three dots. */
export function StepLabel({ n, job, of = 3, mark = 'sigil', id }: StepLabelProps) {
  return (
    <span className="v3-step" data-mark={mark} id={id}>
      {mark === 'sigil' && <span className="v3-step-tick" aria-hidden="true" />}
      <span className="v3-sr">{`Step ${n} of ${of}: `}</span>
      <span className="v3-step-n" aria-hidden="true">
        {mark === 'bracket' ? `[${n}]` : n}
      </span>
      <span className="v3-step-job">{job}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------------------------- Ruler

/** The ASCII rule |····:····| built from a measured width, so it ends on a full bar. Pure, so a test can prove it. */
export function asciiRule(chars: number): string {
  const n = Math.max(0, Math.floor(chars))
  if (n < 2) return ''
  let s = ''
  for (let i = 0; i < n; i++) s += i === 0 || i === n - 1 || i % 10 === 0 ? '|' : i % 5 === 0 ? ':' : '·'
  return s
}

const SIGIL_MARKS = Array.from({ length: 24 }, (_, i) => i)

export interface RulerProps {
  /** Formed marks on the dark ground (an arc of 24 marks), an ASCII rule on the light ground. */
  kind: 'sigil' | 'ascii'
}

export function Ruler({ kind }: RulerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  useEffect(() => {
    const el = ref.current
    if (kind !== 'ascii' || !el) return
    // the width of one mono character at the ruler's own font: measured on a probe, never assumed
    const probe = document.createElement('span')
    probe.textContent = '0'.repeat(20)
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit'
    el.appendChild(probe)
    const cw = probe.getBoundingClientRect().width / 20
    el.removeChild(probe)
    const fit = () => {
      const w = el.clientWidth
      setText(cw > 0 && w > 0 ? asciiRule(Math.floor(w / cw)) : '')
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [kind])
  if (kind === 'sigil') {
    return (
      <div className="v3-ruler" data-kind="sigil" aria-hidden="true">
        {SIGIL_MARKS.map((i) => (
          <i key={i} />
        ))}
      </div>
    )
  }
  return (
    <div className="v3-ruler" data-kind="ascii" aria-hidden="true" ref={ref}>
      {text}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Plate

export interface PlateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  tier?: PlateTier
  /** The step of the tray (1 to 3) and its job; together they draw the head. Omit both for a bare tray. */
  step?: number
  job?: string
  stepMark?: StepMark
  /** One state chip at the right of the head. */
  chip?: ReactNode
  /** The station ruler: first tray only (spec 4.1 rule 3). */
  ruler?: RulerProps['kind'] | false
  /** The order the tray rises in when the place changes (0, 1, 2 = 0, 70, 140 ms). Omit to appear at once. */
  rise?: 0 | 1 | 2
  /** Change this value to flare the tray's light once (a wake, a block start, a cleared fault). */
  flare?: string | number
  /** Change this value to cross the tray with a glint once. */
  glint?: string | number
  as?: 'section' | 'div' | 'article'
  children?: ReactNode
}

/** A raised tray with the graded material: tint, glare, inner top edge and its own shadow. No blur (spec 2.1). */
export function Plate({ tier = 'second', step, job, stepMark = 'sigil', chip, ruler = false, rise, flare, glint, as: Tag = 'section', className, style, children, ...rest }: PlateProps) {
  const head = useId()
  const named = step !== undefined && job !== undefined
  const css = rise === undefined ? style : ({ ...style, ['--rise-i' as string]: rise } as typeof style)
  return (
    <Tag
      {...rest}
      className={cx('v3-plate', className)}
      data-tier={tier}
      data-rise={rise === undefined ? undefined : ''}
      aria-labelledby={named ? head : rest['aria-labelledby']}
      style={css}
    >
      {flare !== undefined && <span key={String(flare)} className="v3-flare" aria-hidden="true" />}
      {glint !== undefined && <Glint on={glint} />}
      {named && (
        <header className="v3-plate-head">
          <StepLabel n={step} job={job} mark={stepMark} id={head} />
          {chip}
        </header>
      )}
      {ruler && <Ruler kind={ruler} />}
      {children}
    </Tag>
  )
}

// ---------------------------------------------------------------------------------------------- Group

export interface GroupProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The quiet caption: 12 px mono capitals, never a box and never a line. */
  label: string
  /** One state chip at the right edge when the whole group shares a state. */
  chip?: ReactNode
  /** well: one recessed well that holds the family (default). flat: the caption only, rows sit on the tray. */
  variant?: 'well' | 'flat'
  children?: ReactNode
}

/** One family in one place. Rows inside are 6 to 8 px apart; groups are 16 px apart (the caller spaces them). */
export function Group({ label, chip, variant = 'well', className, children, ...rest }: GroupProps) {
  const id = useId()
  return (
    <section {...rest} className={cx('v3-group', className)} data-variant={variant} aria-labelledby={id}>
      <h3 className="v3-group-cap" id={id}>
        <span>{label}</span>
        {chip}
      </h3>
      {children}
    </section>
  )
}
