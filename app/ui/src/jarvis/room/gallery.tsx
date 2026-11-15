// The Room states of the gallery entry J02 (A.J02): every state on invented fixtures, stamped SIMULATED. Loaded lazily by
// gallery/entries/J02.tsx, only where the build holds JARVIS. The box is the real canvas under the shell's view row, drawn at 0.66
// to fit the pane.
import { useMemo, useState, type ReactNode } from 'react'
import { DayRing24 } from './DayRing24'
import { GuardKey } from './GuardKey'
import { fixtureAway, fixtureEnergy, fixtureIncidents, fixturePresence, fixtureRoom, type RoomKind } from './fixtures'
import { RoomRulesView } from './RoomRules'
import { RoomSwitchesView } from './RoomSwitches'
import { heavySummary, rulesFrom, type Asked, type HeavyFlags, type LogLine } from './model'
import './room.css'

const NOW = 1_700_000_000_000
const noop = async () => undefined
const act = { presence: noop, autoOff: noop, keepNudge: noop, markCircuit: noop, arm: noop, disarm: noop, autoArm: noop }
const actions = { press: noop, scene: noop, allOff: noop }

function Box({ children, w = 1286, h = 652, zoom = 0.66 }: { children: ReactNode; w?: number; h?: number; zoom?: number }) {
  return <div style={{ position: 'relative', width: w, height: h, zoom, overflow: 'hidden', background: 'var(--surface-ground)' }} data-scene="immersive">{children}</div>
}

const log: LogLine[] = [
  { id: 4, at: NOW, text: 'confirmed by board: Tube light ON', state: 'live' },
  { id: 3, at: NOW - 4000, text: 'asked: Tube light ON', state: 'waiting' },
  { id: 2, at: NOW - 90_000, text: 'asked, no report: Corner light ON', state: 'fault' },
]

export type J02State = 'switches' | 'asked' | 'offline' | 'virtual' | 'rules' | 'rules-waiting' | 'keys' | 'ring' | 'phone'

export function J02State({ state }: { state: J02State }) {
  const [heavy, setHeavy] = useState<HeavyFlags>({ light3: true })
  const rules = useMemo(() => rulesFrom({ presence: fixturePresence(), energy: fixtureEnergy() }), [])
  const clock = useMemo(() => new Date(2026, 10, 15, 14, 2), [])
  const sw = (kind: RoomKind, asked: Record<string, Asked> = {}) => (
    <Box>
      <RoomSwitchesView view={fixtureRoom(kind)} asked={asked} now={NOW} log={log} heavy={heavy} setHeavy={setHeavy} actions={actions} rules={rules} simulated />
    </Box>
  )
  switch (state) {
    case 'switches': return sw('live')
    case 'asked': return sw('live', { fan: { want: true, at: NOW - 2000 }, light5: { want: true, at: NOW - 9000 } })
    case 'offline': return sw('offline')
    case 'virtual': return sw('virtual')
    case 'rules':
      return (
        <Box>
          <RoomRulesView view={fixtureRoom('live')} reload={() => undefined} presence={fixturePresence()} energy={fixtureEnergy(true)} away={fixtureAway(true)} incidents={fixtureIncidents} act={act} heavy={heavy} setHeavy={setHeavy} now={clock} simulated />
        </Box>
      )
    case 'rules-waiting':
      return (
        <Box>
          <RoomRulesView view={fixtureRoom('offline')} reload={() => undefined} presence={null} energy={null} away={null} incidents={[]} act={act} heavy={heavy} setHeavy={setHeavy} now={clock} simulated />
        </Box>
      )
    case 'keys':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 150px)', gridAutoRows: '104px', gap: 10, padding: 12 }} data-scene="immersive" className="jr-kit">
          <GuardKey heavy={false} summary="" state="closed" slot={1} name="Tube light" kind="light" on lamp="live" word="ON, board report" onPress={() => undefined} />
          <GuardKey heavy summary={heavySummary('Water heater')} state="closed" slot={2} name="Water heater" kind="light" on={false} lamp="live" word="OFF, board report" onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="asked" slot={3} name="Ceiling fan" kind="fan" on={false} lamp="waiting" word="asked ON, waiting" onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="unconfirmed" slot={4} name="Corner light" kind="light" on={false} lamp="fault" word="asked, no report" onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="confirmed" slot={5} name="Desk lamp" kind="light" on lamp="live" word="ON, confirmed by board 14:02:11" onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="closed" slot={6} name="Cove soft" kind="light" on={false} lamp="live" word="OFF, board report" preview onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="closed" slot={7} name="free" kind={null} on={false} lamp="planned" word="unavailable" absent onPress={() => undefined} />
          <GuardKey heavy={false} summary="" state="closed" slot={8} name="free" kind={null} on={false} lamp="planned" word="unavailable" absent onPress={() => undefined} />
        </div>
      )
    case 'ring':
      return (
        <div style={{ display: 'flex', gap: 24, padding: 12, flexWrap: 'wrap' }} data-scene="immersive" className="jr-kit">
          <DayRing24 rules={rules} now={clock} />
          <DayRing24 rules={[]} now={clock} />
        </div>
      )
    case 'phone':
      return (
        <div style={{ position: 'relative', width: 358, height: 640, zoom: 0.8, overflow: 'hidden', background: 'var(--surface-ground)' }} data-scene="immersive">
          <RoomSwitchesView view={fixtureRoom('live')} asked={{}} now={NOW} log={log} heavy={heavy} setHeavy={setHeavy} actions={actions} rules={rules} simulated />
        </div>
      )
  }
}
