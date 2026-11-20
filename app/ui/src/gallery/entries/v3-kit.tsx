// T1, 20 Nov 2026: the specimen of design language v3 (docs/design/design-language-v3.md 2, 6, 8.2). Every piece of
// shared/kit/v3 in every pose, inside a data-look='v3' wrapper, over a bright busy backdrop drawn in CSS (the worst case of
// spec 2.7), on the dark ground and on the light ground, with the glass on and again with the glass off (the default).
//
// FIXTURES, NOT MEASUREMENTS. No number here was read from anything: every number sits on a SIMULATED chip or on a row that
// says it is generated. The pose gallery paints hover, pressed and focus still with [data-demo]; the same pieces answer the
// real pointer, so hover one and compare it with its still.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Chip, Counter, Dial, Gauge, Ground, Group, Key, Ledger, LockedKey, Mark, Plate, PressKey, Sigil, StepLabel, Wall } from '../../shared/kit/v3'
import type { MarkKind } from '../../shared/kit/v3'
import type { GalleryEntryX } from '../types'

type Ground_ = 'dark' | 'light'
type Glass = 'on' | 'off'

const SCENE: CSSProperties = { position: 'relative', isolation: 'isolate', overflow: 'hidden', borderRadius: 18, minWidth: 0, width: '100%' }
const BODY: CSSProperties = { position: 'relative', zIndex: 1, display: 'grid', gap: 16, padding: 16, color: 'var(--ink)', fontFamily: 'var(--f-ui)' }
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))', gap: 16, alignItems: 'start' }
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }
const CAP: CSSProperties = { font: '700 11px/1.2 var(--f-mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink2)', margin: 0 }

function Cell({ pose, children }: { pose: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
      <span style={CAP}>{pose}</span>
      {children}
    </div>
  )
}

const MARKS: MarkKind[] = ['system', 'jarvis', 'aankhen', 'yadaash', 'wellwisher']

function Counters() {
  const [chai, setChai] = useState(0)
  const [water, setWater] = useState(3)
  return (
    <>
      <Counter name="Chai" count={chai} onTap={() => setChai((n) => n + 1)} />
      <Counter name="Water" count={water} onTap={() => setWater((n) => n + 1)} />
      <Counter name="Walk" count={null} onTap={() => undefined} />
    </>
  )
}

