/**
 * Where the places in room.json are, as points with a size: kept free of three.js so
 * it can be unit-tested (src/__tests__/places.test.ts).
 *
 * The learned spatial model (aankhen/learn.py) answers with a STATE (empty / outside /
 * room / desk / bed), not a coordinate. When the hub sends no `belief` block (an older
 * hub), lib/belief.ts turns those state probabilities into dot-cloud zones, and needs a
 * centre and a radius for each state. This derives them once per room.json:
 *   desk     the part of the desk zone the desk itself does not cover (the chair side)
 *   bed      the bed frame inside the bed zone
 *   room     the most open point of the floor zone (an L-shaped floor's plain centroid
 *            can sit in the wardrobe), clear of furniture and of the other zones
 *   outside  the doorway, inside the room
 * Each has a radius that fits the place, so the cloud never claims more room than it is.
 */

/* ------------------------------------------------------------------ types */
export interface ZoneLike { name: string; polygon: number[][]; is_exit?: boolean; posture?: string | null; facing_deg?: number | null }
export interface FurnitureLike { name: string; x: number; y: number; w: number; d: number; h: number }
export interface RoomLike { width: number; depth: number; zones: ZoneLike[]; furniture: FurnitureLike[] }

/** A place as a circle on the floor, metres. */
export interface Place { x: number; y: number; r: number }
export interface Places {
  desk: Place | null
  bed: Place | null
  /** The open floor: always present (the room's middle when nothing better exists). */
  room: Place
  /** The doorway, inside the room. */
  door: Place | null
}

const GRID = 0.05                   // sampling step for the polygon geometry, metres
const FURN_MARGIN = 0.22            // a standing body is ~0.4 m across: keep its centre this clear of furniture

/* ------------------------------------------------------------------ geometry */
export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inBox(x: number, y: number, f: FurnitureLike, m = 0): boolean {
  return x >= f.x - m && x <= f.x + f.w + m && y >= f.y - m && y <= f.y + f.d + m
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0
  return Math.hypot(px - ax - t * vx, py - ay - t * vy)
}

function boxDist(x: number, y: number, f: FurnitureLike): number {
  const dx = Math.max(f.x - x, 0, x - (f.x + f.w)), dy = Math.max(f.y - y, 0, y - (f.y + f.d))
  return Math.hypot(dx, dy)
}

function bbox(poly: number[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}

/** Grid points (cell centres) inside a polygon that pass `keep`. */
function samples(poly: number[][], keep: (x: number, y: number) => boolean = () => true): [number, number][] {
  const [x0, y0, x1, y1] = bbox(poly)
  const out: [number, number][] = []
  for (let x = x0 + GRID / 2; x < x1; x += GRID) {
    for (let y = y0 + GRID / 2; y < y1; y += GRID) if (pointInPolygon(x, y, poly) && keep(x, y)) out.push([x, y])
  }
  return out
}

function mean(pts: number[][]): [number, number] {
  let sx = 0, sy = 0
  for (const [x, y] of pts) { sx += x; sy += y }
  return pts.length ? [sx / pts.length, sy / pts.length] : [0, 0]
}

/** A circle for a set of points: their centroid, and the radius of a disc with their area
 *  (so a long strip gets a modest radius, not one that spills past its ends). */
function circleOf(pts: [number, number][], fallback: number[][]): Place {
  if (!pts.length) { const [x, y] = mean(fallback); return { x, y, r: 0.3 } }
  const [x, y] = mean(pts)
  return { x, y, r: Math.sqrt((pts.length * GRID * GRID) / Math.PI) }
}

/** Area of a box inside a polygon, by sampling: which furniture IS this zone's desk/bed. */
function overlap(poly: number[][], f: FurnitureLike): number {
  return samples(poly, (x, y) => inBox(x, y, f)).length
}

function findZone(r: RoomLike, name: string, posture: string): ZoneLike | null {
  const usable = r.zones.filter((z) => z.polygon.length >= 3 && !z.is_exit)
  return usable.find((z) => z.name.toLowerCase() === name)
    ?? usable.find((z) => (z.posture ?? '') === posture) ?? null
}

/** The furniture a zone is built around (most of its footprint inside the zone). */
function mainFurniture(r: RoomLike, z: ZoneLike, name: string): FurnitureLike | null {
  let best: FurnitureLike | null = null, bestN = 0
  for (const f of r.furniture) {
    const n = overlap(z.polygon, f) + (f.name.toLowerCase() === name ? 1 : 0)
    if (n > bestN) { best = f; bestN = n }
  }
  return bestN > 1 ? best : null
}

/** The free point of a set that is farthest from walls, furniture and other zones,
 *  pulled a little toward the set's middle so a long floor does not pick an end. */
function mostOpen(r: RoomLike, pts: [number, number][], avoid: ZoneLike[]): { x: number; y: number; clearance: number } | null {
  if (!pts.length) return null
  const [cx, cy] = mean(pts)
  let best: { x: number; y: number; clearance: number } | null = null, bestScore = -Infinity
  for (const [x, y] of pts) {
    let c = Math.min(x, r.width - x, y, r.depth - y)
    for (const f of r.furniture) c = Math.min(c, boxDist(x, y, f))
    for (const z of avoid) {
      if (pointInPolygon(x, y, z.polygon)) { c = 0; break }
      const p = z.polygon
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length]
        c = Math.min(c, segDist(x, y, p[i][0], p[i][1], q[0], q[1]) + 0.15)   // zones are softer than walls
      }
    }
    const score = Math.min(c, 0.9) - 0.12 * Math.hypot(x - cx, y - cy)
    if (score > bestScore) { bestScore = score; best = { x, y, clearance: c } }
  }
  return best
}

