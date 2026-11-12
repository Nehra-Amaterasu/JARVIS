// Structure primitives: Fold, TapGroup, MasterDetail, EmptyState, Banner (plan 5.5).
import { useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { cx } from './util'

export interface FoldProps {
  title: string
  /** Controlled when given; otherwise the Fold keeps its own state, closed unless defaultOpen. */
  open?: boolean
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
  /** Mount nothing until the first time it is opened (a heavy body such as a long list or a chart). */
  lazy?: boolean
  level?: 2 | 3 | 4
  children: ReactNode
}

/**
 * Replaces the 21 `<details>`, `fold-head` and `contract-head`. A button in a real heading with
 * aria-expanded; the body is hidden, not animated (no height animation, 5.7.6 rule 1).
 */
export function Fold({ title, open, defaultOpen, onToggle, lazy, level = 3, children }: FoldProps) {
  const [own, setOwn] = useState(!!defaultOpen)
  const isOpen = open ?? own
  const opened = useRef(isOpen)
  if (isOpen) opened.current = true
  const bodyId = useId()
  const Tag = (`h${level}`) as 'h2' | 'h3' | 'h4'
  const Chevron = isOpen ? ChevronDown : ChevronRight
  return (
    <div className="ww-fold" data-open={isOpen ? 'true' : 'false'}>
      <Tag className="ww-fold-head">
        <button
          type="button"
          className="ww-fold-btn ww-tap"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={() => {
            if (open === undefined) setOwn(!isOpen)
            onToggle?.(!isOpen)
          }}
        >
          <Chevron size={16} aria-hidden="true" />
          <span>{title}</span>
        </button>
      </Tag>
      <div id={bodyId} className="ww-fold-body" hidden={!isOpen}>
        {(!lazy || opened.current) && children}
      </div>
    </div>
  )
}

export interface TapOption {
  id: string
  label: string
  /** A short extra word read with the label ("P", "A", "C" stand for present, absent, cancelled). */
  title?: string
}
export interface TapGroupProps {
  options: TapOption[]
  /** The stored value; null when nothing is set. */
  value: string | null
  /**
   * Called with the tapped id, or null when the active option is tapped again (the same tap clears).
   * A returned promise that rejects rolls the display back to `value` and calls onRollback.
   */
  onTap: (id: string | null) => void | Promise<void>
  onRollback?: (error: unknown) => void
  /** The group's accessible name (class taps, counter tiles). */
  label: string
  className?: string
}

/**
 * Class taps, the +25 / +50 / +90 presets, counter tiles. Exactly one is active and it is filled (the
 * pressed state is a background, never an inset-shadow stripe). Each is 44 px high for real, because
 * the neighbours are closer than 44 px. Optimistic: the display moves on the tap, never on the reply.
 */
export function TapGroup({ options, value, onTap, onRollback, label, className }: TapGroupProps) {
  const [optimistic, setOptimistic] = useState<{ base: string | null; shown: string | null } | null>(null)
  // an optimistic value is only valid until the stored value changes under it
  const shown = optimistic && optimistic.base === value ? optimistic.shown : value
  const tap = (id: string) => {
    const next = id === shown ? null : id
    setOptimistic({ base: value, shown: next })
    let r: void | Promise<void>
    try {
      r = onTap(next)
    } catch (e) {
      setOptimistic(null)
      onRollback?.(e)
      return
    }
    if (r && typeof (r as Promise<void>).then === 'function') {
      ;(r as Promise<void>).catch((e: unknown) => {
        setOptimistic(null)
        onRollback?.(e)
      })
    }
  }
  return (
    <div className={cx('ww-taps', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <Button key={o.id} grouped size="sm" className="ww-tapopt" aria-pressed={shown === o.id} data-active={shown === o.id ? 'true' : undefined} title={o.title} onClick={() => tap(o.id)}>
          {o.label}
        </Button>
      ))}
    </div>
  )
}

/** Remembered selection per key, for the life of the page: the workspace-wide memory is chunk 4's, this is the primitive's own floor. */
const memory = new Map<string, string>()
export interface MasterDetailProps {
  list: (select: (id: string) => void, selectedId: string | null) => ReactNode
  detail: (selectedId: string | null) => ReactNode
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** Uncontrolled use: where to remember the selection (a workspace or tree id). */
  memoryKey?: string
  /** Accessible names of the two panes. */
  listLabel: string
  detailLabel: string
}

/**
 * List and detail. At 720 px of its OWN width or more they sit side by side; under that the detail
 * stacks below the list (a container query, so the 76 px rail and a pinned panel are already
 * subtracted, 5.4). The selection is remembered per `memoryKey`.
 */
export function MasterDetail({ list, detail, selectedId, onSelect, memoryKey, listLabel, detailLabel }: MasterDetailProps) {
  const [own, setOwn] = useState<string | null>(() => (memoryKey ? (memory.get(memoryKey) ?? null) : null))
  const current = selectedId !== undefined ? selectedId : own
  const select = (id: string) => {
    if (selectedId === undefined) setOwn(id)
    if (memoryKey) memory.set(memoryKey, id)
    onSelect?.(id)
  }
  return (
    <div className="ww-md">
      <div className="ww-md-grid">
        <div className="ww-md-list" role="region" aria-label={listLabel}>
          {list(select, current)}
        </div>
        <div className="ww-md-detail" role="region" aria-label={detailLabel}>
          {detail(current)}
        </div>
      </div>
    </div>
  )
}
export const clearMasterDetailMemory = () => memory.clear()

export interface EmptyStateProps {
  title: string
  body?: string
  /** A real first action when the feature is built and data is missing (pattern E). */
  action?: ReactNode
  /** Why it is empty, in plain words ("no bank yet"); never a made-up number. */
  reason?: string
}

/** Shown after loading finishes. Replaces the ~20 `small muted` strings and the bare "Loading" div. */
export function EmptyState({ title, body, action, reason }: EmptyStateProps) {
  return (
    <div className="ww-empty" role="status" data-empty="">
      <p className="ww-empty-title">{title}</p>
      {body && <p className="ww-empty-body">{body}</p>}
      {reason && <p className="ww-empty-reason">{reason}</p>}
      {action && <div className="ww-empty-action">{action}</div>}
    </div>
  )
}

export interface BannerProps {
  tone?: 'info' | 'sim' | 'fault'
  action?: ReactNode
  children: ReactNode
}

/** The single "dates tentative" line, instead of a `~` on every row. Words first; the dot only repeats them. */
export function Banner({ tone = 'info', action, children }: BannerProps) {
  return (
    <div className="ww-banner" data-tone={tone} role="note">
      <span className="ww-chip-dot" aria-hidden="true" />
      <span className="ww-banner-text">{children}</span>
      {action && <span className="ww-banner-action">{action}</span>}
    </div>
  )
}
