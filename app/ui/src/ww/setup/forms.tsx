/**
 * The pieces every Setup section shares: the draft hook (one save model, saveModel.ts), the card shell with its
 * dirty dot and Discard, the list helpers and the closed "Advanced: JSON" fold that replaces the five JSON
 * editors. The fold applies its text to the DRAFT, not to the server: pasting JSON is an edit like any other.
 */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Card, Field, Fold, IconButton } from '../kit'
import { openOverlay } from '../frame/overlayRegistry'
import { useSetup } from './saveModel'
import { SECTION_LABEL, lines, unlines, type SectionId } from './inputs'

export function useDraft<T>(id: SectionId): [T, (v: T) => void, boolean] {
  const v = useSetup((s) => (id in s.draft ? s.draft[id] : id in s.base ? s.base[id] : undefined)) as T
  const dirty = useSetup((s) => id in s.draft)
  const edit = useSetup((s) => s.edit)
  return [v, (n: T) => edit(id, n), dirty]
}

export const upd = <T,>(arr: T[], i: number, patch: Partial<T>): T[] => arr.map((x, j) => (j === i ? { ...x, ...patch } : x))
export const drop = <T,>(arr: T[], i: number): T[] => arr.filter((_, j) => j !== i)

/** A dot AND a word: a section's unsaved state is never colour alone. */
export function DirtyMark({ id }: { id: SectionId }) {
  const dirty = useSetup((s) => id in s.draft)
  const discard = useSetup((s) => s.discard)
  if (!dirty) return null
  return (
    <span className="su-dirty" data-dirty={id}>
      <span className="su-dot" aria-hidden="true" />
      <span>Unsaved</span>
      <Button size="sm" onClick={() => discard(id)}>
        Discard
      </Button>
    </span>
  )
}

/**
 * "Advanced: JSON" REPLACES the form while it is open instead of stacking under it: the form and a textarea
 * together are taller than the pane, and the owner's no-scroll rule wins. A card shares the open state with
 * its AdvancedJson through this context; <FormPart> wraps the form half.
 */
const JsonMode = createContext<{ open: boolean; set: (v: boolean) => void } | null>(null)
export function FormPart({ children }: { children: ReactNode }) {
  const c = useContext(JsonMode)
  return <div className="su-formpart" hidden={c?.open || undefined}>{children}</div>
}

export interface ShellProps {
  /** The plan's section id (SU1 ...). */
  n: string
  /** The DOM anchor the index scrolls to. */
  anchor: string
  title: string
  /** The draft section whose dirty mark this card shows. */
  dirtyId?: SectionId
  hint?: string
  action?: ReactNode
  children: ReactNode
}

export function SetupCard({ n, anchor, title, dirtyId, hint, action, children }: ShellProps) {
  const [json, setJson] = useState(false)
  return (
    <JsonMode.Provider value={{ open: json, set: setJson }}>
    <div id={`su-${anchor}`} className="su-anchor" tabIndex={-1} data-su={anchor}>
      <Card
        data-card={`su-${anchor}`}
        title={title}
        kicker={n}
        action={
          <>
            {action}
            {dirtyId && <DirtyMark id={dirtyId} />}
          </>
        }
      >
        {hint && <p className="su-hint">{hint}</p>}
        {children}
      </Card>
    </div>
    </JsonMode.Provider>
  )
}

/** A row of fields with a Remove at the end; `label` names the row for the remove button. */
export function FormRow({ label, onRemove, dense, children }: { label: string; onRemove?: () => void; dense?: boolean; children: ReactNode }) {
  return (
    <div className="su-row" role="group" aria-label={label} data-dense={dense ? '' : undefined}>
      <div className="su-row-fields">{children}</div>
      {onRemove && (
        <IconButton label={`Remove ${label}`} size="sm" onClick={onRemove}>
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  )
}

export function AddButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick}>
      <Plus size={14} aria-hidden="true" />
      {children}
    </Button>
  )
}

/** "Advanced: JSON", closed. The text is parsed on Apply and becomes the draft; a parse error stays on screen. */
export function AdvancedJson({ id, value, onApply }: { id: SectionId; value: unknown; onApply: (v: unknown) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const mode = useContext(JsonMode)
  const shown = text ?? JSON.stringify(value, null, 1)
  const rows = Math.min(10, Math.max(6, shown.split('\n').length))
  return (
    <Fold title="Advanced: JSON" level={3} lazy open={mode?.open} onToggle={mode?.set}>
      <div className="su-json">
        <label className="ww-field-label" htmlFor={`su-json-${id}`}>
          {SECTION_LABEL[id]} as JSON
        </label>
        <textarea
          id={`su-json-${id}`}
          className="ww-input su-json-text"
          rows={rows}
          spellCheck={false}
          value={shown}
          onChange={(e) => {
            setText(e.target.value)
            setErr(null)
          }}
        />
        {err && <p className="su-err" role="alert">{`Error: ${err}`}</p>}
        <Button
          size="sm"
          onClick={() => {
            try {
              onApply(JSON.parse(shown))
              setText(null)
              setErr(null)
            } catch (e) {
              setErr(`Not valid JSON: ${(e as Error).message}`)
            }
          }}
        >
          Apply to the form
        </Button>
        <p className="su-hint">Applying changes the form, not the file. Save changes writes it.</p>
      </div>
    </Fold>
  )
}

/** A link row (SU15, SU16): not a card, never the fill. */
export function LinkRow({ anchor, title, line, children }: { anchor: string; title: string; line: string; children: ReactNode }) {
  return (
    <div id={`su-${anchor}`} className="su-anchor su-linkrow" tabIndex={-1} data-su={anchor}>
      <div className="su-linkrow-text">
        <h2 className="su-linkrow-title">{title}</h2>
        <p className="su-linkrow-line">{line}</p>
      </div>
      {children}
    </div>
  )
}

export { openOverlay }

/**
 * A textarea of one-item-per-line. It keeps its own text, because parsing on every keystroke would eat the
 * newline the owner just typed (a blank line is dropped by unlines); the parsed list goes up on each change.
 */
export function LinesField({ label, hint, value, onChange }: { label: string; hint?: string; value?: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(lines(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value && JSON.stringify(unlines(text)) !== JSON.stringify(value ?? [])) {
    setSeen(value)
    setText(lines(value))
  } else if (seen !== value) setSeen(value)
  return (
    <Field
      label={label}
      hint={hint}
      kind="area"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(unlines(e.target.value))
      }}
    />
  )
}
