// PrintSheet (package X03, spec 21.3 S10): the practice paper, its answer key and its marking sheet as plain black on white, for A4
// with 18 mm margins. One component draws both the preview in the desk and the pages the browser prints, so the preview's section
// count is the PDF's: they are the same elements (`data-print-section`). The header is the fixed sentence "Practice paper from your
// bank. Not an official paper."; the seed is in a repeating footer so a paper can be drawn again; a hollow slot prints as a gap with
// its reason, never padded; a question whose text was read but not checked prints as its page crop, because the crop is the source of
// truth. A generated paper from a fixture carries the stamp SIMULATED. The night sheet is planned and cannot be printed yet.
import { HEADER, instruction, isHollow, printsAsCrop, QTYPE_LABEL, type PaperSection, type PaperView, type Slot } from './model'
import { COPY } from './copy'
import './sheet.css'

export type PrintKind = 'paper' | 'key' | 'marking' | 'all'
export const PRINT_KINDS: readonly Exclude<PrintKind, 'all'>[] = ['paper', 'key', 'marking']

export interface Numbered { q: number; section: PaperSection; slot: Slot }
/** Questions numbered 1.. across the sections, in paper order: the number the paper, the key and the marking sheet all use. */
export function numbered(p: PaperView): Numbered[] {
  let q = 0
  return (p.sections ?? []).flatMap((section) => section.slots.map((slot) => ({ q: ++q, section, slot })))
}

export interface PrintSheetProps {
  paper: PaperView
  kind: PrintKind
  /** Drawn on the paper's head when the questions are invented (a fixture): "SIMULATED". */
  stamp?: string
}

export function PrintSheet({ paper, kind, stamp }: PrintSheetProps) {
  const kinds = kind === 'all' ? PRINT_KINDS : [kind]
  return (
    <div className="gx-doc" data-component="print-sheet" data-kind={kind}>
      {kinds.map((k, i) => <Sheet key={k} paper={paper} kind={k} stamp={stamp} later={i > 0} />)}
    </div>
  )
}

function Sheet({ paper, kind, stamp, later }: { paper: PaperView; kind: Exclude<PrintKind, 'all'>; stamp?: string; later: boolean }) {
  const secs = paper.sections ?? []
  const nums = numbered(paper)
  const title = paper.title ?? 'Practice paper'
  const head = kind === 'paper' ? title : kind === 'key' ? `${title}: ${COPY.keyHead.toLowerCase()}` : `${title}: ${COPY.markingHead.toLowerCase()}`
  return (
    <table className="gx-sheet" data-sheet={kind} data-later={later || undefined}>
      <thead>
        <tr><td>
          <header className="gx-head">
            <h1>{head}</h1>
            {stamp && <span className="gx-stamp">{stamp}</span>}
            <p className="gx-sub">{HEADER}</p>
            <p className="gx-meta">
              {paper.totalMarks !== undefined && <span>{paper.totalMarks} marks</span>}
              {paper.durationMin ? <span>{paper.durationMin} minutes</span> : null}
              <span>{secs.length} section{secs.length === 1 ? '' : 's'}</span>
            </p>
          </header>
        </td></tr>
      </thead>
      <tfoot>
        <tr><td><p className="gx-sheetfoot">Seed {paper.seed}. Drawn again with the same seed, the same paper comes out.</p></td></tr>
      </tfoot>
      <tbody>
        <tr><td>
          {kind === 'paper' && secs.map((s) => <PaperSec key={s.name} sec={s} nums={nums} />)}
          {kind === 'key' && <KeyTable nums={nums} />}
          {kind === 'marking' && <MarkingTable nums={nums} total={paper.totalMarks} />}
        </td></tr>
      </tbody>
    </table>
  )
}

function PaperSec({ sec, nums }: { sec: PaperSection; nums: Numbered[] }) {
  return (
    <section className="gx-psec" data-print-section={sec.name}>
      <h2>{sec.name}<span>{instruction(sec)}</span></h2>
      <ol className="gx-qs">
        {sec.slots.map((slot) => {
          const q = nums.find((n) => n.slot === slot)?.q ?? slot.n
          return (
            <li key={slot.n} className="gx-q" value={q} data-hollow={isHollow(slot) || undefined} data-crop={printsAsCrop(slot) || undefined}>
              <span className="gx-qn">{q}.</span>
              <div className="gx-qb">
                {isHollow(slot) ? (
                  <p className="gx-gap">No question here: {slot.reason}.</p>
                ) : printsAsCrop(slot) ? (
                  slot.crop ? <img className="gx-crop" src={slot.crop} alt={`Page crop of question ${q}`} /> : <p className="gx-gap">The page crop of this question has not been cut yet.</p>
                ) : (
                  <p className="gx-text">{slot.text}</p>
                )}
              </div>
              <span className="gx-qm">[{slot.marks}]</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function KeyTable({ nums }: { nums: Numbered[] }) {
  return (
    <section className="gx-psec" data-print-section="key">
      <table className="gx-grid">
        <thead><tr><th>Q</th><th>Section</th><th>Topic</th><th>Marks</th><th>Key</th></tr></thead>
        <tbody>
          {nums.map(({ q, section, slot }) => (
            <tr key={q}>
              <td>{q}</td><td>{section.name}</td>
              <td>{isHollow(slot) ? 'left hollow' : `${slot.topic}${slot.type ? `, ${QTYPE_LABEL[slot.type]}` : ''}`}</td>
              <td>{slot.marks}</td>
              <td>{isHollow(slot) ? 'no question' : slot.key ?? COPY.keyNone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function MarkingTable({ nums, total }: { nums: Numbered[]; total?: number }) {
  return (
    <section className="gx-psec" data-print-section="marking">
      <p className="gx-text">{COPY.markingNote}</p>
      <table className="gx-grid">
        <thead><tr><th>Q</th><th>Topic</th><th>Out of</th><th>Marks given</th></tr></thead>
        <tbody>
          {nums.map(({ q, slot }) => (
            <tr key={q}><td>{q}</td><td>{isHollow(slot) ? 'left hollow' : slot.topic}</td><td>{slot.marks}</td><td className="gx-box" /></tr>
          ))}
        </tbody>
        {total !== undefined && <tfoot><tr><td colSpan={2}>Total</td><td>{total}</td><td className="gx-box" /></tr></tfoot>}
      </table>
    </section>
  )
}
