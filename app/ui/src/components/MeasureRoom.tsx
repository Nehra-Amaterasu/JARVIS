/**
 * Aankhen tab: the guided "Measure my room" form and the drill-readiness card.
 * Logic lives in lib/roomMeasure.ts (unit-tested); the server (aankhen/measure.py)
 * validates again, writes room.json with "measured": true and keeps a backup.
 */
import { CheckCircle2, Circle, Ruler, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { TOKEN, api } from '../lib/api'
import {
  DOORS, LABELS, OPTIONAL, POINTS, RECTS, WALLS, fromServer, parseServerErrors, readinessLine, toPayload,
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

function Num({ label, value, onChange, err }: { label: string; value: string; onChange: (v: string) => void; err?: string }) {
  return (
    <label className={`mr-num ${err ? 'bad' : ''}`} title={err}>
      <span>{label}</span>
      <input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!err} />
    </label>
  )
}

export function MeasureSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (r: Readiness) => void }) {
  const [t, setT] = useState<FormText | null>(null)
  const [errors, setErrors] = useState<FieldError[]>([])
  const [busy, setBusy] = useState(false)
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
      <p className="ts-sub muted">Use a tape. Metres from ONE floor corner: x along the first wall, y along the second.
        South is the y = 0 wall, north the far one, west x = 0, east the far one. Heights from the floor.</p>
      <div className="mr-grid">
        <fieldset><legend>Walls</legend>
          <Num label="x wall (width)" value={t.width} onChange={(v) => set((d) => { d.width = v })} err={errOf('width')} />
          <Num label="y wall (depth)" value={t.depth} onChange={(v) => set((d) => { d.depth = v })} err={errOf('depth')} />
          <Num label="ceiling" value={t.height} onChange={(v) => set((d) => { d.height = v })} err={errOf('height')} />
        </fieldset>
        {RECTS.map((k) => (
          <fieldset key={k}><legend>{LABELS[k]}{OPTIONAL.has(k) ? ' (optional)' : ''}</legend>
            {(['x', 'y', 'w', 'd'] as const).map((a) => (
              <Num key={a} label={{ x: 'corner x', y: 'corner y', w: 'along x', d: 'along y' }[a]} value={t.rects[k][a]}
                onChange={(v) => set((d) => { d.rects[k][a] = v })} err={errOf(`${k}.${a}`) ?? (a === 'x' ? errOf(k) : undefined)} />
            ))}
          </fieldset>
        ))}
        {DOORS.map((k) => (
          <fieldset key={k}><legend>{LABELS[k]}{OPTIONAL.has(k) ? ' (optional)' : ''}</legend>
            <label className="mr-num"><span>wall</span>
              <select value={t.doors[k].wall} onChange={(e) => set((d) => { d.doors[k].wall = e.target.value as Wall })}>
                {WALLS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select></label>
            <Num label="from the wall's start" value={t.doors[k].offset} onChange={(v) => set((d) => { d.doors[k].offset = v })} err={errOf(`${k}.offset`) ?? errOf(`${k}.wall`)} />
            <Num label="door width" value={t.doors[k].width} onChange={(v) => set((d) => { d.doors[k].width = v })} err={errOf(`${k}.width`)} />
          </fieldset>
        ))}
        {POINTS.map((k) => (
          <fieldset key={k}><legend>{LABELS[k]}</legend>
            {(['x', 'y', 'z'] as const).map((a) => (
              <Num key={a} label={a === 'z' ? 'height' : a} value={t.points[k][a]} onChange={(v) => set((d) => { d.points[k][a] = v })} err={errOf(`${k}.${a}`)} />
            ))}
          </fieldset>
        ))}
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
