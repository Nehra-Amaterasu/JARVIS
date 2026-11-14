// CaptureLine (spec 20.5, A.D04): a terminal prompt in a recessed charcoal well. The text is read as it is typed by the
// local tokenizer (parse.ts); what it understood appears as editable chips beneath, an ambiguous line shows its question
// ("? what is 120") and waits, Enter commits, and an Undo toast stays 6 s. One component serves both grammars: `ww`
// (spent, water, gym, remind) and `jarvis` (a closed verb list), so the Memory line and the Console line are this too.
//
// Honest by construction: nothing is committed until the line reads in exactly one way; the numbers on the chips are the
// person's own typed words and are never drawn as a reading; there is no eval, no shell and no network. The block cursor
// is drawn here (the native caret is hidden) because the native one blinks and the spec asks for a solid, still block.
// There is no timer and no animation loop: the only motion is a 140 ms one-shot seat-in of a new chip, removed under
// reduced motion and calm, and the kit toast's own single timeout.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Sigil } from '../grammar'
import { NotchedToast } from '../kit'
import { LampGlyph } from '../lamp'
import { CURSOR_H_EM, CURSOR_W_EM, FIELD_PAD_PX, caretView, chipInputCh, chipsOf, pushHistory, statusOf, stepHistory } from './layout'
import { MAX_LABEL, MAX_TEXT, jarvisVerbs, parseCapture, rewrite, type Field, type FieldKey, type Parsed } from './parse'
import './capture.css'

export interface CaptureLineProps {
  grammar: 'ww' | 'jarvis'
  /** Called once, with what was understood, when Enter is pressed on a line that reads in exactly one way. */
  onCommit(parsed: Parsed): void
  /** The jarvis grammar's closed verb list (`remember` and `help` come with it when it is left out). */
  verbs?: string[]
  /** What Undo does. Without it the toast carries no Undo, because the line cannot take back what the host stored. */
  onUndo?(parsed: Parsed): void
  /** The clock the date words are read against; a test or a fixture passes a fixed one. Default: the real one. */
  now?: () => Date
  /** The accessible name of the field (default "Capture" or "Command"). */
  label?: string
  /** Ctrl+Space focuses this line from anywhere (default on for `ww`). Inside Well Wisher only; off for `jarvis`. */
  globalKey?: boolean
  /** The text the line starts with (the gallery shows each state this way). */
  initialText?: string
}

// ------------------------------------------------------------------------------------------------ Ctrl+Space

const LINES = new Set<HTMLInputElement>()
let bound = false

function shown(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.hidden || n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true') return false
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(n) : null
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
  }
  return true
}

function onGlobalKey(e: globalThis.KeyboardEvent) {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing) return
  if (e.code !== 'Space' && e.key !== ' ') return
  const target = [...LINES].find((el) => el.isConnected && shown(el))
  if (!target) return
  e.preventDefault()
  target.focus()
}

/** One window listener for every mounted line; it is removed with the last one. */
function bindGlobal(el: HTMLInputElement): () => void {
  LINES.add(el)
  if (!bound) { window.addEventListener('keydown', onGlobalKey); bound = true }
  return () => {
    LINES.delete(el)
    if (!LINES.size && bound) { window.removeEventListener('keydown', onGlobalKey); bound = false }
  }
}

// ------------------------------------------------------------------------------------------------ the component

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const
const baseWord = (caption: string) => caption.split(' ·')[0].toLowerCase()

