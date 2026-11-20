// PlanBoard (package Y03, spec 20.7.3 and 20.7.5): the Study plan on one canvas, as three columns of raised plates.
//   left    today's plan (blocks as a rail, the contracts of the chosen block, the one next action, Swap, Rebuild) and the exam study of the day
//   middle  the Syllabus Landscape of the chosen paper and the Sigil Gauges of its units
//   right   the Exam Wheel of the papers on file and the Retention Orbit
// It draws plain data handed to it: the live view (PlanView) fills it from the plan store, the exam store and the Study port, and the
// gallery fills it with invented data stamped SIMULATED. Every number carries a lamp and its word; nothing here predicts a paper or a result.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, PrimaryButton } from '../../../shared/kit'
import type { LampState } from '../../../shared/lamp'
import type { Reading } from './Plate'
import type { Today, PlanContract } from '../../../germoney/game/plan'
import type { ExamsAnswer } from '../../../germoney/pages/Exams'
import { fmtDate, fmtMin } from '../format'
import { ExamWheel } from './ExamWheel'
import { Pager, Plate } from './Plate'
import { RetentionOrbit } from './RetentionOrbit'
import { SigilGauge } from './SigilGauge'
import { SyllabusLandscape } from './SyllabusLandscape'
import { FOOTER, chosenPaper, isMeasured, paged, unitLabel, weakestUnit, type OrbitTopic, type UnitReading } from './model'
import './plan.css'
import './y3.css'

const SLOT_WORD: Record<string, string> = { library: 'Library', evening: 'Evening', weekend: 'Weekend', extra: 'Extra', quest: 'Quest' }
const KIND_WORD: Record<string, string> = { library: 'Library', evening: 'Evening', weekend: 'Weekend', protected: 'Rest' }
const ROWS = 3
const EXAM_ROWS = 1
const GAUGES = 3

export type { Reading }
export interface RetentionReading extends Reading { dueCount: number | null; topics: OrbitTopic[]; dueIds: string[] }

export interface PlanBoardProps {
  today: Today
  exams: ExamsAnswer | null
  paperId: string | null
  onPaper: (id: string) => void
  units: UnitReading[]
  unitsReading: Reading
  retention: RetentionReading
  /** 'YYYY-MM-DD' from the data layer. */
  clock: string
  /** The plan's own lamp: LIVE for the server's plan, SIMULATED in the gallery. */
  planLamp?: Reading
  onStart: () => void
  onRebuild: () => Promise<void>
  onSwap: (firstKey: string, altKey: string) => Promise<string>
  onLog: (subject: string, minutes: number) => void
  onDrill: (unitId: string) => void
  /** Open the Why or Swap sheet at first paint (the gallery shows them). */
  sheet?: 'why' | 'swap' | null
}

function Row({ c, next, children }: { c: PlanContract; next: boolean; children?: ReactNode }) {
  // the focal row (the next action) carries its hint; the others say what and how long, so a list of three always fits its plate
  const meta = `${SLOT_WORD[c.slot] ?? c.slot} · ${fmtMin(c.minutes)}${c.node_name ? ` · ${c.node_name}` : ''}${next && c.hint ? ` · ${c.hint}` : ''}`
  return (
    <li className="y3-row" data-contract={c.key} data-next={next ? 'true' : undefined} data-done={c.done ? 'true' : undefined}>
      <span className="y3-row-main">
        <span className="y3-row-title">{c.title}</span>
        <span className="y3-row-meta">{meta}</span>
      </span>
      {c.done ? <span className="y3-row-done">Done</span> : children}
    </li>
  )
}