const clampR = (r: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, r))

/** Every place a learned state can mean, derived once per room.json. */
export function roomPlaces(r: RoomLike): Places {
  const roomPoly = [[0, 0], [r.width, 0], [r.width, r.depth], [0, r.depth]]
  const desk = findZone(r, 'desk', 'seated')
  const bed = findZone(r, 'bed', 'lying')
  const floor = r.zones.find((z) => z.name.toLowerCase() === 'floor' && z.polygon.length >= 3) ?? null
  const exits = r.zones.filter((z) => z.is_exit && z.polygon.length >= 3)
  const door = exits.find((z) => z.name.toLowerCase() === 'door') ?? exits[0] ?? null
  const blocked = (x: number, y: number) => r.furniture.some((f) => inBox(x, y, f, FURN_MARGIN))

  // the open floor: the floor zone (or the whole room), clear of furniture and of the
  // other zones (a floor polygon drawn round the desk zone must not count as open)
  const others = [desk, bed, ...exits].filter((z): z is ZoneLike => !!z)
  const inRoom = (x: number, y: number) => x > 0 && x < r.width && y > 0 && y < r.depth
  const floorPts = samples(floor?.polygon ?? roomPoly, (x, y) => inRoom(x, y) && !blocked(x, y))
  const openPts = floorPts.filter(([x, y]) => !others.some((z) => pointInPolygon(x, y, z.polygon)))
  const open = mostOpen(r, openPts, others)
    ?? mostOpen(r, samples(roomPoly, (x, y) => !blocked(x, y)), others)
    ?? { x: r.width / 2, y: r.depth / 2, clearance: 0.3 }
  const room: Place = { x: open.x, y: open.y, r: clampR(open.clearance + 0.15, 0.35, 0.8) }

  // the desk: its chair side
  let deskP: Place | null = null
  if (desk) {
    const table = mainFurniture(r, desk, 'desk')
    const c = circleOf(samples(desk.polygon, (x, y) => !table || !inBox(x, y, table)), desk.polygon)
    deskP = { ...c, r: clampR(c.r, 0.25, 0.55) }
  }

  // the bed: its frame inside the zone
  let bedP: Place | null = null
  if (bed) {
    const frame = mainFurniture(r, bed, 'bed')
    const c = circleOf(samples(bed.polygon, frame ? (x, y) => inBox(x, y, frame) : undefined), bed.polygon)
    bedP = { ...c, r: clampR(c.r, 0.3, 0.9) }
  }

  // the door: its middle, inside
  let doorP: Place | null = null
  if (door) {
    const c = circleOf(samples(door.polygon), door.polygon)
    doorP = { ...c, r: clampR(c.r, 0.2, 0.4) }
  }
  return { desk: deskP, bed: bedP, room, door: doorP }
}

/* ------------------------------------------------------------------ energy -> motion */
// Human-band energy is in units of the window's own noise: ~1 when nothing moves, 1.6
// starts motion (motion.HBE_RECENT_GATE), typing sits ~3-4x the desk-still level and
// waving at the desk measured 14-37x (docs/research/2026-10-13-world-model-and-
// channel-charting.md). Log-scaled so all of them read: 1.6x ~0.09, 4x ~0.35, 10x
// ~0.6, 30x ~0.9.
export const HEAT_FLOOR_X = 1.15
export const HEAT_FULL_X = 40

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function energyToHeat(hb: { energy?: number | null; recent?: number | null } | null | undefined): number {
  const recent = finite(hb?.recent), energy = finite(hb?.energy)
  const e = recent > 0 ? recent : energy           // the last second answers fastest
  if (!(e > HEAT_FLOOR_X)) return 0
  return Math.min(1, Math.log(e / HEAT_FLOOR_X) / Math.log(HEAT_FULL_X / HEAT_FLOOR_X))
}
