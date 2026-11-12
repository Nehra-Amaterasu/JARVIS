// The in-memory bench (package BENCH): every exported component of shared/kit, shared/art and shared/lamp, each in its
// states, on one page, with the real clay token files, clay.css, the art and lamp CSS, and (for the legacy ww-* kit
// controls that shared/kit still draws with `.ww-*` classes) the real ww/design and ww/kit stylesheets.
// Nothing under src/ changes; e2e/bench.spec.ts builds this file with Vite in memory and serves it from a fake origin.
//
// URL contract (read once, at load):  ?theme=light|dark   which clay theme (and the matching ww theme) to draw
//                                     ?open=<Overlay>     open one modal on mount (the others render closed)
import { createRoot } from 'react-dom/client'
import { useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import '../../src/styles/design/clay/index.css'
import '../../src/ww/design/base.css'
import '../../src/ww/kit/kit.css'
import './bench.css'
import * as kit from '../../src/shared/kit'
import * as art from '../../src/shared/art'
import * as lampPkg from '../../src/shared/lamp'
import { jarvisRegistry } from '../../src/jarvis/planned'
import type { LampReading, LampState } from '../../src/shared/lamp'
import { LAMP_STATES } from '../../src/shared/lamp'

const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
const OPEN = q.get('open') ?? ''
document.documentElement.setAttribute('data-theme', `clay-${THEME}`)
// The legacy ww-* controls read the Well Wisher themes (Ash = dark default, Paper = light) from html[data-theme];
// the clay theme owns that attribute here, so e2e/bench.spec.ts rewrites those selectors to [data-ww-theme].
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')

const noop = () => {}
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)
const read = (state: LampState, reason = ''): LampReading => ({ state, since: state === 'waiting' ? null : NOW - 42_000, reason })
const STATE_REASON: Record<LampState, string> = { live: '', waiting: 'no report', simulated: 'generated sample', planned: 'not built', fault: 'relay did not answer' }

const { Lamp: KLamp, LampGlyph: KGlyph } = kit

/** Every capitalised function export the page draws, as 'pkg:Name'; the spec compares it with the real export lists. */
const RENDERED = new Set<string>()
const mark = (pkg: string, ...names: string[]) => names.forEach((n) => RENDERED.add(`${pkg}:${n}`))

function B({ name, pkg, also, children }: { name: string; pkg: 'kit' | 'art' | 'lamp'; also?: string[]; children: ReactNode }) {
  mark(pkg, name, ...(also ?? []))
  return (
    <section className="bn-block" data-bench={`${pkg}/${name}`} data-pkg={pkg} aria-labelledby={`bn-${pkg}-${name}`}>
      <h2 className="bn-h" id={`bn-${pkg}-${name}`}>
        {pkg}/{name}
      </h2>
      <div className="bn-forms">{children}</div>
    </section>
  )
}
function F({ form, children }: { form: string; children: ReactNode }) {
  return (
    <div className="bn-form" data-form={form}>
      <p className="bn-cap">{form}</p>
      {children}
    </div>
  )
}

const PLAIN = jarvisRegistry.byId('jarvis.agents')!
const WAITING_ENTRY = jarvisRegistry.byId('jarvis.library')!

