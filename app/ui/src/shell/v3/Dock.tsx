/**
 * The dock (design-language-v3.md 4.1 rule 14): the last element of every screen, the same place and the same height. At its
 * left a mode switch with the view's own mode (the view registers it, contract.tsx) and Ask; then the one input, which shows
 * a dimmed "e.g." example (never typed-looking text), and the submit key. The mode switch shows both keys on every width
 * (jury round 3: a lone "Ask" key on the phone named the mode the person was not in). Ask is the shell's: it opens the
 * command palette, the one place that already knows every place and verb.
 */
import { useId, useState } from 'react'
import type { DockMode, DockSpec } from './contract'

export const ASK_MODE: DockMode = { id: 'ask', label: 'Ask', prefix: 'ask>', example: 'open room rules', action: 'Go' }

export interface DockProps {
  spec: DockSpec | null
  /** Ask was submitted: open the palette. */
  onAsk: () => void
}

export function Dock({ spec, onAsk }: DockProps) {
  const modes = [...(spec?.modes ?? []), ASK_MODE]
  // the view registers its modes after the dock first draws, so until a key is pressed the first mode is the one in use
  const [picked, setPicked] = useState<string | null>(null)
  const [text, setText] = useState('')
  const id = useId()
  const mode = modes.find((m) => m.id === picked) ?? modes[0]
  const ask = mode.id === ASK_MODE.id
  const submit = () => {
    if (ask) {
      setText('')
      onAsk()
      return
    }
    const t = text.trim()
    if (!t) return
    spec?.onSubmit?.(mode.id, t)
    setText('')
  }
  return (
    <form className="s3-dock" aria-label="Capture and ask" data-mode={mode.id} onSubmit={(e) => { e.preventDefault(); submit() }}>
      {modes.length > 1 && (
        <div className="s3-mode" role="group" aria-label="Mode">
          {modes.map((m) => (
            <button key={m.id} type="button" data-mode={m.id} aria-pressed={m.id === mode.id} onClick={() => setPicked(m.id)}>{m.label}</button>
          ))}
        </div>
      )}
      <label className="s3-wellin" htmlFor={`${id}-in`}>
        <span className="s3-prompt" aria-hidden="true">{mode.prefix}</span>
        <input id={`${id}-in`} type="text" value={text} autoComplete="off" spellCheck={false} placeholder={`e.g. ${mode.example}`}
          aria-label={`${mode.label}: type here`} onChange={(e) => setText(e.target.value)} />
      </label>
      <button type="submit" className="s3-key s3-send" disabled={!ask && !text.trim()}>{mode.action}</button>
    </form>
  )
}
