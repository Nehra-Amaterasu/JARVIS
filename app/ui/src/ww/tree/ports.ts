// The Tree's one door to the evidence ledger (spec 20.8.4). The page and the drawer read evidence only through a `TreePort`; the
// engine lane's route lands later as a file in `adapters/` (`*.adapter.ts`, default-exporting a port), and until then the null
// adapter answers: no records, state WAITING, and every write refused with its reason. Nothing here shows a number by itself:
// the lamp state of the reading decides (WAITING, PLANNED and FAULT never show one).
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LampState } from '../../shared/lamp'

/** The kinds the ledger accepts. `self` is a self-mark: it can only ever draw CLAIMED, never EVIDENCED. */
export type EvidenceKind = 'drill' | 'timed' | 'artefact' | 'session' | 'certificate' | 'witness' | 'self'

/** Hard kinds (20.8.4): a held-out drill, a logged session, an external certificate or grade. A node needs at least one. */
export const HARD_KINDS: readonly EvidenceKind[] = ['drill', 'session', 'certificate']

export const KIND_WORD: Record<EvidenceKind, string> = {
  drill: 'held-out drill', timed: 'timed practice', artefact: 'artefact', session: 'logged session', certificate: 'certificate', witness: 'witness note (reported)', self: 'self-mark',
}

export interface EvidenceRecord {
  id: string
  nodeId: string
  kind: EvidenceKind
  /** The day it happened, YYYY-MM-DD. */
  at: string
  /** Where it came from, in a few words (a drill id, a file name, a plate). */
  source: string
  /** What it shows, in a few words ("8/10 held out"). */
  detail: string
  weight: number
  /** Set when the student deletes it; the record stays in the table but stops counting. */
  deletedAt: string | null
}

export type NewEvidence = Pick<EvidenceRecord, 'nodeId' | 'kind' | 'source' | 'detail'> & { weight?: number }

export type Outcome = { ok: true } | { ok: false; reason: string }

/** What the ledger said, with the state it says it under. */
export interface LedgerReading {
  state: LampState
  /** Why the state is what it is, in words (shown beside the lamp). */
  reason: string
  records: EvidenceRecord[]
  /** Career gap rows and Study units that cite a node, by node id (empty until those sections write it). */
  usedBy?: Record<string, string[]>
}

export interface TreePort {
  read(): Promise<LedgerReading>
  /** Add a record. A port that cannot write refuses with the reason. */
  add(r: NewEvidence): Promise<Outcome>
  remove(id: string): Promise<Outcome>
  /** True when the port can write at all (a null adapter cannot): the page disables the keys with the reason instead of hiding them. */
  writable: boolean
}

const NULL_REASON = 'No evidence store is connected yet, so nothing is counted.'

/** The null adapter: nothing recorded, nothing guessed. Every node is OPEN or LOCKED and every writing key says why it is off. */
export const nullPort: TreePort = {
  writable: false,
  read: async () => ({ state: 'waiting', reason: NULL_REASON, records: [] }),
  add: async () => ({ ok: false, reason: NULL_REASON }),
  remove: async () => ({ ok: false, reason: NULL_REASON }),
}

const adapters = import.meta.glob<{ default?: TreePort }>('./adapters/*.adapter.ts', { eager: true })

/** The port the page uses: the first real adapter file by path, else the null adapter. */
export function pickPort(mods: Record<string, { default?: TreePort }> = adapters): TreePort {
  for (const p of Object.keys(mods).sort()) {
    const port = mods[p]?.default
    if (port && port !== nullPort && typeof port.read === 'function') return port
  }
  return nullPort
}

export const TREE_PORT: TreePort = pickPort()

export interface Ledger {
  reading: LedgerReading
  /** True until the first read has answered. */
  loading: boolean
  add: (r: NewEvidence) => Promise<Outcome>
  remove: (id: string) => Promise<Outcome>
}

const WAITING_READ: LedgerReading = { state: 'waiting', reason: 'Reading the evidence ledger.', records: [] }

/** Read the port once, and again after every write. */
export function useLedger(port: TreePort): Ledger {
  const [reading, setReading] = useState<LedgerReading>(WAITING_READ)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    try {
      setReading(await port.read())
    } catch {
      setReading({ state: 'fault', reason: 'The evidence ledger did not answer.', records: [] })
    }
    setLoading(false)
  }, [port])
  useEffect(() => {
    let live = true
    setLoading(true)
    port.read().then((r) => { if (live) { setReading(r); setLoading(false) } }, () => { if (live) { setReading({ state: 'fault', reason: 'The evidence ledger did not answer.', records: [] }); setLoading(false) } })
    return () => { live = false }
  }, [port])
  const add = useCallback(async (r: NewEvidence) => { const o = await port.add(r); if (o.ok) await reload(); return o }, [port, reload])
  const remove = useCallback(async (id: string) => { const o = await port.remove(id); if (o.ok) await reload(); return o }, [port, reload])
  return useMemo(() => ({ reading, loading, add, remove }), [reading, loading, add, remove])
}
