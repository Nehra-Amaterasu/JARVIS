// Orbit Progress (spec 7.4 #23): concentric hairline orbits, one marker per milestone and a "now" notch.
// 280 px hero, 160 px compact. Reached = filled disc, upcoming = ring, planned = dashed ring, so the status
// survives greyscale. The ordered list under the drawing is the keyboard and screen-reader equivalent.
import { useMemo } from 'react'
import { ArtTable, Figure } from './frame'
import { orbitMarkers, orbitRadii, polar, type MilestoneIn } from './geometry'
import { useRoving } from './hooks'

export interface OrbitProps {
  milestones: readonly MilestoneIn[]
  /** Where "now" sits: an orbit and a position on it, both derived from the real data by the caller. */
  now?: { orbit: number; at: number }
  orbits?: number
  size?: 'hero' | 'compact'
  caption: string
  onOpen?: (id: string) => void
}

export function Orbit({ milestones, now, orbits = 4, size = 'hero', caption, onOpen }: OrbitProps) {
  const px = size === 'hero' ? 280 : 160
  const radii = useMemo(() => orbitRadii(orbits, px), [orbits, px])
  const marks = useMemo(() => orbitMarkers(milestones, px, orbits), [milestones, px, orbits])
  const rov = useRoving(marks.length)
  const c = px / 2
  const nowPos = now ? polar(c, c, radii[Math.min(Math.max(0, Math.round(now.orbit)), radii.length - 1)], now.at) : null
  const nowIn = now ? polar(c, c, radii[Math.min(Math.max(0, Math.round(now.orbit)), radii.length - 1)] - 9, now.at) : null
  return (
    <Figure component="orbit" caption={caption}>
      <svg className="art-svg" viewBox={`0 0 ${px} ${px}`} width={px} height={px} role="group" aria-label={`Orbit progress, ${marks.length} milestones. ${caption}`}>
        {radii.map((r) => (
          <circle key={r} className="art-hair" cx={c} cy={c} r={r} fill="none" />
        ))}
        {nowPos && nowIn ? <line className="art-now" x1={nowIn.x} y1={nowIn.y} x2={nowPos.x} y2={nowPos.y} /> : null}
        {marks.map((m, i) => {
          const rp = rov.props(i)
          return (
            <g
              key={m.id}
              className="art-node"
              data-node={m.id}
              data-status={m.status}
              role="button"
              aria-label={`${m.label}, ${m.status}`}
              {...rp}
              onClick={() => onOpen?.(m.id)}
              onKeyDown={(e) => {
                rp.onKeyDown(e)
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen?.(m.id)
                }
              }}
            >
              <circle className="art-hit" cx={m.x} cy={m.y} r={22} />
              <circle className="art-focusring" cx={m.x} cy={m.y} r={10} fill="none" />
              {m.status === 'reached' && <circle className="art-solid" cx={m.x} cy={m.y} r={5} />}
              {m.status === 'upcoming' && <circle className="art-stroke" cx={m.x} cy={m.y} r={4.5} />}
              {m.status === 'planned' && <circle className="art-stroke" cx={m.x} cy={m.y} r={4.5} strokeDasharray="2.2 2" />}
            </g>
          )
        })}
      </svg>
      <ol className="art-list">
        {marks.map((m) => (
          <li key={m.id} data-status={m.status}>{m.label}<span className="art-list-meta"> {m.status}</span></li>
        ))}
      </ol>
      <ArtTable caption={`${caption} (milestones)`} head={['Milestone', 'Orbit', 'Status']} rows={marks.map((m) => [m.label, m.orbit + 1, m.status])} />
    </Figure>
  )
}
