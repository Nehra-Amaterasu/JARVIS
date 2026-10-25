/**
 * Mission → Log. ONE log form for time and proof: minutes, a track, the node it
 * was for, a link or a note. It goes to the plan's log (the one writer: XP,
 * hours, the Floor), so voice, the phone and this form all count the same.
 * Below it: the gym (Forge), "what got in the way" (Interrogation), and GitHub
 * proof (Rule 1, the heatmap).
 *
 * Absorbs: Terminal, Forge, Interrogation, Proof.
 */
import { GitCommit, History } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../lib/store'
import { loadBank } from '../data/bank'
import { mins, usePlan } from '../game/plan'
import { useLogStore } from '../stores/log-store'
import { usePlayerStore } from '../stores/player-store'
import { daysSince, EMPTY, MissionHeader } from '../ui'
import { ForgePage } from './Forge'
import { InterrogationPage } from './Interrogation'
import { ProofPage } from './Proof'

type Section = 'log' | 'learning' | 'gym' | 'missed' | 'proof'

const toB64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1] ?? '')
  r.onerror = () => rej(r.error)
  r.readAsDataURL(f)
})

/** "Submit anything productive": free text, minutes, files. Saved privately with a meta.json; XP to the matched node. */
function Learning() {
  const entries = usePlan((s) => s.learning)
  const load = usePlan((s) => s.loadLearning)
  const add = usePlan((s) => s.addLearning)
  const correct = usePlan((s) => s.correctLearning)
  const toast = useStore((s) => s.toast)
  const bank = useMemo(() => loadBank(), [])
  const [what, setWhat] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { void load() }, [load])
  const submit = async () => {
    if (files.some((f) => f.size > 10 * 1024 * 1024)) return toast('Files must be 10 MB or smaller.', 'fault')
    setBusy(true)
    try {
      const payload = await Promise.all(files.slice(0, 6).map(async (f) => ({ name: f.name, data: await toB64(f) })))
      const r = await add({ what: what.trim(), minutes: Number(minutes) || 0, note: note.trim(), tags: tags.split(',').map((t) => t.trim()).filter(Boolean), files: payload })
      toast(r.say, r.ok ? 'live' : 'fault')
      if (r.ok) { setWhat(''); setNote(''); setTags(''); setFiles([]) }
    } finally { setBusy(false) }
  }
  return (
    <>
      <section className="card log-form">
        <textarea className="field" rows={2} placeholder="What did you learn or make? e.g. watched a lecture on systolic arrays" value={what} onChange={(e) => setWhat(e.target.value)} aria-label="What you did" />
        <div className="field-row">
          <label>Minutes <input className="field sm" type="number" min={0} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
          <label>Tags <input className="field" placeholder="lecture, verilog" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          <label>Files <input className="field" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.py,.v,.sv,.vhd,.c,.cpp,.h,.ipynb,.json,.csv,.m,.tcl"
            onChange={(e) => setFiles([...(e.target.files ?? [])])} /></label>
        </div>
        <input className="field" placeholder="Your note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="field-row"><span className="muted small">Saved privately with your files renamed from your words. Also by voice: "Jarvis, log: …".</span><span style={{ flex: 1 }} />
          <button className="btn primary" disabled={busy || !what.trim()} onClick={() => void submit()}>Log it</button></div>
      </section>
      <section className="card">
        <div className="card-head"><span className="card-title"><History size={14} />Learning timeline</span></div>
        {entries?.length === 0 && <p className="muted small">Nothing yet. Anything productive counts.</p>}
        {entries?.map((e) => (
          <div key={e.id} className="log-row small"><span className="mono">{e.date}</span>
            <span>{e.what}{e.minutes ? ` · ${mins(e.minutes)}` : ''}{e.files.length ? ` · ${e.files.length} file${e.files.length > 1 ? 's' : ''}` : ''}</span>
            <select className="field sm" value={e.nodes[0] ?? ''} aria-label="Counted toward node" onChange={(ev) => void correct(e.id, ev.target.value ? [ev.target.value] : [])}>
              <option value="">(no node)</option>
              {[...new Set([...e.nodes, ...e.suggested_nodes.map((s) => s.id)])].filter((id) => bank.nodes[id]).map((id) => <option key={id} value={id}>{bank.nodes[id].name}</option>)}
            </select></div>))}
      </section>
    </>
  )
}

export function LogPage() {
  const tab = useStore((s) => s.tab)
  const initial: Section = tab === 'forge' ? 'gym' : tab === 'interrogation' ? 'missed' : tab === 'proof' ? 'proof' : 'log'
  const [sec, setSec] = useState<Section>(initial)
  const tabs: [Section, string][] = [['log', 'Log time'], ['learning', 'Learning'], ['gym', 'Gym'], ['missed', 'What got in the way'], ['proof', 'GitHub proof']]
  return (
    <div className="mission-page log">
      <MissionHeader n="M4" title="Log" sub="What you did, with proof if you have it. One form; it counts everywhere."
        right={<div className="seg" role="tablist" aria-label="Log section">{tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sec === k} className={`chip ${sec === k ? 'on' : ''}`} onClick={() => setSec(k)}>{l}</button>))}</div>} />
      {sec === 'log' && <><LogForm /><History_ /></>}
      {sec === 'learning' && <Learning />}
      {sec === 'gym' && <div className="embedded"><ForgePage /></div>}
      {sec === 'missed' && <div className="embedded"><InterrogationPage /></div>}
      {sec === 'proof' && <div className="embedded"><ProofPage /></div>}
    </div>
  )
}

