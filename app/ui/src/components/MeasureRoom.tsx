/**
 * Aankhen tab: the guided "Measure my room" form and the drill-readiness card.
 * Logic lives in lib/roomMeasure.ts (unit-tested); the server (aankhen/measure.py)
 * validates again, writes room.json with "measured": true and keeps a backup.
 */
import { CheckCircle2, Circle, Ruler, X } from 'lucide-react'
import { useCallback, useEffect, useState, type JSX } from 'react'
import { TOKEN, api } from '../lib/api'
import {
  DOORS, LABELS, OPTIONAL, POINTS, RECTS, WALLS, WALL_NAME, fromServer, parseServerErrors, readinessLine, toPayload,
  type FieldError, type FormText, type Readiness, type Wall,
} from '../lib/roomMeasure'

export function useReadiness(poll = 15000) {
  const [r, setR] = useState<Readiness | null>(null)
  const load = useCallback(async () => {
    try { setR(await api<Readiness>('/api/aankhen/readiness')) } catch { /* keep the last */ }
  }, [])
  useEffect(() => {
    void load()
    const id = window.setInterval(load, poll)
    return () => window.clearInterval(id)
  }, [load, poll])
  return { readiness: r, reload: load }
}

export function ReadinessCard({ r, onMeasure }: { r: Readiness | null; onMeasure: () => void }) {
  return (
    <div className="hud-card glass-thin readiness-card rise" style={{ ['--i' as string]: 4 }}>
      <div className="hc-head"><span className="eyebrow">Before trusting zones</span>
        <span className={`pill ${r?.ready ? 'live' : 'sim'}`}>{r?.ready ? 'ready' : 'not yet'}</span></div>
      <div className="muted rc-line">{readinessLine(r)}</div>
      <ul className="rc-items">
        {(r?.items ?? []).map((i) => (
          <li key={i.id} className={i.ok ? 'ok' : 'todo'} title={i.ok ? i.detail : i.how}>
            {i.ok ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            <span>{i.label}</span>
            {!i.ok && <small className="mono muted">{i.how}</small>}
          </li>
        ))}
      </ul>
      {r && !r.layout_measured && <button className="btn sm" onClick={onMeasure}><Ruler size={12} />Measure my room</button>}
    </div>
  )
}

function Num({ label, value, onChange, err, onFocus }: { label: string; value: string; onChange: (v: string) => void; err?: string; onFocus?: () => void }) {
  return (
    <label className={`mr-num ${err ? 'bad' : ''}`} title={err}>
      <span>{label}</span>
      <span className="mr-in">
        <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} aria-invalid={!!err} />
        <i>cm</i>
      </span>
      {err && <small className="mr-err">{err}</small>}
    </label>
  )
}

const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() !== '' && Number.isFinite(v) ? v : null }

/** Top-down sketch of what has been typed so far, in centimetres. Corner 0 is bottom-left:
 *  Wall A runs along the bottom, Wall B up the left side. The field being typed is drawn
 *  as an orange dimension line, so "gap from Wall B" is never a guess. */
