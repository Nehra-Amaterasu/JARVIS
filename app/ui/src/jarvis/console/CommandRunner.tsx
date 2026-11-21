// The Console command line under the v3 look: the dock owns the input (mode Command), so the answers and the one question
// a heavy verb asks live here, in the Activity tray. The verbs and their words are the CommandDeck's own (commands.ts,
// model.ts); only the input moved. A verb that changes something still asks once and runs on a second press.
import { useCallback, useEffect, useRef, useState } from 'react'
import { LampGlyph } from '../../shared/lamp'
import { parseCapture } from '../../shared/capture'
import { askLine, readVerb, runHeavy, type CommandContext, type OutLine } from './commands'
import { VERB_NAMES, verbDef } from './model'
import { ConsoleKey } from './parts'

export const RUNNER_KEEP = 20

export interface CommandRunner {
  lines: OutLine[]
  pending: string | null
  busy: boolean
  /** Takes one line from the dock. Returns false when nothing was run (the dock keeps the text). */
  submit: (text: string) => boolean
  run: () => Promise<void>
  cancel: () => void
  clear: () => void
}

export function useCommandRunner(ctx: CommandContext): CommandRunner {
  const [lines, setLines] = useState<OutLine[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const next = useRef(1)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const push = useCallback((raw: Omit<OutLine, 'id'>[]) => {
    setLines((l) => [...l, ...raw.map((r) => ({ ...r, id: next.current++ }))].slice(-RUNNER_KEEP))
  }, [])

  const submit = useCallback((text: string): boolean => {
    const res = parseCapture('jarvis', text, new Date(), VERB_NAMES)
    if (res.status === 'empty') return false
    if (res.status === 'partial') {
      push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: `not a whole verb yet: ${res.candidates.join(', ')}` }])
      return false
    }
    if (res.status === 'unknown') {
      push([{ tag: 'SYS', state: 'fault', kind: 'out', text: res.message }])
      return false
    }
    if (res.status === 'ask') {
      push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: res.question }])
      return false
    }
    const p = res.parsed
    if (p.grammar !== 'jarvis') return false
    const def = verbDef(p.verb)
    push([{ tag: 'SYS', state: null, kind: 'echo', text: p.text }])
    if (!def) { push([{ tag: 'SYS', state: 'fault', kind: 'out', text: 'unknown verb; try help' }]); return true }
    if (p.args) { push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: `${def.verb} takes no argument` }]); return true }
    if (def.heavy) { push([askLine(def.verb)]); setPending(def.verb); return true }
    push(readVerb(def.verb, ctxRef.current))
    return true
  }, [push])

  const run = useCallback(async () => {
    const verb = pending
    if (!verb || busy) return
    setPending(null)
    setBusy(true)
    push(await runHeavy(verb, ctxRef.current))
    setBusy(false)
  }, [pending, busy, push])
  const cancel = useCallback(() => {
    if (!pending) return
    push([{ tag: 'SYS', state: 'waiting', kind: 'out', text: `${pending}: cancelled, nothing changed` }])
    setPending(null)
  }, [pending, push])
  const clear = useCallback(() => setLines([]), [])
  return { lines, pending, busy, submit, run, cancel, clear }
}

/** The answers of the command line, newest last, and the Run and Cancel of a heavy verb. Draws nothing until there is an answer. */
export function CommandAnswers({ runner, shown = 5 }: { runner: CommandRunner; shown?: number }) {
  const { lines, pending } = runner
  const keys = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (pending) keys.current?.querySelector<HTMLElement>('button')?.focus()
  }, [pending])
  if (!lines.length && !pending) return null
  const view = lines.slice(-shown)
  return (
    <div className="jx3-answers" onKeyDown={(e) => { if (e.key === 'Escape' && pending) { e.preventDefault(); e.stopPropagation(); runner.cancel() } }}>
      <ol className="jx-outs" aria-label="Command answers" aria-live="polite">
        {view.map((l) => (
          <li key={l.id} className="jx-out" data-kind={l.kind} data-state={l.state ?? undefined}>
            {l.kind === 'echo' ? <span className="jx-ps">jrv&gt;</span> : <span className="jx-tag">[{l.tag}]</span>}
            {l.state && <LampGlyph state={l.state} size={12} className="jx-out-lamp" />}
            <span className="jx-out-text">{l.text}</span>
          </li>
        ))}
      </ol>
      {pending && (
        <div className="jx-ask" role="group" aria-label={`Run ${pending}?`} ref={keys}>
          <ConsoleKey label={`Run ${pending}`} onPress={() => void runner.run()} accent />
          <ConsoleKey label="Cancel" onPress={runner.cancel} quiet />
        </div>
      )}
      {!pending && lines.length > 0 && <ConsoleKey label="Clear answers" quiet onPress={runner.clear} />}
    </div>
  )
}
