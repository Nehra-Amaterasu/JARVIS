// Cell Skeleton (spec 7.5 #37): quadtree-style bordered blocks sized to the final layout, static, no shimmer (a
// shimmer is an idle loop and says "working" when nothing is known). The mosaic is a pure function of (depth,
// seed), so the same call always gives the same blocks and a test can pin it. When `ready` flips, the real
// content replaces the blocks in the same box, so the layout does not move. aria-busy marks the region.
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import './art.css'
import { quadBlocks, type Block } from './geometry'

export interface CellSkeletonProps {
  depth?: number
  seed?: number
  /** Your own blocks on a `grid` x `grid` grid, when the final layout is known better than a quadtree. */
  blocks?: readonly Block[]
  grid?: number
  ready?: boolean
  children?: ReactNode
  label?: string
}

export function CellSkeleton({ depth = 2, seed = 1, blocks, grid, ready = false, children, label = 'Loading' }: CellSkeletonProps) {
  const auto = useMemo(() => (blocks ? null : quadBlocks(depth, seed)), [blocks, depth, seed])
  const list = blocks ?? auto ?? []
  const n = grid ?? (1 << Math.floor(Math.min(3, Math.max(1, depth))))
  if (ready) return <div className="art-cells-box" data-component="cell-skeleton" data-ready="">{children}</div>
  return (
    <div className="art-cells-box" data-component="cell-skeleton" aria-busy="true">
      <span className="art-sr">{label}</span>
      <div className="art-cells" style={{ gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)` }} aria-hidden="true">
        {list.map((b, i) => (
          <span key={i} className="art-cell" style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}` }} />
        ))}
      </div>
    </div>
  )
}
