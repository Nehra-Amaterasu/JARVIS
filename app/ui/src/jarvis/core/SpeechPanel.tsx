// JARVIS's voice and the words he is taught to say, behind one key on Core Talk (parity ledger O4b and O4d). The classic
// page had two cards for it (ConnectControls: VoiceCard, PronunciationCard); here they are the two tabs of one drawer that
// the "Voice" key under the stage opens, so the voice is tuned where it is heard and no settings page is needed.
//
// Why a drawer and not a Trim: spec 20.6.6 puts a setting behind a Trim popover of at most 320 x 360, and the voice list,
// the speed and Test voice plus the Trim's own value, default and Reset lines came to about 580 px: in the built app (15 Nov
// screenshot) the well collapsed and the controls drew over each other. The drawer is the pattern this view already uses for Anatomy and Earlier.
//
// First tab: the voice (a grouped list: British, American, Indian English, offline), the speed, Test voice and Back to the
// default. Second tab: each taught word with Hear and Remove, and a form to add one. Every control shows its current value
// and, under the controls, the state of its last call: WAITING while the server is asked, LIVE only when it answered, FAULT
// with the server's own words when it refused.
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { VOICE_GROUPS, voicesIn, pronunciationProblem } from '../../lib/settings'
import { Lamp } from '../../shared/lamp'
import { SPEED_FALLBACK, SPEED_DEFAULT, speechStore, useSpeech, voiceValueText, wordsValueText, type Note, type SpeechPort } from './speech'
import './speech.css'

type Tab = 'voice' | 'words'

/** The state of the last call, as a lamp with its word and the server's own text. Prints nothing before the first call. */
export function NoteLine({ note }: { note: Note }) {
  if (note.state === 'idle') return <p className="sp-note" role="status" />
  return (
    <p className="sp-note" role="status" data-state={note.state}>
      <Lamp reading={{ state: note.state, since: null, reason: note.text }} subject="Last change" />
      <span>{note.text}</span>
    </p>
  )
}

