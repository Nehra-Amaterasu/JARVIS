// The gym session as state, for the Body page's own tray. It is the Forge page's logic (germoney/pages/Forge.tsx) lifted out of that
// page's markup: the same exercise data (EXERCISES, generateSession), the same stores (workout, player, game, plan) and the same
// calls in the same order on save (addSession, recordHours, plan.log 45 min on the body track, markRep), so a session saved here and
// one saved there are the same record and pay the same. Only the screen differs. If Forge.tsx changes how a save pays, change it here too.
import { useCallback, useMemo, useState } from 'react'
import { EXERCISES, MUSCLE_GROUPS, generateSession, type MuscleGroup, type SessionExercise } from '../../../germoney/data/exercises'
import { usePlan } from '../../../germoney/game/plan'
import { useGame } from '../../../germoney/game/store'
import { usePlayerStore } from '../../../germoney/stores/player-store'
import { useWorkoutStore, type WorkoutEntry } from '../../../germoney/stores/workout-store'
import { useFx } from '../../../germoney/ui'

export type Draft = { sets: string; reps: string; weight: string }
export type Stage = 'idle' | 'pick' | 'lift'

/** Digits only for sets and reps, digits and a point for kg: the Forge's own filter. */
export const cleanField = (f: keyof Draft, v: string): string => (f === 'weight' ? v.replace(/[^0-9.]/g, '') : v.replace(/[^0-9]/g, ''))

/** An exercise counts as filled when all three numbers are there (the Forge's own rule). */
export const isFilled = (d: Draft | undefined): boolean => !!d && !!d.sets && !!d.reps && !!d.weight

/** What the last logged numbers of an exercise read as, or the honest "no history yet". */
export function lastLine(last: WorkoutEntry | null): string {
  return last ? `LAST ${last.sets}×${last.reps} @ ${last.weight} kg` : 'LAST: no history yet'
}

export interface GymSession {
  stage: Stage
  muscles: readonly MuscleGroup[]
  selected: ReadonlySet<MuscleGroup>
  session: SessionExercise[] | null
  drafts: Record<string, Draft>
  filled: number
  said: string | null
  vTaper: (m: MuscleGroup) => boolean
  start: () => void
  cancel: () => void
  toggle: (m: MuscleGroup) => void
  build: () => void
  changeMuscles: () => void
  setField: (id: string, f: keyof Draft, v: string) => void
  getLast: (id: string) => WorkoutEntry | null
  save: () => void
}

export function useGymSession(initial: Stage = 'idle'): GymSession {
  const recordHours = usePlayerStore((s) => s.recordHours)
  const getLast = useWorkoutStore((s) => s.getLast)
  const addSession = useWorkoutStore((s) => s.addSession)
  const burst = useFx((s) => s.burst)
  const [stage, setStage] = useState<Stage>(initial)
  const [selected, setSelected] = useState<Set<MuscleGroup>>(new Set())
  const [session, setSession] = useState<SessionExercise[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [said, setSaid] = useState<string | null>(null)

  const toggle = useCallback((m: MuscleGroup) => setSelected((prev) => {
    const n = new Set(prev)
    if (n.has(m)) n.delete(m)
    else n.add(m)
    return n
  }), [])
  const build = useCallback(() => {
    if (!selected.size) return
    const gen = generateSession(MUSCLE_GROUPS.filter((m) => selected.has(m)))
    const seed: Record<string, Draft> = {}
    for (const ex of gen) {
      const last = getLast(ex.id)
      seed[ex.id] = last ? { sets: String(last.sets), reps: String(last.reps), weight: String(last.weight) } : { sets: String(ex.defaultSets), reps: '', weight: '' }
    }
    setDrafts(seed)
    setSession(gen)
    setStage('lift')
    setSaid(null)
  }, [selected, getLast])
  const setField = useCallback((id: string, f: keyof Draft, v: string) => setDrafts((p) => ({ ...p, [id]: { ...(p[id] ?? { sets: '', reps: '', weight: '' }), [f]: cleanField(f, v) } })), [])
  const filled = useMemo(() => session?.filter((ex) => isFilled(drafts[ex.id])).length ?? 0, [session, drafts])

  const save = useCallback(() => {
    if (!session) return
    const entries: WorkoutEntry[] = session.map((ex) => {
      const d = drafts[ex.id]
      return { exerciseId: ex.id, sets: parseInt(d?.sets ?? '', 10), reps: parseInt(d?.reps ?? '', 10), weight: parseFloat(d?.weight ?? '') }
    }).filter((e) => Number.isFinite(e.sets) && Number.isFinite(e.reps) && Number.isFinite(e.weight))
    addSession({ muscles: MUSCLE_GROUPS.filter((m) => selected.has(m)), entries })
    // the one log (it pays the XP); the Body rep ticks now, its ledger entry arrives with the plan event
    recordHours('workout', 1)
    void usePlan.getState().log({ minutes: 45, track: 'body', note: `gym: ${entries.length} exercises` })
    useGame.getState().markRep('body', 'workout', false)
    burst('+10 XP')
    setSession(null)
    setDrafts({})
    setSelected(new Set())
    setStage('idle')
    setSaid(`Session saved: ${entries.length} lift${entries.length === 1 ? '' : 's'}.`)
  }, [session, drafts, selected, addSession, recordHours, burst])

  return {
    stage, muscles: MUSCLE_GROUPS, selected, session, drafts, filled, said,
    vTaper: (m) => EXERCISES[m].some((e) => e.vTaper),
    start: () => { setStage('pick'); setSaid(null) },
    cancel: () => { setStage('idle'); setSession(null); setDrafts({}); setSelected(new Set()) },
    toggle, build,
    changeMuscles: () => { setStage('pick'); setSession(null); setDrafts({}) },
    setField, getLast, save,
  }
}
