// The Well Wisher controls that moved to the shared kit unchanged (S7, first half). They are still drawn by the `.ww-*`
// stylesheet of Well Wisher, so the gallery wraps them in the `.ww` scope: they look here as they look in Well Wisher.
import { useState } from 'react'
import { Search } from 'lucide-react'
import * as kit from '../../shared/kit'
import type { GalleryEntryX } from '../types'
import { noop } from '../fixtures'

const merged = 'kit move, first half, 12 Nov'

function SegDemo({ variant, label, three }: { variant?: 'choice' | 'compact'; label: string; three?: boolean }) {
  const [seg, setSeg] = useState('one')
  const options = three
    ? [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three', disabledReason: 'not built' }]
    : [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]
  return <kit.Segmented label={label} variant={variant} value={seg} onChange={setSeg} options={options} />
}
function ChipCycle() {
  const [cyc, setCyc] = useState<kit.CycleState>('todo')
  return <><kit.Chip cycle={cyc} onCycle={setCyc}>Topic</kit.Chip> <kit.Chip grouped onClick={noop}>Grouped</kit.Chip></>
}
function FoldDemo() {
  const [fold, setFold] = useState(false)
  return <><kit.Fold title="Closed fold" open={fold} onToggle={setFold}>Body</kit.Fold> <kit.Fold title="Open fold" defaultOpen>Body</kit.Fold> <kit.Fold title="Lazy fold" lazy>Lazy body</kit.Fold></>
}
function TapDemo() {
  const [tap, setTap] = useState<string | null>('x')
  return <kit.TapGroup label="Mood" value={tap} onTap={(id) => setTap(id)} options={[{ id: 'x', label: 'Calm' }, { id: 'y', label: 'Busy' }]} />
}
function MasterDetailDemo() {
  const [sel, setSel] = useState('b')
  return (
    <kit.MasterDetail listLabel="Items" detailLabel="Detail" selectedId={sel} onSelect={setSel}
      list={(select, id) => <ul>{['a', 'b'].map((k) => <li key={k}><kit.Button size="sm" aria-pressed={id === k} onClick={() => select(k)}>Item {k}</kit.Button></li>)}</ul>}
      detail={(id) => <p>Detail of {id}</p>} />
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'kit/Button', title: 'Button', group: 'kit', legacy: true, merged, note: 'Quiet, primary and danger. A disabled button says why.',
    states: [
      { label: 'quiet, primary, danger', node: <><kit.Button>Quiet</kit.Button> <kit.Button tone="primary">Primary</kit.Button> <kit.Button tone="danger">Danger</kit.Button></> },
      { label: 'sizes sm md lg', node: <><kit.Button size="sm">Small</kit.Button> <kit.Button size="md">Medium</kit.Button> <kit.Button size="lg">Large</kit.Button></> },
      { label: 'grouped', node: <><kit.Button grouped size="sm">A</kit.Button><kit.Button grouped size="sm">B</kit.Button></> },
      { label: 'loading', node: <kit.Button loading>Saving</kit.Button> },
      { label: 'disabled with reason', node: <kit.Button disabledReason="needs a card">Pay</kit.Button> },
    ],
  },
  {
    id: 'kit/IconButton', title: 'IconButton', group: 'kit', legacy: true, merged, note: 'An icon with a spoken label, three sizes.',
    states: [{ label: 'sizes', node: <><kit.IconButton label="Search" size="sm"><Search size={16} /></kit.IconButton> <kit.IconButton label="Search more"><Search size={18} /></kit.IconButton> <kit.IconButton label="Search lots" size="lg"><Search size={20} /></kit.IconButton></> }],
  },
  {
    id: 'kit/Segmented', title: 'Segmented', group: 'kit', legacy: true, merged, note: 'One choice of a few, in three densities.',
    states: [
      { label: 'view', node: <SegDemo label="View" three /> },
      { label: 'choice', node: <SegDemo label="Choice" variant="choice" /> },
      { label: 'compact', node: <SegDemo label="Compact" variant="compact" /> },
    ],
  },
  {
    id: 'kit/Chip', title: 'Chip', group: 'kit', legacy: true, merged, note: 'A tag or a filter. The cycle chip steps through todo, doing and done.',
    states: [
      { label: 'static tones', node: <><kit.Chip>Neutral</kit.Chip> <kit.Chip tone="live">Live</kit.Chip> <kit.Chip tone="sim">Sim</kit.Chip> <kit.Chip tone="fault">Fault</kit.Chip> <kit.Chip tone="behind">Behind</kit.Chip></> },
      { label: 'toggle and count', node: <><kit.Chip selected count={3} onClick={noop}>Filter</kit.Chip> <kit.Chip onClick={noop}>Other</kit.Chip></> },
      { label: 'cycle', node: <ChipCycle /> },
    ],
  },
  {
    id: 'kit/Field', title: 'Field', group: 'kit', legacy: true, merged, note: 'A labelled input in seven kinds; the error is a sentence, not a colour.',
    states: [
      { label: 'text with hint', node: <kit.Field label="Name" hint="As on the card" /> },
      { label: 'number with unit', node: <kit.Field label="Weight" kind="number" unit="kg" /> },
      { label: 'date and time', node: <><kit.Field label="Date" kind="date" /> <kit.Field label="Time" kind="time" /></> },
      { label: 'area', node: <kit.Field label="Notes" kind="area" /> },
      { label: 'select', node: <kit.Field label="Pick" kind="select"><option>One</option><option>Two</option></kit.Field> },
      { label: 'error', node: <kit.Field label="Email" error="needs an at sign" defaultValue="nope" /> },
      { label: 'disabled', node: <kit.Field label="Locked" disabled defaultValue="read only" /> },
    ],
  },
  { id: 'kit/Skeleton', title: 'Skeleton', group: 'kit', legacy: true, merged, note: 'A loading placeholder that appears only after 200 ms.', states: [{ label: 'loading (appears after 200 ms)', node: <kit.Skeleton lines={3} /> }] },
  {
    id: 'kit/Section', title: 'Section', group: 'kit', legacy: true, merged, also: ['SectionOrder'], note: 'A labelled region of a view; one per view may be primary.',
    states: [{ label: 'plain and primary', node: <><kit.Section id="S1" hint="Where the day starts" aria-label="Start">Section body</kit.Section> <kit.Section id="S2" hint="Primary here" primary as="div">Primary section body</kit.Section></> }],
  },
  {
    id: 'kit/PrimaryButton', title: 'PrimaryButton', group: 'kit', legacy: true, merged, also: ['PrimaryOwner'], note: 'Only one primary button wins a view; the others fall back to quiet.',
    states: [{ label: 'owner and loser', node: (
      <kit.PrimaryOwner>
        <kit.PrimaryButton claimId="a" rank="now">Winner</kit.PrimaryButton> <kit.PrimaryButton claimId="b" rank="workspace">Quiet</kit.PrimaryButton> <kit.PrimaryButton claimId="c" rank="now" when={false}>Withdrawn</kit.PrimaryButton>
      </kit.PrimaryOwner>
    ) }],
  },
  {
    id: 'kit/Toast', title: 'Toast', group: 'kit', legacy: true, merged, also: ['ToastStack'], note: 'A message that leaves on its own; a fault stays until read.',
    states: [{ label: 'neutral, live, fault, with action', node: <kit.ToastStack onDismiss={noop} toasts={[{ id: 'a', message: 'Saved' }, { id: 'b', tone: 'live', message: 'Connected' }, { id: 'c', tone: 'fault', message: 'Lost the board', action: { label: 'Retry', onAction: noop } }]} /> }],
  },
  {
    id: 'kit/Banner', title: 'Banner', group: 'kit', legacy: true, merged, note: 'A line above a view: info, sample data or a fault.',
    states: [{ label: 'info, sim, fault with action', node: <><kit.Banner>Dates are tentative</kit.Banner> <kit.Banner tone="sim">Showing sample data</kit.Banner> <kit.Banner tone="fault" action={<kit.Button size="sm">Retry</kit.Button>}>Board not answering</kit.Banner></> }],
  },
  {
    id: 'kit/EmptyState', title: 'EmptyState', group: 'kit', legacy: true, merged, note: 'Nothing here yet: what, why and the next step.',
    states: [{ label: 'title, body, reason, action', node: <kit.EmptyState title="Nothing yet" body="Add the first item." reason="no data has arrived" action={<kit.Button>Add</kit.Button>} /> }],
  },
  { id: 'kit/Fold', title: 'Fold', group: 'kit', legacy: true, merged, note: 'A disclosure; the lazy fold mounts its body on first open.', states: [{ label: 'closed, open, lazy', node: <FoldDemo /> }] },
  { id: 'kit/TapGroup', title: 'TapGroup', group: 'kit', legacy: true, merged, note: 'A toggle group for logging a mood or a class.', states: [{ label: 'toggle group', node: <TapDemo /> }] },
  { id: 'kit/MasterDetail', title: 'MasterDetail', group: 'kit', legacy: true, merged, note: 'A list and its detail; narrow screens show one at a time.', states: [{ label: 'list and detail', node: <MasterDetailDemo /> }] },
]
export default entries
