// Family B, HUD and terminal frames (spec 7.3): Panel (12), Frame (13), Console (15), the command palette's
// presentation (16), the notched Toast (17), the retro Dialog (20) and the Folder Tab Bar (21).
// The Readouts file holds 14, 18 and 19. Everything here is flat: no glow, no scanline, no flicker (spec 10.5),
// and every chamfer falls back to a rectangle with a real border in forced colours (6.5.2 rule 4).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { LampGlyph, Lamp, type LampState } from './Lamp'
import { focusables, lockBackground, trapTab, useEscStack } from './overlay'
import { cx } from './util'

// ---------------------------------------------------------------------------------------------- Panel

export interface PanelProps {
  children: ReactNode
  /** Failed: the outer layer fills `--state-fault` and the reason is printed with a triangle. */
  error?: string
  /** Not built: the dashed SVG outline replaces the chamfered layers. */
  planned?: boolean
  className?: string
}

/**
 * Component 12, the Chamfered Panel: two stacked layers. The outer is filled `--edge-ui` and the inner is inset 1 px
 * and filled `--surface-raised`, both clipped with 10 px cuts at top-left and bottom-right, which keeps a true 3:1 edge
 * on the diagonals (a plain border is cut away by clip-path).
 */
export function Panel({ children, error, planned, className }: PanelProps) {
  return (
    <section className={cx('k-panel', className)} data-state={planned ? 'planned' : error ? 'error' : undefined} aria-invalid={error ? true : undefined}>
      {planned && (
        <svg className="k-panel-dash" aria-hidden="true" focusable="false" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path d="M10 0.5 H99.5 V90 L90 99.5 H0.5 V10 Z" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
        </svg>
      )}
      <div className="k-panel-in">
        {error && (
          <p className="k-err">
            <LampGlyph state="fault" size={12} /> {error}
          </p>
        )}
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------- Frame

export interface FrameProps {
  children: ReactNode
  /** The footer lamp. */
  state?: LampState
  reason?: string
  /** Timestamp text at the footer's right: real text, supplied by the caller. */
  stamp?: string
  planned?: boolean
  className?: string
}

/** Component 13, Corner Brackets: four 12 px L-shaped brackets (2 px) and a status footer, the lamp left and the timestamp right. */
export function Frame({ children, state, reason, stamp, planned, className }: FrameProps) {
  return (
    <div className={cx('k-frame', className)} data-state={planned ? 'planned' : undefined}>
      <i className="k-br" data-at="tl" aria-hidden="true" />
      <i className="k-br" data-at="tr" aria-hidden="true" />
      <i className="k-br" data-at="bl" aria-hidden="true" />
      <i className="k-br" data-at="br" aria-hidden="true" />
      <div className="k-frame-body">{children}</div>
      {(state || stamp) && (
        <footer className="k-frame-foot">
          {state && <Lamp state={state} reason={reason} />}
          {stamp && <time className="k-frame-stamp">{stamp}</time>}
        </footer>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Console

export type ConsoleTag = 'CORE' | 'EYES' | 'MEM' | 'LIMB' | 'SYS' | 'WISH'

export interface ConsoleLine {
  id: string
  tag: ConsoleTag
  /** Timestamp column text, supplied by the caller. */
  at: string
  text: string
  /** A simulated line carries a diamond; a fault line a triangle. */
  kind?: 'sim' | 'fault'
}

/** At most this many lines stay in the DOM (an assumption of the spec, 7.3 row 15). */
export const CONSOLE_MAX_LINES = 200
const LINE_PX = 18

export interface ConsoleProps {
  lines: ConsoleLine[]
  label: string
  /** Given: a live prompt. Absent: the prompt is disabled and says PLANNED. */
  onSubmit?: (text: string) => void
  /** Told when Ctrl+C copied a line, so the caller can toast it. */
  onCopy?: (line: ConsoleLine) => void
  className?: string
}

/**
 * Component 15, the Log Console: a sunk well of 13 px mono lines with a bracketed channel tag, `role="log"` and
 * `aria-live="off"`: a Follow toggle announces only the fault lines, through its own status region. Arrows move the
 * cursor line, Home and End jump, Ctrl+C copies the cursor line, Esc leaves the prompt. The prompt cursor is a solid
 * block that never blinks.
 */
export function Console({ lines, label, onSubmit, onCopy, className }: ConsoleProps) {
  const [follow, setFollow] = useState(true)
  const [cursor, setCursor] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const kept = useMemo(() => lines.slice(-CONSOLE_MAX_LINES), [lines])
  const lastFault = useMemo(() => [...kept].reverse().find((l) => l.kind === 'fault'), [kept])

  useLayoutEffect(() => {
    if (follow && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [kept, follow])

  const move = (to: number) => {
    const i = Math.min(kept.length - 1, Math.max(0, to))
    setCursor(i)
    setFollow(i === kept.length - 1 ? follow : false)
    if (log.current) log.current.scrollTop = Math.max(0, i * LINE_PX - LINE_PX * 2)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (kept.length === 0) return
    const at = cursor ?? kept.length - 1
    if (e.key === 'ArrowUp') (e.preventDefault(), move(at - 1))
    else if (e.key === 'ArrowDown') (e.preventDefault(), move(at + 1))
    else if (e.key === 'Home') (e.preventDefault(), move(0))
    else if (e.key === 'End') (e.preventDefault(), move(kept.length - 1))
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const l = kept[at]
      if (!l) return
      e.preventDefault()
      try {
        void navigator.clipboard?.writeText(`${l.at} [${l.tag}] ${l.text}`)
      } catch {
        /* clipboard blocked: the caller's onCopy still fires so it can say so */
      }
      onCopy?.(l)
    }
  }
  const planned = !onSubmit
  return (
    <div className={cx('k-console', className)}>
      <div className="k-console-bar">
        <span className="k-console-title">{label}</span>
        <button type="button" className="k-console-follow" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          Follow {follow ? 'on' : 'off'}
        </button>
      </div>
      <div ref={log} className="k-console-log" role="log" aria-live="off" aria-label={label} tabIndex={0} onKeyDown={onKeyDown}>
        {kept.map((l, i) => (
          <div key={l.id} className="k-console-line" data-kind={l.kind} data-cursor={cursor === i ? 'true' : undefined}>
            <time className="k-console-at">{l.at}</time>
            <span className="k-console-tag">[{l.tag}]</span>
            {l.kind === 'sim' && <LampGlyph state="simulated" size={12} />}
            {l.kind === 'fault' && <LampGlyph state="fault" size={12} />}
            <span className="k-console-text">{l.text}</span>
          </div>
        ))}
      </div>
      <div className="k-vh" role="status" aria-live="polite">
        {follow && lastFault ? `FAULT: ${lastFault.text}` : ''}
      </div>
      <form
        className="k-console-prompt"
        data-state={planned ? 'planned' : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          if (planned || !draft.trim()) return
          onSubmit?.(draft)
          setDraft('')
        }}
      >
        <span className="k-prompt-mark" aria-hidden="true">
          &gt;
        </span>
        <input
          className="k-prompt-input"
          aria-label={`${label} prompt`}
          aria-disabled={planned || undefined}
          readOnly={planned}
          value={planned ? '' : draft}
          placeholder={planned ? 'PLANNED' : ''}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') log.current?.focus()
          }}
        />
        <span className="k-prompt-cursor" aria-hidden="true" />
        {planned && <span className="k-readout-why">PLANNED</span>}
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Palette

export type PaletteGroup = 'Go' | 'Do' | 'Ask'
const PALETTE_GROUPS: PaletteGroup[] = ['Go', 'Do', 'Ask']

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  /** The real key, from the one binding table (spec 3.1.2); the palette never invents a hint. */
  hint?: string
  /** Not built: dashed ring, opens "What is coming", never executable. */
  planned?: boolean
}

export interface PaletteViewProps {
  items: PaletteItem[]
  onRun: (item: PaletteItem) => void
  onPlanned: (item: PaletteItem) => void
  onClose: () => void
  label?: string
}

/**
 * Component 16, the Command Palette presentation: an outlined 44 px search field over a grouped list (Go, Do, Ask).
 * `role="combobox"` with a `listbox` and `aria-activedescendant`; Up and Down move, Enter runs, Esc closes, typing
 * filters. Opening (Ctrl+K) and returning focus to the opener belong to the shell; this is the sheet's content.
 */
export function PaletteView({ items, onRun, onPlanned, onClose, label = 'Command palette' }: PaletteViewProps) {
  const uid = useId()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    const hit = items.filter((i) => !n || i.label.toLowerCase().includes(n))
    return PALETTE_GROUPS.flatMap((g) => hit.filter((i) => i.group === g))
  }, [items, q])
  const idx = Math.min(at, Math.max(0, shown.length - 1))
  const optId = (i: PaletteItem) => `${uid}-${i.id}`
  const run = (i: PaletteItem) => (i.planned ? onPlanned(i) : onRun(i))
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setAt(Math.min(shown.length - 1, idx + 1)))
    else if (e.key === 'ArrowUp') (e.preventDefault(), setAt(Math.max(0, idx - 1)))
    else if (e.key === 'Enter' && shown[idx]) (e.preventDefault(), run(shown[idx]))
    else if (e.key === 'Escape') (e.preventDefault(), onClose())
  }
  return (
    <div className="k-palette" aria-label={label}>
      <input
        className="k-palette-field"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${uid}-list`}
        aria-activedescendant={shown[idx] ? optId(shown[idx]) : undefined}
        aria-label={label}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value)
          setAt(0)
        }}
        onKeyDown={onKeyDown}
      />
      <div id={`${uid}-list`} role="listbox" className="k-palette-list" aria-label={`${label} results`}>
        {shown.length === 0 && <p className="k-palette-empty">Nothing matches.</p>}
        {PALETTE_GROUPS.map((g) => {
          const rows = shown.filter((i) => i.group === g)
          if (rows.length === 0) return null
          return (
            <div key={g} role="group" aria-label={g}>
              <div className="k-palette-group" aria-hidden="true">
                {g}
              </div>
              {rows.map((i) => (
                <div
                  key={i.id}
                  id={optId(i)}
                  role="option"
                  aria-selected={shown[idx] === i}
                  aria-disabled={i.planned || undefined}
                  className="k-palette-row"
                  data-active={shown[idx] === i ? 'true' : undefined}
                  data-state={i.planned ? 'planned' : undefined}
                  onClick={() => run(i)}
                >
                  <span className="k-palette-hint">{i.hint ?? ''}</span>
                  <span className="k-palette-label">{i.label}</span>
                  {i.planned && <Lamp state="planned" />}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- NotchedToast

export type NotchedTag = 'OK' | 'NOTE' | 'FAULT'
export const NOTCHED_TOAST_MS = 6000

export interface NotchedToastItem {
  id: string
  tag: NotchedTag
  message: string
  undo?: { label?: string; onUndo: () => void }
}

/**
 * Component 17, the Notched Toast: a mono tag, one line, an optional Undo. 6 s by default; a FAULT toast persists
 * until dismissed (WCAG 2.2.1: no auto-dismiss for errors). Esc dismisses; Undo is a real button.
 */
export function NotchedToast({ tag, message, undo, onDismiss }: Omit<NotchedToastItem, 'id'> & { onDismiss: () => void }) {
  const cb = useRef(onDismiss)
  cb.current = onDismiss
  useEffect(() => {
    if (tag === 'FAULT') return
    const t = setTimeout(() => cb.current(), NOTCHED_TOAST_MS)
    return () => clearTimeout(t)
  }, [tag])
  useEscStack(true, () => cb.current())
  return (
    <div className="k-toast" data-tag={tag}>
      <span className="k-toast-tag">{tag}</span>
      {tag === 'FAULT' && <LampGlyph state="fault" size={12} />}
      <span className="k-toast-msg">{message}</span>
      {undo && (
        <button
          type="button"
          className="k-toast-undo"
          onClick={() => {
            undo.onUndo()
            cb.current()
          }}
        >
          {undo.label ?? 'Undo'}
        </button>
      )}
      {tag === 'FAULT' && (
        <button type="button" className="k-toast-undo" onClick={() => cb.current()}>
          Dismiss
        </button>
      )}
    </div>
  )
}

/** The always-mounted `role="status"` region. The Quiet switch silences every non-fault toast; a fault is never hidden. */
export function NotchedToastStack({ toasts, onDismiss, quiet }: { toasts: NotchedToastItem[]; onDismiss: (id: string) => void; quiet?: boolean }) {
  return (
    <div className="k-toasts" role="status" aria-live="polite" aria-label="Notifications">
      {toasts
        .filter((t) => !quiet || t.tag === 'FAULT')
        .map((t) => (
          <NotchedToast key={t.id} tag={t.tag} message={t.message} undo={t.undo} onDismiss={() => onDismiss(t.id)} />
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- Dialog

export interface RetroDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  /** A delete: plain words, and the Cancel button takes focus first. Never a red default. */
  destructive?: boolean
  /** A failed action: the one place the error style shows. */
  error?: string
}

/** Component 20, the Retro Dialog: a raised window with a mono title bar, a close key, text and two buttons, one deep, over a scrim. */
export function RetroDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, destructive, error }: RetroDialogProps) {
  const hid = useId()
  const portal = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!open) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const back = opener.current
      opener.current = null
      if (back && document.contains(back)) back.focus({ preventScroll: true })
    }
  }, [open])
  useEffect(() => {
    if (!open || !portal.current || !win.current) return
    const release = lockBackground(portal.current)
    const want = win.current.querySelector<HTMLElement>(destructive ? '[data-k-cancel]' : '[data-k-confirm]')
    ;(want ?? focusables(win.current)[0])?.focus({ preventScroll: true })
    return release
  }, [open, destructive])
  useEscStack(open, onCancel)
  if (!open) return null
  return createPortal(
    <div ref={portal} className="k-portal">
      <div className="k-scrim" aria-hidden="true" onClick={onCancel} />
      <div ref={win} className="k-dialog" role="dialog" aria-modal="true" aria-labelledby={hid} data-state={error ? 'error' : undefined} onKeyDown={(e) => win.current && trapTab(e, win.current)}>
        <header className="k-dialog-bar">
          <h2 id={hid} className="k-dialog-title">
            {title}
          </h2>
          <button type="button" className="k-dialog-x" aria-label={`Close ${title}`} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="k-dialog-body">
          {error && (
            <p className="k-err">
              <LampGlyph state="fault" size={12} /> {error}
            </p>
          )}
          {children}
        </div>
        <footer className="k-dialog-foot">
          <button type="button" className="k-btn" data-k-cancel="" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="k-btn" data-k-confirm="" data-primary={destructive ? undefined : 'true'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------------------------- FolderTabs

export interface FolderTab {
  id: string
  label: string
  count?: number
  /** Dashed, aria-disabled; activating it calls onPlanned and does not select. */
  planned?: boolean
}

export interface FolderTabsProps {
  tabs: FolderTab[]
  value: string
  onChange: (id: string) => void
  onPlanned?: (id: string) => void
  label: string
  className?: string
}

/** Component 21, the Folder Tab Bar: tabs on a rail, the selected tab joins the panel below. Roving tabindex; Left, Right, Home, End. */
export function FolderTabs({ tabs, value, onChange, onPlanned, label, className }: FolderTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length
    refs.current[n]?.focus()
    const t = tabs[n]
    if (t.planned) return
    onChange(t.id)
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') (e.preventDefault(), go(i + 1))
    else if (e.key === 'ArrowLeft') (e.preventDefault(), go(i - 1))
    else if (e.key === 'Home') (e.preventDefault(), go(0))
    else if (e.key === 'End') (e.preventDefault(), go(tabs.length - 1))
  }
  return (
    <div className={cx('k-tabs', className)} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          aria-disabled={t.planned || undefined}
          tabIndex={t.id === value ? 0 : -1}
          className="k-tab"
          data-state={t.planned ? 'planned' : undefined}
          onClick={() => (t.planned ? onPlanned?.(t.id) : onChange(t.id))}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
          {t.planned && <span className="k-readout-why"> PLANNED</span>}
          {t.count !== undefined && <span className="k-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
