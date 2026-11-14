// The gallery entries of D05: every state of the four components on fixture data. The fixtures are generated, so every
// reading is stamped SIMULATED (never shown as measured), and the words are neutral ("Unit 3", "Relay 2").
import { useState, type ReactNode } from 'react'
import { Key, TelemetryRail } from '../../kit'
import { CalloutPlate, SpecimenLayout } from './SpecimenLayout'
import { StrataCore } from './StrataCore'
import { SigilMark } from './SigilMark'
import { Rack, RackRow } from './RackRow'
import type { StrataUnit } from './strata'
import type { SigilArm } from './markModel'
import type { RackRowProps } from './RackRow'

/** One fixed clock, so the age text and the pulse are the same on every render and in every screenshot. */
const NOW = 1_700_000_000_000

export const UNITS: StrataUnit[] = [
  { id: 'u1', label: 'Unit 1 Motion', evidence: 0.82, n: 31 },
  { id: 'u2', label: 'Unit 2 Forces', evidence: 0.64, n: 24 },
  { id: 'u3', label: 'Unit 3 Energy', evidence: 0.47, n: 12 },
  { id: 'u4', label: 'Unit 4 Waves', evidence: 0.2, n: 3 },
  { id: 'u5', label: 'Unit 5 Heat', evidence: 0, n: 0 },
  { id: 'u6', label: 'Unit 6 Optics', evidence: 0, n: 0 },
]

const ARM_IDS = ['motion', 'forces', 'energy', 'waves', 'heat', 'optics', 'fields', 'circuits', 'atoms', 'orbits', 'fluids', 'sound', 'light', 'gases', 'waves-2', 'nuclei']
const REC: SigilArm['recent'][] = ['disc', 'disc', 'ring', 'dashed']
export const arms = (n: number): SigilArm[] =>
  ARM_IDS.slice(0, n).map((id, i) => ({ id, length: 0.25 + ((i * 37) % 70) / 100, recent: REC[(i * 3 + 1) % 4], n: (i * 5) % 7 }))

const rows: RackRowProps[] = [
  { device: 'Relay 1', serial: 'RLY-0001', state: 'confirmed', reportedAt: NOW - 20_000, on: true, now: NOW },
  { device: 'Relay 2', serial: 'RLY-0002', state: 'unconfirmed', reportedAt: NOW - 40_000, on: true, now: NOW },
  { device: 'Relay 3', serial: 'RLY-0003', state: 'confirmed', reportedAt: NOW - 14 * 60_000, on: false, now: NOW },
  { device: 'Relay 4', serial: 'RLY-0004', state: 'fault', reportedAt: NOW - 2 * 60_000, reason: 'no answer in 3 s', on: true, now: NOW },
  { device: 'Relay 5', serial: 'RLY-0005', state: 'planned', now: NOW },
  { device: 'Relay 6', serial: 'RLY-0006', state: 'confirmed', now: NOW },
]

function LiveRack() {
  const [on, setOn] = useState<boolean[]>(rows.map((r) => !!r.on))
  return (
    <Rack title="Relay board" note="6 units, fixture data, SIMULATED">
      {rows.map((r, i) => (
        <RackRow key={r.device} {...r} on={on[i]} onToggle={() => setOn((cur) => cur.map((v, j) => (j === i ? !v : v)))} />
      ))}
    </Rack>
  )
}

const SIM = (reason = 'fixture data') => ({ state: 'simulated' as const, reason })

function Demo({ width }: { width?: number }) {
  const plates: ReactNode[] = [
    <CalloutPlate key="a" label="First try" value="62 %" state="simulated" note="last 30 days, weighted" />,
    <CalloutPlate key="b" label="Answered" value={140} state="simulated" note="since Unit 1" />,
    <CalloutPlate key="c" label="Thin layers" value={1} state="simulated" note="Unit 4, fewer than 5 answers" />,
    <CalloutPlate key="d" label="Median block" value="24 min" state="waiting" reason="no sessions logged yet" />,
  ]
  return (
    <SpecimenLayout
      label="Unit strata specimen"
      width={width}
      specimen={<StrataCore units={UNITS} state="simulated" label="Physics units" />}
      callouts={plates}
      anchors={[{ fx: 0.96, fy: 0.12 }, { fx: 0.96, fy: 0.3 }, { fx: 0.96, fy: 0.48 }, { fx: 0.96, fy: 0.66 }]}
      footer={
        <>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <TelemetryRail
              label="Specimen telemetry"
              rows={[
                { id: 'src', label: 'Source', value: 'fixture', ...SIM() },
                { id: 'win', label: 'Window', value: '30 days', ...SIM() },
                { id: 'n', label: 'Answers', value: 140, ...SIM() },
              ]}
            />
          </div>
          <Key label="Open Unit 3" caption onPress={() => undefined} />
        </>
      }
    />
  )
}

