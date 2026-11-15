// Room, Rules (A.J02, spec 20.9.2): the three standing rules as logic gates, the modes, and the hardware setting. One canvas, no
// document scroll at 1366 x 768 (the content box is 1286 x 652): three gates 640 wide on the left; modes and the relay pin map on the
// right. Below 900 px one column that scrolls inside itself.
//
//   [ROM] presence rule   lights come back when I am here (the built rule, its quiet hours)
//   [ROM] auto-off        an empty room: JARVIS asks aloud, then switches off (the built energy rule; no energy figure)
//   [SEN] away mode       arm by itself when every phone is away; the alert on confirmed motion
//
// Every input shows the lamp of how the app knows it; "last fired" is the app's own record, never a guess. The pin map is
// the RW1 fold (jarvis/room/pins), a hardware setting that needs a second press before anything is saved.
import { useMemo, useState } from 'react'
import { phaseView, type AwayStatus, type Incident } from '../../lib/away'
import { canKeep, type EnergyView } from '../../lib/energy'
import type { LimbsView, PresenceOnView } from '../../lib/limbs'
import { Button, Field, LampGlyph, Switch } from '../../shared/kit'
import { keySlots, slotIds, type HeavyFlags } from './model'
import { GateCard } from './GateCard'
import { ModesPanel } from './ModesPanel'
import { AwayDrawer, EnergyDrawer } from './RoomDrawers'
import { PinMap } from './pins/PinMap'
import { autoOffGate, awayGate, presenceGate } from './gates'
import { useRoomLive, useRoomRules, type RulesLive } from './useRoomLive'
import './room.css'

export interface RoomRulesViewProps {
  view: LimbsView | null
  reload: () => void
  presence: PresenceOnView | null
  energy: EnergyView | null
  away: AwayStatus | null
  incidents: Incident[]
  act: RulesLive['act']
  heavy: HeavyFlags
  setHeavy: (next: HeavyFlags) => void
  now: Date
  simulated?: boolean
  /** Fixtures and tests: the drawers start closed; this opens one. */
  openDrawer?: 'away' | 'energy' | null
}

export function RoomRulesView({ view, reload, presence, energy, away, incidents, act, heavy, setHeavy, now, simulated, openDrawer = null }: RoomRulesViewProps) {
  const [drawer, setDrawer] = useState<'away' | 'energy' | null>(openDrawer)
  const pg = useMemo(() => presenceGate(presence, now), [presence, now])
  const eg = useMemo(() => autoOffGate(energy, now), [energy, now])
  const ag = useMemo(() => awayGate(away, incidents), [away, incidents])
  const s = presence?.settings
  const nudge = energy?.waste.nudges.find(canKeep)
  const phase = away ? phaseView(away) : null

  return (
    <div className="jr jr-kit jr-rules" data-scene="immersive" data-view="rules" data-simulated={simulated ? 'true' : undefined}>
      <div className="jr-gates">
        <GateCard gate={pg}
          lead={s ? <Switch label="Presence rule" checked={s.enabled} onChange={(enabled) => void act.presence({ enabled })} /> : undefined}
          foot={s ? (
            <span className="jr-quiet">
              <span className="jr-note" aria-hidden="true">Quiet</span>
              <Field label="Quiet hours start" kind="time" value={s.quiet_start} onChange={(e) => void act.presence({ quiet_start: e.target.value })} />
              <span className="jr-note" aria-hidden="true">to</span>
              <Field label="Quiet hours end" kind="time" value={s.quiet_end} onChange={(e) => void act.presence({ quiet_end: e.target.value })} />
            </span>
          ) : undefined} />
        <GateCard gate={eg}
          lead={energy ? <Switch label="Auto-off" checked={energy.auto_off} onChange={(enabled) => void act.autoOff(enabled)} /> : undefined}
          foot={(
            <span className="jr-foot-keys">
              {nudge && <Button size="sm" grouped onClick={() => void act.keepNudge(nudge.id)}>Keep it on</Button>}
              <Button size="sm" grouped onClick={() => setDrawer('energy')}>Loads and nudges</Button>
            </span>
          )} />
        <GateCard gate={ag}
          lead={away ? <Switch label="Arm by itself" checked={away.config.auto_arm} onChange={(on) => void act.autoArm(on)} /> : undefined}
          foot={(
            <span className="jr-foot-keys">
              {away && (away.armed
                ? <Button size="sm" grouped tone="danger" onClick={() => void act.disarm()}>Disarm</Button>
                : <Button size="sm" grouped onClick={() => void act.arm()}>Arm now</Button>)}
              <Button size="sm" grouped onClick={() => setDrawer('away')}>Phones and incidents</Button>
              {phase && <span className="jr-note"><LampGlyph state={ag.state} size={11} /> {phase.label}</span>}
            </span>
          )} />
      </div>
      <div className="jr-side">
        {view
          ? <ModesPanel modes={view.modes} devices={view.devices} lastMode={view.last_mode} ids={slotIds(view)} reload={reload} />
          : <section className="jr-modes-panel" aria-label="Modes"><span className="jr-tag">[ROM] MODES</span><p className="jr-note"><LampGlyph state="waiting" size={12} /> WAITING: the app did not answer.</p></section>}
        <HeavyPanel view={view} heavy={heavy} setHeavy={setHeavy} />
        <div className="jr-hw jr-dropup" data-up="true">
          <span className="jr-tag">[ROM] HARDWARE SETTING</span>
          <PinMap v={view} onTested={reload} adapter={null} />
        </div>
      </div>
      <AwayDrawer open={drawer === 'away'} onClose={() => setDrawer(null)} />
      <EnergyDrawer open={drawer === 'energy'} onClose={() => setDrawer(null)} energy={energy} markCircuit={act.markCircuit} keepNudge={act.keepNudge} />
    </div>
  )
}

/** The heavy-load flags again, beside the modes: the same store the keys' Trim writes (the key cover reads it). */
function HeavyPanel({ view, heavy, setHeavy }: { view: LimbsView | null; heavy: HeavyFlags; setHeavy: (n: HeavyFlags) => void }) {
  const slots = useMemo(() => keySlots(view, {}, 0).filter((x) => x.present && x.id), [view])
  return (
    <section className="jr-heavy" aria-label="Heavy loads">
      <header className="jr-panel-head">
        <span className="jr-tag">[ROM] HEAVY LOADS</span>
        <span className="jr-note">A flagged channel needs its cover lifted before it turns ON. OFF is always one press.</span>
      </header>
      {slots.length === 0 && <p className="jr-note"><LampGlyph state="waiting" size={12} /> WAITING: no channel is on the board yet.</p>}
      <div className="jr-heavy-grid">
        {slots.map((x) => (
          <Switch key={x.id} label={`${x.name}: heavy load`} checked={!!heavy[x.id!]}
            onChange={(on) => { const n = { ...heavy }; if (on) n[x.id!] = true; else delete n[x.id!]; setHeavy(n) }} />
        ))}
      </div>
    </section>
  )
}

/** The live Rules view. */
export default function RoomRules() {
  const room = useRoomLive()
  const rules = useRoomRules()
  const now = useMemo(() => new Date(), [rules.presence, rules.energy, rules.away]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <RoomRulesView view={room.view} reload={room.actions.reload} presence={rules.presence} energy={rules.energy} away={rules.away} incidents={rules.incidents} act={rules.act} heavy={room.heavy} setHeavy={room.setHeavy} now={now} />
  )
}
