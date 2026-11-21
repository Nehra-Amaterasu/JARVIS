/**
 * The phone's views (design-language-v3.md 3.6): one 44 px chip under the title row naming the current view, "1 OF 5 VIEWS"
 * and a chevron. It opens an opaque list of the section's views, 44 px each. No view label is ever cut, which the desktop's
 * segment slot could not promise at 390 px (jury: the last tab shrank to a single letter).
 */
import { useRef } from 'react'
import { VIEW_LABEL } from '../ids'
import { Chevron } from './Glyphs'
import { Popover, usePopoverChoose } from './Popover'

export interface ViewChipProps {
  sectionLabel: string
  views: readonly string[]
  view: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (view: string) => void
}

export function ViewChip({ sectionLabel, views, view, open, onOpenChange, onSelect }: ViewChipProps) {
  const btn = useRef<HTMLButtonElement>(null)
  const i = Math.max(0, views.indexOf(view))
  return (
    <Popover open={open} onClose={() => onOpenChange(false)} triggerRef={btn} label={`${sectionLabel} views`} align="left" className="s3-viewchip"
      trigger={
        <button ref={btn} type="button" className="s3-key s3-chipbtn" aria-haspopup="dialog" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          <span className="s3-chipname">{VIEW_LABEL[view] ?? view}</span>
          <small className="s3-chipcount">{i + 1} OF {views.length} VIEWS</small>
          <Chevron />
        </button>
      }>
      <p className="s3-cap">{sectionLabel.toUpperCase()} VIEWS</p>
      <ViewList views={views} view={view} onSelect={onSelect} />
    </Popover>
  )
}

function ViewList({ views, view, onSelect }: { views: readonly string[]; view: string; onSelect: (view: string) => void }) {
  const choose = usePopoverChoose()
  return (
    <ul className="s3-vlist">
      {views.map((v) => (
        <li key={v}>
          <button type="button" className="s3-popitem" data-view={v} aria-current={v === view ? 'page' : undefined} onClick={() => choose(() => onSelect(v))}>
            {VIEW_LABEL[v] ?? v}
          </button>
        </li>
      ))}
    </ul>
  )
}
