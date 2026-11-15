// Console, Crew, "Route" (A.J05, spec 20.9.5, parity C05 and the PLANNED `jarvis.agents` card): who is on the staff and what
// they last said, and below them the route of what is planned. The roster and the narration are the staff routes the
// classic Core page already reads (lib/crew, components/Staff useCrew); nothing is invented, and a staff that is not
// running is one WAITING line, a staff that cannot be reached is FAULT with the message. The route is the planned registry
// (jarvis/planned.ts) as plates on a dashed path: BUILT is solid, BUILT, NOT VERIFIED is half, PLANNED is dashed; pressing a
// plate opens the "What is coming" card (what, what it needs). Agents that act on their own are not built, and the plate says so.
import { Play } from 'lucide-react'
import type { Agent, CrewLoad, FeedItem } from '../../lib/crew'
import { sinceTick } from '../../lib/crew'
import { clock } from '../../lib/format'
import { AsciiBar } from '../../shared/grammar'
import { Lamp, LampGlyph, type LampReading } from '../../shared/lamp'
import type { PlannedEntry } from '../../shared/planned/types'
import { useShell } from '../../shell/store'
import { JARVIS_PLANNED } from '../planned'
import { ConsoleKey, PartHead, RoutePlates, LampLine } from './parts'
import { useCrewLive } from './useConsole'
import { fault, live, routePlates, waiting } from './model'
import './console.css'
import './views.css'

const MAX_AGENTS = 8

export interface CrewViewProps {
  load: CrewLoad | null
  feed: FeedItem[]
  /** Epoch seconds. */
  now: number
  registry?: readonly PlannedEntry[]
  onRun?: (id: string) => void
  onOpenPlate?: (id: string) => void
  simulated?: boolean
}

/** One agent as a lamp: running and idle are what it reported; off is WAITING; an error is FAULT with its last error. */
export function agentReading(a: Agent, now: number): LampReading {
  if (a.state === 'error') return fault(a.health.last_error || a.summary || 'the agent stopped with an error')
  if (a.state === 'off') return waiting('off')
  const t = sinceTick(a.health, now)
  if (t.stale) return waiting(`last check ${t.text}`)
  return live(a.state === 'running' ? 'running' : `idle, checked ${t.text}`)
}

export function CrewView({ load, feed, now, registry = JARVIS_PLANNED, onRun, onOpenPlate, simulated = false }: CrewViewProps) {
  const agents = load?.status === 'ok' ? load.view.agents : []
  const plates = routePlates(registry)
  const built = plates.filter((p) => p.state === 'passed').length
  const status: LampReading = !load
    ? waiting('not asked yet')
    : load.status === 'ok'
      ? (agents.length ? live(`${agents.length} on the staff`) : waiting('the staff has no one on it'))
      : load.status === 'absent' ? waiting('the staff is not running yet') : fault(`the staff cannot be reached: ${load.message}`)
  return (
    <div className="jx jx-crew" data-view="crew" data-simulated={simulated ? 'true' : undefined}>
      <section className="jx-card jx-roster" aria-label="Staff">
        <PartHead tag="STF" title="Staff" stamp={simulated} seed="jarvis.console.staff" right={<Lamp reading={status} showLabel size={12} subject="Staff" />} />
        {agents.length === 0 ? (
          <p className="jx-empty"><span className="jx-tag">[STF]</span> {status.reason}</p>
        ) : (
          <ul className="jx-agents" aria-label="Staff roster">
            {agents.slice(0, MAX_AGENTS).map((a) => {
              const r = agentReading(a, now)
              return (
                <li key={a.id} className="jx-agent" data-state={r.state} data-agent={a.id}>
                  <Lamp reading={r} showLabel={false} subject={a.name} />
                  <span className="jx-agent-name"><b>{a.name}</b><span className="jx-dim">{a.role}</span></span>
                  <span className="jx-agent-say">{a.summary || r.reason}</span>
                  <span className="jx-agent-tick jx-dim">{sinceTick(a.health, now).text}</span>
                  <ConsoleKey label="Run" icon={<Play size={14} />} onPress={() => onRun?.(a.id)} disabledReason={onRun ? undefined : 'no route'} />
                </li>
              )
            })}
          </ul>
        )}
        {agents.length > MAX_AGENTS && <p className="jx-dim">{agents.length - MAX_AGENTS} more on the staff</p>}
      </section>

      <section className="jx-card jx-feed" aria-label="What the staff said">
        <PartHead tag="STF" title="Said" seed="jarvis.console.said" />
        {feed.length === 0 ? (
          <p className="jx-empty"><LampLine reading={waiting('nothing said yet')} subject="Staff feed" /></p>
        ) : (
          <ol className="jx-feed-list" aria-label="Staff narration, newest first">
            {feed.map((f) => (
              <li key={f.key} className="jx-feed-row">
                <time>{clock(f.ts)}</time>
                <span className="jx-tag">[{(f.agent || 'staff').toUpperCase().slice(0, 5)}]</span>
                {f.sim && <LampGlyph state="simulated" size={12} />}
                <span className="jx-feed-text">{f.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="jx-card jx-route-card" aria-label="Route">
        <PartHead tag="PLN" title="Route" seed="jarvis.console.route" right={<span className="jx-dim">press a plate: what it is, what it needs</span>} />
        <div className="jx-route-track">
          <span>built</span>
          <AsciiBar value={built} max={Math.max(1, plates.length)} width={28} head="car" state="live" label="Planned items built" reading={<span className="jx-dim">{built} of {plates.length} on the route</span>} />
        </div>
        <RoutePlates registry={registry} onOpen={onOpenPlate} />
      </section>
    </div>
  )
}

/** The registered view (shell/views/console-crew.view.ts): the staff routes and the shell's roadmap card. */
export default function Crew() {
  const live = useCrewLive()
  return (
    <CrewView
      load={live.load} feed={live.feed} now={live.now} onRun={(id) => void live.run(id)}
      onOpenPlate={(id) => useShell.getState().openOverlay('roadmap', id)}
    />
  )
}
