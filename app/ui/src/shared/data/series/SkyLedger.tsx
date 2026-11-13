// SkyLedger (spec 20.5.2, package D02): the last 60 (or 90) days as a calm field of stars on a charcoal sky, ten to
// a row, oldest top left and today bottom right. A kept day is a lit star, a rest day a crescent (rest is a first
// class day, never a hole), an untouched day a faint point that keeps its place. The headline is one ratio over the
// whole window, "41 of the last 60 days kept", so one day moves it by a sixtieth and it changes slowly. Kept days
// that share a habit are joined by hairlines into a figure, by nearness on the sky and not by order in time. There is
// no run counter and no loss wording anywhere: deleting a day lowers the count, honestly, and nothing else happens.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { fnv1a32, mulberry32 } from '../../grammar'
import { LAMP_SPECS, LampGlyph, type LampState } from '../../lamp'
import {
  SKY_COLS, SKY_FADE_MS, SKY_FIGURE_REACH, constellation, crescentPath, fmtIso, localToday, skyCounts, skyHeadline, skyPositions, skySlots,
  type SkyDay, type SkySlot, type SkyWindow,
} from './layout'
import { Housing, Screen, TableFold, isHollow, useWidth } from './parts'

export interface SkyLedgerProps {
  days: SkyDay[]
  window: 60 | 90
  state: LampState
  /** Optional (beyond the contract): the name, the last day of the window (YYYY-MM-DD, default today), why hollow, and
   * what Enter on a day does (the Almanac day drawer). */
  label?: string
  today?: string
  reason?: string
  onOpenDay?(date: string): void
}

const KIND_WORD: Record<SkySlot['kind'], string> = { kept: 'kept', rest: 'rest day', none: 'untouched' }
const LABEL_W = 62
const ROW_H = 30
const ROW_H_PHONE = 28
/** 34 px on top for the corner plates (as the Trace), 14 px below. */
const PAD_TOP = 34
const PAD_Y = 14