function VoiceTab() {
  const s = useSpeech()
  const v = s.voice
  const selectId = useId()
  const [lo, hi] = v?.speed_range ?? SPEED_FALLBACK
  // the slider is a draft while it is dragged: the server is asked once, when the hand lets go (the classic page's rule)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? v?.speed ?? 1
  const commit = () => {
    if (draft === null) return
    const n = draft
    setDraft(null)
    void speechStore.speed(n)
  }
  const busy = s.voiceNote.state === 'waiting'
  const atDefault = !!v && v.chosen === v.default && Math.abs(v.speed - SPEED_DEFAULT) < 0.001
  const groups = VOICE_GROUPS.map((g) => ({ g, list: voicesIn(v, g) })).filter((x) => x.list.length)
  return (
    <div className="sp-tab">
      <label className="sp-label" htmlFor={selectId}>Voice</label>
      <select
        id={selectId} className="sp-select" value={v?.chosen ?? ''} disabled={!v}
        onChange={(e) => void speechStore.pick(e.currentTarget.value)}
      >
        {!v && <option value="">not loaded yet</option>}
        {groups.map(({ g, list }) => (
          <optgroup key={g} label={g}>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.gender ? ` (${x.gender})` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <p className="sp-hint">
        {!v ? 'Waiting for the voice list.'
          : v.chosen.startsWith('kokoro:') ? 'Offline voice on the CPU: no internet, nothing leaves the laptop.'
            : `Online neural voice${v.edge_source === 'built-in' ? ' (the built-in list: the live one could not be fetched)' : ''}. Accent tags still switch voices mid-reply.`}
        {v?.kokoro_missing && ` Offline voice not installed: ${v.kokoro_missing}.`}
      </p>
      <label className="sp-label" htmlFor={`${selectId}-speed`}>Speed <output className="sp-val" htmlFor={`${selectId}-speed`}>{shown.toFixed(2)}×</output></label>
      <input
        id={`${selectId}-speed`} className="sp-range" type="range" min={lo} max={hi} step={0.05} value={shown}
        disabled={!v} aria-valuetext={`${shown.toFixed(2)} times normal speed`}
        onChange={(e) => setDraft(Number(e.currentTarget.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
      />
      <div className="sp-row">
        <button type="button" className="jc-key sp-btn" aria-disabled={!v || busy || undefined} onClick={() => { if (v && !busy) void speechStore.test() }}>Test voice</button>
        <button type="button" className="jc-key jc-key-quiet sp-btn" aria-disabled={!v || busy || atDefault || undefined} onClick={() => { if (v && !busy && !atDefault) void speechStore.resetVoice() }}>
          {atDefault ? 'At the default' : 'Back to the default'}
        </button>
      </div>
      <NoteLine note={s.voiceNote} />
    </div>
  )
}

function WordsTab() {
  const s = useSpeech()
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  const fid = useId()
  const rows = Object.entries(s.words ?? {})
  const problem = word || say ? pronunciationProblem(word, say) : null
  const busy = s.wordsNote.state === 'waiting'
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem || busy || !word.trim() || !say.trim()) return
    if (await speechStore.add(word, say)) {
      setWord('')
      setSay('')
    }
  }
  return (
    <div className="sp-tab">
      {!s.words ? <p className="sp-hint">Waiting for the word list.</p>
        : rows.length === 0 ? <p className="sp-hint">No words taught yet. Write how a name should sound, for example Aankhen as Aan-khen. It changes what he says, not what you read.</p>
          : (
            <ul className="sp-words" aria-label={`${rows.length} taught word${rows.length === 1 ? '' : 's'}`}>
              {rows.map(([w, how]) => (
                <li key={w}>
                  <span className="sp-word"><b>{w}</b> <span aria-hidden="true">as</span><span className="sp-sr"> said as </span> <span className="sp-say">{how}</span></span>
                  <button type="button" className="jc-key jc-key-sm sp-ico" aria-label={`Hear ${w}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) void speechStore.test(`${w}. I said ${w}.`, w) }}>Hear</button>
                  <button type="button" className="jc-key jc-key-sm sp-ico" aria-label={`Remove ${w}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) void speechStore.drop(w) }}>Remove</button>
                </li>
              ))}
            </ul>
          )}
      <form className="sp-form" onSubmit={(e) => void submit(e)} aria-label="Teach a word">
        <label className="sp-label" htmlFor={`${fid}-w`}>Word</label>
        <input id={`${fid}-w`} className="sp-field" value={word} onChange={(e) => setWord(e.currentTarget.value)} maxLength={40} autoComplete="off" placeholder="Aankhen" />
        <label className="sp-label" htmlFor={`${fid}-s`}>Say it as</label>
        <input id={`${fid}-s`} className="sp-field" value={say} onChange={(e) => setSay(e.currentTarget.value)} maxLength={80} autoComplete="off" placeholder="Aan-khen" />
        <div className="sp-row">
          <button type="submit" className="jc-key sp-btn" aria-disabled={!word.trim() || !say.trim() || !!problem || busy || undefined}>Teach</button>
          {problem && <span className="sp-warn" role="alert">{problem}</span>}
        </div>
      </form>
      <NoteLine note={s.wordsNote} />
    </div>
  )
}

export interface SpeechPanelProps {
  port: SpeechPort
  /** A fixture: the port keeps its words in memory and every note says SIMULATED. */
  simulated?: boolean
}

/** The drawer's body. Loads the voice list and the word table once when it is drawn (the drawer draws its children only while open). */
export function SpeechPanel({ port, simulated = false }: SpeechPanelProps) {
  const [tab, setTab] = useState<Tab>('voice')
  const s = useSpeech()
  useEffect(() => {
    speechStore.bind(port, simulated)
    void speechStore.loadVoice()
    void speechStore.loadWords()
  }, [port, simulated])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const next: Tab = tab === 'voice' ? 'words' : 'voice'
    setTab(next)
    const group = e.currentTarget // React clears currentTarget once the handler returns, so read it now
    requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-tab='${next}']`)?.focus())
  }
  return (
    <div className="sp-panel">
      <div className="jc-mode sp-tabs" role="radiogroup" aria-label="Voice settings" onKeyDown={onKey}>
        {(['voice', 'words'] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tab === t} tabIndex={tab === t ? 0 : -1} data-tab={t} onClick={() => setTab(t)}>
            {t === 'voice' ? 'Voice' : 'Spoken words'}
          </button>
        ))}
      </div>
      <p className="sp-now-line"><span className="sp-k">Now</span> {tab === 'voice' ? voiceValueText(s) : wordsValueText(s)}</p>
      {tab === 'voice' ? <VoiceTab /> : <WordsTab />}
    </div>
  )
}

/** The key under the stage that opens the drawer: a 44 px slider glyph and its word, so it is not mistaken for Pause. */
export function VoiceKey({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="jc-key jc-key-sm jc-voice-key" aria-haspopup="dialog" data-testid="voice-key" onClick={onOpen}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <path d="M2 5h16M2 10h16M2 15h16" /><rect x="11" y="3" width="4" height="4" rx="1" /><rect x="4.5" y="8" width="4" height="4" rx="1" /><rect x="9" y="13" width="4" height="4" rx="1" />
      </svg>
      Voice
    </button>
  )
}
