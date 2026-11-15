// The Marks legend (package L01): names every shape, filled and hollow, says where its mark is read from, and carries one kit
// Switch per kind to show or hide it. It is the body of the Marks popover; the popover itself (and its opaque surface) is the
// page's, so this file holds no overlay.
import { Switch } from '../kit'
import { DayMark } from './DayMark'
import { KINDS, SHAPES, type Kind } from './types'

export interface MarksLegendProps {
  on: ReadonlySet<Kind>
  onToggle: (kind: Kind, next: boolean) => void
}

export function MarksLegend({ on, onToggle }: MarksLegendProps) {
  return (
    <div className="alm-legend">
      <p className="alm-legend-key">
        <span><DayMark kind="study" done decorative /> filled: done</span>
        <span><DayMark kind="study" done={false} decorative /> hollow: planned</span>
      </p>
      <ul className="alm-legend-list">
        {KINDS.map((k) => (
          <li key={k} data-kind={k}>
            <span className="alm-legend-glyphs" aria-hidden="true">
              <DayMark kind={k} done decorative />
              {k === 'rest' ? <i /> : <DayMark kind={k} done={false} decorative />}
            </span>
            <Switch label={SHAPES[k].word} checked={on.has(k)} onChange={(next) => onToggle(k, next)} />
            <span className="alm-legend-src">{SHAPES[k].source}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
