// The three rules of Room as gates (A.J02, spec 20.9.2: "room.rules is drawn as a logic-gate schematic: each gate shows its last
// real firing"). Pure: each builder turns what a route reported into inputs with their own lamp, an output, and the last time the
// rule really fired, in the app's own words. An input the app does not report is WAITING "not reported", never a guessed LIVE.
import { armedByText, phaseView, type AwayStatus, type Incident } from '../../lib/away'
import type { EnergyView } from '../../lib/energy'
import type { PresenceOnView } from '../../lib/limbs'
import type { Gate, GateInput } from './model'
import { inWindow } from './model'

export function presenceGate(v: PresenceOnView | null, now: Date): Gate {
  if (!v) {
    return { id: 'presence', tag: '[ROM]', title: 'Back on when I am here', inputs: [], output: 'the last mode comes back', lastFired: null, state: 'waiting', reason: 'the presence rule did not answer' }
  }
  const s = v.settings
  const quiet = inWindow(now, s.quiet_start, s.quiet_end)
  const d = v.decision
  const inputs: GateInput[] = [
    d?.decision === 'acted'
      ? { id: 'evidence', label: 'PRESENCE EVIDENCE', holds: true, state: 'live', reason: d.reason }
      : { id: 'evidence', label: 'PRESENCE EVIDENCE', holds: null, state: 'waiting', reason: 'keyboard or mouse, or Aankhen sure; not reported yet' },
    { id: 'quiet', label: `QUIET ${s.quiet_start} TO ${s.quiet_end}`, not: true, holds: quiet === null ? null : !quiet, state: quiet === null ? 'waiting' : 'live', reason: quiet === null ? 'the quiet hours are not readable' : quiet ? 'quiet hours now: nothing comes on' : 'outside quiet hours' },
    { id: 'manual', label: 'SWITCH USED BY HAND', not: true, holds: d?.decision === 'skipped' && (d as { guard?: string }).guard === 'manual' ? false : null, state: d ? 'live' : 'waiting', reason: d ? undefined : 'not reported yet' },
  ]
  return {
    id: 'presence', tag: '[ROM]', title: 'Back on when I am here', inputs, output: 'the last mode (or light and fan) comes back, once per start',
    lastFired: d?.decision === 'acted' ? { at: d.at, text: d.reason } : null,
    state: s.enabled ? 'live' : 'waiting', reason: s.enabled ? `watches ${s.window_min} min after each start` : 'switched off',
  }
}

export function autoOffGate(v: EnergyView | null, now: Date): Gate {
  if (!v) {
    return { id: 'auto-off', tag: '[ROM]', title: 'Auto-off in an empty room', inputs: [], output: 'switches the circuits off', lastFired: null, state: 'waiting', reason: 'the energy route did not answer' }
  }
  const w = v.waste
  const night = inWindow(now, w.config.night.start, w.config.night.end)
  const inputs: GateInput[] = [
    { id: 'empty', label: `EMPTY ${w.config.auto_off_after_min} MIN`, holds: w.status.state === 'empty' || w.status.state === 'wasting' ? true : null, state: v.presence.sim ? 'simulated' : w.status.state ? 'live' : 'waiting', reason: w.status.text },
    { id: 'asked', label: 'ASKED ALOUD FIRST', holds: null, state: 'waiting', reason: 'JARVIS asks before it switches anything off' },
    { id: 'night', label: `NIGHT ${w.config.night.start} TO ${w.config.night.end}`, not: true, holds: night === null ? null : !night, state: night === null ? 'waiting' : 'live', reason: night ? 'night: nothing is switched off' : undefined },
  ]
  const fired = w.nudges.find((n) => n.status === 'auto_off')
  return {
    id: 'auto-off', tag: '[ROM]', title: 'Auto-off in an empty room', inputs, output: 'the circuits are switched off',
    lastFired: fired ? { at: fired.ts, text: fired.text } : null,
    state: v.auto_off ? 'live' : 'waiting', reason: v.auto_off ? 'on' : 'off: JARVIS only asks',
  }
}

export function awayGate(st: AwayStatus | null, incidents: Incident[]): Gate {
  if (!st) {
    return { id: 'away', tag: '[SEN]', title: 'Away mode', inputs: [], output: 'arms the house watch', lastFired: null, state: 'planned', reason: 'away mode is not answering: the server may be an older build' }
  }
  const view = phaseView(st)
  const home = st.phones_home.length
  const inputs: GateInput[] = [
    { id: 'auto', label: 'ARM BY ITSELF', holds: st.config.auto_arm, state: 'live', reason: st.auto_arm.reason },
    { id: 'phones', label: `NO PHONE HOME ${st.config.away_after_min} MIN`, holds: st.phones.length === 0 ? null : home === 0, state: st.phones.length === 0 ? 'waiting' : 'live', reason: st.phones.length === 0 ? 'no family phone is listed' : `${home} of ${st.phones.length} phones home` },
  ]
  const last = incidents[0]
  return {
    id: 'away', tag: '[SEN]', title: `Away mode: ${view.label}`, inputs, output: 'arms; confirmed motion while armed raises the alert',
    lastFired: st.armed_at ? { at: st.armed_at, text: `armed ${armedByText(st.armed_by)}` } : last ? { at: last.started_at, text: `${last.kind}${last.simulated ? ' (simulated)' : ''}: ${last.outcome ?? last.stage}` } : null,
    state: st.armed ? (st.sensor.source === 'hardware' ? 'live' : 'simulated') : 'waiting',
    reason: view.line,
  }
}