const AXES: art.PillarsChartProps['axes'] = [
  { id: 'a', label: 'Recall', value: 0.7 },
  { id: 'b', label: 'Speed', value: 0.5 },
  { id: 'c', label: 'Accuracy', value: 0.8 },
  { id: 'd', label: 'Stamina', value: 0.4 },
  { id: 'e', label: 'Focus', value: 0.6 },
]
const RIDGE_ROWS = Array.from({ length: 5 }, (_, r) => ({ label: `Day ${r + 1}`, values: Array.from({ length: 24 }, (_, i) => Math.abs(Math.sin((i + r) / 3)) * 10) }))
const ORBIT_MS: art.OrbitProps['milestones'] = [
  { id: 'm1', label: 'First', orbit: 0, at: 0.1, status: 'reached' },
  { id: 'm2', label: 'Second', orbit: 1, at: 0.4, status: 'upcoming' },
  { id: 'm3', label: 'Third', orbit: 2, at: 0.7, status: 'planned' },
]
const RING_NODES: art.NodeRingProps['nodes'] = [
  { id: 'n1', label: 'Voice', status: 'done' },
  { id: 'n2', label: 'Memory', status: 'open' },
  { id: 'n3', label: 'Room', status: 'planned' },
  { id: 'n4', label: 'Senses', status: 'open' },
  { id: 'n5', label: 'Study', status: 'done' },
]
const DAYS: art.WeekStripProps['days'] = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((iso, i) => ({
  iso,
  label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
  minutes: [40, 25, 0, 60, 15, 0, 0][i],
  rest: i === 6,
}))
const WHEEL: art.DateWheelProps['items'] = [
  { id: 'w1', label: 'Mock paper', date: '2026-12-08' },
  { id: 'w2', label: 'Review day', date: '2026-11-20' },
  { id: 'w3', label: 'Later plan', date: '2027-02-02', planned: true },
]
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

function States({ children }: { children: (s: LampState) => ReactNode }) {
  return <>{LAMP_STATES.map((s) => <span key={s} className="bn-cell" data-state-cell={s}>{children(s)}</span>)}</>
}

function Overlays() {
  const [drawer, setDrawer] = useState(OPEN === 'Drawer')
  const [sheet, setSheet] = useState(OPEN === 'Sheet')
  const [pop, setPop] = useState(OPEN === 'Popover')
  const [dlg, setDlg] = useState(OPEN === 'RetroDialog')
  const [dlgX, setDlgX] = useState(OPEN === 'RetroDialogDestructive')
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <B name="Drawer" pkg="kit" also={['Sheet']}>
        <F form="closed (trigger) and open on ?open=Drawer">
          <kit.Button onClick={() => setDrawer(true)}>Open drawer</kit.Button>
          <kit.Drawer open={drawer} onClose={() => setDrawer(false)} title="Settings">
            <p>Drawer body text.</p>
            <kit.Field label="Name" />
            <kit.Button>Save</kit.Button>
          </kit.Drawer>
        </F>
        <F form="sheet (bottom)">
          <kit.Button onClick={() => setSheet(true)}>Open sheet</kit.Button>
          <kit.Sheet open={sheet} onClose={() => setSheet(false)} title="Quick actions">
            <p>Sheet body text.</p>
            <kit.Button>Do it</kit.Button>
          </kit.Sheet>
        </F>
      </B>
      <B name="Popover" pkg="kit">
        <F form="closed (trigger) and open on ?open=Popover">
          <kit.Button ref={anchor} onClick={() => setPop(!pop)}>Toggle popover</kit.Button>
          <kit.Popover open={pop} onClose={() => setPop(false)} anchor={anchor} label="More">
            <kit.Button size="sm">One</kit.Button> <kit.Button size="sm">Two</kit.Button>
          </kit.Popover>
        </F>
      </B>
      <B name="RetroDialog" pkg="kit">
        <F form="closed (trigger) and open on ?open=RetroDialog">
          <kit.Button onClick={() => setDlg(true)}>Open dialog</kit.Button>
          <kit.RetroDialog open={dlg} title="Save changes" confirmLabel="Save" onConfirm={() => setDlg(false)} onCancel={() => setDlg(false)} error="The last save failed">
            Keep these changes?
          </kit.RetroDialog>
        </F>
        <F form="destructive (?open=RetroDialogDestructive)">
          <kit.Button onClick={() => setDlgX(true)}>Open destructive</kit.Button>
          <kit.RetroDialog open={dlgX} destructive title="Delete note" confirmLabel="Delete" onConfirm={() => setDlgX(false)} onCancel={() => setDlgX(false)}>
            This cannot be undone.
          </kit.RetroDialog>
        </F>
      </B>
    </>
  )
}

