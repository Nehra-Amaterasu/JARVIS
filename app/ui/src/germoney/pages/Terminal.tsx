/**
 * Mission → Terminal (log.tsx): "What did you ship today?" Commits, deep-work
 * stamina hours and German hours, +15 XP each; the history is persisted.
 */
import { BookOpen, Clock, GitCommit, Send, Skull, Terminal as TerminalIcon } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../lib/store'
import { useLogStore, type LogType } from '../stores/log-store'
import { useGame } from '../game/store'
import { usePlayerStore } from '../stores/player-store'
import { MissionHeader, useFx } from '../ui'

function when(iso: string): string {
  const t = new Date(iso)
  const k = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const now = new Date()
  const y = new Date()
  y.setDate(now.getDate() - 1)
  if (k(t) === k(now)) return 'TODAY'
  if (k(t) === k(y)) return 'YESTERDAY'
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
}

const TYPES: { id: LogType; label: string; icon: typeof GitCommit; prompt: string }[] = [
  { id: 'commit', label: 'Commit', icon: GitCommit, prompt: 'git push origin main' },
  { id: 'stamina', label: 'Stamina', icon: Clock, prompt: 'log deep-work hours' },
  { id: 'german', label: 'German', icon: BookOpen, prompt: 'log German hours' },
]

export function TerminalPage() {
  const logExecution = usePlayerStore((s) => s.logExecution)
  const entries = useLogStore((s) => s.entries)
  const addEntry = useLogStore((s) => s.addEntry)
  const setTab = useStore((s) => s.setTab)
  const burst = useFx((s) => s.burst)
  const [type, setType] = useState<LogType>('commit')
  const [text, setText] = useState('')
  const [hours, setHours] = useState('')
  const submit = () => {
    if (!text.trim()) return
    // Quarter hours count: 45 minutes of German is a real session.
    const amount = type === 'commit' ? 1 : Math.max(0.25, Math.round((parseFloat(hours) || 1) * 4) / 4)
    logExecution(type, amount)
    useGame.getState().recordLog(type, amount)
    addEntry({ type, text: text.trim(), xp: 15 })
    burst('+15 XP')
    setText('')
    setHours('')
  }
  const meta = TYPES.find((t) => t.id === type)!
  return (
    <div className="mission-page">
      <MissionHeader n="M10" title="Terminal" sub="What did you ship today?" />
      <div className="term-grid">
        <section className="card term">
          <div className="seg">
            {TYPES.map((t) => (
              <button key={t.id} className={type === t.id ? 'on' : ''} onClick={() => setType(t.id)}>
                <t.icon size={13} style={{ marginRight: 6, verticalAlign: -2 }} />{t.label}
              </button>
            ))}
          </div>
          <div className="prompt mono"><TerminalIcon size={13} /> root@silicon-frontier:~$ {meta.prompt}</div>
          {type !== 'commit' && <input className="field" inputMode="decimal" placeholder="Hours spent (0.75 = 45 min)" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} />}
          <textarea className="field area mono" placeholder={type === 'commit' ? 'Describe your commit…' : 'What did you study?'} value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
          <div className="gate-row">
            <span className="mono muted">+15 XP for logging execution · Ctrl Enter</span>
            <span style={{ flex: 1 }} />
            <button className="btn primary" disabled={!text.trim()} onClick={submit}><Send size={14} />Log run</button>
          </div>
          <button className="fail-link" onClick={() => setTab('interrogation')}>
            <Skull size={15} /><span><b>Log a failure →</b><em>Broke a streak? Missed a deadline? Report to interrogation.</em></span>
          </button>
        </section>
        <section className="card">
          <div className="card-head"><span className="card-title">Recent execution</span><span className="mono muted">{entries.length}</span></div>
          {entries.length === 0 && <div className="empty">Nothing logged yet. Ship something.</div>}
          <div className="log-list">
            {entries.slice(0, 40).map((e) => (
              <div key={e.id} className="log-item">
                <div className="mono"><span className="muted">{when(e.date)}</span> <span>[{e.type.toUpperCase()}]</span> <span className="dot xp">+{e.xp}</span></div>
                <p>{e.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
