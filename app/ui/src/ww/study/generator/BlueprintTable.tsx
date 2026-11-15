// BlueprintTable (package X03, spec 21.8): the section rows of a blueprint. One 56 px row per section: name, set, attempt and marks
// each as steppers, the choice rule as a DetentRack, and the section's marks. The row the student is on opens a strip beneath the
// table with what a row would otherwise crowd: allowed types, the unit limit, move and remove. The table never shows a number
// without its state: the caption carries the source lamp with its word, and a section that breaks an invariant carries a FAULT
// lamp in its row and its reason in the issue list.
//
// States (`data-state`): balanced, fault, inferred. Keys: Alt+Up and Alt+Down move the chosen section; each stepper is one tab stop
// (a spinbutton: Up, Down, Page Up, Page Down, Home, End); the minus and plus beside it are mouse targets of 44 px.
import { useId, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button, Chip, IconButton, Lamp, type LampState } from '../../../shared/kit'
import { DetentRack, type Opt } from '../../../shared/data/tables'
import { CHOICES, CHOICE_LABEL, MAX_MARKS, MAX_SECTIONS, MAX_SET, QTYPES, QTYPE_SHORT, moveSection, newSection, settle, clampMarks, clampSet, type Choice, type GenSection, type Issue } from './model'
import { COPY } from './copy'

export interface StepperProps {
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  /** One press of an arrow or of the minus and plus; Page Up and Page Down move five of these. */
  step?: number
  label: string
  /** The words for a value ("none" for 0). */
  format?: (n: number) => string
  disabled?: boolean
}

/** A number with a minus and a plus. The value is the one tab stop (a spinbutton); the two buttons are for a pointer. */
export function Stepper({ value, onChange, min, max, step = 1, label, format, disabled }: StepperProps) {
  const set = (n: number) => { if (!disabled) onChange(Math.min(max, Math.max(min, n))) }
  const key = (e: KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowUp' || k === 'ArrowRight') { e.preventDefault(); set(value + step) }
    else if (k === 'ArrowDown' || k === 'ArrowLeft') { e.preventDefault(); set(value - step) }
    else if (k === 'PageUp') { e.preventDefault(); set(value + 5 * step) }
    else if (k === 'PageDown') { e.preventDefault(); set(value - 5 * step) }
    else if (k === 'Home') { e.preventDefault(); set(min) }
    else if (k === 'End') { e.preventDefault(); set(max) }
  }
  const text = format ? format(value) : String(value)
  return (
    <div className="gx-step" data-disabled={disabled || undefined}>
      <button type="button" className="gx-step-btn" tabIndex={-1} aria-label={`Fewer: ${label}`} disabled={disabled || value <= min} onClick={() => set(value - step)}>−</button>
      <div
        className="gx-step-val"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        onKeyDown={key}
      >{text}</div>
      <button type="button" className="gx-step-btn" tabIndex={-1} aria-label={`More: ${label}`} disabled={disabled || value >= max} onClick={() => set(value + step)}>+</button>
    </div>
  )
}

export interface BlueprintTableProps {
  sections: GenSection[]
  /** The total the paper prints, or null when none was stated. */
  total: number | null
  /** Minutes, or null when unknown. */
  duration: number | null
  /** Called with the whole next list; the table never mutates. */
  onChange: (next: GenSection[]) => void
  issues?: Issue[]
  /** The section the strip beneath the table is open on. */
  selected?: number
  onSelect?: (i: number) => void
  /** The lamp of where the blueprint came from, drawn in the caption with its word. */
  state?: LampState
  reason?: string
  /** Proposed by a rule and not yet saved. */
  inferred?: boolean
  readOnly?: boolean
}

const CHOICE_OPTS: Opt[] = CHOICES.map((c) => ({ value: c, label: CHOICE_LABEL[c] }))

