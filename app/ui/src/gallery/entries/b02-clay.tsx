// The clay kit (B03b): the hardware family (switch, rocker, key, knob, plate), the readouts and the frames. Every one of
// these draws its state with the lamp vocabulary, and a control that cannot act says why instead of looking pressed.
import { useState } from 'react'
import { Search } from 'lucide-react'
import * as kit from '../../shared/kit'
import { LAMP_STATES } from '../../shared/lamp'
import type { GalleryEntryX } from '../types'
import { STATE_REASON, States, noop, read } from '../fixtures'

const merged = 'kit move, 12 and 13 Nov'
const icon = <Search size={20} />

function SwitchDemo() {
  const [on, setOn] = useState(true)
  return <><kit.Switch label="Lights" checked={on} onChange={setOn} /> <kit.Switch label="Fan" checked={false} onChange={noop} confirmed /></>
}
function RockerDemo() {
  const [on, setOn] = useState(true)
  return <kit.Rocker label="Master" on={on} onChange={setOn} />
}
function MuteKey() {
  const [pressed, setPressed] = useState(false)
  return <kit.Key label="Mute" caption pressed={pressed} onPress={() => setPressed(!pressed)} icon={icon} />
}
function SliderDemo() {
  const [n, setN] = useState(40)
  return <kit.TickSlider label="Brightness" value={n} onChange={setN} unit="%" withNumber />
}
function KnobDemo() {
  const [n, setN] = useState(40)
  return <><kit.Knob label="Volume" value={n} onChange={setN} unit="%" /> <kit.Knob label="Trim" size="compact" value={30} onChange={noop} /></>
}
function TabsDemo() {
  const [tab, setTab] = useState('t1')
  return <kit.FolderTabs label="Views" value={tab} onChange={setTab} onPlanned={noop} tabs={[{ id: 't1', label: 'One', count: 3 }, { id: 't2', label: 'Two' }, { id: 't3', label: 'Soon', planned: true }]} />
}

const PALETTE: kit.PaletteItem[] = [
  { id: 'p1', group: 'Go', label: 'Open core', hint: 'G C' },
  { id: 'p2', group: 'Do', label: 'Start a session' },
  { id: 'p3', group: 'Ask', label: 'Ask the room', planned: true },
]
const LOG: kit.ConsoleLine[] = [
  { id: 'l1', tag: 'CORE', at: '12:00:01', text: 'core started' },
  { id: 'l2', tag: 'EYES', at: '12:00:03', text: 'sample frame', kind: 'sim' },
  { id: 'l3', tag: 'LIMB', at: '12:00:04', text: 'relay did not answer', kind: 'fault' },
]

