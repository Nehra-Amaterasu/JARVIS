// NodeDrawer (T01, spec 20.8.3, scale 3): one node opened from the right edge of the canvas. Top to bottom: name and tier; what it is
// in plain words; Evidence (kind, date, what it shows, delete with a confirm); Needs (the step before, as a chip that jumps); Do next
// (one key); Used by; and a footnote on what evidence counts. Keys: E adds evidence, S starts the do-next action, Esc closes and
// focus goes back to the node. A port that cannot write (the null adapter) leaves every writing key visible and says why it is off.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Button, IconButton } from '../../shared/kit'
import { LAMP_SPECS, showsNumber } from '../../shared/lamp'
import { LampWord } from '../left/LampWord'
import { KIND_WORD, type EvidenceKind, type EvidenceRecord, type LedgerReading, type NewEvidence, type Outcome } from './ports'
import { STATE_MEANS, STATE_WORD, type Derived } from './ledger'
import type { NodeDef, TreeDef } from './model'
import { NodeGlyph } from './SkillNode'

const TIER_WORD = { 1: 'seed', 2: 'skill', 3: 'capstone' } as const
/** What the student can type in here: records the student can attest to. The hard kinds (a held-out drill, a logged session, a certificate)
 *  arrive only through the port, from Study, the session log and Certificates, so nothing typed in this drawer can draw EVIDENCED by
 *  itself, and the weight of a record is the port's to give, never the drawer's. */
const KINDS: EvidenceKind[] = ['artefact', 'timed', 'witness']
const typable = (k: EvidenceKind): boolean => KINDS.includes(k)

/** The one do-next action by tree: which evidence the tree's nodes are best earned by (20.8.3). */
const NEXT_BY_TREE: Record<string, { label: string; kind: EvidenceKind }> = {
  academic: { label: '10-minute drill', kind: 'drill' },
  influence: { label: '10-minute drill', kind: 'drill' },
  languages: { label: 'Log a session', kind: 'session' },
  body: { label: 'Log a session', kind: 'session' },
  social: { label: 'Log a session', kind: 'session' },
  health: { label: 'Log a session', kind: 'session' },
  engineering: { label: 'Attach a project', kind: 'artefact' },
  craft: { label: 'Attach a project', kind: 'artefact' },
  money: { label: 'Attach a project', kind: 'artefact' },
  career: { label: 'Add a certificate', kind: 'certificate' },
}
export const doNext = (tree: string) => NEXT_BY_TREE[tree] ?? { label: 'Log a session', kind: 'session' as EvidenceKind }
/** Where a hard record comes from, said plainly: the drawer cannot type one. */
const HARD_FROM: Partial<Record<EvidenceKind, string>> = {
  drill: 'A held-out drill is recorded from Study, not typed here.',
  session: 'A session is recorded from the session log, not typed here.',
  certificate: 'A certificate is recorded from Certificates, not typed here.',
}

export interface NodeDrawerProps {
  tree: TreeDef
  node: NodeDef
  derived: ReadonlyMap<string, Derived>
  reading: LedgerReading
  writable: boolean
  onAdd: (r: NewEvidence) => Promise<Outcome>
  onRemove: (id: string) => Promise<Outcome>
  onClose: () => void
  onJump: (id: string) => void
  /** Take focus when a node opens (the overlay drawer does; the v3 tray does not, so the canvas keeps the keyboard and the arrows go on working). */
  takeFocus?: boolean
}

function RecordRow({ r, writable, onRemove }: { r: EvidenceRecord; writable: boolean; onRemove: (id: string) => Promise<Outcome> }) {
  const [arm, setArm] = useState(false)
  const [why, setWhy] = useState('')
  return (
    <li className="nd-rec" data-kind={r.kind}>
      <span className="nd-rec-main">
        <span className="nd-rec-kind">{KIND_WORD[r.kind]}</span>
        <span className="nd-rec-detail">{r.detail || r.source}</span>
        <span className="nd-rec-at">{r.at}</span>
      </span>
      <Button size="sm" grouped tone={arm ? 'danger' : 'quiet'} disabledReason={writable ? undefined : 'No store is connected.'}
        onClick={async () => { if (!arm) { setArm(true); return } const o = await onRemove(r.id); if (!o.ok) setWhy(o.reason); setArm(false) }}
        onBlur={() => setArm(false)} aria-label={`${arm ? 'Confirm delete' : 'Delete'} ${KIND_WORD[r.kind]} of ${r.at}`}>{arm ? 'Confirm' : 'Delete'}</Button>
      {why && <span className="nd-why" role="status">{why}</span>}
    </li>
  )
}

