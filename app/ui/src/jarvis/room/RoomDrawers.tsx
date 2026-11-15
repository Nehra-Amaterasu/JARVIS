// The two drawers behind the rules (A.J02, parity R04 and R05). Away mode's phone list, neighbour scan and incident traces are the
// classic AwayModeCard, imported and mounted in a drawer untouched (its routes and its logic are the built ones). The energy
// drawer is new but small: the circuits JARVIS cannot switch (marked on or off by hand, the same route as the classic card) and
// the nudge history. It draws no kWh and no rupee figure: there is no current sensor, so every figure would be an estimate
// (spec 20.9.2 "no energy figure").
import { lazy, Suspense } from 'react'
import { canKeep, nudgeBadge, clockHM, type EnergyView } from '../../lib/energy'
import { Button, LampGlyph, Switch } from '../../shared/kit'
import { CoreDrawer } from '../core/CoreDrawer'
import './room.css'

const AwayModeCard = lazy(() => import('../../components/AwayModeCard').then((m) => ({ default: m.AwayModeCard })))

export function AwayDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <CoreDrawer open={open} onClose={onClose} tag="SEN" title="Away mode">
      <div className="jr-kit jr-drawer-body">
        <p className="jr-note">The full away card: it watches no camera, only Wi-Fi presence of listed phones and Aankhen's sensors. Nothing is recorded while disarmed.</p>
        <Suspense fallback={<p role="status" className="jr-note"><LampGlyph state="waiting" size={12} /> Loading away mode…</p>}>
          {open && <AwayModeCard />}
        </Suspense>
      </div>
    </CoreDrawer>
  )
}

export interface EnergyDrawerProps {
  open: boolean
  onClose: () => void
  energy: EnergyView | null
  markCircuit: (id: string, on: boolean) => Promise<void>
  keepNudge: (id: string) => Promise<void>
}

export function EnergyDrawer({ open, onClose, energy, markCircuit, keepNudge }: EnergyDrawerProps) {
  const circuits = (energy?.circuits.circuits ?? []).filter((c) => !c.switchable)
  const nudges = energy?.waste.nudges ?? []
  return (
    <CoreDrawer open={open} onClose={onClose} tag="ROM" title="Loads and nudges">
      <div className="jr-kit jr-drawer-body">
        {!energy && <p className="jr-note" role="status"><LampGlyph state="waiting" size={12} /> WAITING: the energy route did not answer.</p>}
        <p className="jr-note">No energy figure is drawn: the room has no current sensor, so any wattage would be an estimate, not a reading.</p>
        <h3 className="jr-drawer-h">Loads JARVIS cannot switch</h3>
        <p className="jr-note">Record what you did by hand. JARVIS does not switch these.</p>
        {circuits.length === 0 && <p className="jr-note">None listed.</p>}
        <ul className="jr-drawer-list">
          {circuits.map((c) => (
            <li key={c.id}>
              <Switch label={`${c.name} (${c.room}): ${energy?.states[c.id]?.on ? 'marked on' : 'marked off'}`} checked={!!energy?.states[c.id]?.on} onChange={(on) => void markCircuit(c.id, on)} />
            </li>
          ))}
        </ul>
        <h3 className="jr-drawer-h">Nudges</h3>
        {nudges.length === 0 && <p className="jr-note">No nudges yet. One appears when something stays on in an empty room.</p>}
        <ul className="jr-drawer-list">
          {nudges.slice(0, 8).map((n) => (
            <li key={n.id} className="jr-nudge">
              <span className="jr-nudge-top"><time>{clockHM(n.ts)}</time> <b>{n.sim ? 'SIMULATED, ' : ''}{nudgeBadge(n).text}</b></span>
              <span className="jr-nudge-text">{n.text}</span>
              {canKeep(n) && <Button size="sm" grouped onClick={() => void keepNudge(n.id)}>Keep it on</Button>}
            </li>
          ))}
        </ul>
      </div>
    </CoreDrawer>
  )
}
