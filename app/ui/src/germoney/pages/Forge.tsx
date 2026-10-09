/**
 * Mission → Forge (iron-forge.tsx): choose muscles, get a session with movement
 * variety, log sets × reps × kg against your last numbers ("LAST: 3x10 @ 40kg —
 * BEAT IT"). V-taper movements (lats, side delts) are flagged.
 */
import { Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EXERCISES, MUSCLE_GROUPS, generateSession, type MuscleGroup, type SessionExercise } from '../data/exercises'
import { Alert } from '../platform'
import { useGame } from '../game/store'
import { usePlayerStore } from '../stores/player-store'
import { useWorkoutStore, type WorkoutEntry } from '../stores/workout-store'
import { MissionHeader, NeonBar, useFx } from '../ui'

type Draft = { sets: string; reps: string; weight: string }

export function ForgePage() {
  const logExecution = usePlayerStore((s) => s.logExecution)
  const getLast = useWorkoutStore((s) => s.getLast)
  const addSession = useWorkoutStore((s) => s.addSession)
  const sessions = useWorkoutStore((s) => s.sessions)
  const burst = useFx((s) => s.burst)
  const [selected, setSelected] = useState<Set<MuscleGroup>>(new Set())
  const [session, setSession] = useState<SessionExercise[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  const toggle = (m: MuscleGroup) => setSelected((prev) => {
    const n = new Set(prev)
    if (n.has(m)) n.delete(m)
    else n.add(m)
    return n
  })
  const build = () => {
    if (!selected.size) return
    const muscles = MUSCLE_GROUPS.filter((m) => selected.has(m))
    const gen = generateSession(muscles)
    const seed: Record<string, Draft> = {}
    for (const ex of gen) {
      const last = getLast(ex.id)
      seed[ex.id] = last ? { sets: String(last.sets), reps: String(last.reps), weight: String(last.weight) } : { sets: String(ex.defaultSets), reps: '', weight: '' }
    }
    setDrafts(seed)
    setSession(gen)
  }
  const setField = (id: string, f: keyof Draft, v: string) => {
    const clean = f === 'weight' ? v.replace(/[^0-9.]/g, '') : v.replace(/[^0-9]/g, '')
    setDrafts((p) => ({ ...p, [id]: { ...p[id], [f]: clean } }))
  }
  const logged = useMemo(() => session?.filter((ex) => { const d = drafts[ex.id]; return d && d.sets && d.reps && d.weight }).length ?? 0, [session, drafts])
  const finish = () => {
    if (!session) return
    const entries: WorkoutEntry[] = session.map((ex) => {
      const d = drafts[ex.id]
      return { exerciseId: ex.id, sets: parseInt(d?.sets ?? '', 10), reps: parseInt(d?.reps ?? '', 10), weight: parseFloat(d?.weight ?? '') }
    }).filter((e) => Number.isFinite(e.sets) && Number.isFinite(e.reps) && Number.isFinite(e.weight))
    addSession({ muscles: MUSCLE_GROUPS.filter((m) => selected.has(m)), entries })
    logExecution('workout', 1)
    useGame.getState().recordLog('workout', 1)
    burst('+15 XP')
    setSession(null)
    setDrafts({})
    setSelected(new Set())
    Alert.alert('SESSION LOGGED', 'Session forged. The forge grows stronger.')
  }

  if (!session) {
    return (
      <div className="mission-page">
        <MissionHeader n="M8" title="Forge" sub="Choose your battle. Select the muscles to train." right={<span className="mono muted">{sessions.length} sessions logged</span>} />
        <p className="muted small">V-taper focus: back (lats) and shoulders (side delts) build the width. <Sparkles size={11} /> marks those groups.</p>
        <div className="muscle-grid">
          {MUSCLE_GROUPS.map((m) => {
            const taper = EXERCISES[m].some((e) => e.vTaper)
            return (
              <button key={m} className={`chip big ${selected.has(m) ? 'on' : ''}`} onClick={() => toggle(m)}>
                {m}{taper && <Sparkles size={12} />}
              </button>
            )
          })}
        </div>
        <button className="btn primary power" disabled={!selected.size} onClick={build}>
          {selected.size ? `Generate session (${selected.size})` : 'Select a muscle'}
        </button>
        {sessions.length > 0 && (
          <section className="card" style={{ marginTop: 22 }}>
            <div className="card-head"><span className="card-title">Recent sessions</span></div>
            {sessions.slice(0, 6).map((s) => (
              <div key={s.id} className="row-line"><span className="mono muted">{new Date(s.date).toLocaleDateString()}</span><span>{s.muscles.join(' · ')}</span><span className="mono">{s.entries.length} lifts</span></div>
            ))}
          </section>
        )}
      </div>
    )
  }
  return (
    <div className="mission-page">
      <MissionHeader n="M8" title="Forge" sub={MUSCLE_GROUPS.filter((m) => selected.has(m)).join(' · ')}
        right={<button className="btn sm ghost" onClick={() => { setSession(null); setDrafts({}) }}>‹ Change muscles</button>} />
      <NeonBar progress={session.length ? logged / session.length : 0} />
      <div className="lift-grid">
        {session.map((ex, i) => {
          const last = getLast(ex.id)
          const d = drafts[ex.id] ?? { sets: '', reps: '', weight: '' }
          return (
            <section key={ex.id} className="card lift">
              <div className="lift-head"><span className="mono muted">{String(i + 1).padStart(2, '0')}</span><b>{ex.name}</b>{ex.vTaper && <span className="pill"><Sparkles size={10} />V-taper</span>}</div>
              <span className="mono muted">{ex.muscle} · {ex.defaultSets}×{ex.defaultReps}</span>
              {ex.note && <p className="small muted">{ex.note}</p>}
              <div className={`last mono ${last ? '' : 'muted'}`}>{last ? `LAST: ${last.sets}×${last.reps} @ ${last.weight} kg — beat it` : 'LAST: — no history yet'}</div>
              <div className="num-row">
                {(['sets', 'reps', 'weight'] as const).map((f) => (
                  <label key={f}><span className="eyebrow">{f === 'weight' ? 'kg' : f}</span>
                    <input className="field num" inputMode="decimal" value={d[f]} onChange={(e) => setField(ex.id, f, e.target.value)} /></label>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      <button className="btn primary power" disabled={!logged} onClick={finish}>Forge session ({logged}/{session.length} logged)</button>
    </div>
  )
}
