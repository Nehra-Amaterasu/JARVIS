/**
 * Study > dMAT (plan 4.15): practice for the Core Module's three task kinds from the server's own generators
 * (ww_dmat.py). A set is (kind, seed, level, n): the same seed is the same set. The server marks it, so this
 * page never holds a key; the score line counts correct answers only. The levels are practice steps that are
 * NOT calibrated against the real test, and the page says so. If the dMAT routes are absent the view falls
 * back to the registry's one-line placeholder.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Card, Field, PrimaryButton, Segmented } from '../kit'
import { Planned } from '../Planned'
import { dmatHistory, dmatScore, dmatSet, type DmatItem, type DmatKind, type DmatResult, type DmatRow, type DmatSet, type Fig } from './api'
import { fmtMin } from './format'

const KIND_LABEL: Record<DmatKind, string> = { figure: 'Figure sequences', equation: 'Equations', latin: 'Latin squares' }
const LETTER = 'ABCDEFGH'

function Shape({ f }: { f: Fig }) {
  return (
    <svg className="ww-dmat-fig" viewBox={f.viewbox.join(' ')} role="img" aria-label={f.text}>
      {f.paths.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
    </svg>
  )
}

function Item({ it, value, onPick }: { it: DmatItem; value: number | null; onPick: (i: number) => void }) {
  return (
    <div className="ww-dmat-item" data-dmat-item={it.i}>
      <p className="ww-dmat-prompt">{it.prompt}</p>
      {it.kind === 'figure' && (
        <div className="ww-dmat-seq" aria-label="Sequence">
          {it.shown?.map((f, i) => <Shape key={i} f={f} />)}
          <span className="ww-dmat-q" aria-hidden="true">?</span>
        </div>
      )}
      {it.kind === 'equation' && (
        <ul className="ww-dmat-eqs" aria-label="Equations">
          {it.equations?.map((e, i) => <li key={i}><code>{e}</code></li>)}
        </ul>
      )}
      {it.kind === 'latin' && it.grid && (
        <table className="ww-dmat-grid" aria-label="Square">
          <tbody>
            {it.grid.map((row, r) => (
              <tr key={r}>
                {row.map((c, k) => {
                  const ask = typeof it.ask === 'object' && it.ask.row === r + 1 && it.ask.col === k + 1
                  return <td key={k} data-ask={ask ? 'true' : undefined}>{c ?? (ask ? '?' : '')}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ww-dmat-opts" role="radiogroup" aria-label="Answer">
        {it.options.map((o, i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} className="ww-tap ww-dmat-opt" onClick={() => onPick(i)}>
            <span className="ww-dmat-letter">{LETTER[i]}</span>
            {'paths' in o ? <Shape f={o} /> : <span>{o.text}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Dmat() {
  const [kind, setKind] = useState<DmatKind>('figure')
  const [n, setN] = useState('10')
  const [level, setLevel] = useState('1')
  const [timer, setTimer] = useState<'on' | 'off'>('on')
  const [seedText, setSeedText] = useState('')
  const [hist, setHist] = useState<DmatRow[] | null | 'absent'>(null)
  const [set, setSet] = useState<DmatSet | null>(null)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState<number | null>(null)
  const [result, setResult] = useState<DmatResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(0)

  const loadHist = () => dmatHistory().then((r) => setHist(r.results)).catch(() => setHist('absent'))
  useEffect(() => { void loadHist() }, [])

  const finish = async (s: DmatSet, a: (number | null)[]) => {
    setBusy(true)
    try {
      const r = await dmatScore(s.set_id, a, Math.round((Date.now() - started.current) / 1000))
      setResult(r)
      setSet(null)
      void loadHist()
    } catch {
      setErr('The score could not be saved. Is the app running?')
    } finally { setBusy(false) }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  // the countdown runs only while a timed set is on screen; at 0 the set is marked as it stands
  useEffect(() => {
    if (!set || left === null) return
    if (left <= 0) { void finishRef.current(set, answers); return }
    const t = setTimeout(() => setLeft((x) => (x === null ? x : x - 1)), 1000)
    return () => clearTimeout(t)
  }, [set, left, answers])

  const start = async () => {
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      const seed = seedText.trim() ? Number(seedText) : Math.floor(Math.random() * 1_000_000) + 1
      const s = await dmatSet(kind, seed, Number(n), Number(level))
      started.current = Date.now()
      setSet(s)
      setAnswers(s.items.map(() => null))
      setAt(0)
      setLeft(timer === 'on' ? s.time_limit_s : null)
    } catch (e) {
      setErr((e as Error).message || 'The set could not be built.')
    } finally { setBusy(false) }
  }

  if (hist === 'absent') {
    return <div className="ww-dmat" data-view="dmat"><Card data-card="study-dmat" title="dMAT practice"><Planned id="dmat-practice" hint /></Card></div>
  }
  const last = hist && hist.length ? hist[0] : null
  const it = set?.items[at]
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="ww-dmat" data-view="dmat">
      <Card data-card="study-dmat" title="dMAT practice" kicker="Digital Master Test, Core Module">
        {!set && (
          <>
            <Segmented<DmatKind> label="Task kind" value={kind} onChange={setKind}
              options={(Object.keys(KIND_LABEL) as DmatKind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))} />
            <div className="ww-dmat-config">
              <Segmented label="Length" variant="compact" value={n} onChange={setN} options={['10', '20', '30'].map((x) => ({ id: x, label: `${x} tasks` }))} />
              <Segmented label="Level" variant="compact" value={level} onChange={setLevel} options={['1', '2', '3'].map((x) => ({ id: x, label: `Level ${x}` }))} />
              <Segmented<'on' | 'off'> label="Timer" variant="compact" value={timer} onChange={setTimer} options={[{ id: 'on', label: 'Timer on' }, { id: 'off', label: 'Timer off' }]} />
              <Field kind="number" label="Seed" hint="Optional: the same seed is the same set." value={seedText} onChange={(e) => setSeedText(e.target.value)} />
            </div>
            <p className="ww-papers-line" data-dmat-rules="">Rules are public; every item is generated by this app. None is copied from the test. The levels are uncalibrated practice steps, not the real test's difficulty.</p>
            <p className="ww-papers-line" data-dmat-last="">
              {last ? `Last set: ${last.correct} of ${last.of} correct${last.seconds != null ? ` in ${fmtMin(Math.max(1, Math.round(last.seconds / 60)))}` : ''} (${KIND_LABEL[last.kind]}, level ${last.level}).` : hist === null ? 'Reading your sets…' : 'No set taken yet.'}
            </p>
            {err && <p className="ww-rd-err" role="alert">{err}</p>}
            <PrimaryButton claimId="dmat-start" rank="workspace" loading={busy} data-feature="dmat-practice" onClick={() => void start()}>Start set</PrimaryButton>
          </>
        )}
        {set && it && (
          <div data-dmat-run="">
            <p className="ww-papers-line">{set.label} · level {set.level} · seed {set.seed} · task {at + 1} of {set.n}{left !== null ? ` · ${mm(Math.max(0, left))} left` : ''}</p>
            <Item it={it} value={answers[at] ?? null} onPick={(i) => setAnswers((a) => a.map((v, j) => (j === at ? i : v)))} />
            <div className="ww-dmat-nav">
              <Button size="sm" disabled={at === 0} onClick={() => setAt(at - 1)}>Back</Button>
              {at < set.n - 1 && <Button size="sm" onClick={() => setAt(at + 1)}>Next</Button>}
              <PrimaryButton claimId="dmat-finish" rank="workspace" size="sm" loading={busy} onClick={() => void finish(set, answers)}>Finish and score</PrimaryButton>
            </div>
            {err && <p className="ww-rd-err" role="alert">{err}</p>}
          </div>
        )}
        {result && !set && (
          <div className="ww-dmat-result" role="status" data-dmat-result="">
            <p className="ww-dmat-score">{result.correct} of {result.of} correct{result.unanswered ? `, ${result.unanswered} not answered` : ''}{result.seconds != null ? ` in ${mm(Math.round(result.seconds))}` : ''}.</p>
            <p className="ww-papers-line">{result.in_time === null ? 'Untimed.' : result.in_time ? 'Inside the time limit.' : 'Over the time limit.'} Saved to your history.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
