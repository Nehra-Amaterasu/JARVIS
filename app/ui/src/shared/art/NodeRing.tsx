// Node Ring (spec 7.4 #22): up to 24 nodes on a ring joined by a hairline, a value in the centre. A node's status
// is its shape (disc done, ring open, dashed ring planned), never its hue alone. Each node is a focus stop in one
// roving group (Left/Right walk the ring, Enter opens the node); the table below the drawing is the equivalent.
import { useMemo } from 'react'
import { ArtTable, Figure, clip } from './frame'
import { MAX_NODES, polar, ringPoints } from './geometry'
import { useRoving } from './hooks'
import type { ArtState } from './state'

export type NodeStatus = 'done' | 'open' | 'planned'
export interface RingNode {
  id: string
  label: string
  status: NodeStatus
}

export interface NodeRingProps {
  nodes: readonly RingNode[]
  /** The centre value. It carries its own state, so no number is drawn without one. */
  centre?: { value: string; caption?: string; state: ArtState }
  caption: string
  onOpen?: (id: string) => void
}

const W = 520
const H = 380
const R = 124

export function NodeRing({ nodes, centre, caption, onOpen }: NodeRingProps) {
  const list = useMemo(() => nodes.slice(0, MAX_NODES), [nodes])
  const pts = useMemo(() => ringPoints(list.length, W / 2, H / 2, R), [list.length])
  const rov = useRoving(list.length)
  return (
    <Figure component="node-ring" state={centre?.state} caption={caption}>
      <svg className="art-svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={`Node ring, ${list.length} nodes. ${caption}`}>
        <circle className="art-hair" cx={W / 2} cy={H / 2} r={R} fill="none" />
        {list.map((n, i) => {
          const p = pts[i]
          const lab = polar(W / 2, H / 2, R + 18, p.turn)
          const side = Math.sin(p.turn * Math.PI * 2)
          const rp = rov.props(i)
          return (
            <g
              key={n.id}
              className="art-node"
              data-node={n.id}
              data-status={n.status}
              role="button"
              aria-label={`${n.label}, ${n.status}`}
              {...rp}
              onClick={() => onOpen?.(n.id)}
              onKeyDown={(e) => {
                rp.onKeyDown(e)
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen?.(n.id)
                }
              }}
            >
              <circle className="art-hit" cx={p.x} cy={p.y} r={22} />
              <circle className="art-focusring" cx={p.x} cy={p.y} r={11} fill="none" />
              {n.status === 'done' && <circle className="art-solid" cx={p.x} cy={p.y} r={6} />}
              {n.status === 'open' && <circle className="art-stroke" cx={p.x} cy={p.y} r={5} />}
              {n.status === 'planned' && <circle className="art-stroke" cx={p.x} cy={p.y} r={5} strokeDasharray="2.4 2" />}
              <text className="art-label" x={lab.x} y={lab.y} textAnchor={side > 0.25 ? 'start' : side < -0.25 ? 'end' : 'middle'} dominantBaseline="middle">
                {clip(n.label, 16)}
              </text>
            </g>
          )
        })}
        {centre ? (
          <g className="art-centre">
            <text className="art-num" x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle">
              {centre.state === 'live' || centre.state === 'simulated' ? centre.value : '--'}
            </text>
            {centre.caption ? (
              <text className="art-label" x={W / 2} y={H / 2 + 24} textAnchor="middle">{clip(centre.caption, 24)}</text>
            ) : null}
          </g>
        ) : null}
      </svg>
      <ArtTable caption={`${caption} (nodes)`} head={['Node', 'Status']} rows={list.map((n) => [n.label, n.status])} />
    </Figure>
  )
}