export function SkyLedger({ days, window, state, label = 'Days kept', today, reason, onOpenDay }: SkyLedgerProps) {
  const hollow = isHollow(state)
  const win: SkyWindow = window === 90 ? 90 : 60
  const end = today ?? localToday()
  const slots = useMemo(() => skySlots(hollow ? [] : days, win, end), [days, win, end, hollow])
  const c = skyCounts(slots)
  const [stageRef, width] = useWidth(760)
  const rows = win / SKY_COLS
  const rowH = width < 600 ? ROW_H_PHONE : ROW_H
  const h = rows * rowH + PAD_TOP + PAD_Y
  const skyW = Math.max(160, width - LABEL_W - 22)
  const pos = useMemo(() => skyPositions(win, skyW, rows * rowH).map((p) => ({ x: p.x + LABEL_W, y: p.y + PAD_TOP })), [win, skyW, rows, rowH])
  const reach = SKY_FIGURE_REACH * Math.max(skyW / SKY_COLS, rowH)
  const lines = useMemo(() => (hollow ? [] : constellation(slots, pos, reach)), [slots, pos, hollow, reach])
  const [sel, setSel] = useState<number | null>(null)

  // the 200 ms fade marks only a day whose kind changed since the last drawing (never the first drawing)
  // (computed once per new slots, so a hover redraw does not cut a running fade short)
  const prev = useRef<Map<string, string> | null>(null)
  const fresh = useMemo(() => {
    const out = new Set<string>()
    if (prev.current) for (const s of slots) if (s.kind !== 'none' && prev.current.get(s.date) !== s.kind) out.add(s.date)
    return out
  }, [slots])
  useEffect(() => { prev.current = new Map(slots.map((s) => [s.date, s.kind])) }, [slots])

  const say = (i: number) => {
    const s = slots[i]
    return s ? `${fmtIso(s.date)}: ${KIND_WORD[s.kind]}${s.habit && s.kind === 'kept' ? `, ${s.habit}` : ''}${i === slots.length - 1 ? ', today' : ''}` : ''
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const x = ((e.clientX - r.left) / r.width) * width
    const y = ((e.clientY - r.top) / r.height) * h
    let best = -1
    let bd = 18 * 18
    pos.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i } })
    const next = best < 0 ? null : best
    if (next !== sel) setSel(next)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = slots.length
    const from = sel ?? n - 1
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, from + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, from - 1)
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, from + SKY_COLS)
    else if (e.key === 'ArrowUp') next = Math.max(0, from - SKY_COLS)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Enter' && sel !== null && onOpenDay) { e.preventDefault(); onOpenDay(slots[sel].date); return }
    else if (e.key === 'Escape') { setSel(null); return }
    else return
    e.preventDefault()
    setSel(next)
  }

  const share = c.window ? c.kept / c.window : 0
  const restShare = c.window ? c.rest / c.window : 0
  const readout = (
    <div className="sk-read">
      <RatioDial kept={hollow ? 0 : share} rest={hollow ? 0 : restShare} hollow={hollow} />
      <div className="sk-words">
        <p className="sk-headline">
          {hollow
            ? <><span className="sr-num sr-num-hollow" aria-hidden="true">--</span> <span className="sk-of">of the last {win} days</span></>
            : <><span className="sr-num">{c.kept}</span> <span className="sk-of">{skyHeadline(c).replace(/^\d+ /, '')}</span></>}
        </p>
        {!hollow && (
          <div className="sr-sub">
            <span className="sr-kv"><span className="sr-k">rest days</span> {c.rest}</span>
            <span className="sr-kv"><span className="sr-k">untouched</span> {c.none}</span>
            <span className="sr-kv"><span className="sr-k">window</span> {fmtIso(slots[0]?.date ?? end)} to {fmtIso(end)}</span>
          </div>
        )}
        <p className="sr-diff" aria-live="polite">{sel !== null && !hollow ? say(sel) : ' '}</p>
      </div>
    </div>
  )

  return (
    <Housing
      component="SkyLedger" state={state} label={label} reason={reason} readout={readout}
      foot={hollow ? undefined : (
        <ul className="sr-legend" aria-label="Legend">
          <li><svg width="14" height="14" aria-hidden="true"><Star x={7} y={7} /></svg>kept</li>
          <li><svg width="14" height="14" aria-hidden="true"><path className="sk-moon" d={crescentPath(7, 7, 4.6)} /></svg>rest day</li>
          <li><svg width="14" height="14" aria-hidden="true"><circle className="sk-none" cx="7" cy="7" r="1.4" /></svg>untouched</li>
          {lines.length > 0 && <li><svg width="22" height="10" aria-hidden="true"><path className="sk-fig" d="M2 7L10 3L20 6" /></svg>same habit</li>}
        </ul>
      )}
      table={hollow ? undefined : (
        <TableFold
          caption={`${label}: ${skyHeadline(c)}, ${c.rest} rest days`}
          head={['Date', 'Day', 'Habit']}
          rows={() => slots.map((s) => [fmtIso(s.date), KIND_WORD[s.kind], s.kind === 'kept' && s.habit ? s.habit : ''])}
        />
      )}
    >
      <div ref={stageRef} className="sr-stage">
        <Screen
          height={h} planned={state === 'planned'}
          tag={width < 600 ? `${win} days` : `sky · last ${win} days · one star a day`}
          status={<><LampGlyph state={state} size={9} />{LAMP_SPECS[state].label}</>}
        >
          <div
            className="sr-plot"
            {...(hollow
              ? { role: 'img', 'aria-label': `${label}: ${LAMP_SPECS[state].label}, no days drawn` }
              : {
                  role: 'slider', tabIndex: 0, 'aria-label': `${label}, one star per day`,
                  'aria-valuemin': 0, 'aria-valuemax': slots.length - 1, 'aria-valuenow': sel ?? slots.length - 1,
                  'aria-valuetext': say(sel ?? slots.length - 1),
                  onPointerMove: onMove, onPointerLeave: () => setSel(null), onKeyDown: onKey, onBlur: () => setSel(null),
                  onClick: () => { if (sel !== null && onOpenDay) onOpenDay(slots[sel].date) },
                })}
          >
            <svg className="sr-svg sk-svg" width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" focusable="false" data-tone={state}>
              <Dust w={width} h={h} />
              {Array.from({ length: rows }, (_, r) => {
                const first = slots[r * SKY_COLS]
                return (
                  <text key={r} className="sr-svg-label sk-row" x={14} y={PAD_TOP + rowH * (r + 0.5) + 4}>
                    {hollow || !first ? '·' : fmtIso(first.date)}
                  </text>
                )
              })}
              {lines.map((l, k) => <path key={k} className="sk-fig" d={`M${pos[l.a].x} ${pos[l.a].y}L${pos[l.b].x} ${pos[l.b].y}`} />)}
              {pos.map((p, i) => {
                const s = slots[i]
                const kind = hollow || !s ? 'none' : s.kind
                const style = s && fresh.has(s.date) ? ({ ['--sk-fade' as string]: `${SKY_FADE_MS}ms` } as CSSProperties) : undefined
                return (
                  <g key={i} className="sk-day" data-kind={kind} data-fresh={style ? 'true' : undefined} style={style}>
                    {kind === 'kept' && <Star x={p.x} y={p.y} />}
                    {kind === 'rest' && <path className="sk-moon" d={crescentPath(p.x, p.y, 4.6)} />}
                    {kind === 'none' && <circle className="sk-none" cx={p.x} cy={p.y} r={hollow ? 1.6 : 1.3} />}
                  </g>
                )
              })}
              {/* today: a dashed notch ring, the one fixed landmark of the field */}
              {pos.length > 0 && <circle className="sk-today" cx={pos[pos.length - 1].x} cy={pos[pos.length - 1].y} r={9} />}
              {sel !== null && pos[sel] && <circle className="sr-cursor" cx={pos[sel].x} cy={pos[sel].y} r={10} />}
            </svg>
            {sel !== null && pos[sel] && !hollow && <DayCallout x={pos[sel].x} y={pos[sel].y} w={width} text={say(sel)} state={state} />}
          </div>
        </Screen>
      </div>
    </Housing>
  )
}