function Bench() {
  const [on, setOn] = useState(true)
  const [n, setN] = useState(40)
  const [sel, setSel] = useState('b')
  const [seg, setSeg] = useState('one')
  const [cyc, setCyc] = useState<kit.CycleState>('todo')
  const [pressed, setPressed] = useState(false)
  const [tab, setTab] = useState('t1')
  const [fold, setFold] = useState(false)
  const [tap, setTap] = useState<string | null>('x')
  mark('kit', 'SectionOrder', 'PrimaryOwner')
  const overlays = (
    <div className="ww bn-legacy" data-section="wellwisher" data-density="regular">
      <Overlays />
    </div>
  )
  return (
    <main id="bn-root">
      <h1 className="bn-title">Jury bench: kit, art and lamp, {THEME}</h1>
      {/* with ?open= the modals come first: the popover is placed once from its anchor's rectangle, so an anchor far down the page would put it off screen */}
      {OPEN && overlays}

      {/* ------------------------------------------------------------------ lamp package */}
      <B name="Lamp" pkg="lamp">
        <F form="five states, size 12 with word">
          <States>{(s) => <lampPkg.Lamp reading={read(s, STATE_REASON[s])} now={NOW} />}</States>
        </F>
        <F form="size 16, no word, with subject">
          <States>{(s) => <lampPkg.Lamp reading={read(s, STATE_REASON[s])} size={16} showLabel={false} subject="Voice" now={NOW} />}</States>
        </F>
      </B>
      <B name="LampGlyph" pkg="lamp">
        <F form="five bare glyphs">
          <States>{(s) => <span style={{ fontSize: 32, color: 'var(--ink-1)' }}><lampPkg.LampGlyph state={s} /></span>}</States>
        </F>
      </B>
      <B name="Reading" pkg="lamp">
        <F form="live, simulated, waiting, planned, fault">
          <States>{(s) => <lampPkg.Reading label={`Level ${s}`} value={12.5} unit="dB" reading={read(s, STATE_REASON[s])} now={NOW} />}</States>
        </F>
      </B>
      <B name="Annunciators" pkg="lamp">
        <F form="regular">
          <lampPkg.Annunciators items={lampPkg.JARVIS_ANNUNCIATORS} readings={{ [lampPkg.JARVIS_ANNUNCIATORS[0].id]: read('live'), [lampPkg.JARVIS_ANNUNCIATORS[1].id]: read('fault', 'relay did not answer') }} now={NOW} />
        </F>
        <F form="compact">
          <lampPkg.Annunciators items={lampPkg.WW_ANNUNCIATORS} readings={{}} compact now={NOW} />
        </F>
      </B>

      {/* ------------------------------------------------------------------ kit: lamp and hardware (clay) */}
      {/* The data components that moved to shared/kit with the second half of the kit move (13 Nov): a number or fill only for LIVE and SIMULATED. */}
      <B name="Stat" pkg="kit">
        <F form="five states"><States>{(s) => <kit.Stat label={`Hours ${s}`} value={42} unit="h" reading={read(s, STATE_REASON[s])} />}</States></F>
        <F form="not measured"><kit.Stat label="Papers" value={null} reading={read('waiting', 'no report')} /></F>
        <F form="zero with a next step"><kit.Stat label="Drills" value={0} next="Start one drill" reading={read('live')} /></F>
      </B>
      <B name="Meter" pkg="kit">
        <F form="five states"><States>{(s) => <kit.Meter label={`Coverage ${s}`} value={0.6} reading={read(s, STATE_REASON[s])} />}</States></F>
        <F form="not measured"><kit.Meter label="Retention" value={null} reading={read('waiting', 'no report')} /></F>
      </B>
      <B name="Row" pkg="kit">
        <F form="default"><kit.Row title="Signals and systems" meta="Unit 3, 12 questions" /></F>
        <F form="done"><kit.Row title="Lab record" meta="handed in" state="done" /></F>
        <F form="behind"><kit.Row title="Control theory" meta="2 of 5 units" state="behind" /></F>
        <F form="overdue"><kit.Row title="Assignment 4" meta="was due on Monday" state="overdue" /></F>
      </B>
      <B name="Spark" pkg="kit">
        <F form="history"><kit.Spark label="Minutes per day" points={[10, 25, 15, 40, 30, 55, 45]} /></F>
        <F form="no history"><kit.Spark label="Minutes per day" points={[]} /></F>
      </B>
      <B name="StageStrip" pkg="kit">
        <F form="stages"><kit.StageStrip label="Paper pipeline" stages={[{ id: 'a', label: 'Collected', count: 12, state: 'done' }, { id: 'b', label: 'Tagged', count: 7, state: 'current' }, { id: 'c', label: 'Practised', state: 'todo' }, { id: 'd', label: 'Reviewed', state: 'unknown' }]} /></F>
      </B>
      <B name="Lamp" pkg="kit" also={['LampGlyph']}>
        <F form="five states with word">
          <States>{(s) => <KLamp state={s} reason={STATE_REASON[s]} />}</States>
        </F>
        <F form="bare, size 16">
          <States>{(s) => <KLamp state={s} bare size={16} />}</States>
        </F>
        <F form="glyph only">
          <States>{(s) => <KGlyph state={s} size={24} />}</States>
        </F>
      </B>
      <B name="Switch" pkg="kit">
        <F form="on and off"><kit.Switch label="Lights" checked={on} onChange={setOn} /> <kit.Switch label="Fan" checked={false} onChange={noop} confirmed /></F>
        <F form="planned"><kit.Switch label="Heater" checked={false} onChange={noop} planned onPlanned={noop} /></F>
        <F form="error"><kit.Switch label="Relay" checked onChange={noop} error="relay did not answer" /></F>
        <F form="disabled with reason"><kit.Switch label="Pump" checked={false} onChange={noop} disabledReason="needs the board" /></F>
      </B>
      <B name="Rocker" pkg="kit">
        <F form="working"><kit.Rocker label="Master" on={on} onChange={setOn} /></F>
        <F form="planned"><kit.Rocker label="Planned rocker" on={false} onChange={noop} planned onPlanned={noop} /></F>
        <F form="error"><kit.Rocker label="Faulty rocker" on onChange={noop} error="no answer" /></F>
        <F form="disabled with reason"><kit.Rocker label="Held rocker" on={false} onChange={noop} disabledReason="locked by rule" /></F>
      </B>
      <B name="Key" pkg="kit">
        <F form="plain and caption"><kit.Key label="Go" onPress={noop} icon={<Search size={20} />} /> <kit.Key label="Search" caption onPress={noop} icon={<Search size={20} />} /></F>
        <F form="toggle"><kit.Key label="Mute" caption pressed={pressed} onPress={() => setPressed(!pressed)} icon={<Search size={20} />} /></F>
        <F form="loading"><kit.Key label="Save" caption loading onPress={noop} icon={<Search size={20} />} /></F>
        <F form="planned"><kit.Key label="Plan" caption planned onPlanned={noop} onPress={noop} icon={<Search size={20} />} /></F>
        <F form="error"><kit.Key label="Send" caption error="send failed" onPress={noop} icon={<Search size={20} />} /></F>
        <F form="disabled with reason"><kit.Key label="Wait" caption disabledReason="needs a card" onPress={noop} icon={<Search size={20} />} /></F>
      </B>
      <B name="TickSlider" pkg="kit">
        <F form="working with number"><kit.TickSlider label="Brightness" value={n} onChange={setN} unit="%" withNumber /></F>
        <F form="planned"><kit.TickSlider label="Planned level" value={20} onChange={noop} planned onPlanned={noop} /></F>
        <F form="error"><kit.TickSlider label="Bad level" value={20} onChange={noop} error="out of range" /></F>
        <F form="disabled with reason"><kit.TickSlider label="Held level" value={20} onChange={noop} disabledReason="locked by rule" /></F>
      </B>
      <B name="Knob" pkg="kit">
        <F form="hero and compact"><kit.Knob label="Volume" value={n} onChange={setN} unit="%" /> <kit.Knob label="Trim" size="compact" value={30} onChange={noop} /></F>
        <F form="planned"><kit.Knob label="Planned knob" value={0} onChange={noop} planned onPlanned={noop} /></F>
        <F form="error"><kit.Knob label="Bad knob" value={50} onChange={noop} error="no signal" /></F>
        <F form="disabled with reason"><kit.Knob label="Held knob" value={50} onChange={noop} disabledReason="locked by rule" /></F>
      </B>
      <B name="Plate" pkg="kit">
        <F form="plain, serial, barcode"><kit.Plate>CORE</kit.Plate> <kit.Plate serial="SN 0042" barcode>ROOM</kit.Plate></F>
        <F form="status lamps"><States>{(s) => <kit.Plate state={s}>{s}</kit.Plate>}</States></F>
        <F form="planned and link"><kit.Plate planned>SOON</kit.Plate> <kit.Plate href="#bn-top">LINK</kit.Plate></F>
      </B>
      <B name="Readout" pkg="kit">
        <F form="five states"><States>{(s) => <kit.Readout label={`R ${s}`} value={21.5} unit="C" state={s} reason={STATE_REASON[s]} />}</States></F>
        <F form="stale live"><kit.Readout label="Stale" value={7} state="live" ageS={90} /></F>
      </B>
      <B name="Numerals" pkg="kit">
        <F form="five states, 56 and 72"><States>{(s) => <kit.Numerals label={`N ${s}`} value={42} state={s} reason={STATE_REASON[s]} size={s === 'live' ? 72 : 56} />}</States></F>
      </B>
      <B name="ReadoutLines" pkg="kit">
        <F form="five states"><kit.ReadoutLines label="Lines" lines={LAMP_STATES.map((s) => ({ key: s, value: 3.14, state: s, reason: STATE_REASON[s] }))} /></F>
      </B>
      <B name="TelemetryRail" pkg="kit">
        <F form="rows, actionable, planned"><kit.TelemetryRail label="Telemetry" rows={LAMP_STATES.map((s, i) => ({ id: s, label: s, value: 9, state: s, reason: STATE_REASON[s], onPress: i === 0 ? noop : undefined }))} /></F>
      </B>
      <B name="ProgressBar" pkg="kit">
        <F form="live value, simulated, unknown, planned, fault">
          <kit.ProgressBar label="Copy" state="live" value={60} />
          <kit.ProgressBar label="Sample" state="simulated" value={30} />
          <kit.ProgressBar label="Waiting load" state="waiting" />
          <kit.ProgressBar label="Planned load" state="planned" />
          <kit.ProgressBar label="Failed load" state="fault" />
        </F>
      </B>
      <B name="Console" pkg="kit">
        <F form="with prompt"><kit.Console label="Events" lines={LOG} onSubmit={noop} onCopy={noop} /></F>
        <F form="planned prompt (no onSubmit)"><kit.Console label="Read-only events" lines={LOG} /></F>
      </B>
      <B name="Frame" pkg="kit">
        <F form="state and stamp"><kit.Frame state="live" stamp="REV 3">Frame body</kit.Frame></F>
        <F form="simulated, planned"><kit.Frame state="simulated" reason="generated">Sample frame</kit.Frame> <kit.Frame planned>Planned frame</kit.Frame></F>
      </B>
      <B name="Panel" pkg="kit">
        <F form="plain, error, planned"><kit.Panel>Panel body</kit.Panel> <kit.Panel error="could not load">Faulty panel</kit.Panel> <kit.Panel planned>Planned panel</kit.Panel></F>
      </B>
      <B name="FolderTabs" pkg="kit">
        <F form="tabs with a planned one"><kit.FolderTabs label="Views" value={tab} onChange={setTab} onPlanned={noop} tabs={[{ id: 't1', label: 'One', count: 3 }, { id: 't2', label: 'Two' }, { id: 't3', label: 'Soon', planned: true }]} /></F>
      </B>
      <B name="PaletteView" pkg="kit">
        <F form="grouped list with a planned row"><kit.PaletteView items={PALETTE} onRun={noop} onPlanned={noop} onClose={noop} /></F>
      </B>
      <B name="NotchedToastStack" pkg="kit" also={['NotchedToast']}>
        <F form="OK, NOTE, FAULT with undo"><kit.NotchedToastStack onDismiss={noop} toasts={[{ id: 'a', tag: 'OK', message: 'Saved' }, { id: 'b', tag: 'NOTE', message: 'Heads up', undo: { onUndo: noop } }, { id: 'c', tag: 'FAULT', message: 'Send failed' }]} /></F>
      </B>

      {/* ------------------------------------------------------------------ kit: legacy ww-* controls (drawn by ww/kit css) */}
      <div className="ww bn-legacy" data-section="wellwisher" data-density="regular">
        <B name="Button" pkg="kit">
          <F form="quiet, primary, danger"><kit.Button>Quiet</kit.Button> <kit.Button tone="primary">Primary</kit.Button> <kit.Button tone="danger">Danger</kit.Button></F>
          <F form="sizes sm md lg"><kit.Button size="sm">Small</kit.Button> <kit.Button size="md">Medium</kit.Button> <kit.Button size="lg">Large</kit.Button></F>
          <F form="grouped"><kit.Button grouped size="sm">A</kit.Button><kit.Button grouped size="sm">B</kit.Button></F>
          <F form="loading"><kit.Button loading>Saving</kit.Button></F>
          <F form="disabled with reason"><kit.Button disabledReason="needs a card">Pay</kit.Button></F>
        </B>
        <B name="IconButton" pkg="kit">
          <F form="sizes"><kit.IconButton label="Search" size="sm"><Search size={16} /></kit.IconButton> <kit.IconButton label="Search more"><Search size={18} /></kit.IconButton> <kit.IconButton label="Search lots" size="lg"><Search size={20} /></kit.IconButton></F>
        </B>
        <B name="Segmented" pkg="kit">
          <F form="view"><kit.Segmented label="View" value={seg} onChange={setSeg} options={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three', disabledReason: 'not built' }]} /></F>
          <F form="choice"><kit.Segmented label="Choice" variant="choice" value={seg} onChange={setSeg} options={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]} /></F>
          <F form="compact"><kit.Segmented label="Compact" variant="compact" value={seg} onChange={setSeg} options={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]} /></F>
        </B>
        <B name="Chip" pkg="kit">
          <F form="static tones"><kit.Chip>Neutral</kit.Chip> <kit.Chip tone="live">Live</kit.Chip> <kit.Chip tone="sim">Sim</kit.Chip> <kit.Chip tone="fault">Fault</kit.Chip> <kit.Chip tone="behind">Behind</kit.Chip></F>
          <F form="toggle and count"><kit.Chip selected count={3} onClick={noop}>Filter</kit.Chip> <kit.Chip onClick={noop}>Other</kit.Chip></F>
          <F form="cycle"><kit.Chip cycle={cyc} onCycle={setCyc}>Topic</kit.Chip> <kit.Chip grouped onClick={noop}>Grouped</kit.Chip></F>
        </B>
        <B name="Field" pkg="kit">
          <F form="text with hint"><kit.Field label="Name" hint="As on the card" /></F>
          <F form="number with unit"><kit.Field label="Weight" kind="number" unit="kg" /></F>
          <F form="date and time"><kit.Field label="Date" kind="date" /> <kit.Field label="Time" kind="time" /></F>
          <F form="area"><kit.Field label="Notes" kind="area" /></F>
          <F form="select"><kit.Field label="Pick" kind="select"><option>One</option><option>Two</option></kit.Field></F>
          <F form="error"><kit.Field label="Email" error="needs an at sign" defaultValue="nope" /></F>
          <F form="disabled"><kit.Field label="Locked" disabled defaultValue="read only" /></F>
        </B>
        <B name="Skeleton" pkg="kit">
          <F form="loading (appears after 200 ms)"><kit.Skeleton lines={3} /></F>
        </B>
        <B name="Section" pkg="kit">
          <F form="plain and primary"><kit.Section id="S1" hint="Where the day starts" aria-label="Start">Section body</kit.Section> <kit.Section id="S2" hint="Primary here" primary as="div">Primary section body</kit.Section></F>
        </B>
        <B name="PrimaryButton" pkg="kit">
          <F form="owner and loser">
            <kit.PrimaryOwner>
              <kit.PrimaryButton claimId="a" rank="now">Winner</kit.PrimaryButton> <kit.PrimaryButton claimId="b" rank="workspace">Quiet</kit.PrimaryButton> <kit.PrimaryButton claimId="c" rank="now" when={false}>Withdrawn</kit.PrimaryButton>
            </kit.PrimaryOwner>
          </F>
        </B>
        <B name="Toast" pkg="kit" also={['ToastStack']}>
          <F form="neutral, live, fault, with action"><kit.ToastStack onDismiss={noop} toasts={[{ id: 'a', message: 'Saved' }, { id: 'b', tone: 'live', message: 'Connected' }, { id: 'c', tone: 'fault', message: 'Lost the board', action: { label: 'Retry', onAction: noop } }]} /></F>
        </B>
        <B name="Banner" pkg="kit">
          <F form="info, sim, fault with action"><kit.Banner>Dates are tentative</kit.Banner> <kit.Banner tone="sim">Showing sample data</kit.Banner> <kit.Banner tone="fault" action={<kit.Button size="sm">Retry</kit.Button>}>Board not answering</kit.Banner></F>
        </B>
        <B name="EmptyState" pkg="kit">
          <F form="title, body, reason, action"><kit.EmptyState title="Nothing yet" body="Add the first item." reason="no data has arrived" action={<kit.Button>Add</kit.Button>} /></F>
        </B>
        <B name="Fold" pkg="kit">
          <F form="closed, open, lazy"><kit.Fold title="Closed fold" open={fold} onToggle={setFold}>Body</kit.Fold> <kit.Fold title="Open fold" defaultOpen>Body</kit.Fold> <kit.Fold title="Lazy fold" lazy>Lazy body</kit.Fold></F>
        </B>
        <B name="TapGroup" pkg="kit">
          <F form="toggle group"><kit.TapGroup label="Mood" value={tap} onTap={(id) => setTap(id)} options={[{ id: 'x', label: 'Calm' }, { id: 'y', label: 'Busy' }]} /></F>
        </B>
        <B name="MasterDetail" pkg="kit">
          <F form="list and detail">
            <kit.MasterDetail listLabel="Items" detailLabel="Detail" selectedId={sel} onSelect={setSel}
              list={(select, id) => <ul>{['a', 'b'].map((k) => <li key={k}><kit.Button size="sm" aria-pressed={id === k} onClick={() => select(k)}>Item {k}</kit.Button></li>)}</ul>}
              detail={(id) => <p>Detail of {id}</p>} />
          </F>
        </B>
      </div>

      {!OPEN && overlays}

      {/* ------------------------------------------------------------------ art package */}
      <B name="NodeRing" pkg="art"><F form="live centre"><art.NodeRing caption="Subsystems" nodes={RING_NODES} centre={{ value: '3', caption: 'open', state: 'live' }} onOpen={noop} /></F></B>
      <B name="Orbit" pkg="art"><F form="hero"><art.Orbit caption="Milestones" milestones={ORBIT_MS} now={{ orbit: 1, at: 0.3 }} onOpen={noop} /></F><F form="compact"><art.Orbit caption="Milestones small" size="compact" milestones={ORBIT_MS} /></F></B>
      <B name="RingBars" pkg="art"><F form="five states">{LAMP_STATES.map((s) => <art.RingBars key={s} caption={`Bars ${s}`} state={s} max={10} unit="h" reason={STATE_REASON[s]} showTable={s === 'live'} bars={[{ id: 'a', label: 'Mon', value: 4 }, { id: 'b', label: 'Tue', value: null }, { id: 'c', label: 'Wed', value: 9 }]} />)}</F></B>
      <B name="Ridge" pkg="art"><F form="five states">{LAMP_STATES.map((s) => <art.Ridge key={s} state={s} source="room sensor" reason={STATE_REASON[s]} width={360} height={180} unit="dB" rows={RIDGE_ROWS} />)}</F></B>
      <B name="Callout" pkg="art"><F form="normal, planned, fault"><art.Callout caption="Room parts" width={400} height={220} points={[{ id: 'a', x: 60, y: 60, label: 'Lamp', value: '12 W' }, { id: 'b', x: 200, y: 140, label: 'Fan', value: 'off', status: 'planned' }, { id: 'c', x: 320, y: 70, label: 'Board', value: 'lost', status: 'fault' }]} /></F></B>
      <B name="Spec" pkg="art"><F form="fitted and not fitted"><art.Spec caption="Case dimensions" rows={[{ id: 'a', label: 'Width', mm: 120 }, { id: 'b', label: 'Depth', mm: 60, note: 'with lid' }, { id: 'c', label: 'Height', mm: null }]} /></F></B>
      <B name="DotTimer" pkg="art"><F form="running, paused, ended, resting"><art.DotTimer plannedMin={25} elapsedMin={10} state="live" /><art.DotTimer plannedMin={25} elapsedMin={10} paused state="live" /><art.DotTimer plannedMin={25} elapsedMin={12} ended state="simulated" compact /><art.DotTimer plannedMin={25} elapsedMin={0} resting state="waiting" /></F></B>
      <B name="DateWheel" pkg="art"><F form="items and today"><art.DateWheel caption="Dates ahead" items={WHEEL} today="2026-11-13" onOpen={noop} /></F></B>
      <B name="PillarsChart" pkg="art"><F form="five states, sample, editable">{LAMP_STATES.map((s) => <art.PillarsChart key={s} state={s} caption={`Pillars ${s}`} axes={AXES} sample={s === 'simulated'} editable={s === 'live'} onChange={noop} />)}</F></B>
      <B name="WeekStrip" pkg="art"><F form="selected and today"><art.WeekStrip days={DAYS} today="2026-11-13" selected="2026-11-12" onOpen={noop} /></F></B>
      <B name="AsciiSweep" pkg="art" also={['AsciiEmptyState']}>
        <F form="active sweep (bounded 5 s)"><art.AsciiSweep verb="reading memory" /></F>
        <F form="empty states">{(['tree', 'memory', 'console', 'error'] as const).map((v) => <art.AsciiEmptyState key={v} variant={v} message={`Nothing in ${v}`} action={{ label: `Open ${v}`, onAction: noop }} />)}</F>
      </B>
      <B name="StippleRing" pkg="art" also={['DotMatrixMeter']}>
        <F form="five states">{LAMP_STATES.map((s) => <art.StippleRing key={s} frac={0.6} value="60%" state={s} caption={`Ring ${s}`} reason={STATE_REASON[s]} size={120} />)}</F>
        <F form="meter, five states">{LAMP_STATES.map((s) => <art.DotMatrixMeter key={s} level={s === 'live' ? 6 : null} min={0} max={10} unit="mm" state={s} caption={`Meter ${s}`} reason={STATE_REASON[s]} />)}</F>
      </B>
      <B name="Dither" pkg="art"><F form="four kinds">{(['ring', 'ridge', 'bloom', 'bridge'] as const).map((k) => <art.Dither key={k} kind={k} cols={32} rows={20} />)}</F></B>
      <B name="CellSkeleton" pkg="art"><F form="loading and ready"><art.CellSkeleton depth={2} seed={3} /><art.CellSkeleton ready>Loaded content</art.CellSkeleton></F></B>
      <B name="BlankingPlate" pkg="art"><F form="planned and built-not-verified"><art.BlankingPlate entry={PLAIN} onOpen={noop} /><art.BlankingPlate entry={WAITING_ENTRY} onOpen={noop} /></F></B>
      <B name="ArtTable" pkg="art" also={['Figure', 'StateMark', 'StateTag']}>
        <F form="visible table inside a figure"><art.Figure component="bench-figure" state="live" caption="A figure and its table"><art.ArtTable caption="Rows" head={['Name', 'Value']} rows={[['a', 1], ['b', 2]]} visible /></art.Figure></F>
        <F form="marks and tags"><States>{(s) => <art.StateTag state={s} reason={STATE_REASON[s]} />}</States><States>{(s) => <art.StateMark state={s} size={24} />}</States></F>
      </B>
    </main>
  )
}

// What the spec compares: every capitalised function export, per package, against what the page drew.
const fns = (ns: Record<string, unknown>) => Object.keys(ns).filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !/^[A-Z0-9_]+$/.test(k) && typeof ns[k] === 'function')
const w = window as unknown as { __bench: unknown }
createRoot(document.getElementById('root')!).render(<Bench />)
w.__bench = { exports: { kit: fns(kit), art: fns(art), lamp: fns(lampPkg) }, rendered: () => [...RENDERED] }
