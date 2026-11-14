// D03 (wave 6): the ledger table, the slot list and the detent rack. Every row below is a fixture written for the gallery:
// the table says SIMULATED where it shows numbers, and the one LIVE picture is labelled as fixture rows, not a measurement.
import { useState, type ComponentProps } from 'react'
import { DetentRack, LedgerTable, SlotList, type Col, type Item, type Opt, type Row } from '../../shared/data/tables'
import type { LampState } from '../../shared/lamp'
import type { GalleryEntryX } from '../types'

const merged = 'D03, 13 Nov 2026'

const COLUMNS: Col[] = [
  { key: 'topic', label: 'Topic', pinned: true, editable: true, width: '22ch' },
  { key: 'blocks', label: 'Blocks', kind: 'number' },
  { key: 'mins', label: 'Minutes', kind: 'number', unit: 'min', digits: 0, editable: true },
  { key: 'trend', label: 'Last 12', kind: 'spark' },
  { key: 'cover', label: 'Covered', kind: 'meter' },
  { key: 'src', label: 'Source', kind: 'lamp' },
]

const ROWS: Row[] = [
  { id: 'u1', topic: 'Unit 1 · motion', blocks: 14, mins: 420, trend: [2, 3, 3, 5, 4, 6, 7, 6, 8, 9, 8, 10], cover: 0.9, src: 'live' },
  { id: 'u2', topic: 'Unit 2 · energy', blocks: 9, mins: 255, trend: [1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5], cover: 0.6, src: 'live' },
  { id: 'u3', topic: 'Unit 3 · waves', blocks: 6, mins: 150, trend: [5, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1], cover: 0.4, src: 'simulated' },
  { id: 'u4', topic: 'Unit 4 · optics', blocks: 2, mins: 45, trend: [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0], cover: 0.2, src: 'waiting' },
  { id: 'u5', topic: 'Unit 5 · heat', blocks: 0, mins: 0, trend: [], cover: 0, src: 'planned' },
  { id: 'u6', topic: 'Unit 6 · circuits', blocks: 11, mins: 330, trend: [3, 5, 4, 6, 6, 5, 7, 8, 6, 7, 9, 8], cover: 0.7, src: 'fault' },
]

function Ledger(p: Partial<ComponentProps<typeof LedgerTable>> & { state: LampState }) {
  const [rows, setRows] = useState<Row[]>(ROWS)
  return (
    <div style={{ maxWidth: 940 }}>
      <LedgerTable
        columns={COLUMNS}
        rows={rows}
        label="Study blocks"
        onEdit={(row, col, v) => setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [col.key]: v } : r)))}
        {...p}
      />
    </div>
  )
}

const OPTS: Opt[] = [
  { value: 'day', label: 'Today', shortcut: 'T' },
  { value: 'week', label: 'This week', shortcut: 'W' },
  { value: 'month', label: 'This month', shortcut: 'M' },
  { value: 'term', label: 'This term', shortcut: 'R' },
  { value: 'all', label: 'Everything', disabled: true },
]
const GROUPED: Opt[] = [
  { value: 'chai', label: 'Chai', group: 'Food' },
  { value: 'lunch', label: 'Lunch', group: 'Food' },
  { value: 'snack', label: 'Snack', group: 'Food' },
  { value: 'bus', label: 'Bus pass', group: 'Travel' },
  { value: 'auto', label: 'Auto', group: 'Travel' },
  { value: 'books', label: 'Books', group: 'Study' },
  { value: 'other', label: 'Something else' },
]

function Rack(p: Partial<ComponentProps<typeof DetentRack>> & { start: string; opts?: Opt[] }) {
  const [v, setV] = useState(p.start)
  const { start, opts, ...rest } = p
  void start
  return <DetentRack options={opts ?? OPTS} value={v} onChange={setV} label="Range" {...rest} />
}

const ITEMS: Item[] = [
  { id: 'a', label: 'Read the unit notes', meta: '25 min', state: 'live' },
  { id: 'b', label: 'Solve ten questions', meta: '40 min', state: 'simulated' },
  { id: 'c', label: 'Check the answers', meta: '15 min', state: 'waiting' },
  { id: 'd', label: 'Write three lines of summary', meta: '10 min' },
  { id: 'e', label: 'Plan tomorrow', meta: '5 min', state: 'planned' },
]

