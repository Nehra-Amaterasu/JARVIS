/**
 * Setup's one save model (plan 4.9: "a dirty dot per section and a sticky 'Save N changes'; leaving asks").
 *
 * The old drawer had a Save button per section, some sections saved on blur and some on every keystroke, so
 * "was that saved" had four answers. Here a form only edits a DRAFT; nothing reaches the server until
 * saveAll(). A draft that equals the server's value is dropped, so typing a value back is not "a change".
 *
 * The store is module-level on purpose: the Date sheet overlay (O1) and the Setup page edit the same
 * `exams` draft, and switching to Study and back must not throw an hour of typing away (the Frame unmounts
 * the page on a switch). `useFrame.setDirty('setup', ...)` is mirrored by the page so the tab shows the
 * static neutral dot. No timers here: a save is a click, never a debounce.
 */
import { create } from 'zustand'
import { usePlan } from '../../germoney/game/plan'
import {
  DEFAULTS, INPUT_SECTIONS, PLAN_SECTIONS, SECTION_LABEL, loadInputs, putSection,
  type InputSection, type InputsRaw, type SectionId,
} from './inputs'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export type LoadState = 'loading' | 'ready' | 'unavailable'

interface SaveReport {
  saved: SectionId[]
  failed: { id: SectionId; why: string }[]
  /** What the server read but ignored, word for word (normalize_inputs says so; it is shown, not hidden). */
  dropped: string[]
}

interface SetupModel {
  load: LoadState
  /** 'private' when engine-inputs.json is the owner's, 'example' while the engines still read the fictional sample. */
  source: string
  warnings: string[]
  base: Partial<Record<SectionId, unknown>>
  draft: Partial<Record<SectionId, unknown>>
  saving: boolean
  report: SaveReport | null

  refresh: () => Promise<void>
  syncPlan: () => void
  value: <T>(id: SectionId) => T
  edit: (id: SectionId, v: unknown) => void
  discard: (id?: SectionId) => void
  saveAll: (only?: SectionId[]) => Promise<SaveReport>
}

const emptyReport: SaveReport = { saved: [], failed: [], dropped: [] }

/** The plan-side sections read from the plan store (rotation, budget, career, the style half of the profile). */
function planBase(): Partial<Record<SectionId, unknown>> {
  const p = usePlan.getState()
  const out: Partial<Record<SectionId, unknown>> = {}
  if (p.state) {
    out.rotation = { rotation: p.state.rotation, schedule: p.state.schedule }
    out.budget = p.state.budget
    out.career = p.state.career ?? ''
  }
  if (p.profile) out.style = p.profile.style
  return out
}

export const useSetup = create<SetupModel>((set, get) => ({
  load: 'loading',
  source: 'none',
  warnings: [],
  base: {},
  draft: {},
  saving: false,
  report: null,

  refresh: async () => {
    // academics (subject names for the date sheet) and the profile ride along; both are existing plan routes
    void usePlan.getState().loadAcademics()
    void usePlan.getState().loadProfile()
    try {
      const a = await loadInputs()
      const raw: InputsRaw = a?.raw ?? {}
      const base = { ...get().base, ...planBase() }
      for (const k of INPUT_SECTIONS) base[k] = raw[k] ?? DEFAULTS[k]
      set({ base, source: a?.inputs?.source ?? 'none', warnings: a?.inputs?.warnings ?? [], load: 'ready' })
    } catch {
      // the route did not answer: the plan-side sections still work, the input sections say so
      set({ base: { ...get().base, ...planBase() }, load: 'unavailable' })
    }
  },

  syncPlan: () => set({ base: { ...get().base, ...planBase() } }),

  value: <T,>(id: SectionId) => (id in get().draft ? get().draft[id] : id in get().base ? get().base[id] : (DEFAULTS as Record<string, unknown>)[id]) as T,

  edit: (id, v) => {
    const { base, draft } = get()
    const next = { ...draft }
    if (id in base && same(v, base[id])) delete next[id]
    else next[id] = v
    set({ draft: next })
  },

  discard: (id) => {
    if (!id) return set({ draft: {} })
    const next = { ...get().draft }
    delete next[id]
    set({ draft: next })
  },

  saveAll: async (only) => {
    const ids = (Object.keys(get().draft) as SectionId[]).filter((id) => !only || only.includes(id))
    set({ saving: true })
    const report: SaveReport = { ...emptyReport, saved: [], failed: [], dropped: [] }
    const plan = usePlan.getState()
    for (const id of ids) {
      const v = get().draft[id]
      try {
        if ((INPUT_SECTIONS as readonly string[]).includes(id)) {
          const r = await putSection(id as InputSection, v)
          for (const d of r?.dropped ?? []) report.dropped.push(`${SECTION_LABEL[id]}: ${d}`)
        } else if (id === 'rotation') {
          const r = v as { rotation: never; schedule: never }
          await plan.setSettings({ rotation: r.rotation, schedule: r.schedule })
        } else if (id === 'budget') await plan.setSettings({ budget: v as never })
        else if (id === 'career') await plan.setCareer((v as string) || null)
        else if (id === 'style') await plan.saveProfile({ style: v as never })
        report.saved.push(id)
      } catch (e) {
        report.failed.push({ id, why: (e as Error).message || 'the server did not answer' })
      }
    }
    // The plan store's own setters swallow errors, so a plan-side save is only believed once it reads back.
    await get().refresh()
    const draft = { ...get().draft }
    const base = get().base
    for (const id of report.saved) {
      if ((PLAN_SECTIONS as readonly string[]).includes(id) && !same(draft[id], base[id])) {
        report.saved = report.saved.filter((x) => x !== id)
        report.failed.push({ id, why: 'the server did not keep it' })
      } else delete draft[id]
    }
    set({ draft, saving: false, report })
    return report
  },
}))

export const dirtyIds = (draft: Partial<Record<SectionId, unknown>>) => Object.keys(draft) as SectionId[]

/** Tests only. */
export function resetSetupModel(): void {
  useSetup.setState({ load: 'loading', source: 'none', warnings: [], base: {}, draft: {}, saving: false, report: null })
}