export function CaptureLine({ grammar, onCommit, verbs, onUndo, now, label, globalKey, initialText = '' }: CaptureLineProps) {
  const sayId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialText)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState<{ a: number | null; b: number | null; scroll: number }>({ a: null, b: null, scroll: 0 })
  const [editing, setEditing] = useState<{ key: FieldKey; draft: string } | null>(null)
  const [toast, setToast] = useState<{ n: number; parsed: Parsed } | null>(null)
  const history = useRef<string[]>([])
  const hIndex = useRef(-1)
  const held = useRef('')
  const cancelEdit = useRef(false)
  const clock = useRef(now)
  clock.current = now

  const verbKey = verbs === undefined ? null : verbs.join('|')
  const verbList = useMemo(() => jarvisVerbs(verbKey === null ? undefined : verbKey.split('|')), [verbKey])
  const result = useMemo(() => parseCapture(grammar, text, (clock.current ?? (() => new Date()))(), verbList), [grammar, text, verbList])
  const plan = statusOf(result, grammar, verbList)
  const chips = chipsOf(result)
  const ready = result.status === 'ok'
  const useGlobal = globalKey ?? grammar === 'ww'

  useEffect(() => {
    const el = inputRef.current
    return el && useGlobal ? bindGlobal(el) : undefined
  }, [useGlobal])

  const sync = () => {
    const el = inputRef.current
    if (!el) return
    setCaret({ a: el.selectionStart, b: el.selectionEnd, scroll: el.scrollLeft })
  }
  useLayoutEffect(sync, [text])

  const commit = () => {
    if (result.status !== 'ok') return
    const parsed = result.parsed
    onCommit(parsed)
    history.current = pushHistory(history.current, text)
    hIndex.current = -1
    setText('')
    setEditing(null)
    setToast((t) => ({ n: (t?.n ?? 0) + 1, parsed }))
  }
  const undo = (parsed: Parsed) => {
    onUndo?.(parsed)
    setText(parsed.text)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape' && text) {
      e.preventDefault()
      e.stopPropagation()
      setText('')
      hIndex.current = -1
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && history.current.length) {
      e.preventDefault()
      if (hIndex.current === -1) held.current = text
      const next = stepHistory(history.current.length, hIndex.current, e.key === 'ArrowUp' ? 'up' : 'down')
      hIndex.current = next
      setText(next === -1 ? held.current : history.current[next])
    }
  }

  const applyEdit = (refocus: boolean) => {
    if (!editing) return
    const f = chips.fields.find((x) => x.key === editing.key)
    setEditing(null)
    if (chips.verb && f && editing.draft.trim() !== f.raw) setText(rewrite(chips.verb, chips.fields, editing.key, editing.draft))
    if (refocus) inputRef.current?.focus()
  }

  const view = caretView(text.length, caret.a, caret.b)
  const style = { ['--cl-col' as string]: view.col, ['--cl-scroll' as string]: `${caret.scroll}px`, ['--cl-pad' as string]: `${FIELD_PAD_PX}px`, ['--cl-cur-w' as string]: `${CURSOR_W_EM}em`, ['--cl-cur-h' as string]: `${CURSOR_H_EM}em` } as CSSProperties
  const name = label ?? (grammar === 'ww' ? 'Capture' : 'Command')
  const verbEntry = grammar === 'ww' ? 'ww' : 'jarvis'

  return (
    <section className="cl" data-scene="immersive" data-grammar="terminal sigil" data-capture={grammar} data-status={plan.status} aria-label={`${name} line`} style={style}>
      {CORNERS.map((c) => <span key={c} className="cl-corner" data-c={c} aria-hidden="true" />)}
      <div className="cl-plate" aria-hidden="true">
        <span className="cl-tag"><Sigil seed={`capture-${verbEntry}`} size={16} />CAPTURE<span className="cl-sub">{verbEntry}</span></span>
        <span className="cl-state" data-status={plan.status}>
          {plan.lamp && <LampGlyph state={plan.lamp} size={12} />}
          {plan.status === 'ready' && <span className="cl-return">{'↵'}</span>}
          {plan.word}
        </span>
      </div>

      <div className="cl-line">
        <span className="cl-prompt" aria-hidden="true">{'>'}</span>
        <div className="cl-field" data-selecting={view.shown ? undefined : 'true'}>
          <input
            ref={inputRef}
            className="cl-input"
            value={text}
            maxLength={grammar === 'ww' ? MAX_TEXT : MAX_TEXT * 3}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
            aria-label={name}
            aria-describedby={sayId}
            onChange={(e) => { hIndex.current = -1; setEditing(null); setText(e.target.value) }}
            onKeyDown={onKeyDown}
            onKeyUp={sync}
            onSelect={sync}
            onClick={sync}
            onScroll={sync}
            onFocus={() => { setFocused(true); sync() }}
            onBlur={() => setFocused(false)}
          />
          {view.shown && <span className="cl-block" data-focus={focused ? 'true' : 'false'} aria-hidden="true" />}
        </div>
        <button type="button" className="cl-enter" aria-label={grammar === 'ww' ? 'Log it' : 'Send it'} aria-disabled={!ready} data-ready={ready ? 'true' : 'false'} onClick={commit}>
          {'↵'}
        </button>
      </div>

      {chips.fields.length > 0 && (
        <ul className="cl-chips" aria-label="What was understood">
          {chips.fields.map((f: Field) => (
            <li key={f.key} className="cl-chip" data-field={f.key} data-state={f.state} data-kind={f.kind}>
              {f.kind === 'fixed' ? (
                <span className="cl-plate-verb"><span className="cl-cap">{f.caption}</span><span className="cl-val">{f.display}</span></span>
              ) : editing?.key === f.key ? (
                <label className="cl-edit">
                  <span className="cl-cap">{f.caption}</span>
                  <input
                    className="cl-chip-input"
                    autoFocus
                    value={editing.draft}
                    maxLength={MAX_LABEL + 12}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`Edit ${baseWord(f.caption)}`}
                    style={{ ['--cl-ch' as string]: chipInputCh(editing.draft) } as CSSProperties}
                    onChange={(e) => setEditing({ key: f.key, draft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyEdit(true) }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit.current = true; setEditing(null); inputRef.current?.focus() }
                    }}
                    onBlur={() => { if (cancelEdit.current) cancelEdit.current = false; else applyEdit(false) }}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="cl-chip-btn"
                  title={f.state === 'missing' ? undefined : f.display}
                  aria-label={f.state === 'missing' ? `Fill in ${baseWord(f.caption)}` : `Edit ${baseWord(f.caption)}: ${f.display}`}
                  onClick={() => setEditing({ key: f.key, draft: f.raw })}
                >
                  <span className="cl-cap" aria-hidden="true">{f.caption}</span>
                  <span className="cl-val">{f.display}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="cl-say" id={sayId} data-status={plan.status}>
        {plan.status === 'ambiguous' ? (<><span className="cl-q">?</span>{plan.line.replace(/^\?/, '')}</>) : plan.line}
      </p>
      <span className="k-vh" role="status" aria-live="polite">{plan.alert}</span>

      <div className="cl-toast" role="status" aria-live="polite" aria-label="Last entry">
        {toast && (
          <NotchedToast
            key={toast.n}
            tag="OK"
            message={`${grammar === 'ww' ? 'logged' : 'sent'}: ${toast.parsed.text}`}
            undo={onUndo ? { label: 'Undo', onUndo: () => undo(toast.parsed) } : undefined}
            onDismiss={() => setToast((t) => (t && t.n === toast.n ? null : t))}
          />
        )}
      </div>
    </section>
  )
}
