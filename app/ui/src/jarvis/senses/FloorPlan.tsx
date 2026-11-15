// FloorPlan (spec 20.9.3, the default Map form): an isometric floor in SVG, zone rings and the two link ends as dots.
// "Rings are zones, not positions." A ring brightens with its zone's probability only when the readiness check trusts
// zones; before that every ring is the same dashed outline, because a name earns a place only after the drill. No body,
// no head, no figure: the drawing has a floor, the room's furniture as boxes, rings and two dots.
import { useMemo } from 'react'
import { fitPoints, isoOf, zoneRing, type Source } from './model'
import type { RoomSpec } from '../../twin/SpatialTwin'
import type { BeliefZone } from '../../lib/belief'

export interface FloorPlanProps {
  room: RoomSpec | null
  source: Source
  zones: BeliefZone[]
  trusted: boolean
  width?: number
  height?: number
}

const RING_STEPS = 28

export function FloorPlan({ room, source, zones, trusted, width = 486, height = 196 }: FloorPlanProps) {
  const W = room?.width ?? 4
  const D = room?.depth ?? 4
  // fit what is drawn, not just the floor: tall furniture and rings that reach past a wall must stay inside the box
  const fit = useMemo(() => {
    const raw = (x: number, y: number, z = 0) => isoOf(x, y, 1, 0, 0, z)
    const pts = [raw(0, 0), raw(W, 0), raw(W, D), raw(0, D)]
    for (const f of room?.furniture ?? []) for (const [dx, dy] of [[0, 0], [f.w, 0], [f.w, f.d], [0, f.d]]) pts.push(raw(f.x + dx, f.y + dy), raw(f.x + dx, f.y + dy, f.h))
    for (const z of room?.zones ?? []) { const r = zoneRing(z.polygon); if (r) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) pts.push(raw(r.x + dx * r.r, r.y + dy * r.r)) }
    for (const s of room?.sensors ?? []) pts.push(raw(s.x, s.y, s.z))
    return fitPoints(pts, width, height)
  }, [room, W, D, width, height])
  const P = (x: number, y: number, z = 0) => isoOf(x, y, fit.k, fit.ox, fit.oy, z)
  const poly = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const floor = [P(0, 0), P(W, 0), P(W, D), P(0, D)]
  const ring = (cx: number, cy: number, r: number) => poly(Array.from({ length: RING_STEPS }, (_, i) => P(cx + r * Math.cos((i / RING_STEPS) * Math.PI * 2), cy + r * Math.sin((i / RING_STEPS) * Math.PI * 2))))
  const ends = (room?.sensors ?? []).filter((s) => s.id === 'esp32' || s.id === 'router' || s.kind === 'esp32' || s.kind === 'router').slice(0, 2)
  const pOf = (id: string) => zones.find((z) => z.id === id || z.name === id)?.p ?? 0
  return (
    <svg className="js-plan" viewBox={`0 0 ${width} ${height}`} width="100%" role="img" data-source={source} data-known={room ? 'true' : 'false'}
      aria-label={room ? `Floor plan of the room, ${W} by ${D} metres: rings are zones, not positions.` : 'Floor plan: the layout has not been read, so this is a placeholder floor.'}>
      <polygon points={poly(floor)} className="js-plan-floor" data-hollow={room ? undefined : 'true'} />
      {room?.furniture.map((f) => {
        const a = [P(f.x, f.y), P(f.x + f.w, f.y), P(f.x + f.w, f.y + f.d), P(f.x, f.y + f.d)]
        const t = [P(f.x, f.y, f.h), P(f.x + f.w, f.y, f.h), P(f.x + f.w, f.y + f.d, f.h), P(f.x, f.y + f.d, f.h)]
        return (
          <g key={f.name} className="js-plan-box" aria-hidden="true">
            <polygon points={poly([a[1], a[2], t[2], t[1]])} /><polygon points={poly([a[3], a[2], t[2], t[3]])} /><polygon points={poly(t)} />
          </g>
        )
      })}
      {(room?.zones ?? []).map((z) => {
        const r = zoneRing(z.polygon)
        if (!r) return null
        const p = trusted ? pOf(z.name) : 0
        return (
          <g key={z.name} className="js-plan-zone" data-lit={p >= 0.3 ? 'true' : undefined} style={{ ['--p' as string]: String(p) }}>
            <polygon points={ring(r.x, r.y, r.r)} />
            {trusted && <text x={P(r.x, r.y).x} y={P(r.x, r.y).y + 4} textAnchor="middle">{z.name}</text>}
          </g>
        )
      })}
      {ends.map((s) => {
        const p = P(s.x, s.y, s.z)
        return (
          <g key={s.id} className="js-plan-end" data-end={s.id === 'router' || s.kind === 'router' ? 'router' : 'board'}>
            <circle cx={p.x} cy={p.y} r={5} />
            <text x={p.x + 9} y={p.y + 4}>{s.id === 'router' || s.kind === 'router' ? 'router' : 'ESP32'}</text>
          </g>
        )
      })}
    </svg>
  )
}
