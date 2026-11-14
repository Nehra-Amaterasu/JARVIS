// The Core section rebuilt (A.J01, spec 20.9.1, 20.9.7): the whole Talk surface on stamped fixtures, then its four new
// components in their states. A product entry (gallery/entries/jarvis), so a Well Wisher only build never loads it.
// Every LIVE here is drawn SIMULATED: the gallery has no microphone and no core. Motion is forced to the static form.
import type { ReactNode } from 'react'
import { CoreFixture, fixtureBands } from '../../../jarvis/core/fixtures'
import { HandoffChip, OrganStrip, PipelineRibbon, SigilRing, type Organ, type PipelineStage } from '../../../jarvis/core'
import type { GalleryEntryX } from '../../types'

/** The 1286 x 652 Core box, zoomed down to fit the specimen pane (the layout is fixed px, so it scales as a picture). */
function Box({ children, zoom = 0.66 }: { children: ReactNode; zoom?: number }) {
  return <div style={{ position: 'relative', width: 1286, height: 652, zoom, overflow: 'hidden' }}>{children}</div>
}

const stages = (kind: 'running' | 'off' | 'fault'): PipelineStage[] => {
  if (kind === 'off') return (['hear', 'write', 'think', 'say'] as const).map((id) => ({ id, state: 'waiting', reason: 'core off' }))
  if (kind === 'fault') return [
    { id: 'hear', state: 'simulated', sec: 0.6, median: 0.7, reason: 'fixture' },
    { id: 'write', state: 'fault', reason: 'Whisper failed to load' },
    { id: 'think', state: 'waiting', reason: 'not measured yet' },
    { id: 'say', state: 'waiting', reason: 'not measured yet' },
  ]
  return [
    { id: 'hear', state: 'simulated', sec: 0.6, median: 0.7, reason: 'fixture' },
    { id: 'write', state: 'simulated', sec: 0.4, median: 0.5, reason: 'fixture' },
    { id: 'think', state: 'simulated', sec: 1.1, median: 1.4, running: true, reason: 'fixture, running' },
    { id: 'say', state: 'simulated', sec: 0.6, reason: 'fixture, no median yet' },
  ]
}

const organs: Organ[] = [
  { id: 'brain', name: 'BRAIN', reading: { state: 'simulated', since: null, reason: 'fixture' }, source: 'fixture' },
  { id: 'voice', name: 'VOICE', reading: { state: 'simulated', since: null, reason: 'fixture' }, source: 'fixture' },
  { id: 'room', name: 'ROOM', reading: { state: 'fault', since: null, reason: 'board link down' }, source: 'fixture' },
  { id: 'sense', name: 'SENSE', reading: { state: 'waiting', since: null, reason: 'not tested' }, source: 'fixture' },
  { id: 'mem', name: 'MEM', reading: { state: 'planned', since: null, reason: 'not built' }, source: 'fixture' },
]

const ring = (bands: number[], state: 'simulated' | 'waiting' | 'fault') => (
  <div style={{ width: 280, aspectRatio: '1', background: 'var(--surface-ground)', borderRadius: 14 }} data-scene="immersive"><SigilRing bands={bands} state={state} /></div>
)

const entries: GalleryEntryX[] = [
  {
    id: 'section/CoreTalk',
    title: 'Core, Talk (shell v2)',
    group: 'section',
    merged: 'J01, wave 6',
    also: ['CoreTalkView', 'Transcript', 'TurnRow', 'Anatomy', 'CoreDrawer', 'LiveSigil'],
    note: 'Fixtures, stamped SIMULATED. Asleep is the first screen most days: the hollow ring, the art in the empty stage, one accent key.',
    states: [
      { label: 'asleep', node: <Box><CoreFixture kind="asleep" /></Box> },
      { label: 'thinking (fixture turns)', node: <Box><CoreFixture kind="thinking" /></Box> },
      { label: 'stopped with an error', node: <Box><CoreFixture kind="fault" /></Box> },
    ],
  },
  {
    id: 'section/SigilRing',
    title: 'SigilRing',
    group: 'section',
    merged: 'J01, wave 6',
    note: 'The 96-tick glyph band is the spectrum in a second projection: lit ticks only with a frame, hollow otherwise.',
    states: [
      { label: 'fixture spectrum, SIMULATED', node: ring(fixtureBands(0), 'simulated') },
      { label: 'no frame, WAITING (hollow)', node: ring([], 'waiting') },
      { label: 'FAULT (hollow)', node: ring(fixtureBands(0), 'fault') },
    ],
  },
  {
    id: 'section/PipelineRibbon',
    title: 'PipelineRibbon',
    group: 'section',
    merged: 'J01, wave 6',
    note: 'HEAR, WRITE, THINK, SAY. A track fills only as elapsed over a real median; with no median it stays dashed.',
    states: [
      { label: 'THINK running, SAY has no median', node: <div style={{ width: 720 }}><PipelineRibbon stages={stages('running')} /></div> },
      { label: 'core off: every node hollow', node: <div style={{ width: 720 }}><PipelineRibbon stages={stages('off')} /></div> },
      { label: 'a stage faulted', node: <div style={{ width: 720 }}><PipelineRibbon stages={stages('fault')} /></div> },
      { label: 'phone: four rows', node: <div style={{ width: 358 }}><PipelineRibbon stages={stages('running')} orientation="column" /></div> },
    ],
  },
  {
    id: 'section/OrganStrip',
    title: 'OrganStrip',
    group: 'section',
    merged: 'J01, wave 6',
    note: 'Five organs, a lamp and one word each; Enter opens Anatomy on that organ.',
    states: [
      { label: 'five states', node: <div style={{ width: 720 }}><OrganStrip organs={organs} onOpen={() => {}} /></div> },
      { label: 'phone: five lamps', node: <div style={{ width: 358 }}><OrganStrip organs={organs} onOpen={() => {}} compact /></div> },
    ],
  },
  {
    id: 'section/HandoffChip',
    title: 'HandoffChip',
    group: 'section',
    merged: 'J01, wave 6',
    note: 'Under a turn that wrote into Well Wisher. Without the notify port it is text that says the planner is not here.',
    states: [
      { label: 'notify port present: a link', node: <HandoffChip product="ww" target="ww/day.today" label="Day 3 Dec 18:00" onOpen={() => {}} /> },
      { label: 'notify port null: text only', node: <HandoffChip product="ww" target="ww/day.today" label="Day 3 Dec 18:00" notifyPresent={false} /> },
    ],
  },
]

export default entries
