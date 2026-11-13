// Package D01, the number forms of spec 20.5.2: Odometer, Dumbbell, LedgerTape and Jar, each in its states. Example words
// are neutral on purpose (Unit 3, chai, physics): no real person, place or account appears here.
import { useState } from 'react'
import { Dumbbell, Jar, LedgerTape, Odometer } from '../../shared/data/numbers'
import type { GalleryEntryX } from '../types'

const merged = 'D01, 13 Nov 2026'

/** A counter you can press: the wheels roll on a change when on screen, and only then. */
function RollDemo() {
  const [n, setN] = useState(41)
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      <Odometer value={n} unit="questions answered" state="simulated" delta={n - 41} since="09:00" />
      <button type="button" className="gl-btn" style={{ minHeight: 44, minWidth: 120, font: '13px var(--font-mono, monospace)', padding: '0 14px', border: '1px solid var(--edge-ui)', borderRadius: 8, background: 'var(--surface-raised)', color: 'var(--ink-1)', boxShadow: 'var(--elev-raised)', cursor: 'pointer' }} onClick={() => setN((v) => v + 19)}>
        add 19
      </button>
    </div>
  )
}

const rows = [
  { label: 'physics', before: 34, after: 52 },
  { label: 'maths', before: 40, after: 46 },
  { label: 'chemistry', before: 61, after: 58 },
  { label: 'Unit 3', before: 12, after: 40 },
  { label: 'revision', before: 70, after: 70 },
]

const tape = [
  { label: 'chai', amount: 120 },
  { label: 'auto to college', amount: 90 },
  { label: 'notebook', amount: 65 },
  { label: 'lunch', amount: 150 },
]

const entries: GalleryEntryX[] = [
  {
    id: 'data/Odometer',
    title: 'Odometer',
    group: 'data',
    merged,
    note: 'The hero number: pixel-numeral wheels in a recessed well. A wheel rolls only on a change, only on screen, never in Calm. WAITING, PLANNED and FAULT draw four dashed wells and the reason, never a figure.',
    states: [
      { label: 'hero, LIVE, with a change since 09:00', node: <Odometer value={41} unit="questions answered" state="live" delta={3} since="09:00" /> },
      { label: 'hero, SIMULATED (stamped)', node: <Odometer value={1280} unit="focus minutes" state="simulated" /> },
      { label: 'hero, WAITING (hollow form)', node: <Odometer value={0} unit="focus minutes" state="waiting" /> },
      { label: 'hero, PLANNED', node: <Odometer value={0} unit="questions answered" state="planned" reason="not built yet" /> },
      { label: 'hero, FAULT', node: <Odometer value={0} unit="questions answered" state="fault" reason="source did not answer" /> },
      { label: 'compact, in a rail', node: <Odometer value={7} unit="blocks" state="live" size="compact" /> },
      { label: 'compact, WAITING', node: <Odometer value={0} unit="blocks" state="waiting" size="compact" /> },
      { label: 'opens a drawer (focusable)', node: <Odometer value={212} unit="check-ins" state="live" onOpen={() => undefined} /> },
      { label: 'press it: it rolls on a change', node: <RollDemo /> },
    ],
  },
  {
    id: 'data/Dumbbell',
    title: 'Dumbbell',
    group: 'data',
    merged,
    note: 'Two values on one rail: a ring for the student\'s earlier self, a disc for now. Rails share one ruler and are sorted by the size of the gap. There is no field for anyone else\'s value.',
    states: [
      { label: 'LIVE, five rails', node: <Dumbbell rows={rows} scale={[0, 80]} state="live" unit="questions" earlierName="last month" nowName="this month" /> },
      { label: 'LIVE, off the scale is held at the end', node: <Dumbbell rows={[{ label: 'physics', before: 20, after: 95 }, { label: 'maths', before: 30, after: 36 }]} scale={[0, 80]} state="live" /> },
      { label: 'SIMULATED', node: <Dumbbell rows={rows.slice(0, 3)} scale={[0, 80]} state="simulated" /> },
      { label: 'WAITING (hollow)', node: <Dumbbell rows={rows.slice(0, 3)} scale={[0, 80]} state="waiting" /> },
      { label: 'PLANNED', node: <Dumbbell rows={[]} scale={[0, 80]} state="planned" reason="needs two months of marks" /> },
    ],
  },
  {
    id: 'data/LedgerTape',
    title: 'LedgerTape',
    group: 'data',
    merged,
    note: 'A 320 px paper tape: text lines with dotted leaders, a total in Odometer wheels, a registration ruler and a torn end. The torn edge is the same every time for the same tape.',
    states: [
      { label: 'LIVE, four lines', node: <LedgerTape entries={tape} total={425} state="live" unit="INR" /> },
      { label: 'LIVE, empty tape', node: <LedgerTape entries={[]} total={0} state="live" /> },
      { label: 'LIVE, total does not match the lines', node: <LedgerTape entries={tape.slice(0, 2)} total={300} state="live" /> },
      { label: 'SIMULATED', node: <LedgerTape entries={tape.slice(0, 3)} total={275} state="simulated" /> },
      { label: 'WAITING (hollow)', node: <LedgerTape entries={tape} total={425} state="waiting" /> },
    ],
  },
  {
    id: 'data/Jar',
    title: 'Jar',
    group: 'data',
    merged,
    note: 'One recessed well per category: fill is spending against the student\'s own plan, a disc on the wall marks the notch. Past the notch the fill is hatched and one line says how far. No red, no scolding.',
    states: [
      {
        label: 'LIVE, under, at the notch, over, empty',
        node: (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Jar label="chai" level={180} plan={400} state="live" unit="INR" />
            <Jar label="books" level={400} plan={400} state="live" unit="INR" />
            <Jar label="snacks" level={520} plan={400} state="live" unit="INR" />
            <Jar label="travel" level={0} plan={600} state="live" unit="INR" />
          </div>
        ),
      },
      { label: 'no plan: a share of the well', node: <Jar label="water" level={0.55} state="live" /> },
      { label: 'SIMULATED', node: <Jar label="chai" level={260} plan={400} state="simulated" unit="INR" /> },
      { label: 'WAITING (hollow)', node: <Jar label="chai" level={0} plan={400} state="waiting" /> },
      { label: 'FAULT', node: <Jar label="chai" level={0} plan={400} state="fault" reason="budget file unreadable" /> },
    ],
  },
]

export default entries
