/**
 * The staff: JARVIS's crew of small agents, each watching one thing and saying what
 * it sees (lib/crew.ts). Shared by the Eyes view (narration + who is on duty) and the
 * Core page (a compact roster).
 *
 *   narration      newest on top: time, the agent's glyph, what it said. Simulated
 *                  lines are amber, as everywhere; at most `limit` are kept on screen
 *   on duty        one mini card per agent: name, role, a state LED, its last summary,
 *                  how often it has run and how long a run takes
 *
 * The crew backend may not be running (or not exist yet): the cards say so plainly
 * ("staff not running yet") and keep looking, every 8 s instead of every 2.
 */
import { AlarmClock, AudioLines, Bot, BrainCircuit, ClipboardList, HeartPulse, Home, ScanEye, ShieldCheck, Trophy, Users, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { clock, useNow } from '../lib/format'
import { agentGlyph, fmtMs, loadCrew, mergeFeed, sinceTick, stateTone, type Agent, type CrewLoad, type FeedItem, type Glyph } from '../lib/crew'
import { useStore } from '../lib/store'
import '../styles/staff.css'

const GLYPH: Record<Glyph, typeof Bot> = {
  eyes: ScanEye, energy: Zap, guard: ShieldCheck, memory: BrainCircuit, time: AlarmClock,
  health: HeartPulse, mission: Trophy, voice: AudioLines, home: Home, ledger: ClipboardList, bot: Bot,
}

export interface Crew { load: CrewLoad | null; feed: FeedItem[]; agents: Agent[] }

/** Poll /api/crew while mounted (2 s; 8 s while it is absent or failing), and fold in
 *  crew events from the bus as they arrive. */
export function useCrew(ms = 2000, limit = 8): Crew {
  const [load, setLoad] = useState<CrewLoad | null>(null)
  const events = useStore((s) => s.events)
  useEffect(() => {
    let alive = true
    let timer = 0
    const ctl = new AbortController()
    const tick = async () => {
      try {
        const r = await loadCrew(ctl.signal)
        if (!alive) return
        setLoad(r)
        timer = window.setTimeout(tick, r.status === 'ok' ? ms : 8000)
      } catch { /* aborted: unmounting */ }
    }
    void tick()
    return () => { alive = false; ctl.abort(); window.clearTimeout(timer) }
  }, [ms])
  const polled = load?.status === 'ok' ? load.view.events : null
  const feed = useMemo(() => mergeFeed(polled ?? [], events, limit), [polled, events, limit])
  const agents = load?.status === 'ok' ? load.view.agents : []
  return { load, feed, agents }
}

function AgentGlyph({ a, size = 13 }: { a: { id: string; name?: string; role?: string }; size?: number }) {
  const Icon = GLYPH[agentGlyph(a)]
  return <Icon size={size} strokeWidth={1.8} />
}

/** Why there is nothing to show, in words. null when there is something. */
function absentNote(load: CrewLoad | null): string | null {
  if (!load) return 'Looking for the staff…'
  if (load.status === 'absent') return 'Staff not running yet — JARVIS will list them here when the crew starts.'
  if (load.status === 'error') return `Staff unreachable: ${load.message}`
  return null
}

/* ------------------------------------------------------------------ narration */
export function StaffFeed({ crew }: { crew: Crew }) {
  const byId = useMemo(() => new Map(crew.agents.map((a) => [a.id, a])), [crew.agents])
  const note = absentNote(crew.load)
  if (!crew.feed.length) {
    return <div className="staff-empty muted">{note ?? 'Quiet. Nothing to say yet.'}</div>
  }
  return (
    <ol className="staff-feed" aria-live="polite">
      {crew.feed.map((e, i) => {
        const a = byId.get(e.agent)
        return (
          <li key={e.key} className={`sf-row ${e.sim ? 'sim' : ''} ${i === 0 ? 'newest' : ''}`} style={{ ['--k' as string]: i }}>
            <time className="mono">{clock(e.ts)}</time>
            <span className="sf-glyph" title={a?.name ?? e.agent}><AgentGlyph a={a ?? { id: e.agent }} size={12} /></span>
            <span className="sf-text">{e.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ on duty */
export function StaffRoster({ crew, compact = false }: { crew: Crew; compact?: boolean }) {
  const now = useNow(1000) / 1000
  const note = absentNote(crew.load)
  if (!crew.agents.length) return <div className="staff-empty muted">{note ?? 'No agents on duty.'}</div>
  return (
    <div className={`staff-roster ${compact ? 'compact' : ''}`}>
      {crew.agents.map((a, i) => {
        const tone = stateTone(a.state)
        const tick = sinceTick(a.health, now)
        return (
          <div key={a.id} className={`sr-card ${tone} rise`} style={{ ['--i' as string]: i }} title={a.health.last_error ?? undefined}>
            <div className="sr-head">
              <span className="sr-glyph"><AgentGlyph a={a} /></span>
              <span className="sr-name">{a.name}</span>
              <i className={`sr-led ${tone} ${a.state === 'running' ? 'breathe' : ''}`} aria-label={a.state} />
            </div>
            {!compact && a.role && <div className="sr-role">{a.role}</div>}
            <div className="sr-sum">{a.summary || <span className="muted">—</span>}</div>
            <div className="sr-foot mono">
              <span>{a.health.runs.toLocaleString()} runs</span>
              <span>{fmtMs(a.health.avg_ms)} ms</span>
              {a.health.errors > 0 && <span className="fault">{a.health.errors} err</span>}
              <span className={tick.stale ? 'stale' : ''}>{tick.text}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Header pill: how many are on duty. */
export function StaffPill({ crew }: { crew: Crew }) {
  if (crew.load?.status !== 'ok') return <span className="pill">{crew.load ? 'off duty' : '…'}</span>
  const running = crew.agents.filter((a) => a.state === 'running').length
  const errors = crew.agents.filter((a) => a.state === 'error').length
  return (
    <span className={`pill ${errors ? 'fault' : running ? 'live' : ''}`}>
      {running > 0 && <i className="led" />}{running}/{crew.agents.length} on duty{errors ? ` · ${errors} failing` : ''}
    </span>
  )
}

/* ------------------------------------------------------------------ Core's card */
export function StaffCard() {
  const crew = useCrew(2000, 3)
  return (
    <section className="card staff-card">
      <div className="card-head">
        <span className="card-title"><span className="track">S1</span>Staff</span>
        <StaffPill crew={crew} />
      </div>
      <StaffRoster crew={crew} compact />
      {crew.feed.length > 0 && (
        <div className="staff-card-feed">
          <span className="eyebrow"><Users size={11} /> latest</span>
          <StaffFeed crew={crew} />
        </div>
      )}
    </section>
  )
}
