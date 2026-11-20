// KIT1, 19 Nov 2026: the pose gallery. Every interactive piece of the shared kit in every pose, side by side, in the page's theme and
// on the dark scene, so one screenshot shows the whole interaction language (plan 08 A3, principle 4 "pose to pose": design the poses
// first, motion only travels between them, so every pose stands alone).
//
// A cell draws one piece in one pose and carries `data-demo="<pose>"`. The pointer and keyboard poses (hover, pressed, focus) are
// painted STILL: the stylesheet answers `[data-demo='hover']` with the same picture `:hover` draws, so the cell sets that attribute on
// the piece's own element after it mounts. checked, disabled and loading are the pieces' real props. A pose a piece cannot be in says
// so, with the reason, in the cell: no cell is empty (an empty cell cannot be told from a forgotten one).
//
// Every control here is a real, live kit component, so it also answers the real pointer: hover one and compare it with its still.
// The Popover and Drawer rows draw the surface (their live behaviour is e2e/overlays.spec.ts) with the one control each carries.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { Button, Chip, Field, IconButton, Key, Rocker, Segmented, Switch } from '../../shared/kit'
import { HoldButton } from '../../shared/kit/Interactive'
import type { GalleryEntryX } from '../types'
import { noop } from '../fixtures'

export const POSES = ['rest', 'hover', 'pressed', 'focus', 'checked', 'disabled', 'loading'] as const
export type Pose = (typeof POSES)[number]
/** The poses painted still by [data-demo] on the piece's own element. */
const STILL: readonly Pose[] = ['hover', 'pressed', 'focus']
const TARGET = 'button, input, select, textarea, [role=switch], [role=radio]'

interface CellSpec {
  /** The live piece in this pose. */
  node?: ReactNode
  /** Why the piece cannot be in this pose; replaces the piece. */
  na?: string
  /** Which element inside the cell takes the still pose (default: the first control). */
  pick?: string
}
interface Row {
  piece: string
  note: string
  cells: Record<Pose, CellSpec>
}