export function PlanBoard(p: PlanBoardProps) {
  const { today, exams } = p
  const [blockId, setBlockId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [exPage, setExPage] = useState(0)
  const [gPage, setGPage] = useState(0)
  const [sheet, setSheet] = useState<'why' | 'swap' | null>(p.sheet ?? null)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<string | null>(null)
  const [unit, setUnit] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const model = useMemo(() => {
    const rows = today.blocks.map((b) => ({ b, items: b.kind === 'protected' ? [] : today.contracts.filter((c) => c.slot === b.kind) }))
    const next = rows.flatMap((r) => r.items).find((c) => !c.done) ?? null
    const firstTree = today.contracts.find((c) => c.slot === 'library' && c.source === 'tree' && !c.done) ?? null
    return { rows, next, firstTree }
  }, [today])
  const startBlock = model.rows.find((r) => model.next && r.items.some((c) => c.key === model.next!.key))?.b.id ?? model.rows[0]?.b.id ?? null
  const cur = model.rows.find((r) => r.b.id === (blockId ?? startBlock)) ?? model.rows[0] ?? null
  const alts = today.alternatives ?? []
  const view = paged(cur?.items ?? [], ROWS, page)

  const slots = exams?.days.find((d) => d.date === exams.date)?.slots ?? []
  const exRows = slots.flatMap((s) => s.blocks.map((b) => ({ slot: s.label, b })))
  const exView = paged(exRows, EXAM_ROWS, exPage)

  const papers = exams?.papers ?? []
  const paper = chosenPaper(papers, p.paperId)
  const wheel = papers.map((x) => ({ id: x.id, label: x.title, date: x.date, approx: x.approx }))
  const gv = paged(p.units, GAUGES, gPage)
  const weak = weakestUnit(p.units)
  const anyMeasured = p.units.some(isMeasured)

  useEffect(() => { if (sheet) sheetRef.current?.focus() }, [sheet])
  const close = () => { setSheet(null); opener.current?.focus() }
  const open = (which: 'why' | 'swap', el: HTMLElement) => { opener.current = el; setSheet(which) }

  const e = today.exam
  const planLamp = p.planLamp ?? { state: 'live' as LampState, reason: 'the plan engine answered' }
  const doRebuild = () => { setBusy(true); void p.onRebuild().finally(() => { setBusy(false); setAsk(false) }) }

  return (
    <div className="ww-plan y3 y3-plan" data-view="plan">
      <div className="y3-col">
        <Plate id="study-plan" title="Today's plan" kicker={e?.phase ? e.phase.name : e?.subject ? `Exam mode: ${e.subject.name}` : undefined} lamp={planLamp} className="y3-today">
          {sheet && (
            <div className="y3-sheet" ref={sheetRef} tabIndex={-1} role="dialog" aria-label={sheet === 'why' ? 'Why this order' : 'Swap the next block'} onKeyDown={(k) => { if (k.key === 'Escape') { k.stopPropagation(); close() } }}>
              <div className="y3-sheet-head">
                <h3 className="y3-sheet-title">{sheet === 'why' ? 'Why this order' : 'Swap the next block'}</h3>
                <Button size="sm" grouped onClick={close}>Close</Button>
              </div>
              {sheet === 'why' && (
                <div className="y3-sheet-body">
                  <p className="y3-line">{e?.advice ?? 'The plan gives no reason for today.'}</p>
                  {e?.milestone && <p className="y3-line">Next milestone: {e.milestone}</p>}
                </div>
              )}
              {sheet === 'swap' && model.firstTree && (
                <ul className="y3-sheet-body y3-swap">
                  {alts.map((a) => (
                    <li key={a.key} className="y3-row">
                      <span className="y3-row-main"><span className="y3-row-title">{a.title}</span><span className="y3-row-meta">{fmtMin(a.minutes)}{a.node_name ? ` · ${a.node_name}` : ''}</span></span>
                      <Button size="sm" onClick={() => void p.onSwap(model.firstTree!.key, a.key).then((s) => { setSay(s); close() })}>Swap in</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {model.rows.length === 0 ? (
            <p className="y3-line y3-empty">No block is planned for today.</p>
          ) : (
            <>
              <div className="y3-rail" role="group" aria-label="Blocks of the day" style={{ ['--n' as string]: model.rows.length }}>
                {model.rows.map(({ b }) => (
                  <button key={b.id} type="button" className="y3-blk ww-tap" data-block={b.kind} aria-pressed={cur?.b.id === b.id} aria-label={`${b.label}, ${b.start}, ${fmtMin(b.minutes)}`} onClick={() => { setBlockId(b.id); setPage(0) }}>
                    <span className="y3-blk-name">{KIND_WORD[b.kind] ?? b.kind}</span>
                    <span className="y3-blk-meta">{b.start} · {fmtMin(b.minutes)}</span>
                  </button>
                ))}
              </div>
              {cur && <p className="y3-line y3-blkhead">{cur.b.label}</p>}
              <ul className="y3-rows" aria-label={cur ? `${cur.b.label}, contracts` : 'Contracts'}>
                {cur?.b.kind === 'protected' && <li className="y3-line y3-rest">Protected rest. The plan never puts work here.</li>}
                {cur && cur.b.kind !== 'protected' && cur.items.length === 0 && <li className="y3-line y3-rest">Nothing planned here.</li>}
                {view.items.map((c) => {
                  const isNext = model.next?.key === c.key
                  return (
                    <Row key={c.key} c={c} next={isNext}>
                      {model.firstTree?.key === c.key && alts.length > 0 && (
                        <Button size="sm" grouped aria-label={`Swap ${c.title} (${alts.length} other ${alts.length === 1 ? 'option' : 'options'})`} onClick={(ev) => open('swap', ev.currentTarget)}>Swap</Button>
                      )}
                    </Row>
                  )
                })}
              </ul>
              <Pager page={view.page} pages={view.pages} onPage={setPage} label="Contracts" />
            </>
          )}
          {say && <p className="y3-line" role="status">{say}</p>}
          <footer className="y3-foot">
            {!ask ? (
              <>
                {model.next && <PrimaryButton claimId="plan-start" rank="workspace" size="lg" onClick={p.onStart}>Start in Focus</PrimaryButton>}
                {e?.advice && <Button size="sm" grouped onClick={(ev) => open('why', ev.currentTarget)}>Why this order</Button>}
                <Button size="sm" grouped onClick={() => setAsk(true)}>Rebuild today's plan</Button>
              </>
            ) : (
              <div className="y3-confirm" role="group" aria-label="Confirm rebuild">
                <p className="y3-line">Rebuild today's plan? The blocks are drawn again from the bank. Contracts you finished stay finished.</p>
                <span className="y3-confirm-acts">
                  <Button size="sm" grouped loading={busy} onClick={doRebuild}>Rebuild</Button>
                  <Button size="sm" grouped onClick={() => setAsk(false)}>Keep the plan</Button>
                </span>
              </div>
            )}
          </footer>
        </Plate>

        <Plate id="study-exam-blocks" title="Exam study today" lamp={exams ? planLamp : { state: 'waiting', reason: 'reading the exam plan' }} className="y3-exam">
          {exRows.length === 0 && <p className="y3-line y3-empty">No exam study block is left today.</p>}
          <ul className="y3-rows">
            {exView.items.map(({ slot, b }) => {
              const sub = exams?.papers.find((x) => x.id === b.paper)?.subject
              return (
                <li key={`${slot}:${b.paper}`} className="y3-row y3-exrow">
                  <span className="y3-row-main">
                    <span className="y3-row-title">{b.title}</span>
                    <span className="y3-row-meta">{slot} · {fmtMin(b.minutes)}{b.focus.length ? ` · ${b.focus.slice(0, 3).map((f) => f.title).join(', ')}` : ''}</span>
                  </span>
                  {sub && (
                    <span className="y3-log">
                      {[30, 60].map((m) => <Button key={m} size="sm" grouped aria-label={`Log ${m} minutes on ${b.title}`} onClick={() => p.onLog(sub, m)}>{m} min</Button>)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <Pager page={exView.page} pages={exView.pages} onPage={setExPage} label="Exam study" />
        </Plate>
      </div>

      <div className="y3-col">
        <Plate title="Syllabus landscape" kicker={paper ? paper.title : undefined} lamp={p.unitsReading} className="y3-landplate">
          <SyllabusLandscape units={p.units} selectedId={unit} onSelect={setUnit} caption="Height = your marks, footprint = the unit's share of the paper. It follows your records, not the clock." />
          {p.unitsReading.state !== 'live' && p.unitsReading.state !== 'simulated' && p.units.length > 0 && <p className="y3-line y3-why">Not measured: {p.unitsReading.reason}.</p>}
        </Plate>
        <Plate title="Weak units" lamp={p.unitsReading} className="y3-gauges">
          {p.units.length === 0 ? (
            <>
              <div className="y3-gauge-row" aria-hidden="true">
                {[0, 1, 2].map((k) => <svg key={k} className="y3-sg-ghost" viewBox="0 0 96 96"><path d="M20.9 77.1A41 41 0 1 1 75.1 77.1" transform="translate(0 0)" /></svg>)}
              </div>
              <p className="y3-line y3-ascii">No syllabus units yet. Add them in Subjects.</p>
            </>
          ) : (
            <>
              <div className="y3-gauge-row">
                {gv.items.map((u) => <SigilGauge key={u.id} unitId={u.id} proficiency={u.proficiency ?? 0} n={u.n} label={`Unit ${u.num}`} selected={unit === u.id} action="Opens Drill; the unit is not carried over" onSelect={() => { setUnit(u.id); p.onDrill(u.id) }} />)}
              </div>
              <Pager page={gv.page} pages={gv.pages} onPage={setGPage} label="Units" />
              <p className="y3-line" role="status">
                {weak ? `${unitLabel(weak)} has the shortest arc, n = ${weak.n}.` : anyMeasured ? 'Every measured unit is level.' : 'No unit has 5 answers yet, so no arc is drawn as measured.'}
              </p>
            </>
          )}
        </Plate>
      </div>

      <div className="y3-col">
        <Plate title="Exam calendar" kicker={paper ? fmtDate(paper.date) : undefined} lamp={exams ? planLamp : { state: 'waiting', reason: 'reading the papers on file' }} className="y3-wheelplate">
          <div className="y3-wheel-row">
            <ExamWheel papers={wheel} today={p.clock} selectedId={paper?.id ?? null} onSelect={(id) => { p.onPaper(id); setUnit(null) }} />
            <div className="y3-paper">
              {paper ? (
                <>
                  <p className="y3-paper-title">{paper.title}</p>
                  <p className="y3-paper-meta">{fmtDate(paper.date)}{paper.approx ? ', date not final' : ''}</p>
                  <p className="y3-paper-meta">{paper.logged_minutes} of {paper.planned_minutes} min logged</p>
                  <span className="y3-meter" role="img" aria-label={`${paper.logged_minutes} of ${paper.planned_minutes} planned minutes logged`}>
                    <i style={{ inlineSize: `${paper.planned_minutes ? Math.min(100, Math.round((paper.logged_minutes / paper.planned_minutes) * 100)) : 0}%` }} />
                  </span>
                </>
              ) : (
                <p className="y3-line y3-ascii">{exams ? 'No papers on file yet. Add the date sheet in Settings.' : 'Reading the papers on file.'}</p>
              )}
            </div>
          </div>
        </Plate>
        <Plate title="Review orbit" lamp={p.retention} className="y3-orbitplate">
          <RetentionOrbit topics={p.retention.topics} dueIds={p.retention.dueIds} dueCount={p.retention.dueCount} state={p.retention.state} reason={p.retention.reason} />
        </Plate>
      </div>
      <p className="y3-foot-line">{FOOTER}</p>
    </div>
  )
}
