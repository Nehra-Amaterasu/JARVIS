import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { isReducedMotion } from '../motion/useReducedMotion'
import { cx, tokenMs } from './util'

export interface SegmentedOption<T extends string = string> {
  id: T
  label: string
  /** Disabled WITH a reason: stays focusable, selects nothing, says why. */
  disabledReason?: string
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (id: T) => void
  /** view 40 px (a page's view switch), choice 44 px real (a form choice), compact 36 px visible with a 44 px hit area. */
  variant?: 'view' | 'choice' | 'compact'
  /** The group's accessible name. Required: a radio group with no name is announced as nothing. */
  label: string
  className?: string
}

/** Where the checked option sits inside the channel, in px from the channel's padding edge. */
interface Geo {
  x: number
  y: number
  w: number
  h: number
}

/** Pixels of pointer travel before a press on the thumb becomes a drag (a tap has a little jitter). */
const DRAG_SLOP = 4

/** The previous object when nothing moved, so setState bails out. */
const sameGeo = (a: Geo | null, b: Geo | null): Geo | null => (a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h ? a : b)

const nearest = (centres: number[], at: number): number => {
  let best = 0
  for (let i = 1; i < centres.length; i++) if (Math.abs(centres[i] - at) < Math.abs(centres[best] - at)) best = i
  return best
}

/** A fine, hovering pointer: a mouse or a pen on a desktop. The phone and a touch screen keep tap (plan 08, Risks). */
const desktopPointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * One segmented control instead of three `.seg` definitions, `life-kinds` and `ex-chips`.
 * A radio group: arrow keys move and select, one roving tab stop, Home and End jump. The selected
 * option is a wash plus ink, never the accent (the accent belongs to the single primary, 5.2).
 *
 * The thumb (clay themes only): ONE element that sits under the checked option and travels to the new
 * one by `translate` (the width follows only where the two options differ in width), in --dur-thumb on
 * --ease-thumb, which overshoots once and is settled inside 240 ms. It is drawn only while it moves;
 * at rest the checked option's own fill is the state (so a still screenshot, the contrast probes and
 * forced colours all see a filled option), and that fill lands on the new option the moment the thumb
 * does. A key press or a tap moves it the same way a drag does. On a desktop pointer, with three or
 * more options, the thumb can be dragged along the channel and snaps to the nearest option on release;
 * two options and every touch keep tap. Reduced motion (the media query or data-motion='calm'): the
 * thumb never travels, the fill jumps. Before the channel has a measurable size (a test DOM, a hidden
 * tab) there is no thumb and the checked option is drawn exactly as it was.
 */
