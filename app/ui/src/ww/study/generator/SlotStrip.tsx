// SlotStrip (package X03, spec 21.8 and 21.3 S5): the slots of a generated paper, a section at a time. A rail of section tabs on the left
// (each says how many of its slots are filled); the chosen section's slots on the right, 44 px or more each, two columns, with the
// source chip first: HAND (you accepted it), RULE (a counted rule did), TEMPLATE (a numerical filled from a template), dashed MODEL
// (a local model drafted it; not your decision yet) and a hollow slot, drawn dashed with the reason (too few reviewed questions).
// A hollow slot is never padded with a made-up question. Slots rise in with a 40 ms stagger, once, when a draw arrives (static form:
// present); nothing moves at idle.
//
// Keys: Up and Down move between sections (one tab stop for the rail), Page Up and Page Down turn the slot pages, R reseeds.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Lamp, type LampState } from '../../../shared/kit'
import { instruction, isHollow, printsAsCrop, QTYPE_LABEL, type PaperSection, type Slot, type SlotSource } from './model'

export const SOURCE_WORD: Record<SlotSource, string> = { hand: 'HAND', rule: 'RULE', template: 'TEMPLATE', model: 'MODEL', hollow: 'HOLLOW' }
const SOURCE_MEANS: Record<SlotSource, string> = {
  hand: 'a question you accepted yourself',
  rule: 'a question a counted rule accepted',
  template: 'a numerical filled from a template; the numbers differ',
  model: 'drafted by the local model, not your decision yet',
  hollow: 'no reviewed question fits this slot, so it is left empty',
}
const SOURCE_GLYPH: Record<SlotSource, string> = { hand: '+', rule: '#', template: '=', model: '~', hollow: 'o' }

export function SourceChip({ source }: { source: SlotSource }) {
  return (
    <span className="gx-src" data-src={source} title={SOURCE_MEANS[source]}>
      <span className="gx-src-glyph" aria-hidden="true">{SOURCE_GLYPH[source]}</span>
      <span>{SOURCE_WORD[source]}</span>
      <span className="ww-sr-only">, {SOURCE_MEANS[source]}</span>
    </span>
  )
}

export const PAGE_SIZE = 12

export interface SlotStripProps {
  sections: PaperSection[]
  /** The lamp of the draw (LIVE or SIMULATED), drawn with its word beside the counts. */
  state: LampState
  reason?: string
  onSwap?: (section: string, n: number) => void
  onReseed?: () => void
  pageSize?: number
  /** The section shown first (a gallery state or a test). */
  initialSection?: number
}

export function SlotStrip({ sections, state, reason, onSwap, onReseed, pageSize = PAGE_SIZE, initialSection = 0 }: SlotStripProps) {
  const uid = useId()
  const [at, setAt] = useState(Math.min(initialSection, Math.max(0, sections.length - 1)))
  const [page, setPage] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = Math.min(at, Math.max(0, sections.length - 1))
  const sec = sections[idx]
  const slots = sec?.slots ?? []
  const pages = Math.max(1, Math.ceil(slots.length / pageSize))
  const pg = Math.min(page, pages - 1)
  const shown = slots.slice(pg * pageSize, pg * pageSize + pageSize)
  const total = sections.reduce((n, s) => n + s.slots.length, 0)
  const hollow = sections.reduce((n, s) => n + s.slots.filter(isHollow).length, 0)
  useEffect(() => setPage(0), [idx])

  const go = (i: number) => { setAt(i); tabs.current[i]?.focus() }
  const tabKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); go(Math.min(sections.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); go(0) }
    else if (e.key === 'End') { e.preventDefault(); go(sections.length - 1) }
  }
  const panelKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    if (e.key === 'PageDown' && pg < pages - 1) { e.preventDefault(); setPage(pg + 1) }
    else if (e.key === 'PageUp' && pg > 0) { e.preventDefault(); setPage(pg - 1) }
    else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && onReseed) { e.preventDefault(); onReseed() }
  }

  return (
    <div className="gx-ss" data-component="slot-strip" onKeyDown={panelKey}>
      <div className="gx-ss-status">
        <Lamp state={state} reason={reason} />
        <span>{total - hollow} of {total} slots filled</span>
        {hollow > 0 && <span className="gx-ss-hollow">{hollow} hollow</span>}
        {onReseed && <Button size="sm" className="gx-ss-reseed" onClick={onReseed}>Reseed <kbd className="gx-key">R</kbd></Button>}
      </div>

      <div className="gx-ss-body">
        <div className="gx-ss-rail" role="tablist" aria-orientation="vertical" aria-label="Sections of the paper">
          {sections.map((s, i) => {
            const h = s.slots.filter(isHollow).length
            return (
              <button
                key={s.name + i}
                ref={(el) => { tabs.current[i] = el }}
                type="button"
                role="tab"
                id={`${uid}-t${i}`}
                aria-selected={i === idx}
                aria-controls={`${uid}-p`}
                tabIndex={i === idx ? 0 : -1}
                className="gx-ss-tab"
                data-hollow={h > 0 || undefined}
                onClick={() => setAt(i)}
                onKeyDown={(e) => tabKey(e, i)}
              >
                <span className="gx-ss-tab-name">{s.name}</span>
                <span className="gx-ss-tab-meta">{s.slots.length - h} of {s.slots.length} filled{h > 0 ? `, ${h} hollow` : ''}</span>
              </button>
            )
          })}
        </div>

        <div className="gx-ss-panel" role="tabpanel" id={`${uid}-p`} aria-labelledby={`${uid}-t${idx}`}>
          {sec && <p className="gx-ss-inst">{instruction(sec)}</p>}
          <ol className="gx-slots" aria-label={sec ? `Slots of ${sec.name}` : 'Slots'}>
            {shown.map((s, k) => <SlotRow key={`${pg}-${s.n}-${s.questionId ?? 'h'}`} slot={s} i={k} onSwap={onSwap && sec ? () => onSwap(sec.name, s.n) : undefined} />)}
          </ol>
          {pages > 1 && (
            <div className="gx-pager" role="group" aria-label={`Slots, page ${pg + 1} of ${pages}`}>
              <Button size="sm" aria-label="Earlier slots" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</Button>
              <span>{pg + 1} of {pages}</span>
              <Button size="sm" aria-label="Later slots" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotRow({ slot: s, i, onSwap }: { slot: Slot; i: number; onSwap?: () => void }) {
  const hollow = isHollow(s)
  return (
    <li className="gx-slot" data-src={s.source} data-hollow={hollow || undefined} style={{ ['--i' as string]: Math.min(i, 6) }}>
      <span className="gx-slot-n">{s.n}</span>
      <SourceChip source={s.source} />
      <span className="gx-slot-main">
        {hollow ? <b>Left hollow</b> : <b>{s.topic}</b>}
        <span className="gx-slot-meta">{hollow ? `${s.marks} marks` : `${s.unit} · ${s.marks} marks${s.type ? ` · ${QTYPE_LABEL[s.type]}` : ''}`}</span>
      </span>
      <span className="gx-slot-why" title={s.reason}>{s.reason}{printsAsCrop(s) ? ' Prints as the page crop.' : ''}</span>
      {onSwap && !hollow && <Button size="sm" className="gx-slot-swap" onClick={onSwap}>Swap</Button>}
    </li>
  )
}