/** A realistic container: the stage zooms and wraps states, so a bare component would be squeezed to a card of 130 px. */
function W({ w, children }: { w: number; children: ReactNode }) {
  return <div style={{ width: w, maxWidth: '100%' }}>{children}</div>
}

function Scroller({ children }: { children: ReactNode }) {
  return <div tabIndex={0} role="region" aria-label="Wide specimen, scrolls sideways" style={{ overflowX: 'auto', maxWidth: '100%' }}>{children}</div>
}

export const entries = [
  {
    id: 'data/SpecimenLayout',
    title: 'SpecimenLayout',
    group: 'data' as const,
    note: 'One specimen, callouts on 1 px leaders that bend once at 45 degrees, a datum line with a tick every 40 px, a footer. At 900 px and below it reflows: the specimen first, the callouts a swipe carousel.',
    states: [
      { label: 'desktop, 1302 x 720 (the shell canvas at 1366 x 768)', node: <Scroller><Demo width={1302} /></Scroller> },
      { label: 'reflow, 390 wide', node: <div style={{ width: 358, maxWidth: '100%' }}><Demo width={358} /></div> },
    ],
    also: ['CalloutPlate'],
  },
  {
    id: 'data/StrataCore',
    title: 'StrataCore',
    group: 'data' as const,
    note: 'Units as strata: thickness is evidence. A dashed flat layer has none. Numbers only for LIVE and SIMULATED; every other state draws every layer hollow and says why.',
    states: [
      { label: 'simulated, six units', node: <W w={400}><StrataCore units={UNITS} state="simulated" label="Physics units" /></W> },
      { label: 'live, two units', node: <W w={400}><StrataCore units={UNITS.slice(0, 2)} state="live" label="Two units" /></W> },
      { label: 'hollow: waiting', node: <W w={400}><StrataCore units={UNITS} state="waiting" reason="no answers logged yet" label="Physics units" /></W> },
      { label: 'hollow: planned', node: <W w={400}><StrataCore units={UNITS.slice(0, 3)} state="planned" label="Planned" /></W> },
      { label: 'hollow: fault', node: <W w={400}><StrataCore units={UNITS.slice(0, 3)} state="fault" reason="the question store did not answer" label="Fault" /></W> },
    ],
  },
  {
    id: 'data/SigilMark',
    title: 'SigilMark',
    group: 'data' as const,
    note: 'One arm per topic; arm length is evidence; a disc tip is recent practice, a ring is not recent, a dashed ring is never; an arm forks at three pieces of evidence. The same arms give the same bytes.',
    states: [
      ...[6, 10, 16].map((n) => ({ label: `${n} arms, simulated`, node: <SigilMark arms={arms(n)} size={160} state="simulated" label={`${n} topics`} /> })),
      { label: 'small, 48 px', node: <SigilMark arms={arms(8)} size={48} state="simulated" label="8 topics" /> },
      { label: 'hollow: waiting', node: <SigilMark arms={arms(8)} size={160} state="waiting" reason="no evidence report" label="Topics" /> },
      { label: 'planned', node: <SigilMark arms={[]} size={160} state="planned" label="Topics" /> },
    ],
  },
  {
    id: 'data/RackRow',
    title: 'RackRow',
    group: 'data' as const,
    note: 'A hardware rack unit. The confirmed lamp lights only after the board has reported: a row marked confirmed with no report time draws as "sent, not acknowledged" (Relay 6). Try the rockers: they change the commanded state, never the lamp.',
    states: [
      { label: 'a rack of six units', node: <W w={520}><LiveRack /></W> },
      ...(['unconfirmed', 'confirmed', 'fault', 'planned'] as const).map((s) => ({
        label: s,
        node: <W w={520}><Rack title={s} note="one unit"><RackRow device="Relay 2" serial="RLY-0002" state={s} reportedAt={s === 'planned' ? undefined : NOW - 20_000} reason="no answer in 3 s" on now={NOW} /></Rack></W>,
      })),
    ],
    also: ['Rack'],
  },
]
