/**
 * The dock (design-language-v3.md 4.1 rule 14): the last element of every screen, the same place and the same height. At its
 * left a mode switch with the view's own mode (the view registers it, contract.tsx) and Ask; then the one input, which shows
 * a dimmed "e.g." example (never typed-looking text), and the submit key. The mode switch shows both keys on every width
 * (jury round 3: a lone "Ask" key on the phone named the mode the person was not in). Ask is the shell's: it opens the
 * command palette, the one place that already knows every place and verb.
 *
 * 28 Nov (V1, chrome that gives room back): the dock was 76 px on every screen. It is now a slim 44 px line that keeps its
 * height when it opens, so nothing above it moves under the pointer. It OPENS (data-open) while the pointer is over it, while
 * focus is inside it, while it holds unsent text, and when the "/" key summons it from anywhere outside a text field; it
 * goes quiet again when none of those holds.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { DockMode, DockSpec } from './contract'

export const ASK_MODE: DockMode = { id: 'ask', label: 'Ask', prefix: 'ask>', example: 'open room rules', action: 'Go' }

export interface DockProps {
  spec: DockSpec | null
  /** Ask was submitted: open the palette. The typed text is passed along; the dock keeps it in the input either way. */
  onAsk: (text: string) => void
  /** A still pose for the specimen page: true draws the open dock without a pointer or focus. The shell never passes it. */
  open?: boolean
}

export function Dock({ spec, onAsk, open: pose }: DockProps) {
  const modes = [...(spec?.modes ?? []), ASK_MODE]
  // the view registers its modes after the dock first draws, so until a key is pressed the first mode is the one in use
  const [picked, setPicked] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  // "/" summons the dock from anywhere that is not already a place to type (the palette keeps Ctrl+K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('[aria-modal="true"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const open = pose ?? (hover || focus || text.trim().length > 0)
  const mode = modes.find((m) => m.id === picked) ?? modes[0]
  const ask = mode.id === ASK_MODE.id
  const submit = () => {
    const t = text.trim()
    if (ask) {
      // the palette cannot take a starting query yet (README, "Open edit"), so the text stays in the input: nothing typed is lost
      onAsk(t)
      return
    }
    if (!t) return
    // the input clears only when the view says it took the line; a view that returns false or throws keeps the person's text
    const clear = () => setText((cur) => (cur.trim() === t ? '' : cur))
    try {
      const r = spec?.onSubmit?.(mode.id, t)
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        void (r as Promise<boolean | void>).then((ok) => { if (ok !== false) clear() }, () => undefined)
      } else if (r !== false) clear()
    } catch {
      /* the view failed: keep the text so the person can retry */
    }
  }
  return (
    <form className="s3-dock" aria-label="Capture and ask" data-mode={mode.id} data-open={open ? 'true' : 'false'}
      onSubmit={(e) => { e.preventDefault(); submit() }}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false) }}>
      {modes.length > 1 && (
        <div className="s3-mode" role="group" aria-label="Mode">
          {modes.map((m) => (
            <button key={m.id} type="button" data-mode={m.id} aria-pressed={m.id === mode.id} onClick={() => setPicked(m.id)}>{m.label}</button>
          ))}
        </div>
      )}
      <label className="s3-wellin" htmlFor={`${id}-in`}>
        <span className="s3-prompt" aria-hidden="true">{mode.prefix}</span>
        <input ref={input} id={`${id}-in`} type="text" value={text} aria-keyshortcuts="/" autoComplete="off" spellCheck={false} placeholder={`e.g. ${mode.example}`}
          aria-label={`${mode.label}: type here`} onChange={(e) => setText(e.target.value)} />
        <span className="s3-dockkey" aria-hidden="true"><kbd>/</kbd></span>
      </label>
      <button type="submit" className="s3-key s3-send" disabled={!ask && !text.trim()}>{mode.action}</button>
    </form>
  )
}