function Scene({ ground, glass }: { ground: Ground_; glass: Glass }) {
  const light = ground === 'light'
  const mark = light ? 'bracket' : 'sigil'
  return (
    <div style={SCENE} data-v3-scene={`${ground}-${glass}`} data-look="v3" data-ground={ground} data-glass={glass}>
      <Wall />
      <Ground />
      <div style={BODY}>
        <div style={GRID}>
          <Plate tier="first" step={1} job="WAKE" stepMark={mark} chip={<Chip state="waiting" />} ruler={light ? 'ascii' : 'sigil'} rise={0}>
            <Key accent size="big" caps={['CTRL', 'SHIFT', 'SPACE']}>
              Wake JARVIS
            </Key>
            <Group label="Voice stage" chip={<Chip>MIC · NO LEVEL</Chip>}>
              <div style={{ display: 'grid', placeItems: 'center' }}>
                <Sigil size={150} label="Voice ring, asleep" />
              </div>
            </Group>
          </Plate>
          <Plate tier="second" step={2} job="CONVERSATION" stepMark={mark} chip={<Chip state="simulated" />} rise={1}>
            <Group label="Counters" variant="flat" chip={<Chip state="simulated" />}>
              <Counters />
            </Group>
            <Group label="Ledger">
              <Ledger
                label="One row per state"
                rows={[
                  { id: 'a', label: 'Voice core', reason: 'core not started', state: 'waiting' },
                  { id: 'b', label: 'Sample reading', reason: 'generated sample, preview only', state: 'simulated', value: '0.2' },
                  { id: 'c', label: 'Reminder engine', reason: 'next: the reminder engine', state: 'planned' },
                  { id: 'd', label: 'Steward', reason: 'the steward is not answering, so replies will fail until it is back', state: 'fault', action: <Key accent>Check steward</Key> },
                  { id: 'e', label: 'Clock', reason: 'the system clock', state: 'live' },
                ]}
              />
            </Group>
          </Plate>
          <Plate tier="third" step={3} job="VOICE PATH" stepMark={mark} rise={2} glint="g">
            <div style={ROW}>
              <Dial name="Count" state="waiting" max={10} reason="needs what it heard" size={84} />
              <Dial name="Sample" state="simulated" value={6} max={10} size={84} reason="generated sample" />
            </div>
            <div style={ROW}>
              <Gauge name="GPU memory" state="waiting" max={6} unit="GB" reason="brain not loaded" />
              <Gauge name="GPU memory" state="simulated" value={0.2} max={6} unit="GB" reason="generated sample" />
            </div>
          </Plate>
        </div>

        <Plate tier="second">
          <div style={GRID}>
            <Cell pose="key rest">
              <Key>Open</Key>
            </Cell>
            <Cell pose="key hover">
              <Key pose="hover">Open</Key>
            </Cell>
            <Cell pose="key pressed">
              <Key pose="pressed">Open</Key>
            </Cell>
            <Cell pose="key focus">
              <Key pose="focus">Open</Key>
            </Cell>
            <Cell pose="lit: ON, selected">
              <Key lit toggle>
                Frosted
              </Key>
            </Cell>
            <Cell pose="lit pressed">
              <Key lit toggle pose="pressed">
                Frosted
              </Key>
            </Cell>
            <Cell pose="accent rest">
              <Key accent>Start a block</Key>
            </Cell>
            <Cell pose="accent hover">
              <Key accent pose="hover">
                Start a block
              </Key>
            </Cell>
            <Cell pose="accent pressed">
              <Key accent pose="pressed">
                Start a block
              </Key>
            </Cell>
            <Cell pose="accent focus">
              <Key accent pose="focus">
                Start a block
              </Key>
            </Cell>
            <Cell pose="locked">
              <LockedKey reason="needs the steward to answer first.">Start JARVIS</LockedKey>
            </Cell>
            <Cell pose="locked, hover (no change)">
              <LockedKey reason="nothing is loaded." pose="hover">
                Unload models
              </LockedKey>
            </Cell>
            <Cell pose="icon key">
              <Key size="icon" aria-label="More">
                <span aria-hidden="true">⋯</span>
              </Key>
            </Cell>
            <Cell pose="key caps">
              <span style={ROW}>
                <PressKey>CTRL</PressKey>
                <PressKey>SPACE</PressKey>
              </span>
            </Cell>
            <Cell pose="step label">
              <span style={{ display: 'grid', gap: 8 }}>
                <StepLabel n={1} job="WAKE" mark="sigil" />
                <StepLabel n={2} job="FOLLOW-UPS" mark="bracket" />
              </span>
            </Cell>
            <Cell pose="chips: the five states">
              <span style={{ display: 'grid', gap: 6 }}>
                <Chip state="live" />
                <Chip state="waiting" />
                <Chip state="simulated" />
                <Chip state="planned" />
                <Chip state="fault" />
              </span>
            </Cell>
            <Cell pose="marks">
              <span style={ROW}>
                {MARKS.map((k, i) => (
                  <Mark key={k} kind={k} disc lit={i === 1} label={k} />
                ))}
              </span>
            </Cell>
          </div>
        </Plate>
      </div>
    </div>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'v3/Kit',
    title: 'Design language v3: the kit',
    group: 'kit',
    merged: 'T1, 20 Nov',
    also: ['Plate', 'Group', 'Ledger', 'Chip', 'Key', 'LockedKey', 'PressKey', 'Counter', 'Dial', 'Gauge', 'Sigil', 'Mark', 'StepLabel', 'Ground'],
    note: 'The material of the new look: three graded trays, a recessed group, a ledger, chips, keys in every pose, locked keys with their reason, drawn dials in their WAITING pose, the formed marks. Over a bright busy backdrop, on both grounds, glass on and off. Every number here is a fixture on a SIMULATED chip.',
    states: [
      { label: 'dark ground, glass on', node: <Scene ground="dark" glass="on" /> },
      { label: 'light ground, glass on', node: <Scene ground="light" glass="on" /> },
      { label: 'dark ground, glass off', node: <Scene ground="dark" glass="off" /> },
      { label: 'light ground, glass off', node: <Scene ground="light" glass="off" /> },
    ],
  },
]

export default entries
