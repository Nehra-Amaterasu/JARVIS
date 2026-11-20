// Invented evidence for the gallery and the tests, every row stamped SIMULATED by the port's own state. Never shown as measured. The
// fixture clock is Wednesday 18 November 2026. Rows are addressed by (tree, branch, node) so a rename of a node never breaks them.
import { TREES, type TreeDef } from './model'
import type { EvidenceRecord, LedgerReading, NewEvidence, Outcome, TreePort } from './ports'

export const FIXTURE_NOW = Date.UTC(2026, 10, 18)

type Row = [tree: string, branch: number, node: number, kind: EvidenceRecord['kind'], at: string, detail: string, weight: number]

/** A handful of trees with records: a branch earned in full, a node in progress, a self-mark, and one stale node (its newest hard
 *  record is older than the tree's refresh window). */
const ROWS: Row[] = [
  ['academic', 0, 0, 'drill', '2026-10-02', 'held-out 8/10', 1],
  ['academic', 0, 1, 'drill', '2026-10-20', 'held-out 7/10', 2],
  ['academic', 0, 2, 'drill', '2026-11-12', 'held-out 8/10', 3],
  ['academic', 1, 0, 'drill', '2026-11-05', 'held-out 9/10', 1],
  ['academic', 1, 1, 'timed', '2026-11-10', 'timed set, 12 of 15', 1],
  ['academic', 2, 0, 'self', '2026-11-14', 'I think I can do this', 0],
  ['languages', 0, 0, 'session', '2026-09-30', 'class session, 60 min', 1],
  ['languages', 0, 1, 'session', '2026-10-14', 'class session, 90 min', 2],
  ['languages', 0, 2, 'certificate', '2026-11-03', 'unit certificate', 3],
  ['languages', 1, 0, 'session', '2026-08-01', 'class session, 60 min', 1],
  ['languages', 1, 1, 'witness', '2026-11-08', 'a friend heard me (reported)', 1],
  ['body', 0, 0, 'session', '2026-11-11', 'trainer-led, 45 min', 1],
  ['body', 4, 0, 'session', '2026-11-04', 'trainer-led, 60 min', 1],
  ['body', 4, 1, 'timed', '2026-11-13', 'timed drill with a partner', 1],
  ['engineering', 0, 0, 'artefact', '2026-10-25', 'a 120-line program', 1],
  ['engineering', 0, 1, 'drill', '2026-11-06', 'held-out 7/10', 2],
  ['engineering', 9, 0, 'artefact', '2026-11-01', 'a first commit history', 1],
  ['engineering', 9, 0, 'session', '2026-11-02', 'review session, 30 min', 1],
  ['career', 0, 0, 'artefact', '2026-11-09', 'a one-page draft', 1],
]

export function fixtureRecords(trees: TreeDef[] = TREES()): EvidenceRecord[] {
  const out: EvidenceRecord[] = []
  ROWS.forEach(([t, b, n, kind, at, detail, weight], i) => {
    const node = trees.find((x) => x.id === t)?.branches[b]?.nodes[n]
    if (node) out.push({ id: `fx-${i + 1}`, nodeId: node.id, kind, at, source: 'invented for the gallery', detail, weight, deletedAt: null })
  })
  return out
}

export interface FixturePortOptions {
  /** `waiting` reads like the null adapter; `empty` is a live ledger with no record yet. */
  mode?: 'records' | 'empty' | 'waiting'
  trees?: TreeDef[]
}

/** An in-memory port that can write, so the gallery and the tests can add a self-mark and delete a record. State SIMULATED. */
export function createFixturePort({ mode = 'records', trees }: FixturePortOptions = {}): TreePort & { all(): EvidenceRecord[] } {
  let rows: EvidenceRecord[] = mode === 'records' ? fixtureRecords(trees) : []
  let seq = 1000
  const reading = (): LedgerReading => mode === 'waiting'
    ? { state: 'waiting', reason: 'No evidence store is connected yet, so nothing is counted.', records: [] }
    : { state: 'simulated', reason: 'Invented rows for the gallery, not your records.', records: rows.map((r) => ({ ...r })) }
  return {
    writable: mode !== 'waiting',
    all: () => rows,
    read: async () => reading(),
    add: async (r: NewEvidence): Promise<Outcome> => {
      if (mode === 'waiting') return { ok: false, reason: 'No evidence store is connected yet, so nothing is counted.' }
      seq += 1
      rows = [...rows, { id: `fx-${seq}`, nodeId: r.nodeId, kind: r.kind, at: '2026-11-18', source: r.source, detail: r.detail, weight: r.kind === 'self' ? 0 : (r.weight ?? 1), deletedAt: null }]
      return { ok: true }
    },
    remove: async (id: string): Promise<Outcome> => {
      if (mode === 'waiting') return { ok: false, reason: 'No evidence store is connected yet, so nothing is counted.' }
      rows = rows.map((r) => (r.id === id ? { ...r, deletedAt: '2026-11-18' } : r))
      return { ok: true }
    },
  }
}