function Cell({ piece, pose, spec }: { piece: string; pose: Pose; spec: CellSpec }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (spec.na || !STILL.includes(pose)) return
    ref.current?.querySelector<HTMLElement>(spec.pick ?? TARGET)?.setAttribute('data-demo', pose)
  }, [pose, spec.na, spec.pick])
  return (
    <div
      ref={ref}
      className="kp-cell"
      data-pose-cell={`${piece}/${pose}`}
      data-piece={piece}
      data-demo={pose}
      data-na={spec.na ? 'true' : undefined}
      style={{ display: 'grid', alignContent: 'start', gap: 8, flex: '0 0 auto', minWidth: 150, maxWidth: '100%', padding: '8px 10px' }}
    >
      <span data-cap="" style={{ font: '600 11px/1 var(--font-mono, ui-monospace, monospace)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        {pose}
      </span>
      {spec.na ? (
        <p style={{ margin: 0, maxWidth: 170, font: '12px/1.4 var(--font-sans, system-ui, sans-serif)', color: 'var(--ink-3)' }}>
          <strong style={{ fontWeight: 600, color: 'var(--ink-2)' }}>n/a</strong> {spec.na}
        </p>
      ) : (
        <div>{spec.node}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- live pieces with their own state
function Seg({ start }: { start: string }) {
  const [v, setV] = useState(start)
  return (
    <Segmented
      label={`Pose ${start}`}
      value={v}
      onChange={setV}
      options={[{ id: 'a', label: 'Day' }, { id: 'b', label: 'Week' }, { id: 'c', label: 'Month' }]}
    />
  )
}
function SegDisabled() {
  const [v, setV] = useState('a')
  return <Segmented label="Pose disabled" value={v} onChange={setV} options={[{ id: 'a', label: 'Day' }, { id: 'b', label: 'Week' }, { id: 'c', label: 'Month', disabledReason: 'not built' }]} />
}
function Sw({ on, label, ...rest }: { on: boolean; label: string; loading?: boolean; disabledReason?: string }) {
  const [v, setV] = useState(on)
  return <Switch label={label} checked={v} onChange={setV} {...rest} />
}
function Rk({ on, label, disabledReason }: { on: boolean; label: string; disabledReason?: string }) {
  const [v, setV] = useState(on)
  return <Rocker label={label} on={v} onChange={setV} disabledReason={disabledReason} />
}
function Kp({ pressed, label, ...rest }: { pressed?: boolean; label: string; loading?: boolean; disabledReason?: string }) {
  const [v, setV] = useState(pressed ?? false)
  return <Key label={label} caption icon={<Search size={18} aria-hidden="true" />} pressed={pressed === undefined ? undefined : v} onPress={() => setV(!v)} {...rest} />
}
function Cp({ selected, disabledReason, label }: { selected?: boolean; disabledReason?: string; label: string }) {
  const [v, setV] = useState(selected ?? false)
  return <Chip selected={v} onClick={() => setV(!v)} disabledReason={disabledReason}>{label}</Chip>
}

/** A surface specimen: the card a Popover or a Drawer draws, in place (their live forms are fixed to the viewport). */
function Surface({ kind }: { kind: 'popover' | 'sheet' }) {
  const isSheet = kind === 'sheet'
  return (
    <div
      className={isSheet ? 'ww-sheet' : 'ww-popover'}
      data-place={isSheet ? 'right' : undefined}
      role="group"
      aria-label={isSheet ? 'Drawer specimen' : 'Popover specimen'}
      style={{ position: 'static', inlineSize: 230, minInlineSize: 0, padding: isSheet ? 0 : 12, borderRadius: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: isSheet ? '8px 8px 8px 16px' : 0 }}>
        <span style={{ font: '600 14px/1.3 var(--font-sans, system-ui, sans-serif)' }}>{isSheet ? 'Settings' : 'Log minutes'}</span>
        <IconButton label={isSheet ? 'Close Settings' : 'Close popover'} size="sm" onClick={noop}>
          <X size={18} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

const NA_SURFACE = 'a surface, not a switch: its control is the close button in the row above'
const row = (piece: string, note: string, cells: Record<Pose, CellSpec>): Row => ({ piece, note, cells })

const ROWS: Row[] = [
  row('Button', 'quiet', {
    rest: { node: <Button onClick={noop}>Save</Button> },
    hover: { node: <Button onClick={noop}>Save</Button> },
    pressed: { node: <Button onClick={noop}>Save</Button> },
    focus: { node: <Button onClick={noop}>Save</Button> },
    checked: { node: <Button aria-pressed="true" onClick={noop}>Mute</Button> },
    disabled: { node: <Button disabledReason="needs a card">Pay</Button> },
    loading: { node: <Button loading>Saving</Button> },
  }),
  row('Button primary', 'the accent', {
    rest: { node: <Button tone="primary" onClick={noop}>Start</Button> },
    hover: { node: <Button tone="primary" onClick={noop}>Start</Button> },
    pressed: { node: <Button tone="primary" onClick={noop}>Start</Button> },
    focus: { node: <Button tone="primary" onClick={noop}>Start</Button> },
    checked: { node: <Button tone="primary" aria-pressed="true" onClick={noop}>Running</Button> },
    disabled: { node: <Button tone="primary" disabledReason="pick a day">Start</Button> },
    loading: { node: <Button tone="primary" loading>Starting</Button> },
  }),
  row('Chip', 'a filter', {
    rest: { node: <Cp label="Papers" /> },
    hover: { node: <Cp label="Papers" /> },
    pressed: { node: <Cp label="Papers" /> },
    focus: { node: <Cp label="Papers" /> },
    checked: { node: <Cp label="Papers" selected /> },
    disabled: { node: <Cp label="Papers" disabledReason="none yet" /> },
    loading: { na: 'a chip answers at once; it never waits' },
  }),
  row('Field', 'text', {
    rest: { node: <Field label="Name" defaultValue="Ada" /> },
    hover: { node: <Field label="Name" defaultValue="Ada" /> },
    pressed: { na: 'a field is not pressed: typing in it is the focus pose' },
    focus: { node: <Field label="Name" defaultValue="Ada" /> },
    checked: { na: 'a field holds text; it is not on or off' },
    disabled: { node: <Field label="Name" defaultValue="Ada" disabled hint="locked by the plan" /> },
    loading: { na: 'a field validates as you type; nothing to wait for' },
  }),
  row('Switch', 'role switch', {
    rest: { node: <Sw on={false} label="Heater" /> },
    hover: { node: <Sw on={false} label="Heater" /> },
    pressed: { node: <Sw on={false} label="Heater" /> },
    focus: { node: <Sw on={false} label="Heater" /> },
    checked: { node: <Sw on label="Heater" /> },
    disabled: { node: <Sw on={false} label="Heater" disabledReason="needs the board" /> },
    loading: { node: <Sw on={false} label="Heater" loading /> },
  }),
  row('Rocker', 'master switch', {
    rest: { node: <Rk on={false} label="Master off" /> },
    hover: { node: <Rk on={false} label="Master hover" />, pick: '.k-rocker-half[data-active="false"]' },
    pressed: { node: <Rk on={false} label="Master pressed" />, pick: '.k-rocker-half[data-active="false"]' },
    focus: { node: <Rk on={false} label="Master focus" /> },
    checked: { node: <Rk on label="Master on" /> },
    disabled: { node: <Rk on={false} label="Master held" disabledReason="locked by a rule" /> },
    loading: { na: 'a rocker acts at once; the board confirms on its own lamp' },
  }),
  row('Key', 'a keycap', {
    rest: { node: <Kp label="Go" /> },
    hover: { node: <Kp label="Go" /> },
    pressed: { node: <Kp label="Go" /> },
    focus: { node: <Kp label="Go" /> },
    checked: { node: <Kp label="Mute" pressed /> },
    disabled: { node: <Kp label="Wait" disabledReason="needs a card" /> },
    loading: { node: <Kp label="Save" loading /> },
  }),
  row('Segmented', 'three options', {
    rest: { node: <Seg start="a" /> },
    hover: { node: <Seg start="a" />, pick: '.ww-seg-opt[aria-checked="false"]' },
    pressed: { node: <Seg start="a" />, pick: '.ww-seg-opt[aria-checked="false"]' },
    focus: { node: <Seg start="a" />, pick: '.ww-seg-opt[aria-checked="false"]' },
    checked: { node: <Seg start="b" /> },
    disabled: { node: <SegDisabled /> },
    loading: { na: 'a choice applies at once; the page it changes shows its own wait' },
  }),
  row('HoldButton', 'hold to confirm', {
    rest: { node: <HoldButton label="Erase" onConfirm={noop} /> },
    hover: { node: <HoldButton label="Erase" onConfirm={noop} /> },
    pressed: { node: <HoldButton label="Erase" onConfirm={noop} /> },
    focus: { node: <HoldButton label="Erase" onConfirm={noop} /> },
    checked: { na: 'an action, not a state: it has no on position' },
    disabled: { node: <HoldButton label="Erase" onConfirm={noop} reason="nothing to erase" /> },
    loading: { node: <HoldButton label="Erase" onConfirm={noop} />, pick: '.ww-hold' },
  }),
  row('Popover', 'surface', {
    rest: { node: <Surface kind="popover" /> },
    hover: { node: <Surface kind="popover" /> },
    pressed: { node: <Surface kind="popover" /> },
    focus: { node: <Surface kind="popover" /> },
    checked: { na: NA_SURFACE },
    disabled: { na: NA_SURFACE },
    loading: { na: NA_SURFACE },
  }),
  row('Drawer', 'surface', {
    rest: { node: <Surface kind="sheet" /> },
    hover: { node: <Surface kind="sheet" /> },
    pressed: { node: <Surface kind="sheet" /> },
    focus: { node: <Surface kind="sheet" /> },
    checked: { na: NA_SURFACE },
    disabled: { na: NA_SURFACE },
    loading: { na: NA_SURFACE },
  }),
]

/** The hold's loading pose is the bar mid-fill: the control carries data-hold, the stylesheet draws the fill. */
function HoldHeld({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.querySelector('.ww-hold')?.setAttribute('data-hold', 'holding')
  }, [])
  return <div ref={ref}>{children}</div>
}

function Grid({ scene }: { scene: 'page' | 'dark' }) {
  return (
    <section
      data-pose-grid={scene}
      data-scene={scene === 'dark' ? 'immersive' : undefined}
      aria-label={scene === 'dark' ? 'Poses on the dark scene' : 'Poses in the page theme'}
      // the dark scene declares no hover-face role (a token gap, reported): inside a light page it would inherit the light one
      style={{ padding: 16, borderRadius: 20, background: 'var(--surface-ground)', color: 'var(--ink-1)', ...(scene === 'dark' ? ({ '--surface-raised-hi': 'var(--surface-raised)' } as CSSProperties) : null) }}
    >
      <h3 style={{ margin: '0 0 8px', font: '600 14px/1.3 var(--font-sans, system-ui, sans-serif)', color: 'var(--ink-2)' }}>
        {scene === 'dark' ? 'Dark scene (the JARVIS ground)' : 'Page theme'}
      </h3>
      {/* one row per piece, its seven poses wrapping side by side; on a phone the poses stack, so nothing is wider than the page */}
      <div style={{ display: 'grid', gap: 4 }}>
        {ROWS.map((r) => (
          <div key={r.piece} data-piece-row={r.piece} role="group" aria-label={r.piece} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 4, padding: '6px 0' }}>
            <div style={{ flex: '1 0 100%', font: '600 13px/1.3 var(--font-sans, system-ui, sans-serif)', color: 'var(--ink-1)', padding: '0 10px' }}>
              {r.piece} <span style={{ font: '12px/1.3 var(--font-sans, system-ui, sans-serif)', color: 'var(--ink-3)' }}>{r.note}</span>
            </div>
            {POSES.map((p) => {
              const spec = r.cells[p]
              const held = r.piece === 'HoldButton' && p === 'loading'
              return <Cell key={p} piece={r.piece} pose={p} spec={held ? { ...spec, node: <HoldHeld>{spec.node}</HoldHeld>, pick: undefined } : spec} />
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

function PoseGallery() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Grid scene="page" />
      <Grid scene="dark" />
    </div>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'kit/Poses',
    title: 'Poses (the interaction language)',
    group: 'kit',
    merged: 'KIT1, 19 Nov 2026',
    note: 'Every interactive kit piece in every pose, in the page theme and on the dark scene. Hover, pressed and focus are painted still; the rest are the real props.',
    states: [{ label: 'every piece, every pose', node: <PoseGallery /> }],
  },
]

export default entries
