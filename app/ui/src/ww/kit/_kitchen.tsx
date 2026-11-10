// The kitchen sink (plan 9, chunk 1b): every primitive of 5.5 in every state, on one page.
//
// It is a dev surface, not a route: the row does not own a route file, so the Playwright specs build
// this module into a lab page (e2e/kitchen.ts) and the vitest suite mounts it directly. Nothing in
// the app imports it. Every string is fictional; there is no owner data here.
import { createRoot, type Root } from 'react-dom/client'
import { useRef, useState, type ReactNode } from 'react'
import { Plus, Settings, Trash2 } from 'lucide-react'
import {
  Banner, Button, Card, CardHead, Chip, CoachMark, ComingCard, CursorLabel, Drawer, EmptyState, Field, Fold, HoldButton, IconButton, LockChip, MasterDetail, Meter, PinHeader, Popover, PrimaryButton, PrimaryOwner,
  Reveal, Row, Section, Segmented, Sheet, Skeleton, Spark, StageStrip, Stat, TapGroup, Toast, ToastStack,
  type CycleState, type ToastItem,
} from './index'
import './_kitchen.css'

export type KitchenOverlay = 'drawer' | 'sheet' | 'popover' | 'toast' | null
export interface KitchenOptions {
  /** Open one overlay at load, for the screenshot specs. */
  overlay?: KitchenOverlay
}

/** One labelled block per primitive; `data-kitchen` is the name the specs and tests look for. */
function Block({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Section id={`K-${name}`} hint={`The ${name} primitive in every state`}>
      <p className="ww-kicker">{name}</p>
      <div className="kitchen-row" data-kitchen={name}>
        {children}
      </div>
    </Section>
  )
}

