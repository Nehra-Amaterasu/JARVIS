// The spoken-words table (parity O4d): a word and how to say it, added, edited, heard and removed. The card shows the first
// three rows and the count; the drawer holds the form and the whole table. Hear says the SPOKEN form itself, so a person can
// check the sound before keeping it. A route that does not answer is WAITING with the reason and the table is not drawn.
import { Pencil, Trash2, Volume2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Lamp, type LampReading } from '../../shared/lamp'
import { pronunciationProblem } from '../../lib/settings'
import { simState, wordRows, type RouteStatus } from './model'
import type { WordsLive } from './useSound'
import './sound.css'

export function wordsReading(route: RouteStatus, hasTable: boolean, simulated: boolean): LampReading {
  if (hasTable && route.ok) return { state: simState('live', simulated), since: route.at, reason: 'the pronunciation route answered' }
  const reason = route.reason ? `the pronunciation route did not answer: ${route.reason}` : 'reading the table'
  return { state: 'waiting', since: null, reason }
}

export function WordsCard({ words, simulated, onOpen }: { words: WordsLive; simulated: boolean; onOpen: () => void }) {
  const rows = wordRows(words.table)
  const reading = wordsReading(words.route, !!words.table, simulated)
  return (
    <section className="sd-tool" aria-label="Pronunciation" data-card="words">
      <div className="sd-tool-text">
        <h3><span className="sd-tag">[SAY]</span>Pronunciation<Lamp reading={reading} subject="Spoken words" /></h3>
        {words.table ? (
          <p className="sd-note">{rows.length ? `${rows.length} word${rows.length === 1 ? '' : 's'} in the table, e.g. ${rows.slice(0, 2).map((r) => r.word).join(', ')}.` : 'No fixes yet. Add a word and how to say it.'}</p>
        ) : <p className="sd-note">No table shown: {reading.reason}.</p>}
      </div>
      <button type="button" className="sd-key" onClick={onOpen} data-open="words"><Pencil size={16} aria-hidden="true" />Edit</button>
    </section>
  )
}

export function WordsBody({ words, simulated }: { words: WordsLive; simulated: boolean }) {
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  const [heard, setHeard] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const rows = wordRows(words.table)
  const reading = wordsReading(words.route, !!words.table, simulated)
  const ready = !!words.table
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const p = pronunciationProblem(word, say)
    setProblem(p)
    if (p || !ready) return
    if (await words.save(word, say)) { setWord(''); setSay('') }
  }
  const hear = async (spoken: string) => setHeard(await words.hear('', spoken))
  return (
    <>
      <div className="sd-row"><Lamp reading={reading} subject="Spoken words" /><p className="sd-note">{ready ? `${rows.length} word${rows.length === 1 ? '' : 's'}. JARVIS says the second column wherever the first appears.` : reading.reason}</p></div>
      <form className="sd-field" onSubmit={save} noValidate>
        <label htmlFor="sd-word">Word</label>
        <input id="sd-word" className="sd-well" value={word} onChange={(e) => setWord(e.target.value)} placeholder="raga" maxLength={40} aria-invalid={problem ? true : undefined} aria-disabled={!ready || undefined} readOnly={!ready} />
        <label htmlFor="sd-say">Say it as</label>
        <input id="sd-say" className="sd-well" value={say} onChange={(e) => setSay(e.target.value)} placeholder="rah-gah" maxLength={80} aria-invalid={problem ? true : undefined} aria-disabled={!ready || undefined} readOnly={!ready} />
        {(problem || words.error) && <p className="sd-note" role="alert">{problem ?? `Not saved: ${words.error}`}</p>}
        <div className="sd-row">
          <button type="button" className="sd-key" aria-disabled={!say.trim() || undefined} onClick={() => say.trim() && void hear(say.trim())}><Volume2 size={16} aria-hidden="true" />Hear</button>
          <button type="submit" className="sd-key" aria-disabled={!ready || !word.trim() || !say.trim() || undefined}>Save</button>
        </div>
        {heard && <p className="sd-note" role="status">{heard}</p>}
      </form>
      {ready && rows.length > 0 && (
        <ul className="sd-words" aria-label="The table">
          {rows.map((r) => (
            <li key={r.word} className="sd-word-row">
              <span><b>{r.word}</b><span>says {r.say}</span></span>
              <button type="button" className="sd-key" data-quiet="true" aria-label={`Edit ${r.word}`} onClick={() => { setWord(r.word); setSay(r.say); setProblem(null) }}><Pencil size={16} aria-hidden="true" /></button>
              <button type="button" className="sd-key" data-quiet="true" aria-label={`Remove ${r.word}`} onClick={() => void words.remove(r.word)}><Trash2 size={16} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      {ready && rows.length === 0 && <p className="sd-empty">No fixes yet. When JARVIS says a name or a term wrongly, add it here with how it should sound.</p>}
    </>
  )
}
