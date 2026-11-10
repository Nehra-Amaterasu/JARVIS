// O6 Log minutes (plan 4.13): THE one composer. It posts through the plan's log (usePlan.log, the one writer
// for XP, hours and the Floor), exactly as the old Log page's form did, so voice, the phone and this sheet all
// count the same. Opened with openOverlay('log', { track?, node?, minutes? }) from Now's "Other", from
// Study's Log session and from the legacy `terminal` tab id. Primary: Log it.
import { useMemo, useState } from 'react'
import { GitCommit } from 'lucide-react'
import { loadBank } from '../../germoney/data/bank'
import { mins, usePlan } from '../../germoney/game/plan'
import { useLogStore } from '../../germoney/stores/log-store'
import { usePlayerStore } from '../../germoney/stores/player-store'
import { useStore } from '../../lib/store'
import { Field, PrimaryButton } from '../kit'
import { closeOverlay, registerOverlay } from '../frame/overlayRegistry'
import './overlays.css'

export interface LogMinutesProps { track?: string; node?: string; minutes?: number }

export function LogMinutes({ track: t0, node: n0, minutes: m0 }: LogMinutesProps) {
  const state = usePlan((s) => s.state)
  const log = usePlan((s) => s.log)
  const recordHours = usePlayerStore((s) => s.recordHours)
  const toast = useStore((s) => s.toast)
  const bank = useMemo(() => loadBank(), [])
  const tracks = useMemo(() => {
    const rot = Object.values(state?.rotation ?? {}).map((r) => [r.track, r.label] as [string, string])
    return [...rot, ['deutsch', 'German'], ['body', 'Body / gym']] as [string, string][]
  }, [state])
  const [minutes, setMinutes] = useState(String(m0 ?? 45))
  const [track, setTrack] = useState(t0 ?? 'digital')
  const [node, setNode] = useState(n0 ?? '')
  const [proof, setProof] = useState('')
  const [note, setNote] = useState('')
  const [commit, setCommit] = useState(false)
  const [busy, setBusy] = useState(false)
  const nodes = (state?.wip ?? []).filter((id) => bank.nodes[id])
  const m = Math.round(Number(minutes))
  const bad = !Number.isFinite(m) || m <= 0

  const submit = async () => {
    if (bad) return toast('How many minutes?', 'fault')
    setBusy(true)
    const r = await log({ minutes: m, track, note: note.trim(), proof: proof.trim(), node: node || null })
    setBusy(false)
    if (!r.ok) return toast(r.say, 'fault')
    recordHours(track === 'deutsch' ? 'german' : track === 'body' ? 'workout' : 'stamina', m / 60)
    if (commit) recordHours('commit', 1)
    useLogStore.getState().addEntry({ type: track === 'deutsch' ? 'german' : commit ? 'commit' : 'stamina', text: `${mins(m)} ${track}${note ? `: ${note}` : ''}`, xp: 0 })
    toast(r.say, 'live')
    closeOverlay()
  }

  return (
    <div className="ov-body" data-overlay="log">
      <div className="ov-grid">
        <Field label="Minutes" kind="number" min={1} max={600} unit="min" value={minutes} error={bad ? 'Enter a number of minutes above 0.' : undefined} onChange={(e) => setMinutes(e.target.value)} />
        <Field label="Track" kind="select" value={track} onChange={(e) => setTrack(e.target.value)}>
          {tracks.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Field>
        <Field label="For node" kind="select" value={node} onChange={(e) => setNode(e.target.value)}>
          <option value="">none</option>
          {nodes.map((id) => <option key={id} value={id}>{bank.nodes[id].name}</option>)}
        </Field>
      </div>
      <Field label="Proof link" hint="GitHub, HDLBits, a photo URL. A link makes it verified." value={proof} onChange={(e) => setProof(e.target.value)} />
      <Field label="Note" hint="What you did." value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="ov-check">
        <input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} />
        <GitCommit size={14} aria-hidden="true" />This included a commit
      </label>
      <p className="ov-note">10 XP per half hour (up to 60). German 15+ min ticks the Deutsch rep, 25+ min of study the Silicon rep, any gym the Body rep.</p>
      <div className="ov-actions">
        <PrimaryButton claimId="log-it" rank="overlay" loading={busy} onClick={() => void submit()}>Log it</PrimaryButton>
      </div>
    </div>
  )
}

registerOverlay('log', LogMinutes as never)
