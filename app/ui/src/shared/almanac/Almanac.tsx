// Almanac (package L01, spec 20.6.1): one calendar object for the month and the year form. The month form is a grid of raised
// clay cells (a pressed tile outside the month), a weekday header and a 12 px strip of the weekday rhythm; the year form is 53
// week columns of small cells shaded in four stipple densities. The week and day forms are built by L03 and show a plain
// "not built" plate here, never borrowed content.
//
// Keyboard: ONE tab stop in the grid (roving tabindex). Arrow keys, Home and End move across days, PageUp and PageDown change
// the month, `t` is Today, `w` `m` `y` switch the form, `n` adds an intent on the focused day, Enter opens the day. A shortcut is
// scoped to focus inside the Almanac and never fires while typing. The page owns the month, the form and the drawer; this file
// owns only which day holds the tab stop.
//
// No idle work: the tooltip follows a mouse by writing to one element on pointer events (no state, no timer, no frame loop); the
// long press is one timeout armed by a touch and cleared by its release.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { PlannedGlyph } from '../lamp'
import type { LampState } from '../lamp'
import { DayCell } from './DayCell'
import {
  WEEKDAY_SHORT, addMonths, cellView, firstOf, levelOf, longDate, monthGrid, monthLabel, monthName, monthOf, nextFocus, parseYmd, yearColumns, yearOf, ymd,
} from './model'
import type { AlmanacMode, DayData, Exam, Kind } from './types'

export interface AlmanacProps {
  mode: AlmanacMode
  days: DayData[]
  onPick: (date: string) => void
  exams?: Exam[]
  /** YYYY-MM; default: the month of `today`. */
  month?: string
  /** YYYY-MM-DD; default: the clock, read once at mount. */
  today?: string
  /** The lamp of the page's source. Not live and not simulated with no days: the cells draw the still skeleton. */
  state?: LampState
  selected?: string | null
  /** The kinds switched on in the Marks popover; absent means all. */
  kindsOn?: ReadonlySet<Kind>
  form?: 'desk' | 'phone'
  onMonth?: (delta: -1 | 1) => void
  onMode?: (mode: AlmanacMode) => void
  onToday?: () => void
  onAdd?: (date: string) => void
  /** A right click, the menu key or a long press on a day. */
  onMenu?: (date: string, anchor: HTMLElement) => void
  /** Year form: Enter or a click on a day names its month. */
  onJump?: (month: string) => void
  className?: string
}

const LONG_PRESS_MS = 550

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