export function NodeDrawer({ tree, node, derived, reading, writable, onAdd, onRemove, onClose, onJump, takeFocus = true }: NodeDrawerProps) {
  const d = derived.get(node.id)
  const state = d?.state ?? 'open'
  const root = useRef<HTMLElement>(null)
  const next = doNext(tree.id)
  const [adding, setAdding] = useState<EvidenceKind | null>(null)
  const [detail, setDetail] = useState('')
  const [msg, setMsg] = useState('')
  const prereq = node.prereq ? tree.byId.get(node.prereq) ?? null : null
  const usedBy = reading.usedBy?.[node.id] ?? []
  const counted = showsNumber(reading.state)
  const start: EvidenceKind = typable(next.kind) ? next.kind : 'artefact'
  useEffect(() => { setAdding(null); setDetail(''); setMsg('') }, [node.id])
  useEffect(() => { if (takeFocus) root.current?.focus({ preventScroll: true }) }, [node.id, takeFocus])
  const reasonOff = writable ? undefined : 'No evidence store.'

  const submit = async (kind: EvidenceKind) => {
    if (!typable(kind)) return
    const o = await onAdd({ nodeId: node.id, kind, source: 'typed in the drawer', detail: detail.trim() || KIND_WORD[kind] })
    setMsg(o.ok ? `${KIND_WORD[kind]} added.` : o.reason)
    if (o.ok) { setAdding(null); setDetail('') }
  }
  /** The do-next key: a typable kind opens the add form; a hard one says where the record comes from. */
  const startNext = () => {
    if (!writable) { setMsg(reading.reason); return }
    if (typable(next.kind)) setAdding(next.kind)
    else setMsg(HARD_FROM[next.kind] ?? 'That record comes from another section.')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); if (writable) setAdding((a) => a ?? start); else setMsg(reading.reason) }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); startNext() }
  }
  return (
    <aside ref={root} tabIndex={-1} className="nd ww-insp" role="complementary" aria-label={`Node details: ${node.name}`} data-state={state} onKeyDown={onKey}>
      <header className="nd-head">
        <p className="nd-banner" aria-hidden="true">+--[ {TIER_WORD[node.tier].toUpperCase()} ]--{'-'.repeat(8)}</p>
        <svg className="nd-glyph" viewBox="-30 -30 60 60" width="56" height="56" aria-hidden="true"><NodeGlyph tier={node.tier} state={state} /></svg>
        <div className="nd-title">
          <h3 className="nd-name">{node.name}</h3>
          <p className="nd-sub">{TIER_WORD[node.tier][0].toUpperCase() + TIER_WORD[node.tier].slice(1)} in {node.branch}, {tree.name}</p>
          <p className="nd-state"><b>{STATE_WORD[state]}</b> <span>{STATE_MEANS[state]}</span></p>
        </div>
        <IconButton className="nd-close" label="Close the node (Esc)" size="sm" onClick={onClose}><X size={16} aria-hidden="true" /></IconButton>
      </header>
      <p className="nd-what">A {TIER_WORD[node.tier]} of {node.branch}. {node.tier === 1 ? 'Start here.' : node.tier === 3 ? 'It closes the branch.' : 'It builds on the step before.'}</p>

      <section className="nd-sec" aria-labelledby="nd-ev">
        <h4 id="nd-ev" className="nd-h">Evidence <LampWord state={reading.state} /></h4>
        {counted && d && d.records.length > 0
          ? <ul className="nd-recs">{d.records.map((r) => <RecordRow key={r.id} r={r} writable={writable} onRemove={onRemove} />)}</ul>
          : <p className="nd-empty">{counted ? 'No record on this node yet.' : `${LAMP_SPECS[reading.state].label}: ${reading.reason}`}</p>}
        {adding ? (
          <div className="nd-add" role="group" aria-label="Add evidence">
            <div className="nd-kinds" role="group" aria-label="Kind of evidence">
              {KINDS.map((k) => <button key={k} type="button" aria-pressed={adding === k} className="nd-kind" onClick={() => setAdding(k)}>{KIND_WORD[k]}</button>)}
            </div>
            <input className="ww-input nd-input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What it shows, in a few words" aria-label="What the evidence shows" onKeyDown={(e) => { if (e.key === 'Enter') void submit(adding) }} />
            <div className="nd-add-keys">
              <Button size="md" tone="primary" onClick={() => void submit(adding)}>Add {KIND_WORD[adding]}</Button>
              <Button size="md" onClick={() => setAdding(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="nd-keys">
            <Button size="md" disabledReason={reasonOff} onClick={() => setAdding(start)}>Add evidence (E)</Button>
            <Button size="md" disabledReason={reasonOff} onClick={() => void onAdd({ nodeId: node.id, kind: 'self', source: 'self-mark', detail: 'I think I can do this', weight: 0 }).then((o) => setMsg(o.ok ? 'Marked as claimed. It stays CLAIMED until there is evidence.' : o.reason))}>Self-mark</Button>
          </div>
        )}
        {msg && <p className="nd-msg" role="status">{msg}</p>}
      </section>

      <section className="nd-sec" aria-labelledby="nd-needs">
        <h4 id="nd-needs" className="nd-h">Needs</h4>
        {prereq
          ? <button type="button" className="nd-chip ww-tap" onClick={() => onJump(prereq.id)}><span className="nd-chip-k">{STATE_WORD[derived.get(prereq.id)?.state ?? 'open']}</span>{prereq.name}</button>
          : <p className="nd-empty">Nothing: this is the first step of its branch.</p>}
      </section>

      <section className="nd-sec nd-next" aria-labelledby="nd-next">
        <h4 id="nd-next" className="nd-h">Do next</h4>
        <Button size="lg" tone="primary" disabledReason={reasonOff} onClick={startNext}>{next.label} (S)</Button>
        <p className="nd-empty">{HARD_FROM[next.kind] ?? 'A project counts as evidence together with a logged session or a held-out drill beside it; on its own the node stays IN PROGRESS.'}</p>
      </section>

      <section className="nd-sec" aria-labelledby="nd-used">
        <h4 id="nd-used" className="nd-h">Used by <LampWord state={usedBy.length ? reading.state : 'planned'} /></h4>
        {usedBy.length
          ? <ul className="nd-used">{usedBy.map((u) => <li key={u}>{u}</li>)}</ul>
          : <p className="nd-empty">Nothing cites this node yet. Career gaps and Study units will list here.</p>}
      </section>

      <p className="nd-foot">Counts as evidence: a held-out drill, timed practice, an artefact, a logged session, a certificate, or a witness note (shown as reported). Drills, sessions and certificates come from Study, the session log and Certificates; you type only an artefact, timed practice or a witness note. A self-mark alone stays CLAIMED, and a node needs at least one drill, session or certificate to be EVIDENCED.</p>
    </aside>
  )
}
