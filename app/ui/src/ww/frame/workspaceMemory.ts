/**
 * Scene memory (plan 5.7.4 #4): each workspace remembers where you left it, so a switch is a visit,
 * not a reset. Four kinds of thing are kept:
 *   scroll   the centre's scrollTop per workspace (restored without animation)
 *   values   anything a page registers through `useWorkspaceValue(ws, key, initial)`: a selected id,
 *            a view, a filter, an open fold, a draft text
 *   trees    view and selection PER TREE ID, not per workspace, so the Tree's seven trees each come back
 *            as left (plan Obj 10.1, owner question 15 deferred the seven-up overview)
 *   dirty    a workspace is "not default" when any registered value differs from the initial it was
 *            registered with; the tab shows a small static dot for it
 *
 * Kept in sessionStorage (this window's session, like the app's own tab choice) with an in-memory copy,
 * so blocked storage costs the restore across a reload and nothing else. It is a plain module store
 * with subscribe, so a tab reads the dot through useSyncExternalStore and nothing re-renders on scroll.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { session } from '../kit/util'
import type { WsId } from './workspaces'

const KEY = 'ww.frame.memory'

interface Entry {
  v: unknown
  d: unknown
}
export interface TreeScene {
  view?: string
  selection?: string | null
}
interface Mem {
  scroll: Partial<Record<WsId, number>>
  values: Partial<Record<WsId, Record<string, Entry>>>
  trees: Record<string, TreeScene>
}

function load(): Mem {
  try {
    const raw = session.get(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Mem>
      return { scroll: p.scroll ?? {}, values: p.values ?? {}, trees: p.trees ?? {} }
    }
  } catch {
    /* corrupt: start clean */
  }
  return { scroll: {}, values: {}, trees: {} }
}

let mem: Mem = load()
let version = 0
const subs = new Set<() => void>()
const save = () => session.set(KEY, JSON.stringify(mem))
const touch = () => {
  version++
  subs.forEach((f) => f())
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const workspaceMemory = {
  scroll: (ws: WsId): number => mem.scroll[ws] ?? 0,
  setScroll(ws: WsId, top: number): void {
    const n = Math.max(0, Math.round(top))
    if ((mem.scroll[ws] ?? 0) === n) return
    mem.scroll[ws] = n
    save() // a scroll position is not a "scene change": no notify, no dot
  },

  get<T>(ws: WsId, key: string, fallback: T): T {
    const e = mem.values[ws]?.[key]
    return e === undefined ? fallback : (e.v as T)
  },
  /** `initial` is what counts as default for the dirty dot; the first registration wins. */
  set<T>(ws: WsId, key: string, value: T, initial: T): void {
    const bag = (mem.values[ws] ??= {})
    const d = bag[key] ? bag[key].d : initial
    if (bag[key] && same(bag[key].v, value)) return
    bag[key] = { v: value, d }
    save()
    touch()
  },
  isDefault(ws: WsId): boolean {
    return Object.values(mem.values[ws] ?? {}).every((e) => same(e.v, e.d))
  },

  tree: (id: string): TreeScene => mem.trees[id] ?? {},
  setTree(id: string, patch: TreeScene): void {
    mem.trees[id] = { ...mem.trees[id], ...patch }
    save()
    touch()
  },

  subscribe(f: () => void): () => void {
    subs.add(f)
    return () => void subs.delete(f)
  },
  version: () => version,
  /** Forget everything (Setup > reset, and every test). */
  clear(): void {
    mem = { scroll: {}, values: {}, trees: {} }
    save()
    touch()
  },
}

/** One key's stored value as text (undefined when nothing is stored): a stable snapshot for useSyncExternalStore. */
function storedText(ws: WsId, key: string): string | undefined {
  const e = mem.values[ws]?.[key]
  return e === undefined ? undefined : JSON.stringify(e.v)
}

/** True when the workspace has a remembered value that differs from its default. */
export function useSceneDirty(ws: WsId): boolean {
  useSyncExternalStore(workspaceMemory.subscribe, workspaceMemory.version, workspaceMemory.version)
  return !workspaceMemory.isDefault(ws)
}

/**
 * useState that is remembered: the first render reads the stored value, every set writes it through.
 * The setter is stable. Use it for a selected id, a view, a filter or a draft; not for server data.
 */
export function useWorkspaceValue<T>(ws: WsId, key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => workspaceMemory.get(ws, key, initial))
  // A write from outside this component (under shell v2 the frame writes Life's view when the shell's view switch
  // moves, A.N02) is adopted. The snapshot is this one key's stored value as text, so a write to any other key
  // re-renders nothing here, and the component's own write matches the value it already holds (no extra state).
  const stored = useSyncExternalStore(workspaceMemory.subscribe, () => storedText(ws, key), () => storedText(ws, key))
  useEffect(() => {
    if (stored === undefined) return
    const next = JSON.parse(stored) as T
    setValue((cur) => (same(next, cur) ? cur : next))
  }, [stored])
  const set = useCallback(
    (v: T) => {
      setValue(v)
      workspaceMemory.set(ws, key, v, initial)
    },
    // `initial` is read once as the default; a changing literal must not re-create the setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, key],
  )
  return [value, set]
}

/** The same for one tree: view and selection are keyed by the tree's id. */
export function useTreeScene(treeId: string): [TreeScene, (p: TreeScene) => void] {
  useSyncExternalStore(workspaceMemory.subscribe, workspaceMemory.version, workspaceMemory.version)
  return [workspaceMemory.tree(treeId), (p) => workspaceMemory.setTree(treeId, p)]
}