const entries: GalleryEntryX[] = [
  {
    id: 'kit/Stat', title: 'Stat', group: 'kit', merged, note: 'A number with its lamp; unmeasured shows the way to measure it.',
    states: [
      { label: 'five states', node: <States>{(s) => <kit.Stat label={`Hours ${s}`} value={42} unit="h" reading={read(s, STATE_REASON[s])} />}</States> },
      { label: 'not measured', node: <kit.Stat label="Papers" value={null} reading={read('waiting', 'no report')} /> },
      { label: 'zero with a next step', node: <kit.Stat label="Drills" value={0} next="Start one drill" reading={read('live')} /> },
    ],
  },
  {
    id: 'kit/Meter', title: 'Meter', group: 'kit', merged, note: 'A fill against a goal; no fill without a reading.',
    states: [
      { label: 'five states', node: <States>{(s) => <kit.Meter label={`Coverage ${s}`} value={0.6} reading={read(s, STATE_REASON[s])} />}</States> },
      { label: 'not measured', node: <kit.Meter label="Retention" value={null} reading={read('waiting', 'no report')} /> },
    ],
  },
  {
    id: 'kit/Row', title: 'Row', group: 'kit', merged, note: 'A list row. Behind and overdue use a word as well as a colour.',
    states: [
      { label: 'default', node: <kit.Row title="Signals and systems" meta="Unit 3, 12 questions" /> },
      { label: 'done', node: <kit.Row title="Lab record" meta="handed in" state="done" /> },
      { label: 'behind', node: <kit.Row title="Control theory" meta="2 of 5 units" state="behind" /> },
      { label: 'overdue', node: <kit.Row title="Assignment 4" meta="was due on Monday" state="overdue" /> },
    ],
  },
  {
    id: 'kit/Spark', title: 'Spark', group: 'kit', merged, note: 'A trend line. With no history it says so.',
    states: [
      { label: 'history', node: <kit.Spark label="Minutes per day" points={[10, 25, 15, 40, 30, 55, 45]} /> },
      { label: 'no history', node: <kit.Spark label="Minutes per day" points={[]} /> },
    ],
  },
  {
    id: 'kit/StageStrip', title: 'StageStrip', group: 'kit', merged, note: 'A pipeline in four stages; an unknown stage is drawn as unknown.',
    states: [{ label: 'stages', node: <kit.StageStrip label="Paper pipeline" stages={[{ id: 'a', label: 'Collected', count: 12, state: 'done' }, { id: 'b', label: 'Tagged', count: 7, state: 'current' }, { id: 'c', label: 'Practised', state: 'todo' }, { id: 'd', label: 'Reviewed', state: 'unknown' }]} /> }],
  },
  {
    id: 'kit/Lamp', title: 'Lamp (kit)', group: 'kit', merged, also: ['LampGlyph'], note: "The kit's own lamp, the same five states as the lamp package.",
    states: [
      { label: 'five states with word', node: <States>{(s) => <kit.Lamp state={s} reason={STATE_REASON[s]} />}</States> },
      { label: 'bare, size 16', node: <States>{(s) => <kit.Lamp state={s} bare size={16} />}</States> },
      { label: 'glyph only', node: <States>{(s) => <kit.LampGlyph state={s} size={24} />}</States> },
    ],
  },
  {
    id: 'kit/Switch', title: 'Switch', group: 'kit', merged, note: 'On and off by word and position. A switch that cannot act gives the reason.',
    states: [
      { label: 'on and off', node: <SwitchDemo /> },
      { label: 'planned', node: <kit.Switch label="Heater" checked={false} onChange={noop} planned onPlanned={noop} /> },
      { label: 'error', node: <kit.Switch label="Relay" checked onChange={noop} error="relay did not answer" /> },
      { label: 'disabled with reason', node: <kit.Switch label="Pump" checked={false} onChange={noop} disabledReason="needs the board" /> },
    ],
  },
  {
    id: 'kit/Rocker', title: 'Rocker', group: 'kit', merged, note: 'The master switch: two halves, one pressed.',
    states: [
      { label: 'working', node: <RockerDemo /> },
      { label: 'planned', node: <kit.Rocker label="Planned rocker" on={false} onChange={noop} planned onPlanned={noop} /> },
      { label: 'error', node: <kit.Rocker label="Faulty rocker" on onChange={noop} error="no answer" /> },
      { label: 'disabled with reason', node: <kit.Rocker label="Held rocker" on={false} onChange={noop} disabledReason="locked by rule" /> },
    ],
  },
  {
    id: 'kit/Key', title: 'Key', group: 'kit', merged, note: 'A keycap. The one accent-filled key of a view is its primary action.',
    states: [
      { label: 'plain and caption', node: <><kit.Key label="Go" onPress={noop} icon={icon} /> <kit.Key label="Search" caption onPress={noop} icon={icon} /></> },
      { label: 'toggle', node: <MuteKey /> },
      { label: 'loading', node: <kit.Key label="Save" caption loading onPress={noop} icon={icon} /> },
      { label: 'planned', node: <kit.Key label="Plan" caption planned onPlanned={noop} onPress={noop} icon={icon} /> },
      { label: 'error', node: <kit.Key label="Send" caption error="send failed" onPress={noop} icon={icon} /> },
      { label: 'disabled with reason', node: <kit.Key label="Wait" caption disabledReason="needs a card" onPress={noop} icon={icon} /> },
    ],
  },
  {
    id: 'kit/TickSlider', title: 'TickSlider', group: 'kit', merged, note: 'A slider with ticks, keyboard stepped, the number optional.',
    states: [
      { label: 'working with number', node: <SliderDemo /> },
      { label: 'planned', node: <kit.TickSlider label="Planned level" value={20} onChange={noop} planned onPlanned={noop} /> },
      { label: 'error', node: <kit.TickSlider label="Bad level" value={20} onChange={noop} error="out of range" /> },
      { label: 'disabled with reason', node: <kit.TickSlider label="Held level" value={20} onChange={noop} disabledReason="locked by rule" /> },
    ],
  },
  {
    id: 'kit/Knob', title: 'Knob', group: 'kit', merged, note: 'A dial in two sizes.',
    states: [
      { label: 'hero and compact', node: <KnobDemo /> },
      { label: 'planned', node: <kit.Knob label="Planned knob" value={0} onChange={noop} planned onPlanned={noop} /> },
      { label: 'error', node: <kit.Knob label="Bad knob" value={50} onChange={noop} error="no signal" /> },
      { label: 'disabled with reason', node: <kit.Knob label="Held knob" value={50} onChange={noop} disabledReason="locked by rule" /> },
    ],
  },
  {
    id: 'kit/Plate', title: 'Plate', group: 'kit', merged, note: 'A stamped label, optionally with a serial, a barcode and a status lamp.',
    states: [
      { label: 'plain, serial, barcode', node: <><kit.Plate>CORE</kit.Plate> <kit.Plate serial="SN 0042" barcode>ROOM</kit.Plate></> },
      { label: 'status lamps', node: <States>{(s) => <kit.Plate state={s}>{s}</kit.Plate>}</States> },
      { label: 'planned and link', node: <><kit.Plate planned>SOON</kit.Plate> <kit.Plate href="#bn-top">LINK</kit.Plate></> },
    ],
  },
  {
    id: 'kit/Readout', title: 'Readout', group: 'kit', merged, note: 'A value in the instrument face. A stale LIVE value ages visibly.',
    states: [
      { label: 'five states', node: <States>{(s) => <kit.Readout label={`R ${s}`} value={21.5} unit="C" state={s} reason={STATE_REASON[s]} />}</States> },
      { label: 'stale live', node: <kit.Readout label="Stale" value={7} state="live" ageS={90} /> },
    ],
  },
  {
    id: 'kit/Numerals', title: 'Numerals', group: 'kit', merged, note: 'The large dotted numerals; only LIVE and SIMULATED print a digit.',
    states: [{ label: 'five states, 56 and 72', node: <States>{(s) => <kit.Numerals label={`N ${s}`} value={42} state={s} reason={STATE_REASON[s]} size={s === 'live' ? 72 : 56} />}</States> }],
  },
  {
    id: 'kit/ReadoutLines', title: 'ReadoutLines', group: 'kit', merged, note: 'Several readings in one block, one lamp each.',
    states: [{ label: 'five states', node: <kit.ReadoutLines label="Lines" lines={LAMP_STATES.map((s) => ({ key: s, value: 3.14, state: s, reason: STATE_REASON[s] }))} /> }],
  },
  {
    id: 'kit/TelemetryRail', title: 'TelemetryRail', group: 'kit', merged, note: 'A rail of readings; a row with an action is a button.',
    states: [{ label: 'rows, actionable, planned', node: <kit.TelemetryRail label="Telemetry" rows={LAMP_STATES.map((s, i) => ({ id: s, label: s, value: 9, state: s, reason: STATE_REASON[s], onPress: i === 0 ? noop : undefined }))} /> }],
  },
  {
    id: 'kit/ProgressBar', title: 'ProgressBar', group: 'kit', merged, note: 'A bar that fills only for a measured value; otherwise it says why not.',
    states: [{ label: 'live value, simulated, unknown, planned, fault', node: <>
      <kit.ProgressBar label="Copy" state="live" value={60} />
      <kit.ProgressBar label="Sample" state="simulated" value={30} />
      <kit.ProgressBar label="Waiting load" state="waiting" />
      <kit.ProgressBar label="Planned load" state="planned" />
      <kit.ProgressBar label="Failed load" state="fault" />
    </> }],
  },
  {
    id: 'kit/Console', title: 'Console', group: 'kit', merged, note: 'The event log. Without an onSubmit it is read only and says so.',
    states: [
      { label: 'with prompt', node: <kit.Console label="Events" lines={LOG} onSubmit={noop} onCopy={noop} /> },
      { label: 'planned prompt (no onSubmit)', node: <kit.Console label="Read-only events" lines={LOG} /> },
    ],
  },
  {
    id: 'kit/Frame', title: 'Frame', group: 'kit', merged, note: 'A bordered frame that carries a state and an optional stamp.',
    states: [
      { label: 'state and stamp', node: <kit.Frame state="live" stamp="REV 3">Frame body</kit.Frame> },
      { label: 'simulated, planned', node: <><kit.Frame state="simulated" reason="generated">Sample frame</kit.Frame> <kit.Frame planned>Planned frame</kit.Frame></> },
    ],
  },
  {
    id: 'kit/Panel', title: 'Panel', group: 'kit', merged, note: 'The plain surface of the clay kit.',
    states: [{ label: 'plain, error, planned', node: <><kit.Panel>Panel body</kit.Panel> <kit.Panel error="could not load">Faulty panel</kit.Panel> <kit.Panel planned>Planned panel</kit.Panel></> }],
  },
  {
    id: 'kit/FolderTabs', title: 'FolderTabs', group: 'kit', merged, note: 'Tabs with a count; a planned tab opens the "what is coming" plate.',
    states: [{ label: 'tabs with a planned one', node: <TabsDemo /> }],
  },
  {
    id: 'kit/PaletteView', title: 'PaletteView', group: 'kit', merged, note: 'The grouped command list of the palette.',
    states: [{ label: 'grouped list with a planned row', node: <kit.PaletteView items={PALETTE} onRun={noop} onPlanned={noop} onClose={noop} /> }],
  },
  {
    id: 'kit/NotchedToastStack', title: 'NotchedToastStack', group: 'kit', merged, also: ['NotchedToast'], note: 'Toasts with a tag word: OK, NOTE or FAULT.',
    states: [{ label: 'OK, NOTE, FAULT with undo', node: <kit.NotchedToastStack onDismiss={noop} toasts={[{ id: 'a', tag: 'OK', message: 'Saved' }, { id: 'b', tag: 'NOTE', message: 'Heads up', undo: { onUndo: noop } }, { id: 'c', tag: 'FAULT', message: 'Send failed' }]} /> }],
  },
]
export default entries
