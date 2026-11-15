// GeneratorDesk (package X03, spec 21.3 S4, S5 and S10): the practice-paper maker, three steps in one canvas. Blueprint (the sections,
// marks and counts the student confirms, with every issue shown before anything is drawn), Slots (a seeded paper drawn from the bank,
// each slot naming where its question came from, hollow ones left hollow) and Print (the paper, its key and its marking sheet, as the
// browser prints them). It reads and draws through the Study port only: `port.blueprints()` and `port.generate()`. The members the
// port does not have yet (saving and inferring a blueprint, swapping a slot) are the optional `extras`; a control that needs one is
// disabled with its reason, so with the null adapter the desk is an honest WAITING page with a hand-built draft, and nothing is faked.
//
// Product rules this file keeps: no number without a state lamp and its word; nothing generated is shown as measured (a fixture draw is
// SIMULATED); the model drafts and never grades; no pass chance, no "important", "likely" or "expected".
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Field, Lamp, PrimaryButton, Segmented, type LampState } from '../../../shared/kit'
import { DetentRack } from '../../../shared/data/tables'
import { showsNumber } from '../../../shared/lamp'
import { STUDY_PORT } from '../ports'
import { BlueprintTable, Stepper } from './BlueprintTable'
import { COPY, FOOTER } from './copy'
import { NO_EXTRAS, type GeneratorExtras } from './extras'
import { PaperSkeleton } from './PaperSkeleton'
import { PrintFrame, type PrintHandle } from './PrintFrame'
import { PrintSheet, type PrintKind } from './PrintSheet'
import { SlotStrip } from './SlotStrip'
import {
  MAX_SECTIONS, minutesPerMark, minutesText, newSection, nextSeed, paperStats, parseSeed, sameBlueprint, toGen, totalOf, validate,
  type GenBlueprint, type GenSection, type GeneratorPort, type PaperView,
} from './model'
import './generator.css'

export type Step = 'blueprint' | 'slots' | 'print'

export interface GeneratorDeskProps {
  port?: GeneratorPort
  extras?: GeneratorExtras
  /** Open on this step and, for slots and print, draw the paper once the blueprint has loaded (the gallery, the tests, the bench). */
  initial?: { step?: Step; blueprintId?: string; seed?: number; kind?: PrintKind; infer?: boolean }
  /** The shell registers the desk with the print frame; a gallery state without a frame still draws the preview. */
  frame?: boolean
}

interface Notice { state: LampState; text: string }
const BLANK: GenBlueprint = { id: 'draft', label: 'New blueprint', durationMin: null, total: null, origin: 'HAND', sourcePaper: null, sections: [] }
const KIND_OPTIONS = [
  { id: 'paper' as const, label: 'Paper' },
  { id: 'key' as const, label: 'Key' },
  { id: 'marking' as const, label: 'Marking' },
  { id: 'all' as const, label: 'All three' },
]
/** The printable height of an A4 page inside 18 mm margins, in CSS px (297 - 36 mm at 96 dpi). */
const PAGE_PX = Math.round(((297 - 36) / 25.4) * 96)