export function Almanac({
  mode, days, onPick, exams, month: monthProp, today: todayProp, state = 'live', selected, kindsOn, form = 'desk',
  onMonth, onMode, onToday, onAdd, onMenu, onJump, className,
}: AlmanacProps) {
  const today = useMemo(() => todayProp ?? ymd(new Date()), [todayProp])
  const month = monthProp ?? monthOf(today)
  const dayMap = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const examMap = useMemo(() => new Map((exams ?? []).map((e) => [e.date, e])), [exams])
  const grid = useMemo(() => monthGrid(month), [month])
  const waiting = days.length === 0 && state !== 'live' && state !== 'simulated'

  // the day that holds the tab stop: today if it is on the page, else the 1st
  const [focus, setFocus] = useState<string>(today)
  const visible = useMemo(() => new Set(grid.map((c) => c.date)), [grid])
  const year = yearOf(month + '-01')
  const stop = mode === 'year'
    ? (yearOf(focus) === year ? focus : yearOf(today) === year ? today : `${year}-01-01`)
    : visible.has(focus) ? focus : visible.has(today) ? today : firstOf(month)
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const wantFocus = useRef<string | null>(null)
  useEffect(() => {
    const d = wantFocus.current
    if (d && cells.current.has(d)) {
      wantFocus.current = null
      cells.current.get(d)!.focus({ preventScroll: true })
    }
  })

  const moveTo = useCallback((date: string) => {
    setFocus(date)
    wantFocus.current = date
    if (monthOf(date) !== month && mode === 'month') onMonth?.(monthOf(date) > month ? 1 : -1)
  }, [month, mode, onMonth])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return
    if (mode === 'month' || mode === 'year') {
      const next = nextFocus(stop, e.key)
      if (next) {
        e.preventDefault()
        if (mode === 'year' && yearOf(next) !== yearOf(stop)) return
        moveTo(next)
        return
      }
    }
    switch (e.key) {
      case 'PageUp': case 'PageDown': {
        e.preventDefault()
        const delta = e.key === 'PageUp' ? -1 : 1
        const day = Number(stop.slice(8, 10))
        const to = `${addMonths(month, delta)}-${String(Math.min(day, 28)).padStart(2, '0')}`
        setFocus(to)
        wantFocus.current = to // the old cell leaves the grid, so focus follows to the same day of the new month
        onMonth?.(delta)
        break
      }
      case 't': e.preventDefault(); setFocus(today); wantFocus.current = today; onToday?.(); break
      case 'w': e.preventDefault(); onMode?.('week'); break
      case 'm': e.preventDefault(); onMode?.('month'); break
      case 'y': e.preventDefault(); onMode?.('year'); break
      case 'n': e.preventDefault(); onAdd?.(stop); break
      default: break
    }
  }

  // ---- the tooltip and the long press: events only
  const tip = useRef<HTMLDivElement>(null)
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current)
    press.current = null
  }
  useEffect(() => cancelPress, [])
  const cellAt = (t: EventTarget | null) => (t as HTMLElement | null)?.closest<HTMLElement>('[data-date]') ?? null
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = tip.current
    if (!box) return
    const el = e.pointerType === 'mouse' ? cellAt(e.target) : null
    if (!el) {
      box.hidden = true
      return
    }
    const root = e.currentTarget.getBoundingClientRect()
    box.textContent = el.dataset.tip ?? ''
    box.hidden = false
    const w = box.offsetWidth
    const x = Math.min(e.clientX - root.left + 14, root.width - w - 4)
    box.style.transform = `translate(${Math.max(4, x)}px, ${e.clientY - root.top + 16}px)`
  }
  const hideTip = () => {
    if (tip.current) tip.current.hidden = true
  }
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = cellAt(e.target)
    if (e.pointerType !== 'touch' || !el || !onMenu) return
    cancelPress()
    press.current = setTimeout(() => {
      press.current = null
      if (el.dataset.date) onMenu(el.dataset.date, el)
    }, LONG_PRESS_MS)
  }
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const el = cellAt(e.target)
    if (!el?.dataset.date || !onMenu) return
    e.preventDefault()
    onMenu(el.dataset.date, el)
  }

  const handlers = {
    onKeyDown, onPointerMove, onPointerLeave: hideTip, onPointerDown, onPointerUp: cancelPress, onPointerCancel: cancelPress, onContextMenu,
  }

  if (mode === 'week' || mode === 'day') {
    return (
      <div className={className ? `alm ${className}` : 'alm'} data-mode={mode} data-form={form} {...handlers}>
        <div className="alm-notbuilt" role="status">
          <PlannedGlyph size={16} />
          <span>The {mode} form is not built yet. The month and the year are.</span>
        </div>
      </div>
    )
  }

  if (mode === 'year') {
    return (
      <div className={className ? `alm ${className}` : 'alm'} data-mode="year" data-form={form} {...handlers}>
        <YearForm
          year={year} today={today} dayMap={dayMap} active={stop} onJump={(m) => onJump?.(m)} onPick={onPick}
        />
        <div ref={tip} className="alm-tip" hidden aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className={className ? `alm ${className}` : 'alm'} data-mode="month" data-form={form} data-waiting={waiting ? 'true' : undefined} {...handlers}>
      <div className="alm-grid" role="grid" aria-label={monthLabel(month)} aria-rowcount={7}>
        <div className="alm-wk" role="row">
          {WEEKDAY_SHORT.map((w, i) => <span key={w} role="columnheader" className="alm-wd" data-weekend={i > 4 ? 'true' : undefined}>{w}</span>)}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div key={r} className="alm-row" role="row">
            {grid.slice(r * 7, r * 7 + 7).map((c) => (
              <div key={c.date} role="gridcell" className="alm-gc" aria-selected={selected === c.date}>
                <DayCell
                  date={c.date}
                  view={cellView(c.date, dayMap.get(c.date), examMap.get(c.date), kindsOn)}
                  inMonth={c.inMonth}
                  today={c.date === today}
                  selected={selected === c.date}
                  stop={c.date === stop}
                  form={form}
                  waiting={waiting}
                  onPick={(d) => { setFocus(d); onPick(d) }}
                  buttonRef={(el) => { if (el) cells.current.set(c.date, el); else cells.current.delete(c.date) }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <Rhythm stop={stop} />
      <div ref={tip} className="alm-tip" hidden aria-hidden="true" />
    </div>
  )
}

/** The 12 px strip under the grid: the weekday rhythm, one dot per weekday and a bar at the weekday of the focused day. */
function Rhythm({ stop }: { stop: string }) {
  const at = (parseYmd(stop).getDay() + 6) % 7
  return (
    <div className="alm-rhythm" aria-hidden="true">
      {WEEKDAY_SHORT.map((w, i) => <span key={w} data-at={i === at ? 'true' : undefined} />)}
    </div>
  )
}

interface YearFormProps {
  year: number
  today: string
  dayMap: ReadonlyMap<string, DayData>
  active: string
  onJump: (month: string) => void
  onPick: (date: string) => void
}

/**
 * The year form: weekdays down, weeks across. It is ONE focusable grid (aria-activedescendant), because a day here is a 20 px
 * pointer target and 371 buttons would be 371 targets under the 44 px rule; the month keys below the grid are the touch route.
 */
function YearForm({ year, today, dayMap, active, onJump, onPick }: YearFormProps) {
  const cols = useMemo(() => yearColumns(year), [year])
  const weeks = cols.length
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`
    const start = cols.findIndex((col) => col.some((c) => c.date === firstOf(m)))
    return { m, start }
  })
  const activeId = `alm-y-${active}`
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onJump(monthOf(active))
    }
  }
  return (
    <div className="alm-year" style={{ ['--weeks' as string]: weeks }}>
      <div className="alm-ymonths" aria-hidden="true">
        {months.map(({ m, start }, i) => (
          <span key={m} style={{ gridColumn: `${start + 1} / ${(months[i + 1]?.start ?? weeks) + 1}` }}>{monthName(m).slice(0, 3)}</span>
        ))}
      </div>
      <div className="alm-ygrid" role="grid" aria-label={`${year}, one cell per day`} tabIndex={0} aria-activedescendant={activeId} onKeyDown={onKey}>
        {Array.from({ length: 7 }, (_, wd) => (
          <div key={wd} role="row" className="alm-yrow">
            {cols.map((col) => {
              const c = col[wd]
              const day = dayMap.get(c.date)
              const lv = levelOf(day)
              return (
                <div
                  key={c.date}
                  id={`alm-y-${c.date}`}
                  role="gridcell"
                  className="alm-yc"
                  data-date={c.date}
                  data-level={lv}
                  data-in={c.inYear ? 'true' : 'false'}
                  data-today={c.date === today ? 'true' : undefined}
                  data-active={c.date === active ? 'true' : undefined}
                  data-tip={`${longDate(c.date)}: ${cellView(c.date, day, undefined).text}`}
                  aria-label={`${longDate(c.date)}: ${cellView(c.date, day, undefined).text}`}
                  onClick={() => { onPick(c.date); onJump(monthOf(c.date)) }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className="alm-ylegend">
        <span>Minutes studied in a day</span>
        {([[1, 'under 30'], [2, '30 to 59'], [3, '60 to 119'], [4, '120 or more']] as const).map(([l, w]) => (
          <span key={l}><i className="alm-yc" data-level={l} data-in="true" aria-hidden="true" />{w}</span>
        ))}
      </p>
      <ul className="alm-ykeys" aria-label="Months">
        {months.map(({ m }) => (
          <li key={m}>
            <button type="button" className="alm-ykey" onClick={() => onJump(m)}>
              <span>{monthName(m)}</span>
              <YearHeat dayMap={dayMap} month={m} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Four stipple densities in one line for a month: how many of its days sit at each level (decorative; the key names the month). */
function YearHeat({ dayMap, month }: { dayMap: ReadonlyMap<string, DayData>; month: string }) {
  const levels = [0, 0, 0, 0, 0]
  for (const [date, d] of dayMap) if (monthOf(date) === month) levels[levelOf(d)]++
  const total = levels.slice(1).reduce((s, n) => s + n, 0)
  return (
    <span className="alm-yheat" aria-hidden="true" data-empty={total === 0 ? 'true' : undefined}>
      {[1, 2, 3, 4].map((l) => <i key={l} data-level={l} style={{ flexGrow: levels[l] }} />)}
    </span>
  )
}