export function RoomSketch({ t, focus }: { t: FormText; focus: string | null }) {
  const W = num(t.width) ?? 400, D = num(t.depth) ?? 300
  const pad = Math.max(W, D) * 0.12
  const Y = (y: number) => D - y                                  // svg y grows downward; room y grows away from Wall A
  const [item, axis] = (focus ?? '').split('.')
  const dim: JSX.Element[] = []
  const line = (x1: number, y1: number, x2: number, y2: number, label: string) => {
    dim.push(<g key={label} className="mr-dim">
      <line x1={x1} y1={Y(y1)} x2={x2} y2={Y(y2)} />
      <text x={(x1 + x2) / 2} y={Y((y1 + y2) / 2) - pad * 0.15} textAnchor="middle">{label}</text>
    </g>)
  }
  if (item === 'width') line(0, 0, W, 0, `Wall A ${W} cm`)
  if (item === 'depth') line(0, 0, 0, D, `Wall B ${D} cm`)
  if ((RECTS as readonly string[]).includes(item)) {
    const r = t.rects[item as (typeof RECTS)[number]]
    const x = num(r.x) ?? 0, y = num(r.y) ?? 0, w = num(r.w) ?? 0, d = num(r.d) ?? 0
    if (axis === 'x') line(0, y + d / 2, x, y + d / 2, `${x} cm`)
    if (axis === 'y') line(x + w / 2, 0, x + w / 2, y, `${y} cm`)
    if (axis === 'w') line(x, y, x + w, y, `${w} cm`)
    if (axis === 'd') line(x, y, x, y + d, `${d} cm`)
  }
  if ((POINTS as readonly string[]).includes(item)) {
    const p = t.points[item as (typeof POINTS)[number]]
    const x = num(p.x) ?? 0, y = num(p.y) ?? 0
    if (axis === 'x') line(0, y, x, y, `${x} cm`)
    if (axis === 'y') line(x, 0, x, y, `${y} cm`)
  }
  const doorSeg = (k: (typeof DOORS)[number]) => {
    const d = t.doors[k]; const o = num(d.offset), w = num(d.width)
    if (o === null || w === null) return null
    const seg = { south: [o, 0, o + w, 0], north: [o, D, o + w, D], west: [0, o, 0, o + w], east: [W, o, W, o + w] }[d.wall]
    if (item === k && axis === 'offset') {
      const from = { south: [0, 0], north: [0, D], west: [0, 0], east: [W, 0] }[d.wall]
      line(from[0], from[1], seg[0], seg[1], `${o} cm`)
    }
    return <line key={k} className="mr-door" x1={seg[0]} y1={Y(seg[1])} x2={seg[2]} y2={Y(seg[3])} />
  }
  return (
    <svg className="mr-sketch" fontSize={Math.max(W, D) * 0.045} viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${D + 2 * pad}`} role="img" aria-label="room sketch">
      <rect className="mr-room" x={0} y={0} width={W} height={D} />
      {RECTS.map((k) => {
        const r = t.rects[k]; const x = num(r.x), y = num(r.y), w = num(r.w), d = num(r.d)
        if (x === null || y === null || !w || !d) return null
        return <g key={k} className={`mr-thing ${item === k ? 'on' : ''}`}>
          <rect x={x} y={Y(y + d)} width={w} height={d} />
          <text x={x + w / 2} y={Y(y + d / 2)} textAnchor="middle" dominantBaseline="middle">{LABELS[k]}</text>
        </g>
      })}
      {DOORS.map(doorSeg)}
      {POINTS.map((k) => {
        const p = t.points[k]; const x = num(p.x), y = num(p.y)
        if (x === null || y === null || x < 0 || y < 0 || x > W || y > D) return null
        return <g key={k} className={`mr-point ${item === k ? 'on' : ''}`}><circle cx={x} cy={Y(y)} r={pad * 0.12} />
          <text x={x} y={Y(y) - pad * 0.25} textAnchor="middle">{k === 'board' ? 'ESP32' : 'router'}</text></g>
      })}
      <circle className="mr-origin" cx={0} cy={Y(0)} r={pad * 0.15} />
      <text className="mr-wall" x={-pad * 0.2} y={Y(0) + pad * 0.6}>corner 0</text>
      <text className="mr-wall" x={W / 2} y={Y(0) + pad * 0.6} textAnchor="middle">Wall A</text>
      <text className="mr-wall" x={-pad * 0.5} y={Y(D / 2)} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.5} ${Y(D / 2)})`}>Wall B</text>
      <text className="mr-wall" x={W / 2} y={-pad * 0.35} textAnchor="middle">Wall C</text>
      <text className="mr-wall" x={W + pad * 0.5} y={Y(D / 2)} textAnchor="middle" transform={`rotate(90 ${W + pad * 0.5} ${Y(D / 2)})`}>Wall D</text>
      {dim}
    </svg>
  )
}