export function Kitchen({ overlay = null }: KitchenOptions) {
  const [seg, setSeg] = useState('papers')
  const [topic, setTopic] = useState<CycleState>('todo')
  const [tap, setTap] = useState<string | null>('p')
  const [drawer, setDrawer] = useState(overlay === 'drawer')
  const [sheet, setSheet] = useState(overlay === 'sheet')
  const [pop, setPop] = useState(overlay === 'popover')
  const [dirty, setDirty] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>(overlay === 'toast' ? [{ id: 't1', message: 'Marks saved. Tomorrow’s blocks changed.', action: { label: 'Undo', onAction: () => {} } }] : [])
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <PrimaryOwner>
      <div className="ww-centre kitchen" data-ws="study" style={{ display: 'grid', gap: 'var(--gap-group)', padding: 'var(--space-4)' }}>
        <PinHeader title="Kitchen sink" level={1}>
          <IconButton label="Settings" size="sm">
            <Settings size={18} aria-hidden="true" />
          </IconButton>
        </PinHeader>

        <Block name="Button">
          <Button size="sm">Small</Button>
          <Button>Medium</Button>
          <Button size="lg">Large</Button>
          <Button tone="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button disabledReason="Needs one marked paper.">Sharpen</Button>
          <span className="kitchen-group" data-kitchen-group="grouped">
            <Button grouped size="sm">+25</Button>
            <Button grouped size="sm">+50</Button>
            <Button grouped size="sm">+90</Button>
          </span>
          <PrimaryButton claimId="kitchen-start" rank="now">Start</PrimaryButton>
          <PrimaryButton claimId="kitchen-save" rank="workspace" when={dirty} onClick={() => setDirty(false)}>Save</PrimaryButton>
          <Button onClick={() => setDirty(true)}>Make a change</Button>
        </Block>
        <Block name="IconButton">
          <IconButton label="Add" size="sm"><Plus size={18} aria-hidden="true" /></IconButton>
          <IconButton label="Settings"><Settings size={18} aria-hidden="true" /></IconButton>
          <IconButton label="Delete" size="lg"><Trash2 size={18} aria-hidden="true" /></IconButton>
          <IconButton label="Add (grouped)" grouped><Plus size={18} aria-hidden="true" /></IconButton>
        </Block>
        <Block name="Segmented">
          <Segmented label="View" value={seg} onChange={setSeg} options={[{ id: 'papers', label: 'Papers' }, { id: 'plan', label: 'Plan' }, { id: 'dmat', label: 'dMAT', disabledReason: 'Not built yet.' }]} />
          <Segmented label="Level" variant="choice" value="exam" onChange={() => {}} options={[{ id: 'exam', label: 'Exam' }, { id: 'gate', label: 'GATE', disabledReason: 'No GATE bank yet.' }]} />
          <Segmented label="Range" variant="compact" value="w" onChange={() => {}} options={[{ id: 'd', label: 'Day' }, { id: 'w', label: 'Week' }]} />
        </Block>
        <Block name="Chip">
          <Chip>Plain</Chip>
          <Chip tone="live">Measured</Chip>
          <Chip tone="sim">Simulated</Chip>
          <Chip tone="fault">Fault</Chip>
          <Chip tone="behind" count={2}>Behind</Chip>
          <Chip selected onClick={() => {}}>Today</Chip>
          <Chip cycle={topic} onCycle={setTopic}>Limits</Chip>
          <Chip cycle="learned" onCycle={() => {}} grouped>Series</Chip>
          <Chip cycle="solid" onCycle={() => {}} grouped>Vectors</Chip>
        </Block>
        <Block name="Field">
          <Field label="Marks" kind="number" unit="of 20" hint="Whole marks only." defaultValue={14} />
          <Field label="Topic" defaultValue="Limits" />
          <Field label="Marks (error)" kind="number" error="More than 20." defaultValue={25} />
          <Field label="Note" kind="area" defaultValue="Revise series." />
          <Field label="Tier" kind="select" defaultValue="exam"><option value="exam">Exam</option><option value="gate">GATE</option></Field>
          <Field label="Locked" disabled defaultValue="Read only" />
        </Block>
        <Block name="Card">
          <Card data-card="k-default" title="Default card" kicker="Practice" action={<Button size="sm">Edit</Button>} index={0}>Body text of a default card.</Card>
          <Card data-card="k-raised" title="Raised" tone="raised" level={3}>A raised surface.</Card>
          <Card data-card="k-quiet" title="Quiet" tone="quiet" level={3}>No fill.</Card>
          <Card data-card="k-lift" title="Interactive" lift level={3}>Lifts 2 px on hover.</Card>
          <Card data-card="k-loading" title="Loading" loading level={3} />
          <Card data-card="k-error" title="Failed" error="Could not load the plan." onRetry={() => {}} level={3} />
        </Block>
        <Block name="CardHead">
          <CardHead title="A bare head" kicker="Kicker" action={<Chip>Action</Chip>} />
        </Block>
        <Block name="Section">
          <p className="kitchen-note">Every block on this page is a Section with an id and a hint.</p>
        </Block>
        <Block name="PrimaryOwner">
          <p className="kitchen-note">Exactly one Start or Save above wears the fill (data-primary).</p>
        </Block>
        <Block name="Fold">
          <div className="kitchen-wide">
            <Fold title="Why this" defaultOpen>Open body.</Fold>
            <Fold title="More" lazy>Never mounted until opened.</Fold>
          </div>
        </Block>
        <Block name="Row">
          <div style={{ inlineSize: '100%' }}>
            <Row lead="09:00" title="Calculus" meta="Room 4" action={<Button size="sm" grouped>Open</Button>} />
            <Row lead="11:00" title="Physics" meta="Behind by 2 sessions" state="behind" />
            <Row lead="14:00" title="Chemistry" meta="Paper due" state="overdue" />
            <Row lead="16:00" title="Workshop" meta="Logged" state="done" />
          </div>
        </Block>
        <Block name="Stat">
          <Stat label="Papers" value={4} unit="done" />
          <Stat label="Streak" value={0} next="study 25 minutes" />
          <Stat label="Coverage" value={null} />
        </Block>
        <Block name="Meter">
          <div style={{ inlineSize: '100%', display: 'grid', gap: 'var(--space-2)' }}>
            <Meter value={0} label="Empty" />
            <Meter value={0.55} label="Half" />
            <Meter value={1} label="Full" />
            <Meter value={null} label="Not measured" />
          </div>
        </Block>
        <Block name="Spark">
          <Spark points={[3, 5, 4, 8, 7, 9]} label="Minutes" />
          <Spark points={[]} label="Marks" />
        </Block>
        <Block name="StageStrip">
          <StageStrip label="Paper stages" stages={[{ id: 'a', label: 'Learn', count: 6, state: 'done' }, { id: 'b', label: 'Practise', count: 2, state: 'current' }, { id: 'c', label: 'Mark', state: 'unknown' }, { id: 'd', label: 'Review', count: 0, state: 'todo' }]} />
        </Block>
        <Block name="TapGroup">
          <TapGroup label="Maths class" value={tap} onTap={setTap} options={[{ id: 'p', label: 'P', title: 'Present' }, { id: 'a', label: 'A', title: 'Absent' }, { id: 'c', label: 'C', title: 'Cancelled' }]} />
        </Block>
        <Block name="MasterDetail">
          <div style={{ inlineSize: '100%' }}>
            <MasterDetail listLabel="Papers" detailLabel="Paper detail" memoryKey="kitchen" list={(select, sel) => <div style={{ display: 'grid', gap: 'var(--space-1)' }}>{['CIE 1', 'CIE 2'].map((p) => <Button key={p} grouped size="sm" aria-pressed={sel === p} onClick={() => select(p)}>{p}</Button>)}</div>} detail={(sel) => <p className="kitchen-note">{sel ?? 'Pick a paper.'}</p>} />
          </div>
        </Block>
        <Block name="EmptyState">
          <EmptyState title="No questions yet" body="The bank is empty." reason="Nothing has been added." action={<Button size="sm">Add questions</Button>} />
        </Block>
        <Block name="Banner">
          <div style={{ inlineSize: '100%' }}><Banner tone="sim" action={<Button size="sm">Confirm dates</Button>}>Dates are tentative until the date sheet is out.</Banner></div>
        </Block>
        <Block name="Skeleton">
          <div style={{ inlineSize: '100%' }}><Skeleton lines={3} /></div>
        </Block>
        <Block name="Reveal">
          <Reveal index={0}><Chip>Arrives once</Chip></Reveal>
          <Reveal index={1}><Chip>Then rests</Chip></Reveal>
        </Block>
        <Block name="ComingCard">
          <ComingCard featureId="kitchen-coming" label="Sharpen" line="Sharpen needs one GATE-tier question solved on this node." when="after the end-sems" />
        </Block>
        <Block name="LockChip">
          <LockChip id="kitchen-lock" reason="Needs one marked paper." />
        </Block>
        <Block name="CoachMark">
          <div style={{ inlineSize: '100%' }}><CoachMark id="kitchen-coach" text="Drag to pan, scroll to zoom." /></div>
        </Block>
        <Block name="HoldButton">
          <HoldButton label="Reset week" onConfirm={() => {}} />
          <HoldButton label="End session" onConfirm={() => {}} reason="No session is running." />
        </Block>
        <Block name="PinHeader">
          <p className="kitchen-note">The head at the top of this page is a PinHeader.</p>
        </Block>
        <Block name="CursorLabel">
          <span data-cursor="Open node" className="kitchen-note">Hover here with a mouse.</span>
        </Block>
        <Block name="Drawer">
          <Button onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button ref={anchor} onClick={() => setPop((v) => !v)}>Day shape</Button>
          <Button onClick={() => setToasts([{ id: String(Date.now()), message: 'Saved.' }])}>Show toast</Button>
        </Block>
        <Block name="Toast">
          <Toast message="A plain toast." onDismiss={() => {}} />
          <Toast tone="fault" message="Could not save marks." onDismiss={() => {}} />
        </Block>
      </div>
      <CursorLabel />
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Settings">
        <Field label="Name" defaultValue="Sample" />
        <Button tone="danger" size="sm">Reset</Button>
      </Drawer>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Log minutes">
        <Field label="Minutes" kind="number" defaultValue={25} />
      </Sheet>
      <Popover open={pop} onClose={() => setPop(false)} anchor={anchor} label="Day shape">
        <p className="kitchen-note">Morning heavy, evening light.</p>
      </Popover>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </PrimaryOwner>
  )
}

/** Mount the kitchen into `el` inside a themed .ww root, as the specs and the vitest suite do. */
export function mountKitchen(el: HTMLElement, opts: KitchenOptions = {}): Root {
  el.classList.add('ww')
  el.setAttribute('data-section', 'wellwisher')
  el.setAttribute('data-density', 'compact')
  const root = createRoot(el)
  root.render(<Kitchen {...opts} />)
  return root
}

declare global {
  interface Window {
    WWKitchen?: { mount: typeof mountKitchen }
  }
}
if (typeof window !== 'undefined') window.WWKitchen = { mount: mountKitchen }