export function Segmented<T extends string = string>({ options, value, onChange, variant = 'view', label, className }: SegmentedProps<T>) {
  const noteId = useId()
  const group = useRef<HTMLSpanElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [note, setNote] = useState<string | null>(null)
  // -1 when the value is not among the options: nothing is checked, so no thumb is drawn and no drag starts; the tab stop stays on the first option
  const selectedIdx = options.findIndex((o) => o.id === value)
  const tabStop = selectedIdx < 0 ? 0 : selectedIdx
  const labelsKey = options.map((o) => o.label).join('\u0001')

  const [geo, setGeo] = useState<Geo | null>(null)
  const [moving, setMoving] = useState(false)
  const [dragX, setDragX] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const prevIdx = useRef<number | null>(null)
  const drag = useRef<{ id: number; startX: number; baseX: number; min: number; max: number; centres: number[]; x: number; active: boolean } | null>(null)
  const suppress = useRef(false)

  const measure = useCallback((): Geo | null => {
    const g = group.current
    const o = selectedIdx < 0 ? null : refs.current[selectedIdx]
    // offsetParent must be the channel: the classic (non-clay) channel is not positioned and has no thumb
    if (!g || !o || o.offsetParent !== g || o.offsetWidth === 0) return null
    return { x: o.offsetLeft, y: o.offsetTop, w: o.offsetWidth, h: o.offsetHeight }
  }, [selectedIdx])

  // measured before paint, so the first frame already has the thumb under the checked option; a changed selection travels
  useLayoutEffect(() => {
    // a drag holds a snapshot of the options (centres, limits): when the options or the value change under it, it ends without choosing
    drag.current = null
    setDragX(null)
    setOver(null)
    const g = measure()
    setGeo(g)
    if (g && prevIdx.current !== null && prevIdx.current !== selectedIdx && !isReducedMotion()) setMoving(true)
    prevIdx.current = g ? selectedIdx : null
  }, [selectedIdx, labelsKey, measure])

  // the channel can change width (a window resize, a font arriving, a sibling): re-measure without travelling
  useEffect(() => {
    const g = group.current
    if (!g || typeof ResizeObserver === 'undefined') return
    let live = true
    // the same numbers keep the same object, so a resize callback that changed nothing does not render again
    const remeasure = () => setGeo((prev) => sameGeo(prev, measure()))
    const ro = new ResizeObserver(remeasure)
    ro.observe(g)
    void document.fonts?.ready.then(() => {
      if (live) remeasure()
    })
    return () => {
      live = false
      ro.disconnect()
    }
  }, [measure])

  // a channel that cannot be measured any more (a hidden tab) cannot carry a drag
  useEffect(() => {
    if (!geo && drag.current) cancelDrag()
  }, [geo])

  // safety net for a transition that never reports its end (a tab hidden mid-travel)
  useEffect(() => {
    if (!moving) return
    const t = setTimeout(() => setMoving(false), tokenMs(thumb.current, '--dur-thumb', 180) + 120)
    return () => clearTimeout(t)
  }, [moving, selectedIdx])

  const choose = (i: number, focus: boolean) => {
    const o = options[i]
    if (focus) refs.current[i]?.focus()
    if (o.disabledReason) {
      setNote(`${o.label}: ${o.disabledReason}`)
      return
    }
    setNote(null)
    if (o.id !== value) onChange(o.id)
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Escape' && drag.current) {
      e.preventDefault()
      cancelDrag()
      return
    }
    const last = options.length - 1
    // in a right-to-left page the left arrow goes to the NEXT option, because the options run right to left
    const dirAttr = group.current?.closest('[dir]')?.getAttribute('dir')
    const rtl = !!group.current && (dirAttr ? dirAttr === 'rtl' : getComputedStyle(group.current).direction === 'rtl')
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const next = e.key === fwd || e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === back || e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (next < 0) return
    e.preventDefault()
    choose(next, true)
  }

  // ------------------------------------------------------------------------------------------ drag (desktop, three or more options)
  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    suppress.current = false
    drag.current = null // a leftover from a press that never got its release must not start a drag with no button down
    if (e.button !== 0 || e.pointerType === 'touch' || options.length < 3 || !geo || selectedIdx < 0 || !desktopPointer()) return
    const hit = (e.target as HTMLElement).closest('.ww-seg-opt')
    if (!hit || hit !== refs.current[selectedIdx]) return // only the thumb is grabbed; a press on another option is a tap
    const os = refs.current.filter((o): o is HTMLButtonElement => !!o)
    const first = os[0]
    const last = os[os.length - 1]
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      baseX: geo.x,
      min: first.offsetLeft,
      max: last.offsetLeft + last.offsetWidth - geo.w,
      centres: os.map((o) => o.offsetLeft + o.offsetWidth / 2),
      x: geo.x,
      active: false,
    }
    // captured from the press, so the release always arrives here, even outside the channel (capture after the slop missed it)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a synthetic pointer has no capture: the drag still follows move events over the channel */
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id || !geo) return
    // the primary button is up (released where no event reached us): the drag is over, whatever the pointer does now
    if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
      cancelDrag()
      return
    }
    const dx = e.clientX - d.startX
    if (!d.active) {
      if (Math.abs(dx) < DRAG_SLOP) return
      d.active = true
      setMoving(false)
    }
    d.x = Math.min(d.max, Math.max(d.min, d.baseX + dx))
    setDragX(d.x)
    setOver(nearest(d.centres, d.x + geo.w / 2))
  }
  const endDrag = (e: ReactPointerEvent<HTMLSpanElement>, commit: boolean) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.active) return
    suppress.current = true
    setTimeout(() => {
      suppress.current = false
    }, 0)
    setMoving(!isReducedMotion())
    setDragX(null)
    setOver(null)
    // the snapshot may be older than the options: clamp, and give up if the option is gone
    const target = Math.min(options.length - 1, Math.max(0, commit && geo ? nearest(d.centres, d.x + geo.w / 2) : selectedIdx))
    if (!options[target]) return
    // a committed move to another option takes focus with it, so the next arrow key starts from the checked option (the roving tab stop)
    choose(target, commit && target !== selectedIdx && !options[target].disabledReason)
  }
  /** Ends a drag without choosing: the thumb goes back to the checked option and focus stays where it was. */
  function cancelDrag() {
    const d = drag.current
    drag.current = null
    setDragX(null)
    setOver(null)
    if (d?.active) {
      suppress.current = true
      setTimeout(() => {
        suppress.current = false
      }, 0)
      setMoving(!isReducedMotion())
    }
  }

  const at: Geo | null = geo && dragX !== null ? { ...geo, x: dragX } : geo
  const thumbStyle = at ? ({ '--seg-x': `${at.x}px`, '--seg-y': `${at.y}px`, '--seg-w': `${at.w}px`, '--seg-h': `${at.h}px` } as CSSProperties) : undefined

  return (
    <span className="ww-seg-wrap">
      <span
        ref={group}
        className={cx('ww-seg', className)}
        role="radiogroup"
        aria-label={label}
        data-variant={variant}
        data-thumb={geo ? 'on' : undefined}
        data-dragging={geo && dragX !== null ? 'true' : undefined}
        aria-describedby={note ? noteId : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
        onLostPointerCapture={() => cancelDrag()}
        onBlur={(e) => {
          if (drag.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) cancelDrag()
        }}
      >
        <span
          ref={thumb}
          className="ww-seg-thumb"
          aria-hidden="true"
          style={thumbStyle}
          data-moving={moving ? 'true' : undefined}
          data-drag={geo && dragX !== null ? 'true' : undefined}
          onTransitionEnd={(e) => e.propertyName === 'translate' && setMoving(false)}
        />
        {options.map((o, i) => (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            className="ww-seg-opt ww-tap"
            aria-checked={o.id === value}
            aria-disabled={o.disabledReason ? true : undefined}
            data-over={over === i ? 'true' : undefined}
            tabIndex={i === tabStop ? 0 : -1}
            title={o.disabledReason ? `${o.label}: ${o.disabledReason}` : undefined}
            onClick={() => {
              if (suppress.current) {
                suppress.current = false
                return
              }
              choose(i, false)
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        ))}
      </span>
      {note && (
        <span id={noteId} className="ww-reason" role="status">
          {note}
        </span>
      )}
    </span>
  )
}
