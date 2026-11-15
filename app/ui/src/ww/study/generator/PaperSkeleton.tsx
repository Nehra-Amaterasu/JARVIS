// PaperSkeleton (package X03, spec 21.4 S4): the live A4 layout of a blueprint at 0.42 scale, drawn as SVG bars: a heading per section
// and one bar per question set, taller for more marks. It is a layout, not a paper, and says so; the table beside it is its text
// twin, so the drawing carries one sentence of the same counts for a screen reader. No timer, no canvas.
import { skeletonRows, type GenBlueprint } from './model'
import { COPY } from './copy'

const PAGE = { w: 794, h: 1123 }
export const SKELETON_SCALE = 0.42

export interface PaperSkeletonProps { blueprint: Pick<GenBlueprint, 'sections'> }

export function PaperSkeleton({ blueprint }: PaperSkeletonProps) {
  const rows = skeletonRows(blueprint, PAGE)
  const sets = blueprint.sections.reduce((n, s) => n + s.set, 0)
  const label = `Layout of the paper: ${blueprint.sections.length} section${blueprint.sections.length === 1 ? '' : 's'}, ${sets} question${sets === 1 ? '' : 's'} set. ${COPY.previewNote}`
  return (
    <figure className="gx-skel" data-component="paper-skeleton">
      <svg role="img" aria-label={label} viewBox={`0 0 ${PAGE.w} ${PAGE.h}`} width={Math.round(PAGE.w * SKELETON_SCALE)} height={Math.round(PAGE.h * SKELETON_SCALE)}>
        <rect className="gx-skel-page" x="1" y="1" width={PAGE.w - 2} height={PAGE.h - 2} rx="10" />
        <rect className="gx-skel-bar" x="68" y="68" width="460" height="22" rx="6" />
        <rect className="gx-skel-bar" x="68" y="104" width="300" height="12" rx="6" />
        {rows.map((r, i) => (
          <rect key={i} className={r.kind === 'head' ? 'gx-skel-head' : 'gx-skel-slot'} x={68} y={r.y} width={r.w} height={r.h} rx={r.kind === 'head' ? 6 : 8} data-section={r.section} />
        ))}
      </svg>
      <figcaption>{COPY.previewNote}</figcaption>
    </figure>
  )
}
