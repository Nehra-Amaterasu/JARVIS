// DmatBoard (package Y03): Study > dMAT on one canvas, in the plan view's forms and rhythm. Every feature of the classic page keeps its home:
// the three task kinds, length, level, timer, the optional seed, the rule line, the last set, Start, the running set with Back / Next /
// Finish and the countdown, the score and the saved line. Setup is two plates (the choice, and the last set drawn as a dial); a running
// set is the task plate beside a rail of one dot per task. The levels are uncalibrated practice steps and the page says so.
import { useRef } from 'react'
import { Button, Field, Lamp, PrimaryButton, Segmented } from '../../../shared/kit'
import type { DmatKind } from '../api'
import { lookV3Enabled, Zones } from '../../../shell/v3'
import { fmtMin } from '../format'
import { Item } from './DmatItem'
import { KIND_LABEL, mmss, type useDmat } from './useDmat'
import '../plan/y3.css'
import './dmat.css'
import './dmat-v3.css'

export type DmatState = ReturnType<typeof useDmat>

/** The score as a dial: an open 270 degree arc filled to correct / of. A count, so it carries the lamp of where it came from. */
function Dial({ correct, of, label }: { correct: number | null; of: number | null; label: string }) {
  const C = 60, R = 50
  const a = (deg: number) => { const r = (deg * Math.PI) / 180; return [C + R * Math.cos(r), C + R * Math.sin(r)] as const }
  const arc = (to: number) => { const [x0, y0] = a(135), [x1, y1] = a(to); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 ${to - 135 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}` }
  const f = correct !== null && of ? Math.min(1, correct / of) : 0
  return (
    <div className="dm-dial" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" width="160" height="160" aria-hidden="true">
        <path className="dm-dial-groove" d={arc(405)} />
        {f > 0 && <path className="dm-dial-fill" d={arc(135 + 270 * f)} />}
      </svg>
      <span className="dm-dial-num">{correct === null ? '--' : correct}<small>{of ? ` of ${of}` : ''}</small></span>
    </div>
  )
}

function KindGlyph({ k }: { k: DmatKind }) {
  return (
    <svg className="dm-glyph" viewBox="0 0 64 40" aria-hidden="true">
      {k === 'figure' && (<><path d="M6 30 14 12 22 30Z" /><rect x="26" y="12" width="16" height="16" rx="2" /><path d="M54 10 61 20 54 30 47 20Z" className="dm-q" /></>)}
      {k === 'equation' && (<><path d="M8 20h14M15 13v14" /><path d="M30 16h14M30 24h14" /><circle cx="56" cy="20" r="4" className="dm-q" /></>)}
      {k === 'latin' && (<>{[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={14 + c * 13} y={3 + r * 12} width="10" height="9" rx="2" className={r === 1 && c === 1 ? 'dm-q' : undefined} />))}</>)}
    </svg>
  )
}

const KIND_NOTE: Record<DmatKind, string> = {
  figure: 'Shapes in a row, one missing.',
  equation: 'Small equations, one unknown.',
  latin: 'Each symbol once per row and column.',
}
const KINDS = Object.keys(KIND_LABEL) as DmatKind[]

/** The task kind as three tiles: one radio group, arrows move and choose, one tab stop. */
function KindTiles({ value, onChange }: { value: DmatKind; onChange: (k: DmatKind) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const key = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % KINDS.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + KINDS.length - 1) % KINDS.length : -1
    if (to < 0) return
    e.preventDefault()
    refs.current[to]?.focus()
    onChange(KINDS[to])
  }
  return (
    <div className="dm-kinds" role="radiogroup" aria-label="Task kind">
      {KINDS.map((k, i) => (
        <button key={k} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={value === k} tabIndex={value === k ? 0 : -1} className="dm-kind ww-tap" onClick={() => onChange(k)} onKeyDown={(e) => key(e, i)}>
          <KindGlyph k={k} />
          <span className="dm-kind-name">{KIND_LABEL[k]}</span>
          <span className="dm-kind-note">{KIND_NOTE[k]}</span>
        </button>
      ))}
    </div>
  )
}

export function DmatBoard({ d }: { d: DmatState }) {
  const { set, result, last, hist, err, busy, at, left } = d
  const it = set?.items[at]
  const answered = d.answers.filter((a) => a !== null).length
  const lastLine = last
    ? `${last.correct} of ${last.of} correct${last.seconds != null ? ` in ${fmtMin(Math.max(1, Math.round(last.seconds / 60)))}` : ''} (${KIND_LABEL[last.kind]}, level ${last.level})`
    : hist === null ? 'Reading your sets…' : 'No set taken yet.'

  const cards = (
    <>
      {!set && (
        <section className="y3-card dm-setup" data-card="study-dmat">
          <header className="y3-head">
            <h2 className="y3-title">dMAT practice</h2>
            <span className="y3-kicker">Digital Master Test, Core Module</span>
          </header>
          <KindTiles value={d.kind} onChange={d.setKind} />
          <div className="dm-config">
            <Segmented label="Length" variant="compact" value={d.n} onChange={d.setN} options={['10', '20', '30'].map((x) => ({ id: x, label: `${x} tasks` }))} />
            <Segmented label="Level" variant="compact" value={d.level} onChange={d.setLevel} options={['1', '2', '3'].map((x) => ({ id: x, label: `Level ${x}` }))} />
            <Segmented<'on' | 'off'> label="Timer" variant="compact" value={d.timer} onChange={d.setTimer} options={[{ id: 'on', label: 'Timer on' }, { id: 'off', label: 'Timer off' }]} />
          </div>
          {err && <p className="ww-rd-err" role="alert">{err}</p>}
          <footer className="y3-foot dm-setup-foot">
            <PrimaryButton claimId="dmat-start" rank="workspace" size="lg" loading={busy} data-feature="dmat-practice" onClick={() => void d.start()}>Start set</PrimaryButton>
            <Field kind="number" label="Seed" hint="Optional: the same seed is the same set." value={d.seedText} onChange={(e) => d.setSeedText(e.target.value)} />
          </footer>
        </section>
      )}

      {set && it && (
        <section className="y3-card dm-run" data-card="study-dmat" data-dmat-run="">
          <header className="y3-head">
            <h2 className="y3-title">{set.label}</h2>
            <span className="y3-kicker">level {set.level} · seed {set.seed}</span>
          </header>
          <p className="y3-line dm-count">Task {at + 1} of {set.n}</p>
          <Item it={it} value={d.answers[at] ?? null} onPick={d.pick} />
          {err && <p className="ww-rd-err" role="alert">{err}</p>}
          <footer className="y3-foot dm-nav">
            <Button size="sm" grouped disabled={at === 0} onClick={() => d.setAt(at - 1)}>Back</Button>
            {at < set.n - 1 && <Button size="sm" grouped onClick={() => d.setAt(at + 1)}>Next</Button>}
            <PrimaryButton claimId="dmat-finish" rank="workspace" size="lg" loading={busy} onClick={() => void d.finish(set, d.answers)}>Finish and score</PrimaryButton>
          </footer>
        </section>
      )}
    </>
  )

  const side = (
      <aside className="y3-card dm-side" aria-label={set ? 'Progress' : 'Last set'}>
        {set ? (
          <>
            <header className="y3-head"><h2 className="y3-title">This set</h2><span className="y3-lamp"><Lamp state="live" reason="counted from your answers" /></span></header>
            <ol className="dm-dots" aria-label={`${answered} of ${set.n} answered`}>
              {set.items.map((_, i) => <li key={i} className="dm-dot" data-on={d.answers[i] !== null ? 'true' : undefined} data-here={i === at ? 'true' : undefined}><span className="y3-sr">Task {i + 1}{d.answers[i] !== null ? ', answered' : ', open'}</span></li>)}
            </ol>
            <p className="dm-clock-well">
              <span className="dm-clock-label">Time left</span>
              <output className="dm-clock" aria-label={left !== null ? `${mmss(Math.max(0, left))} left` : 'Untimed'}>{left !== null ? mmss(Math.max(0, left)) : 'Untimed'}</output>
            </p>
            <p className="y3-line">{answered} of {set.n} answered. A task left open is marked as not answered; nothing is taken away.</p>
          </>
        ) : (
          <>
            <header className="y3-head"><h2 className="y3-title">Last set</h2><span className="y3-lamp"><Lamp state={last ? 'live' : 'waiting'} reason={last ? 'from your saved sets' : 'no set taken yet'} /></span></header>
            {result ? (
              <div className="dm-result" role="status" data-dmat-result="">
                <Dial correct={result.correct} of={result.of} label={`${result.correct} of ${result.of} correct`} />
                <p className="dm-score">{result.correct} of {result.of} correct{result.unanswered ? `, ${result.unanswered} not answered` : ''}{result.seconds != null ? ` in ${mmss(Math.round(result.seconds))}` : ''}.</p>
                <p className="y3-line">{result.in_time === null ? 'Untimed.' : result.in_time ? 'Inside the time limit.' : 'Over the time limit.'} Saved to your history.</p>
              </div>
            ) : (
              <div className="dm-last">
                <Dial correct={last ? last.correct : null} of={last ? last.of : null} label={last ? `Last set ${last.correct} of ${last.of} correct` : 'No set taken yet'} />
                <p className="y3-line" data-dmat-last="">{last ? `Last set: ${lastLine}.` : lastLine}</p>
              </div>
            )}
            <p className="y3-line dm-rules" data-dmat-rules="">Rules are public; every item is generated by this app. None is copied from the test. The levels are uncalibrated practice steps, not the real test's difficulty.</p>
          </>
        )}
      </aside>
  )

  if (lookV3Enabled()) {
    return (
      <Zones
        ratio="default"
        first={{
          job: 'PRACTICE',
          flare: set ? 1 : 0,
          children: <div className="ww-dmat y3 dm dm3-col" data-view="dmat">{cards}</div>,
        }}
        second={{
          job: 'PROGRESS',
          peek: { name: 'Progress', lamp: set ? 'live' : last ? 'live' : 'waiting', note: set ? `${answered} of ${set.n} answered` : last ? 'last set on file' : 'no set taken yet' },
          children: <div className="ww-dmat y3 dm dm3-col dm3-side">{side}</div>,
        }}
        third={{
          job: 'RULES',
          peek: { name: 'Rules', lamp: 'planned', note: 'uncalibrated practice levels' },
          children: (
            <div className="ww-dmat y3 dm dm3-col">
              <p className="y3-line" data-dmat-rules3="">Rules are public; every item is generated by this app. None is copied from the test. The levels are uncalibrated practice steps, not the real test's difficulty.</p>
              <p className="y3-line"><Lamp state="planned" reason="levels are not calibrated against the real test" /> Levels 1 to 3</p>
            </div>
          ),
        }}
      />
    )
  }

  return (
    <div className="ww-dmat y3 dm" data-view="dmat">
      {cards}
      {side}
    </div>
  )
}
