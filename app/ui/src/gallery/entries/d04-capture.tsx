// D04 (wave 6, 13 Nov 2026): the Capture Line, one component for both grammars, and the table of what its local tokenizer
// reads. Every specimen runs on the fixed clock of Friday 13 Nov 2026, 10:30, so the dates on the chips are the same on
// every day the gallery is opened; they are fixtures, not the date of today.
import { CaptureLine, parseWw, type ParseResult } from '../../shared/capture'
import type { GalleryEntryX } from '../types'

const merged = 'D04, 13 Nov 2026'
const FIXED = () => new Date(2026, 10, 13, 10, 30)
const Fixture = () => <p className="gl-note">Clock fixed at Fri 13 Nov 2026, 10:30 for these specimens.</p>
const none = () => {}

const SAMPLES = [
  'spent 120 chai',
  'water 250',
  'gym legs 45',
  'remind me next tue 7 pm physics',
  'remind me eom pay rent',
  'spent 60 snacks last mon',
  '120',
  'water 2',
  'remind me 7 pm physics',
  'remind me at 7 physics tomorrow',
  'spent 120 chai tomorrow',
  'remind me tue physics',
]

function say(r: ParseResult): string {
  if (r.status === 'ok') return r.parsed.fields.filter((f) => f.kind !== 'fixed').map((f) => `${f.caption.split(' ·')[0].toLowerCase()} ${f.display}`).join(' · ')
  if (r.status === 'ask') return r.question
  return r.status
}

function ReadingTable() {
  return (
    <table className="gl-table" style={{ borderCollapse: 'collapse', font: '13px/1.5 var(--font-mono, ui-monospace, monospace)', inlineSize: '100%' }}>
      <caption style={{ textAlign: 'start', paddingBlockEnd: 8 }}>What the tokenizer reads, with the clock at Fri 13 Nov 2026, 10:30. A line with a question is not committed.</caption>
      <thead>
        <tr><th scope="col" style={{ textAlign: 'start', paddingInlineEnd: 16 }}>Typed</th><th scope="col" style={{ textAlign: 'start', paddingInlineEnd: 16 }}>Reads as</th><th scope="col" style={{ textAlign: 'start' }}>Result</th></tr>
      </thead>
      <tbody>
        {SAMPLES.map((t) => {
          const r = parseWw(t, FIXED())
          return (
            <tr key={t}>
              <th scope="row" style={{ textAlign: 'start', fontWeight: 400, paddingInlineEnd: 16, paddingBlock: 2 }}>{t}</th>
              <td style={{ paddingInlineEnd: 16 }}>{say(r)}</td>
              <td>{r.status === 'ok' ? 'commits' : 'waits'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'data/CaptureLine',
    title: 'CaptureLine',
    group: 'data',
    merged,
    also: ['parseWw'],
    note: 'A terminal prompt in a recessed well. What you type is read as you type; the parts appear beneath as chips you can press and edit. A line that could mean two things asks and waits. Enter commits and an Undo toast stays 6 s. Ctrl+Space focuses it inside Well Wisher. Try it: type "spent 120 chai", then "120".',
    states: [
      { label: 'idle (type here)', node: <><CaptureLine grammar="ww" onCommit={none} onUndo={none} now={FIXED} /><Fixture /></> },
      { label: 'a spend, read', node: <CaptureLine grammar="ww" onCommit={none} onUndo={none} now={FIXED} initialText="spent 120 chai" globalKey={false} /> },
      { label: 'a reminder: date and time resolved', node: <CaptureLine grammar="ww" onCommit={none} onUndo={none} now={FIXED} initialText="remind me next tue 7 pm physics" globalKey={false} /> },
      { label: 'ambiguous: "? what is 120" waits', node: <CaptureLine grammar="ww" onCommit={none} now={FIXED} initialText="120" globalKey={false} /> },
      { label: 'a part is missing: the hollow chip', node: <CaptureLine grammar="ww" onCommit={none} now={FIXED} initialText="spent 120" globalKey={false} /> },
      { label: 'a bare hour: 7 am or 7 pm', node: <CaptureLine grammar="ww" onCommit={none} now={FIXED} initialText="remind me at 7 physics tomorrow" globalKey={false} /> },
      { label: 'still typing a verb', node: <CaptureLine grammar="ww" onCommit={none} now={FIXED} initialText="re" globalKey={false} /> },
      { label: 'what each phrase reads as (table)', node: <ReadingTable /> },
    ],
  },
  {
    id: 'data/CaptureLine-jarvis',
    title: 'CaptureLine, jarvis grammar',
    group: 'data',
    merged,
    note: 'The same component with a closed verb list: remember, help and the verbs a section passes in. Anything else answers "unknown verb; try help". It sends nothing anywhere: Enter hands the parsed verb to the section.',
    states: [
      { label: 'Memory: remember>', node: <CaptureLine grammar="jarvis" onCommit={none} onUndo={none} now={FIXED} initialText="remember> I keep my notes in the blue folder" globalKey={false} /> },
      { label: 'Console verbs, idle', node: <CaptureLine grammar="jarvis" onCommit={none} now={FIXED} verbs={['status', 'test hearing', 'restart brain', 'free gpu', 'export memory', 'jobs', 'plan']} globalKey={false} /> },
      { label: 'Console: a two-word verb', node: <CaptureLine grammar="jarvis" onCommit={none} now={FIXED} verbs={['status', 'test hearing', 'restart brain']} initialText="test hearing" globalKey={false} /> },
      { label: 'unknown verb', node: <CaptureLine grammar="jarvis" onCommit={none} now={FIXED} verbs={['status', 'jobs']} initialText="format c:" globalKey={false} /> },
    ],
  },
]

export default entries