function LogForm() {
  const state = usePlan((s) => s.state)
  const log = usePlan((s) => s.log)
  const recordHours = usePlayerStore((s) => s.recordHours)
  const lastCommit = usePlayerStore((s) => s.player.lastCommitDate)
  const toast = useStore((s) => s.toast)
  const bank = useMemo(() => loadBank(), [])
  const tracks = useMemo(() => {
    const rot = Object.values(state?.rotation ?? {}).map((r) => [r.track, r.label] as [string, string])
    return [...rot, ['deutsch', 'German'], ['body', 'Body / gym']] as [string, string][]
  }, [state])
  const [minutes, setMinutes] = useState('45')
  const [track, setTrack] = useState('digital')
  const [node, setNode] = useState('')
  const [proof, setProof] = useState('')
  const [note, setNote] = useState('')
  const [commit, setCommit] = useState(false)
  const [busy, setBusy] = useState(false)
  const nodes = (state?.wip ?? []).filter((id) => bank.nodes[id])
  const since = daysSince(lastCommit)
  const submit = async () => {
    const m = Math.round(Number(minutes))
    if (!Number.isFinite(m) || m <= 0) return toast('How many minutes?', 'fault')
    setBusy(true)
    const r = await log({ minutes: m, track, note: note.trim(), proof: proof.trim(), node: node || null })
    setBusy(false)
    if (!r.ok) return toast(r.say, 'fault')
    recordHours(track === 'deutsch' ? 'german' : track === 'body' ? 'workout' : 'stamina', m / 60)
    if (commit) recordHours('commit', 1)
    useLogStore.getState().addEntry({ type: track === 'deutsch' ? 'german' : commit ? 'commit' : 'stamina', text: `${mins(m)} ${track}${note ? `: ${note}` : ''}`, xp: 0 })
    toast(r.say, 'live')
    setProof('')
    setNote('')
    setCommit(false)
  }
  return (
    <section className="card log-form">
      <div className="field-row">
        <label>Minutes <input className="field sm" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
        <label>Track <select className="field" value={track} onChange={(e) => setTrack(e.target.value)}>{tracks.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>For node <select className="field" value={node} onChange={(e) => setNode(e.target.value)}>
          <option value="">(none)</option>{nodes.map((id) => <option key={id} value={id}>{bank.nodes[id].name}</option>)}</select></label>
      </div>
      <div className="field-row">
        <input className="field" placeholder="Proof link (GitHub, HDLBits, a photo URL): makes it verified" value={proof} onChange={(e) => setProof(e.target.value)} />
        <input className="field" placeholder="Note (what you did)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="field-row">
        <label className="check"><input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} /><GitCommit size={13} /> This included a commit</label>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>Log it</button>
      </div>
      <p className="muted small">10 XP per half hour (up to 60). German 15+ min ticks the Deutsch rep, 25+ min of study the Silicon rep, any gym the Body rep.
        {since !== null ? ` Last commit ${since} day${since === 1 ? '' : 's'} ago.` : ''}</p>
    </section>
  )
}

function History_() {
  const events = usePlan((s) => s.state?.events) ?? EMPTY
  const legacy = useLogStore((s) => s.entries)
  const rows = [...events].filter((e) => e.kind === 'log' || e.kind === 'contract' || e.kind === 'ship' || e.kind === 'node').reverse().slice(0, 25)
  return (
    <section className="card">
      <div className="card-head"><span className="card-title"><History size={14} />Recent</span></div>
      {rows.length === 0 && <p className="muted small">Nothing logged in the new log yet.</p>}
      {rows.map((e) => (
        <div key={e.id} className="log-row small"><span className="mono">{e.date}</span>
          <span>{e.kind === 'contract' ? e.title : e.kind === 'log' ? `${mins(e.minutes ?? 0)} ${e.track}${e.note ? ` · ${e.note}` : ''}` : `${e.kind} · ${e.note ?? e.node ?? ''}`}</span>
          <span className={`mono ${e.verified ? 'live' : 'muted'}`}>+{e.xp ?? 0} XP</span></div>))}
      {legacy.length > 0 && <details><summary className="muted small">Older Terminal entries ({legacy.length})</summary>
        {legacy.slice(-20).reverse().map((l) => <div key={l.id} className="log-row small"><span className="mono">{l.date.slice(0, 10)}</span><span>{l.text}</span><span className="mono muted">+{l.xp} XP</span></div>)}
      </details>}
    </section>
  )
}