export function GeneratorDesk({ port = STUDY_PORT, extras = NO_EXTRAS, initial, frame = true }: GeneratorDeskProps) {
  const [loaded, setLoaded] = useState(false)
  const [src, setSrc] = useState<{ state: LampState; reason: string }>({ state: 'waiting', reason: 'a blueprint is inferred from a paper on file' })
  const [list, setList] = useState<GenBlueprint[]>([])
  const [bp, setBp] = useState<GenBlueprint | null>(null)
  const [base, setBase] = useState<GenBlueprint | null>(null)
  const [inferred, setInferred] = useState(false)
  const [row, setRow] = useState(0)
  const [step, setStep] = useState<Step>(initial?.step ?? 'blueprint')
  const [seedText, setSeedText] = useState(String(initial?.seed ?? 48271))
  const [paper, setPaper] = useState<PaperView | null>(null)
  const [paperSrc, setPaperSrc] = useState<{ state: LampState; reason: string }>({ state: 'waiting', reason: COPY.noPaperNote })
  const [busy, setBusy] = useState<null | 'draw' | 'save' | 'infer'>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [kind, setKind] = useState<PrintKind>(initial?.kind ?? 'paper')
  const printer = useRef<PrintHandle>(null)
  const autoDrawn = useRef(false)

  // ------------------------------------------------------------------------------------------ load through the port
  useEffect(() => {
    let live = true
    port.blueprints().then((r) => {
      if (!live) return
      setSrc({ state: r.state, reason: r.reason })
      const items = showsNumber(r.state) && r.data ? r.data.map(toGen) : []
      setList(items)
      const first = items.find((b) => b.id === initial?.blueprintId) ?? items[0] ?? null
      setBp(first)
      setBase(first)
      setLoaded(true)
    })
    return () => { live = false }
  }, [port, initial?.blueprintId])

  const issues = useMemo(() => (bp ? validate(bp) : []), [bp])
  const dirty = !!bp && !sameBlueprint(bp, base)
  const stats = useMemo(() => paperStats(paper), [paper])
  const mpm = bp ? minutesPerMark(bp) : null
  const balanced = !!bp && issues.length === 0
  const invariant: LampState = issues.length ? 'fault' : src.state === 'simulated' ? 'simulated' : 'live'

  // ------------------------------------------------------------------------------------------ editing
  const edit = (next: GenBlueprint) => { setBp({ ...next, origin: 'HAND' }); setPaper(null); setInferred(false); setNotice(null) }
  const setSections = (sections: GenSection[]) => bp && edit({ ...bp, sections })
  const startByHand = () => { const b = { ...BLANK, sections: [newSection([])] }; setBp(b); setBase(null); setRow(0) }
  const pick = (id: string) => { const b = list.find((x) => x.id === id); if (b) { setBp(b); setBase(b); setPaper(null); setInferred(false); setRow(0); setNotice(null) } }

  // ------------------------------------------------------------------------------------------ the three actions
  const draw = useCallback(async (id: string, seed: number) => {
    setBusy('draw')
    setNotice({ state: 'waiting', text: COPY.drawing })
    const r = await port.generate({ blueprintId: id, seed })
    setBusy(null)
    if (!showsNumber(r.state) || !r.data) {
      setNotice({ state: r.state === 'fault' ? 'fault' : 'waiting', text: `${COPY.drawWaiting}: ${r.reason}` })
      setPaperSrc({ state: r.state, reason: r.reason })
      return false
    }
    setPaper(r.data)
    setPaperSrc({ state: r.state, reason: r.reason })
    setNotice(null)
    return true
  }, [port])

  const parsed = parseSeed(seedText)
  const seedBad = seedText.trim() !== '' && parsed === null

  const confirm = async () => {
    if (!bp || !balanced) return
    if (parsed === null) { setNotice({ state: 'fault', text: COPY.seedBad }); return }
    let id = bp.id
    if (dirty || base === null) {
      if (!extras.save) { setNotice({ state: 'waiting', text: COPY.unsavedEdits }); return }
      setBusy('save')
      const r = await extras.save(bp)
      setBusy(null)
      if (!showsNumber(r.state) || !r.data) { setNotice({ state: r.state === 'fault' ? 'fault' : 'waiting', text: `Not saved: ${r.reason}` }); return }
      setBp(r.data.blueprint); setBase(r.data.blueprint); id = r.data.blueprint.id
      if (r.data.issues.length) { setNotice({ state: 'fault', text: `Saved, but the generator will refuse it: ${r.data.issues[0].text}` }); return }
    }
    if (await draw(id, parsed)) setStep('slots')
  }

  const infer = async () => {
    if (!extras.infer) return
    setBusy('infer')
    const r = await extras.infer()
    setBusy(null)
    if (!showsNumber(r.state) || !r.data) { setNotice({ state: r.state === 'fault' ? 'fault' : 'waiting', text: `Nothing inferred: ${r.reason}` }); return }
    setBp(r.data.blueprint); setBase(null); setInferred(true); setPaper(null); setRow(0)
    setNotice({ state: r.state, text: `Proposed by a rule: ${r.data.trace.slice(0, 2).join('; ')}. Check it, then confirm.` })
  }

  const reseed = async () => {
    if (!bp) return
    const n = nextSeed(parsed ?? 1)
    setSeedText(String(n))
    await draw(bp.id, n)
  }
  const drawAgain = async () => {
    if (!bp) return
    if (parsed === null) { setNotice({ state: 'fault', text: COPY.seedBad }); return }
    await draw(bp.id, parsed)
  }

  // a gallery state, a test or the bench may ask the desk to open already drawn
  useEffect(() => {
    if (!loaded || autoDrawn.current || !bp || !initial?.step || initial.step === 'blueprint') return
    autoDrawn.current = true
    void draw(bp.id, initial.seed ?? 48271)
  }, [loaded, bp, initial, draw])

  // the gallery shows the inferred state (RULE, not saved) by asking the adapter once, as the button would
  const inferred1 = useRef(false)
  useEffect(() => {
    if (!loaded || inferred1.current || !initial?.infer || !extras.infer) return
    inferred1.current = true
    void infer()
  }, [loaded])

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || step !== 'blueprint' || !bp) return
    if ((e.target as HTMLElement).closest('input, textarea, [role="listbox"], [role="spinbutton"]')) return
    if (e.key === '+' && bp.sections.length < MAX_SECTIONS) { e.preventDefault(); setSections([...bp.sections, newSection(bp.sections)]); setRow(bp.sections.length) }
  }

  // ------------------------------------------------------------------------------------------ the preview's page count
  const sheet = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState(1)
  const [scale, setScale] = useState(0.7)
  const prev = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (step !== 'print') return
    const h = (sheet.current?.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0
    setPages(Math.max(1, Math.ceil(h / PAGE_PX)))
  }, [step, paper, kind])
  useLayoutEffect(() => {
    const el = prev.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setScale(Math.min(0.7, Math.max(0.3, (el.clientWidth || 556) / 794))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [step])

  const print = () => {
    const ok = printer.current?.print()
    setNotice(ok ? { state: 'live', text: 'Sent to the print dialog. Choose Save as PDF to keep a file.' } : { state: 'waiting', text: 'The page is still being laid out. Try again in a moment.' })
  }

  const stepNeed = !bp || !balanced ? COPY.stepNeedsBlueprint : undefined
  const paperNeed = paper ? undefined : COPY.stepNeedsPaper
  const confirmReason = !bp ? 'no blueprint to confirm'
    : !balanced ? COPY.refuseUnbalanced
    : (dirty || base === null) && !extras.save ? COPY.unsavedEdits
    : seedBad ? COPY.seedBad : undefined

  const hasBp = !!bp

  return (
    <div className="gx-desk" data-component="generator-desk" data-step={step} data-state={src.state} onKeyDown={onKey}>
      <div className="gx-desk-in">
        <header className="gx-top">
          <h2 className="gx-title">{COPY.title}</h2>
          <span className="gx-top-lamp"><Lamp state={paper ? paperSrc.state : src.state} reason={paper ? paperSrc.reason : src.reason} /></span>
          <Segmented<Step>
            variant="choice"
            label="Steps of the practice paper"
            value={step}
            onChange={setStep}
            options={[
              { id: 'blueprint', label: '1 Blueprint' },
              { id: 'slots', label: '2 Slots', disabledReason: paperNeed ?? stepNeed },
              { id: 'print', label: '3 Print', disabledReason: paperNeed },
            ]}
          />
        </header>

        {step === 'blueprint' && (
          <div className="gx-main gx-main-bp">
            {!hasBp ? (
              <section className="gx-empty" aria-label="No blueprint">
                <Lamp state={src.state} reason={src.reason} />
                <h3>{loaded ? COPY.noBlueprint : 'Reading blueprints'}</h3>
                <p>{loaded ? COPY.noBlueprintNote : 'Asking the paper engine.'}</p>
                {loaded && <p className="gx-why">Waiting: {src.reason}</p>}
                <span className="gx-empty-act">
                  <Button disabledReason={extras.infer ? undefined : COPY.inferWaiting} loading={busy === 'infer'} onClick={() => void infer()}>{COPY.infer}</Button>
                  <Button onClick={startByHand}>{COPY.start}</Button>
                </span>
              </section>
            ) : (
              <>
                <div className="gx-left">
                  <div className="gx-facts" role="group" aria-label="The paper's totals">
                    {list.length > 1 && (
                      <DetentRack label="Blueprint" options={list.map((b) => ({ value: b.id, label: b.label }))} value={list.some((b) => b.id === bp.id) ? bp.id : ''} onChange={pick} />
                    )}
                    <div className="gx-fact" role="group" aria-label="Total marks">
                      <span className="gx-fact-l">Total marks</span>
                      <Stepper value={totalOf(bp)} min={1} max={500} label="Total marks" onChange={(n) => edit({ ...bp, total: n })} />
                    </div>
                    <div className="gx-fact" role="group" aria-label="Exam minutes">
                      <span className="gx-fact-l">Minutes</span>
                      <Stepper value={bp.durationMin ?? 0} min={0} max={600} step={5} label="Exam minutes" format={(n) => (n === 0 ? 'not set' : String(n))} onChange={(n) => edit({ ...bp, durationMin: n === 0 ? null : n })} />
                    </div>
                    <div className="gx-fact gx-fact-mpm" role="group" aria-label={COPY.minutesPerMark}>
                      <span className="gx-fact-l">{COPY.minutesPerMark}</span>
                      <span className="gx-fact-v">{minutesText(mpm)}</span>
                      <span className="gx-fact-s"><Lamp state={mpm === null ? 'waiting' : src.state === 'simulated' ? 'simulated' : 'live'} reason={mpm === null ? COPY.noDuration : 'minutes divided by marks of this blueprint'} /></span>
                    </div>
                    <div className="gx-inv" role="status" aria-live="polite">
                      <Lamp state={invariant} reason={issues[0]?.text ?? COPY.balanced(totalOf(bp))} />
                      <span>{issues.length ? 'does not balance' : COPY.balanced(totalOf(bp))}</span>
                    </div>
                  </div>

                  <BlueprintTable
                    sections={bp.sections}
                    total={bp.total}
                    duration={bp.durationMin}
                    issues={issues}
                    selected={row}
                    onSelect={setRow}
                    onChange={setSections}
                    state={src.state}
                    reason={src.reason}
                    inferred={inferred}
                    actions={<Button size="sm" disabledReason={extras.infer ? undefined : COPY.inferWaiting} loading={busy === 'infer'} onClick={() => void infer()}>{COPY.infer}</Button>}
                  />
                  {bp.sections.length <= 5 && <p className="gx-hint">{COPY.rowHint}</p>}
                  {issues.length > 0 && (
                    <ul className="gx-issues" aria-label="Issues to settle before drawing">
                      {issues.slice(0, 3).map((x, i) => (
                        <li key={i}>
                          <Lamp state="fault" bare reason={x.text} /> <span>{x.text}</span>
                          {x.code === 'total' && <Button size="sm" onClick={() => edit({ ...bp, total: null })}>Use the sections’ sum</Button>}
                        </li>
                      ))}
                      {issues.length > 3 && <li>{issues.length - 3} more issues.</li>}
                    </ul>
                  )}
                </div>

                <aside className="gx-right" aria-label="Preview and the next step">
                  <PaperSkeleton blueprint={bp} />
                  {notice && <p className="gx-notice" role="status" data-state={notice.state}><Lamp state={notice.state} bare /><span>{notice.text}</span></p>}
                  <span className="gx-right-act">
                    <PrimaryButton claimId="gen-confirm" rank="workspace" size="lg" loading={busy === 'draw' || busy === 'save'} disabledReason={confirmReason} onClick={() => void confirm()}>{COPY.save}</PrimaryButton>
                  </span>
                </aside>
              </>
            )}
          </div>
        )}

        {step === 'slots' && (
          <div className="gx-main gx-main-slots">
            {paper?.sections ? (
              <SlotStrip
                sections={paper.sections}
                state={paperSrc.state}
                reason={paperSrc.reason}
                onReseed={() => void reseed()}
                onSwap={extras.swap ? (s, n) => void extras.swap!(paper, s, n).then((r) => { if (showsNumber(r.state) && r.data) setPaper(r.data) }) : undefined}
              />
            ) : (
              <section className="gx-empty"><Lamp state={paperSrc.state} reason={paperSrc.reason} /><h3>{COPY.noPaper}</h3><p>{COPY.noPaperNote}</p></section>
            )}
            <div className="gx-bar">
              <Field
                label={COPY.seedLabel}
                value={seedText}
                inputMode="numeric"
                error={seedBad ? COPY.seedBad : undefined}
                hint={COPY.seedShort}
                onChange={(e) => setSeedText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void drawAgain() }}
              />
              <Button loading={busy === 'draw'} onClick={() => void drawAgain()}>Draw with this seed</Button>
              {notice && <span className="gx-notice" role="status" data-state={notice.state}><Lamp state={notice.state} bare /><span>{notice.text}</span></span>}
              <span className="gx-bar-end">
                <Button onClick={() => setStep('blueprint')}>Back to the blueprint</Button>
                <PrimaryButton claimId="gen-to-print" rank="workspace" size="lg" onClick={() => setStep('print')}>Print this paper</PrimaryButton>
              </span>
            </div>
          </div>
        )}

        {step === 'print' && (
          <div className="gx-main gx-main-print">
            {paper?.sections ? (
              <>
                <section className="gx-prev-card" aria-label="Preview of the printed page">
                  <div className="gx-prev" ref={prev} style={{ ['--gx-scale' as string]: scale }}>
                    <div className="gx-page" ref={sheet}>
                      <PrintSheet paper={paper} kind={kind} stamp={paperSrc.state === 'simulated' ? 'SIMULATED' : undefined} />
                    </div>
                  </div>
                  <p className="gx-prev-cap">{kind === 'all' ? 'The three sheets in order' : 'Page 1'} of {pages} on A4, with 18 mm margins. What you see is what prints.</p>
                </section>
                <aside className="gx-right gx-print-side" aria-label="Print options">
                  <Segmented<PrintKind> variant="choice" label="What to print" value={kind} onChange={setKind} options={KIND_OPTIONS} />
                  <dl className="gx-pfacts">
                    <div><dt>Sections</dt><dd>{stats.sections}</dd></div>
                    <div><dt>Slots filled</dt><dd>{stats.filled} of {stats.slots}</dd></div>
                    <div><dt>Marks</dt><dd>{stats.marks}</dd></div>
                    <div><dt>Seed</dt><dd>{paper.seed}</dd></div>
                    <div className="gx-pfacts-lamp"><Lamp state={paperSrc.state} reason={paperSrc.reason} /></div>
                  </dl>
                  {stats.hollow > 0 && <p className="gx-pnote">{COPY.hollowTitle(stats.hollow)}: they print as gaps with the reason. {COPY.hollowNote}</p>}
                  {stats.asCrop > 0 && <p className="gx-pnote">{COPY.cropNote(stats.asCrop)}</p>}
                  <p className="gx-pnote gx-night"><Lamp state="planned" reason={COPY.nightPlanned} /> Night sheet</p>
                  {notice && <p className="gx-notice" role="status" data-state={notice.state}><Lamp state={notice.state} bare /><span>{notice.text}</span></p>}
                  <p className="gx-pnote">{COPY.printNote}</p>
                  <span className="gx-right-act">
                    <Button onClick={() => setStep('slots')}>Back to the slots</Button>
                    <PrimaryButton claimId="gen-print" rank="workspace" size="lg" onClick={print}>{COPY.printCta}</PrimaryButton>
                  </span>
                </aside>
                {frame && <PrintFrame ref={printer} paper={paper} kind={kind} stamp={paperSrc.state === 'simulated' ? 'SIMULATED' : undefined} />}
              </>
            ) : (
              <section className="gx-empty"><Lamp state={paperSrc.state} reason={paperSrc.reason} /><h3>{COPY.noPaper}</h3><p>{COPY.noPaperNote}</p></section>
            )}
          </div>
        )}

        <footer className="gx-foot"><span>{FOOTER}</span></footer>
      </div>
    </div>
  )
}
