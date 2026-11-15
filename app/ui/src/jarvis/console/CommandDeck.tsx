// The Console command line (spec 20.9.5): a Capture Line of grammar `jarvis` with a closed verb list, and the strip of
// answers above it. Tab completes a verb, Up recalls history (the Capture Line keeps the last 20), `/` focuses the line
// from anywhere in the view, Esc on an empty line leaves it. A verb that changes something asks once: the answer strip
// shows the question with Run and Cancel, focus moves to Run, and Enter runs it. Nothing here is a shell: the verb is
// looked up in a table and a word that is not in it never leaves the Capture Line.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CaptureLine, type Parsed } from '../../shared/capture'
import { LampGlyph } from '../../shared/lamp'
import { askLine, readVerb, runHeavy, type CommandContext, type OutLine } from './commands'
import { VERB_NAMES, completeVerb, verbDef } from './model'
import { ConsoleKey } from './parts'

export const OUT_KEEP = 20
export const OUT_SHOWN = 8

/** Put a value into a React-controlled input so its onChange runs (the Tab completion's only way in). */
function setInputValue(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function CommandDeck({ ctx, shown = OUT_SHOWN, initial }: { ctx: CommandContext; shown?: number; initial?: OutLine[] }) {
  const [lines, setLines] = useState<OutLine[]>(initial ?? [])
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const next = useRef((initial?.length ?? 0) + 1)
  const root = useRef<HTMLDivElement>(null)
  const runKey = useRef<HTMLDivElement>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  const push = useCallback((raw: Omit<OutLine, 'id'>[]) => {
    setLines((l) => [...l, ...raw.map((r) => ({ ...r, id: next.current++ }))].slice(-OUT_KEEP))
  }, [])

  const onCommit = useCallback((p: Parsed) => {
    if (p.grammar !== 'jarvis') return
    const def = verbDef(p.verb)
    push([{ tag: 'SYS', state: null, kind: 'echo', text: p.text }])
    if (!def) { push([{ tag: 'SYS', state: 'fault', kind: 'out', text: 'unknown verb; try help' }]); return }
    if (p.args) { push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: `${def.verb} takes no argument` }]); return }
    if (def.heavy) { push([askLine(def.verb)]); setPending(def.verb); return }
    push(readVerb(def.verb, ctxRef.current))
  }, [push])

  // focus moves to Run when a question is asked, so Enter answers it; it goes back to the line when it is answered
  useEffect(() => {
    if (pending) runKey.current?.querySelector<HTMLElement>('button')?.focus()
  }, [pending])
  const backToLine = () => root.current?.querySelector<HTMLInputElement>('.cl-input')?.focus()
  const run = async () => {
    const verb = pending
    if (!verb || busy) return
    setPending(null)
    setBusy(true)
    push(await runHeavy(verb, ctxRef.current))
    setBusy(false)
    backToLine()
  }
  const cancel = () => {
    if (!pending) return
    push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: `${pending}: cancelled, nothing changed` }])
    setPending(null)
    backToLine()
  }

  // `/` focuses the line from anywhere in the view (not while typing in a field)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      const input = root.current?.querySelector<HTMLInputElement>('.cl-input')
      if (!input || !input.offsetParent) return
      e.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (e.key === 'Tab' && !e.shiftKey && t instanceof HTMLInputElement && t.classList.contains('cl-input') && t.value.trim()) {
      const done = completeVerb(t.value)
      if (done !== t.value) { e.preventDefault(); setInputValue(t, done) }
      return
    }
    if (e.key === 'Escape' && pending) { e.preventDefault(); e.stopPropagation(); cancel(); return }
    if (e.key === 'Escape' && t instanceof HTMLInputElement && t.classList.contains('cl-input') && !t.value) {
      e.preventDefault()
      // the first Esc on an empty line clears the answers (the log and the tabs come back); the next one leaves the line
      if (lines.length) setLines([])
      else t.blur()
    }
  }

  const view = lines.slice(-shown)
  return (
    <div className="jx-deck" ref={root} onKeyDownCapture={onKeyDownCapture} data-pending={pending ?? undefined}>
      <ol className="jx-outs" aria-label="Command answers" aria-live="polite" data-empty={view.length ? undefined : 'true'}>
        {view.map((l) => (
          <li key={l.id} className="jx-out" data-kind={l.kind} data-state={l.state ?? undefined}>
            {l.kind === 'echo' ? <span className="jx-ps">jarvis&gt;</span> : <span className="jx-tag">[{l.tag}]</span>}
            {l.state && <LampGlyph state={l.state} size={12} className="jx-out-lamp" />}
            <span className="jx-out-text">{l.text}</span>
          </li>
        ))}
        {view.length > 0 && view.length <= 6 && !pending && <li className="jx-out jx-out-hint"><span className="jx-tag">[SYS]</span> Esc on an empty line clears these answers</li>}
      </ol>
      {pending && (
        <div className="jx-ask" role="group" aria-label={`Run ${pending}?`} ref={runKey}>
          <ConsoleKey label={`Run ${pending}`} onPress={() => void run()} accent />
          <ConsoleKey label="Cancel" onPress={cancel} quiet />
          <span className="jx-ask-hint">Enter runs it, Esc cancels</span>
        </div>
      )}
      <CaptureLine grammar="jarvis" verbs={VERB_NAMES} onCommit={onCommit} label="Command" globalKey={false} />
    </div>
  )
}