/** A lit star: a disc with a thin four-point glint (the sigil grammar's cross, at a sixth of the weight). */
function Star({ x, y }: { x: number; y: number }) {
  return (
    <>
      <path className="sk-glint" d={`M${x - 8} ${y}H${x + 8}M${x} ${y - 8}V${y + 8}`} />
      <circle className="sk-star" cx={x} cy={y} r={3.6} />
    </>
  )
}

/** A faint seeded dust of far points: atmosphere, aria-hidden, the same on every drawing, at most 48 of them. */
function Dust({ w, h }: { w: number; h: number }) {
  const pts = useMemo(() => {
    const rnd = mulberry32(fnv1a32(`sky-dust-${Math.round(w / 40)}-${Math.round(h / 40)}`))
    return Array.from({ length: 48 }, () => ({ x: Math.round((LABEL_W + rnd() * (w - LABEL_W)) * 10) / 10, y: Math.round(rnd() * h * 10) / 10, r: rnd() < 0.2 ? 0.8 : 0.45 }))
  }, [w, h])
  return <g className="sk-dust">{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} />)}</g>
}

/** The ratio dial: one ring, the kept share as a solid arc from the top, the rest share as a dashed arc after it. */
function RatioDial({ kept, rest, hollow }: { kept: number; rest: number; hollow: boolean }) {
  const R = 22
  const C = 2 * Math.PI * R
  const k = Math.max(0, Math.min(1, kept))
  const rs = Math.max(0, Math.min(1 - k, rest))
  return (
    <svg className="sk-dial" width="76" height="76" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="sk-dial-track" cx="32" cy="32" r={R} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * 2 * Math.PI
        return <path key={i} className="sk-dial-tick" d={`M${32 + Math.sin(a) * 27} ${32 - Math.cos(a) * 27}L${32 + Math.sin(a) * 30} ${32 - Math.cos(a) * 30}`} />
      })}
      {!hollow && (
        <>
          <circle className="sk-dial-kept" cx="32" cy="32" r={R} strokeDasharray={`${k * C} ${C}`} transform="rotate(-90 32 32)" />
          <circle className="sk-dial-rest" cx="32" cy="32" r={R} strokeDasharray={`0 ${k * C} ${rs * C} ${C}`} transform="rotate(-90 32 32)" />
        </>
      )}
      <circle className={hollow ? 'sk-dial-hub-hollow' : 'sk-dial-hub'} cx="32" cy="32" r="4" />
    </svg>
  )
}

function DayCallout({ x, y, w, text, state }: { x: number; y: number; w: number; text: string; state: LampState }) {
  const W = 176
  const left = Math.max(4, Math.min(w - W - 4, x + 14))
  const top = Math.max(4, y - 50)
  return (
    <div className="sr-callout" style={{ left: x + 14 + W > w ? Math.max(4, x - 14 - W) : left, top, inlineSize: W }} aria-hidden="true">
      <span className="sr-co-val">{text}</span>
      <span className="sr-co-lamp"><LampGlyph state={state} size={10} />{LAMP_SPECS[state].label}</span>
    </div>
  )
}