export function BlueprintTable({ sections, total, duration, onChange, issues = [], selected = 0, onSelect, state = 'waiting', reason, inferred, readOnly }: BlueprintTableProps) {
  const uid = useId()
  const sum = sections.reduce((n, s) => n + s.attempt * s.marks, 0)
  const at = Math.min(Math.max(selected, 0), Math.max(0, sections.length - 1))
  const cur = sections[at]
  const tableState = issues.length ? 'fault' : inferred ? 'inferred' : 'balanced'
  const patch = (i: number, p: Partial<GenSection>) => onChange(sections.map((s, k) => (k === i ? settle({ ...s, ...p }) : s)))
  const faulty = (s: GenSection) => issues.some((x) => x.section === s.name)

  const rowKey = (e: KeyboardEvent, i: number) => {
    if (readOnly || !e.altKey) return
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); onChange(moveSection(sections, i, i - 1)); onSelect?.(i - 1) }
    else if (e.key === 'ArrowDown' && i < sections.length - 1) { e.preventDefault(); onChange(moveSection(sections, i, i + 1)); onSelect?.(i + 1) }
  }

  return (
    <div className="gx-bt" data-component="blueprint-table" data-state={tableState} data-dense={sections.length > 5 || undefined}>
      <div className="gx-bt-cap">
        <span className="gx-bt-title">Sections</span>
        <span className="gx-bt-lamp"><Lamp state={state} reason={reason} /></span>
        {inferred && <span className="gx-chip-rule" title="proposed by a counted rule, not saved yet">RULE, not saved</span>}
        {!readOnly && (
          <Button
            size="sm"
            className="gx-add"
            disabledReason={sections.length >= MAX_SECTIONS ? COPY.maxSections : undefined}
            onClick={() => { onChange([...sections, newSection(sections)]); onSelect?.(sections.length) }}
          >+ {COPY.addSection}</Button>
        )}
        <span className="gx-bt-sum">{sum} of {total ?? sum} marks{duration !== null ? `, ${duration} min` : ''}</span>
      </div>

      <div className="gx-bt-head" aria-hidden="true">
        <span>Section</span><span>Set</span><span>Attempt</span><span>Marks each</span><span>Choice</span><span className="gx-bt-r">Marks</span>
      </div>

      <ul className="gx-bt-rows" aria-label="Sections of the blueprint">
        {sections.map((s, i) => (
          <li
            key={i}
            className="gx-row"
            data-selected={i === at || undefined}
            data-fault={faulty(s) || undefined}
            onFocusCapture={() => onSelect?.(i)}
            onKeyDown={(e) => rowKey(e, i)}
          >
            <input
              className="gx-name"
              value={s.name}
              aria-label={`Name of section ${i + 1}`}
              readOnly={readOnly}
              maxLength={24}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <Stepper value={s.set} min={1} max={MAX_SET} label={`Questions set, ${s.name}`} disabled={readOnly} onChange={(n) => patch(i, { set: clampSet(n) })} />
            <Stepper value={s.attempt} min={1} max={s.set} label={`Questions to attempt, ${s.name}`} disabled={readOnly || s.choice !== 'any'} onChange={(n) => patch(i, { attempt: n })} />
            <Stepper value={s.marks} min={1} max={MAX_MARKS} label={`Marks each, ${s.name}`} disabled={readOnly} onChange={(n) => patch(i, { marks: clampMarks(n) })} />
            <DetentRack
              label={`Choice rule, ${s.name}`}
              options={CHOICE_OPTS}
              value={s.choice}
              disabled={readOnly}
              onChange={(v) => patch(i, { choice: v as Choice })}
            />
            <span className="gx-bt-r gx-marks">
              {faulty(s) && <Lamp state="fault" bare reason="breaks a rule" />}
              {s.attempt * s.marks}
            </span>
          </li>
        ))}
      </ul>

      {cur && (
        <div className="gx-strip" role="group" aria-labelledby={`${uid}-strip`}>
          <span id={`${uid}-strip`} className="gx-strip-h">{cur.name}</span>
          <div className="gx-strip-types" role="group" aria-label={`Allowed question types, ${cur.name}`}>
            {QTYPES.map((t) => (
              <Chip key={t} selected={cur.types.includes(t)} onClick={readOnly ? undefined : () => patch(at, { types: cur.types.includes(t) ? cur.types.filter((x) => x !== t) : [...cur.types, t] })}>{QTYPE_SHORT[t]}</Chip>
            ))}
          </div>
          <Stepper
            value={cur.unitLimit ?? 0}
            min={0}
            max={cur.set}
            label={`Most from one unit, ${cur.name}`}
            format={(n) => (n === 0 ? 'no limit' : `${n} per unit`)}
            disabled={readOnly}
            onChange={(n) => patch(at, { unitLimit: n === 0 ? null : n })}
          />
          <span className="gx-strip-act">
            <IconButton label="Move section up" disabled={readOnly || at === 0} onClick={() => { onChange(moveSection(sections, at, at - 1)); onSelect?.(at - 1) }}><ChevronUp size={18} aria-hidden="true" /></IconButton>
            <IconButton label="Move section down" disabled={readOnly || at === sections.length - 1} onClick={() => { onChange(moveSection(sections, at, at + 1)); onSelect?.(at + 1) }}><ChevronDown size={18} aria-hidden="true" /></IconButton>
            <IconButton label="Remove section" disabled={readOnly || sections.length <= 1} onClick={() => { onChange(sections.filter((_, k) => k !== at)); onSelect?.(Math.max(0, at - 1)) }}><Trash2 size={18} aria-hidden="true" /></IconButton>
          </span>
        </div>
      )}

    </div>
  )
}