function Slots(p: Partial<ComponentProps<typeof SlotList>>) {
  const [items, setItems] = useState<Item[]>(ITEMS)
  return (
    <div style={{ maxWidth: 560 }}>
      <SlotList
        items={items}
        label="Today's blocks"
        onReorder={(from, to) => setItems((xs) => { const n = [...xs]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n })}
        {...p}
      />
    </div>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'data/LedgerTable',
    title: 'LedgerTable',
    group: 'data',
    merged,
    note: 'A rack ledger: 32 px rows with a 44 px row button, a sticky header plate with a ruler, ▲ ▼ in text, F2 to edit a cell, a column chooser, a drawer on expand and key-value cards under 900 px. Numbers draw only for LIVE and SIMULATED. The rows are fixtures.',
    states: [
      { label: 'SIMULATED, sorted by minutes', node: <Ledger state="simulated" defaultSort={{ key: 'mins', dir: 'desc' }} /> },
      { label: 'LIVE form (fixture rows, not a measurement)', node: <Ledger state="live" reason="fixture rows for the gallery" /> },
      { label: 'WAITING: numbers are hollow', node: <Ledger state="waiting" /> },
      { label: 'FAULT: numbers are hollow, with the reason', node: <Ledger state="fault" reason="the study log did not answer" /> },
      { label: 'PLANNED: hollow, says it is not built', node: <Ledger state="planned" /> },
      { label: 'dense (28 px, console only)', node: <Ledger state="simulated" density="dense" /> },
      { label: 'column chooser open', node: <Ledger state="simulated" defaultChooserOpen defaultHidden={['trend']} /> },
      { label: 'drawer open on a row', node: <Ledger state="simulated" defaultOpenId="u3" /> },
      { label: 'key-value cards (under 900 px)', node: <Ledger state="simulated" layout="cards" /> },
      { label: 'loading: hollow rows', node: <Ledger state="waiting" loading /> },
      { label: 'empty', node: <Ledger state="simulated" rows={[]} empty="No study blocks logged yet." emptyAction={<button type="button" className="d3-key">Log a 10-minute block</button>} /> },
    ],
  },
  {
    id: 'data/SlotList',
    title: 'SlotList',
    group: 'data',
    merged,
    note: 'Rows seat into slots. Alt+Up and Alt+Down move the focused row; Space picks it up and its seat becomes a dashed blanking plate; a drag on the grip does the same.',
    states: [
      { label: 'idle, reorderable (try Alt+Up / Alt+Down)', node: <Slots /> },
      { label: 'lifting: raised row over its dashed plate', node: <Slots liftedId="b" /> },
      { label: 'fixed order (no onReorder)', node: <div style={{ maxWidth: 560 }}><SlotList items={ITEMS} label="Fixed blocks" /></div> },
      { label: 'empty', node: <div style={{ maxWidth: 560 }}><SlotList items={[]} empty="No blocks planned. Add one from the capture line." /></div> },
    ],
  },
  {
    id: 'data/DetentRack',
    title: 'DetentRack',
    group: 'data',
    merged,
    note: 'The product\'s select: a listbox with aria-activedescendant, typeahead, a notch and pawl that click onto the active row, and a bottom sheet under 900 px. There is no native select.',
    states: [
      { label: 'closed', node: <Rack start="week" /> },
      { label: 'open (Up, Down, Home, End, typing, Enter, Esc)', node: <div style={{ minHeight: 330 }}><Rack start="week" defaultOpen flow /></div> },
      { label: 'grouped, with the ├─ └─ gutter', node: <div style={{ minHeight: 440 }}><Rack start="bus" opts={GROUPED} grouped defaultOpen flow label="Category" /></div> },
      { label: 'bottom sheet form (under 900 px)', node: <div style={{ minHeight: 440 }}><Rack start="month" layout="sheet" defaultOpen flow /></div> },
      { label: 'disabled, with its reason', node: <Rack start="day" disabledReason="Only one range exists until a week has passed." /> },
    ],
  },
]

export default entries