export function MeasureSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (r: Readiness) => void }) {
  const [t, setT] = useState<FormText | null>(null)
  const [errors, setErrors] = useState<FieldError[]>([])
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  useEffect(() => {
    api<{ form: Record<string, unknown> }>('/api/aankhen/room-measure').then((g) => setT(fromServer(g.form))).catch(() => setT(fromServer(null)))
  }, [])
  const errOf = (f: string) => errors.find((e) => e.field === f || e.field.startsWith(f + '.'))?.error
  if (!t) return <div className="teach-sheet glass slide-up measure-sheet" role="dialog" aria-label="Measure my room"><div className="skeleton scan" style={{ height: 80 }} /></div>
  const set = (fn: (d: FormText) => void) => setT((o) => { const d = structuredClone(o!); fn(d); return d })
  const save = async () => {
    const { body, errors: local } = toPayload(t)
    setErrors(local)
    if (local.length) return
    setBusy(true)
    try {
      const res = await fetch('/api/aankhen/room-measure', {
        method: 'POST', headers: { 'X-Jarvis-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErrors(parseServerErrors(j).length ? parseServerErrors(j) : [{ field: '', error: String(j?.error ?? res.statusText) }]); return }
      onSaved(j.readiness)
      onClose()
    } finally { setBusy(false) }
  }
  return (
    <div className="teach-sheet glass slide-up measure-sheet" role="dialog" aria-label="Measure my room">
      <div className="ts-head">
        <div className="ts-title"><Ruler size={16} /><b>Measure my room</b></div>
        <button className="btn icon sm ghost" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <ol className="ts-sub mr-steps">
        <li><b>Pick corner 0:</b> any floor corner you can stand in. Stand there facing into the room.</li>
        <li><b>Wall A</b> is the wall on your <b>right</b>, <b>Wall B</b> the wall on your <b>left</b>. Wall C is opposite A, Wall D opposite B.</li>
        <li>Everything is in <b>centimetres</b>, straight off the tape. "Gap from Wall B" = tape from Wall B to the thing, along the floor, at a right angle.</li>
        <li>For furniture, measure to its corner <b>nearest corner 0</b>. Click a box: the sketch shows that line in orange.</li>
      </ol>
      <div className="mr-layout">
        <RoomSketch t={t} focus={focus} />
        <div className="mr-grid">
          <fieldset><legend>The room</legend>
            <Num label="Wall A length" value={t.width} onFocus={() => setFocus('width')} onChange={(v) => set((d) => { d.width = v })} err={errOf('width')} />
            <Num label="Wall B length" value={t.depth} onFocus={() => setFocus('depth')} onChange={(v) => set((d) => { d.depth = v })} err={errOf('depth')} />
            <Num label="Ceiling height" value={t.height} onFocus={() => setFocus('height')} onChange={(v) => set((d) => { d.height = v })} err={errOf('height')} />
          </fieldset>
          {RECTS.map((k) => (
            <fieldset key={k}><legend>{LABELS[k]}{OPTIONAL.has(k) ? ' (optional)' : ''}</legend>
              {(['x', 'y', 'w', 'd'] as const).map((a) => (
                <Num key={a} label={{ x: 'gap from Wall B', y: 'gap from Wall A', w: 'length along Wall A', d: 'length along Wall B' }[a]} value={t.rects[k][a]}
                  onFocus={() => setFocus(`${k}.${a}`)} onChange={(v) => set((d) => { d.rects[k][a] = v })}
                  err={errOf(`${k}.${a}`) ?? (a === 'x' ? errOf(k) : undefined)} />
              ))}
            </fieldset>
          ))}
          {DOORS.map((k) => (
            <fieldset key={k}><legend>{LABELS[k]}{OPTIONAL.has(k) ? ' (optional)' : ''}</legend>
              <label className="mr-num"><span>on which wall</span>
                <select value={t.doors[k].wall} onFocus={() => setFocus(`${k}.offset`)} onChange={(e) => set((d) => { d.doors[k].wall = e.target.value as Wall })}>
                  {WALLS.map((w) => <option key={w} value={w}>{WALL_NAME[w].long}</option>)}
                </select></label>
              <Num label={`${WALL_NAME[t.doors[k].wall].from} to the door edge`} value={t.doors[k].offset} onFocus={() => setFocus(`${k}.offset`)}
                onChange={(v) => set((d) => { d.doors[k].offset = v })} err={errOf(`${k}.offset`) ?? errOf(`${k}.wall`)} />
              <Num label="door width" value={t.doors[k].width} onFocus={() => setFocus(`${k}.width`)} onChange={(v) => set((d) => { d.doors[k].width = v })} err={errOf(`${k}.width`)} />
            </fieldset>
          ))}
          {POINTS.map((k) => (
            <fieldset key={k}><legend>{LABELS[k]}</legend>
              {(['x', 'y', 'z'] as const).map((a) => (
                <Num key={a} label={{ x: 'gap from Wall B', y: 'gap from Wall A', z: 'height above floor' }[a]} value={t.points[k][a]}
                  onFocus={() => setFocus(`${k}.${a}`)} onChange={(v) => set((d) => { d.points[k][a] = v })} err={errOf(`${k}.${a}`)} />
              ))}
              {k === 'router' && <small className="muted">In another room? A rough guess is fine. Behind Wall A or B means a minus number.</small>}
            </fieldset>
          ))}
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="mr-errors fault" role="alert">{errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.error}</li>)}</ul>
      )}
      <div className="ts-train">
        <span className="muted">Saving marks the layout MEASURED and keeps a backup of the old room.json. Restart Aankhen to redraw the twin.</span>
        <button className="btn sm primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save measured room'}</button>
      </div>
    </div>
  )
}
