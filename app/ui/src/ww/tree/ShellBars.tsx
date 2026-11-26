/**
 * The Tree's two lists, folded behind one key each when the page is hosted under the new shell (CP2).
 *
 * Why: at 1366 the page is about 900 px wide between the Today column and the Proof rail. Eight tree names as one
 * segmented pill wrapped to two rows, and twelve branch chips ran 1,608 px along a sideways scroller. A list of
 * eight or twelve is a choice, so it sits behind a key and opens as an opaque popover with 44 px rows; the stage
 * gets the height back. With the flag off the classic page keeps its pill and its chip row (the callers decide).
 */
import { Check, ChevronDown, Layers } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useEscStack } from '../../shared/kit/overlay'
import { Button } from '../kit'

export { inShell } from './inShell'

const PANEL_W = 360

/**
 * The popover of this page under the shell. The kit's Popover is portaled to <body>, outside the shell root, where the
 * Well Wisher design theme (dark ink) wins over the clay roles and a light panel got light text: unreadable (owner,
 * 15 Nov: "in dropdowns and lists text isn't visible"). This one stays in the page's own tree, so it reads the shell's
 * tokens, and it has an opaque raised face of its own. Same contract as the kit's: Esc and a press outside close it,
 * and Esc returns focus to the key. Placed once, when it opens, and kept inside the window.
 */
export function Panel({ open, onClose, anchor, label, className, children }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement | null>; label: string; className?: string; children?: ReactNode }) {
  const [pos, setPos] = useState<CSSProperties>({})
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    const a = anchor.current?.getBoundingClientRect()
    if (!a) return
    const w = Math.min(box.current?.offsetWidth || PANEL_W, window.innerWidth - 32)
    const left = Math.max(16, Math.min(a.left, window.innerWidth - w - 16))
    const below = window.innerHeight - a.bottom - 24
    // below the key when there is room (at least 20 rem), else above it; either way it ends inside the window and scrolls inside itself
    setPos(below >= 320 || a.top < below
      ? { insetBlockStart: a.bottom + 8, insetInlineStart: left, maxBlockSize: Math.max(160, below) }
      : { insetBlockEnd: window.innerHeight - a.top + 8, insetInlineStart: left, maxBlockSize: Math.max(160, a.top - 24) })
  }, [open, anchor])
  // the anchor is the key's wrapper: focus goes back to the key inside it
  useEscStack(open, () => { onClose(); (anchor.current?.querySelector<HTMLElement>('button') ?? anchor.current)?.focus({ preventScroll: true }) })
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [open, onClose, anchor])
  if (!open) return null
  return <div ref={box} className={`ww-tree-panel${className ? ` ${className}` : ''}`} role="dialog" aria-label={label} style={pos} data-scroll-ok="">{children}</div>
}

export interface PickOption { id: string; label: string; count?: string; disabledReason?: string }

function Rows({ label, options, value, onPick }: { label: string; options: PickOption[]; value?: string; onPick: (id: string) => void }) {
  return (
    <div className="ww-tree-rows" role={value === undefined ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role={value === undefined ? undefined : 'radio'} aria-checked={value === undefined ? undefined : o.id === value} aria-disabled={o.disabledReason ? true : undefined}
          className="ww-tree-opt" onClick={() => { if (!o.disabledReason) onPick(o.id) }}>
          <span className="ww-tree-opt-main">
            <span className="ww-tree-opt-label">{o.label}</span>
            {o.disabledReason && <span className="ww-tree-opt-why">{o.disabledReason}</span>}
          </span>
          {o.count && <span className="ww-tree-opt-count">{o.count}</span>}
          {value !== undefined && o.id === value && <Check size={16} aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}

/** Which tree: one key that names the open tree, a list behind it. */
export function TreePicker({ value, options, onChange }: { value: string; options: PickOption[]; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const cur = options.find((o) => o.id === value) ?? options[0]
  return (
    <>
      <span ref={anchor} className="ww-tree-keywrap">
        <Button size="sm" className="ww-tree-key ww-tree-pick" aria-label={`Tree ${cur ? `${cur.label} ${cur.count ?? ''}`.trim() : ''}`.trim()} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="ww-tree-key-k">Tree</span>
          <span className="ww-tree-key-v">{cur ? `${cur.label} ${cur.count ?? ''}`.trim() : ''}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </span>
      <Panel open={open} onClose={() => setOpen(false)} anchor={anchor} label="Which tree">
        <div className="ww-tree-pop">
          <Rows label="Which tree" options={options} value={value} onPick={(id) => { onChange(id); setOpen(false) }} />
        </div>
      </Panel>
    </>
  )
}

/** Branches: one key, the zoom-to-branch list and the counts line behind it. */
export function BranchMenu({ options, stats, onPick }: { options: PickOption[]; stats: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  return (
    <>
      <span ref={anchor} className="ww-tree-keywrap">
        <Button size="sm" className="ww-tree-key" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Layers size={16} aria-hidden="true" />
          <span className="ww-tree-key-v">Branches</span>
          <span className="ww-tree-key-k">{options.length}</span>
        </Button>
      </span>
      <Panel open={open} onClose={() => setOpen(false)} anchor={anchor} label="Branches">
        <div className="ww-tree-pop ww-tree-pop-wide">
          <Rows label="Zoom to a branch" options={options} onPick={(id) => { onPick(id); setOpen(false) }} />
          <p className="ww-tree-hint">{stats}</p>
        </div>
      </Panel>
    </>
  )
}
