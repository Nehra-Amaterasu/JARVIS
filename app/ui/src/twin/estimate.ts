/**
 * The estimate avatar's brain, kept free of three.js so it can be unit-tested
 * (src/__tests__/estimate.test.ts). EstimateAvatar.ts draws what this decides.
 *
 * With no radar on the real board there are no tracks: the only answer to "where am I"
 * is the learned spatial model (aankhen/learn.py), which picks one of five STATES
 * (empty / outside / room / desk / bed), and the activity model (still / typing /
 * waving / walking). A state is a place in room.json, not a coordinate, so the figure
 * stands on a SPOT derived from that place's polygon:
 *   desk     seated, at the centroid of the part of the desk zone the desk itself does
 *            not cover (the chair side), facing the zone's facing_deg
 *   bed      lying on the bed zone, head along its facing_deg (feet -> head)
 *   room     standing on the most open point of the floor zone (an L-shaped floor's
 *            plain centroid can sit in the wardrobe)
 *   outside  no figure: a soft marker just past the door
 *   empty    nothing
 * Nothing here pretends to be a measurement; the label says "estimate" and the number.
 */

/* ------------------------------------------------------------------ types */
export type Posture = 'standing' | 'seated' | 'lying'
export type Motion = 'still' | 'typing' | 'waving' | 'walking'
export type Focus = 'chest' | 'hands' | 'arm' | 'legs'
export type Place = 'desk' | 'bed' | 'room'
export const POSTURES: readonly Posture[] = ['standing', 'seated', 'lying']
export const MOTIONS: readonly Motion[] = ['still', 'typing', 'waving', 'walking']
export const IN_ROOM: readonly string[] = ['room', 'desk', 'bed']

export interface ZoneLike { name: string; polygon: number[][]; is_exit?: boolean; posture?: string | null; facing_deg?: number | null }
export interface FurnitureLike { name: string; x: number; y: number; w: number; d: number; h: number }
export interface RoomLike { width: number; depth: number; zones: ZoneLike[]; furniture: FurnitureLike[] }

/** Where the figure rests. facing: radians in the floor plane (0 = +x) the face points;
 *  for lying, the direction from feet to head. base: what the body rests on, metres. */
export interface Spot { x: number; y: number; facing: number; posture: Posture; base: number }
export interface Spots {
  desk: Spot | null
  bed: Spot | null
  room: Spot
  /** Where standing up from the desk or the bed puts me (walking while "at the bed"). */
  stand: { desk: Spot | null; bed: Spot | null }
  /** The doorway, inside the room; and a point just past it, outside. */
  door: { x: number; y: number } | null
  outside: { x: number; y: number } | null
  /** How far the figure may drift around the room spot while walking, metres. */
  wander: number
}

export const SEAT_H = 0.46          // a desk chair's seat
const BED_H = 0.5
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

/** Area centroid of the part of a polygon that passes `keep`; the whole polygon's, then
 *  its vertices', when nothing does (a sliver thinner than the sampling grid). */
function centreOf(poly: number[][], keep?: (x: number, y: number) => boolean): [number, number] {
  const some = keep ? samples(poly, keep) : []
  if (some.length) return mean(some)
  const all = samples(poly)
  return all.length ? mean(all) : mean(poly)
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

const rad = (deg: number) => (deg * Math.PI) / 180

/** Every place the figure can rest, derived once per room.json. */
export function roomSpots(r: RoomLike): Spots {
  const roomPoly = [[0, 0], [r.width, 0], [r.width, r.depth], [0, r.depth]]
  const desk = findZone(r, 'desk', 'seated')
  const bed = findZone(r, 'bed', 'lying')
  const floor = r.zones.find((z) => z.name.toLowerCase() === 'floor' && z.polygon.length >= 3) ?? null
  const exits = r.zones.filter((z) => z.is_exit && z.polygon.length >= 3)
  const door = exits.find((z) => z.name.toLowerCase() === 'door') ?? exits[0] ?? null
  const blocked = (x: number, y: number) => r.furniture.some((f) => inBox(x, y, f, FURN_MARGIN))

  // the open floor: the floor zone (or the whole room), clear of furniture and of the
  // other zones (a floor polygon drawn round the desk zone must not seat me standing)
  const others = [desk, bed, ...exits].filter((z): z is ZoneLike => !!z)
  const inRoom = (x: number, y: number) => x > 0 && x < r.width && y > 0 && y < r.depth
  const floorPts = samples(floor?.polygon ?? roomPoly, (x, y) => inRoom(x, y) && !blocked(x, y))
  const openPts = floorPts.filter(([x, y]) => !others.some((z) => pointInPolygon(x, y, z.polygon)))
  const open = mostOpen(r, openPts, others)
    ?? mostOpen(r, samples(roomPoly, (x, y) => !blocked(x, y)), others)
    ?? { x: r.width / 2, y: r.depth / 2, clearance: 0.3 }
  const toMid = Math.hypot(r.depth / 2 - open.y, r.width / 2 - open.x)
  const room: Spot = { x: open.x, y: open.y, posture: 'standing', base: 0,
    facing: toMid < 0.05 ? -Math.PI / 2 : Math.atan2(r.depth / 2 - open.y, r.width / 2 - open.x) }

  // the desk: seated on its chair side
  let deskSpot: Spot | null = null
  if (desk) {
    const table = mainFurniture(r, desk, 'desk')
    const [sx, sy] = centreOf(desk.polygon, (x, y) => !table || !inBox(x, y, table))
    let facing: number
    if (desk.facing_deg != null) facing = rad(desk.facing_deg)
    else if (table) {
      const nx = Math.max(table.x, Math.min(sx, table.x + table.w)), ny = Math.max(table.y, Math.min(sy, table.y + table.d))
      facing = Math.atan2(ny - sy, nx - sx)
    } else facing = Math.atan2(r.depth / 2 - sy, r.width / 2 - sx)
    deskSpot = { x: sx, y: sy, facing, posture: 'seated', base: SEAT_H }
  }

  // the bed: lying along it, on its top
  let bedSpot: Spot | null = null
  if (bed) {
    const frame = mainFurniture(r, bed, 'bed')
    const [bx, by] = centreOf(bed.polygon, frame ? (x, y) => inBox(x, y, frame) : undefined)
    let facing: number
    if (bed.facing_deg != null) facing = rad(bed.facing_deg)
    else {
      // along the longer side, head toward the nearer wall
      const [x0, y0, x1, y1] = bbox(bed.polygon)
      facing = x1 - x0 >= y1 - y0 ? (bx < r.width / 2 ? Math.PI : 0) : (by < r.depth / 2 ? -Math.PI / 2 : Math.PI / 2)
    }
    bedSpot = { x: bx, y: by, facing, posture: 'lying', base: frame ? frame.h : BED_H }
  }

  // standing up: from the desk where the chair is; from the bed onto the nearest open floor
  const nearestFree = (s: Spot): Spot => {
    let best = room, bd = Infinity
    for (const [x, y] of openPts.length ? openPts : floorPts) {
      const d = Math.hypot(x - s.x, y - s.y)
      if (d < bd) { bd = d; best = { x, y, facing: Math.atan2(s.y - y, s.x - x), posture: 'standing', base: 0 } }
    }
    return best
  }
  const stand = {
    desk: deskSpot ? { ...deskSpot, posture: 'standing' as Posture, base: 0 } : null,
    bed: bedSpot ? nearestFree(bedSpot) : null,
  }

  // the door: its middle inside, and a point 0.45 m past the nearest wall
  let doorIn: { x: number; y: number } | null = null, outside: { x: number; y: number } | null = null
  if (door) {
    const [dx, dy] = centreOf(door.polygon)
    doorIn = { x: dx, y: dy }
    const walls = [{ d: dx, x: -0.45, y: dy }, { d: r.width - dx, x: r.width + 0.45, y: dy },
      { d: dy, x: dx, y: -0.45 }, { d: r.depth - dy, x: dx, y: r.depth + 0.45 }]
    walls.sort((a, b) => a.d - b.d)
    outside = { x: walls[0].x, y: walls[0].y }
  }
  return { desk: deskSpot, bed: bedSpot, room, stand, door: doorIn, outside, wander: Math.max(0.12, Math.min(0.45, open.clearance - 0.2)) }
}

/* ------------------------------------------------------------------ zone + activity -> pose */
export interface PoseChoice {
  show: 'figure' | 'outside' | 'none'
  posture: Posture
  motion: Motion
  focus: Focus
  /** which spot: a place, or standing up beside it */
  at: Place | 'stand-desk' | 'stand-bed' | null
}

const FOCUS: Record<Motion, Focus> = { still: 'chest', typing: 'hands', waving: 'arm', walking: 'legs' }

/** What the figure does for a learned state and activity. Walking while the zone
 *  model still says desk or bed means getting up: I stand beside it. */
export function poseFor(state: string | null | undefined, activity: string | null | undefined): PoseChoice {
  const motion: Motion = (MOTIONS as readonly string[]).includes(activity ?? '') ? activity as Motion : 'still'
  const focus = FOCUS[motion]
  if (state === 'outside') return { show: 'outside', posture: 'standing', motion: 'still', focus: 'chest', at: null }
  if (state !== 'desk' && state !== 'bed' && state !== 'room') return { show: 'none', posture: 'standing', motion: 'still', focus: 'chest', at: null }
  if (state === 'room') return { show: 'figure', posture: 'standing', motion, focus, at: 'room' }
  if (motion === 'walking') return { show: 'figure', posture: 'standing', motion, focus, at: state === 'desk' ? 'stand-desk' : 'stand-bed' }
  return { show: 'figure', posture: state === 'desk' ? 'seated' : 'lying', motion, focus, at: state }
}

/** The spot for a choice, falling back to the open floor when the room has no such zone. */
export function spotFor(s: Spots, at: PoseChoice['at']): Spot | null {
  switch (at) {
    case 'desk': return s.desk ?? s.room
    case 'bed': return s.bed ?? s.room
    case 'stand-desk': return s.stand.desk ?? s.room
    case 'stand-bed': return s.stand.bed ?? s.room
    case 'room': return s.room
    default: return null
  }
}

/* ------------------------------------------------------------------ energy -> heat */
// Human-band energy is in units of the window's own noise: ~1 when nothing moves, 1.6
// starts motion (motion.HBE_RECENT_GATE), typing sits ~3-4x the desk-still level and
// waving at the desk measured 14-37x (docs/research/2026-10-13-world-model-and-
// channel-charting.md). Log-scaled so all of them read: 1.6x ~0.09, 4x ~0.35, 10x
// ~0.6, 30x ~0.9.
export const HEAT_FLOOR_X = 1.15
export const HEAT_FULL_X = 40
// A burst decays with this time constant: a 1-second wave is still at a third after 2 s.
export const HEAT_TAU_S = 1.6

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function energyToHeat(hb: { energy?: number | null; recent?: number | null } | null | undefined): number {
  const recent = finite(hb?.recent), energy = finite(hb?.energy)
  const e = recent > 0 ? recent : energy           // the last second answers fastest
  if (!(e > HEAT_FLOOR_X)) return 0
  return Math.min(1, Math.log(e / HEAT_FLOOR_X) / Math.log(HEAT_FULL_X / HEAT_FLOOR_X))
}

/** Instant attack, exponential release: a burst of movement stays visible a few seconds. */
export function decayHeat(prev: number, input: number, dt: number, tau = HEAT_TAU_S): number {
  const kept = prev * Math.exp(-Math.max(0, dt) / tau)
  return Math.max(Math.max(0, Math.min(1, input)), kept)
}

/* ------------------------------------------------------------------ holding the estimate */
export interface LearnedLike {
  t?: number
  state: string
  p: Record<string, number>
  occupied_p: number
  activity?: { state: string; p: Record<string, number> } | null
}
export interface Held {
  /** desk / bed / room (a figure), outside (the door marker), or null (nothing) */
  zone: string | null
  activity: Motion | 'none'
  /** P(this zone) — the figure's opacity and the number on its label */
  p: number
  occupied: number
}

// Show the figure only when the model gives better than even odds that I am in.
export const SHOW_P = 0.5
// How long a new answer must persist before the figure acts on it. The engine's HMM
// already smooths the state; this stops a single flickering window (the zone is right
// 88 % of the time on the real board) from sending the figure across the room.
export const HOLD = { appear: 0.5, move: 1.5, leave: 2.5, activity: 0.8 }
// No new learned window for this long: the model is not answering (warming up, a board
// that went silent). The figure goes, rather than claim an old answer is now.
export const STALE_S = 4

/** The raw target of one learned answer, before any hold. */
export function targetZone(l: LearnedLike | null | undefined): string | null {
  if (!l) return null
  if (l.occupied_p >= SHOW_P) {
    if (IN_ROOM.includes(l.state)) return l.state
    // in, by better than even odds, but the single best state is out: the likeliest place in
    let best = 'room', bp = -1
    for (const z of IN_ROOM) if ((l.p[z] ?? 0) > bp) { bp = l.p[z] ?? 0; best = z }
    return best
  }
  return l.state === 'outside' ? 'outside' : null
}

export class EstimateHold {
  zone: string | null = null
  activity: Motion | 'none' = 'none'
  private pend: { v: string | null; since: number } | null = null
  private pendA: { v: Motion | 'none'; since: number } | null = null
  private lastT: number | undefined = undefined
  private freshAt = -Infinity

  update(l: LearnedLike | null | undefined, now: number): Held {
    if (l && l.t !== undefined) {
      if (l.t !== this.lastT) { this.lastT = l.t; this.freshAt = now }
    } else if (l) this.freshAt = now
    const stale = !l || now - this.freshAt > STALE_S
    const raw = stale ? null : targetZone(l)
    if (raw === this.zone) this.pend = null
    else if (stale || !l) { this.zone = null; this.pend = null }
    else {
      if (!this.pend || this.pend.v !== raw) this.pend = { v: raw, since: now }
      const inNow = this.zone !== null && IN_ROOM.includes(this.zone)
      const inNext = raw !== null && IN_ROOM.includes(raw)
      const hold = !inNext ? HOLD.leave : inNow ? HOLD.move : HOLD.appear
      if (now - this.pend.since >= hold) { this.zone = raw; this.pend = null }
    }
    const a = l?.activity?.state
    const rawA: Motion | 'none' = (MOTIONS as readonly string[]).includes(a ?? '') ? a as Motion : 'none'
    if (rawA === this.activity) this.pendA = null
    else {
      if (!this.pendA || this.pendA.v !== rawA) this.pendA = { v: rawA, since: now }
      if (now - this.pendA.since >= HOLD.activity || this.zone === null) { this.activity = rawA; this.pendA = null }
    }
    const p = this.zone && l ? (this.zone === 'outside' ? l.p.outside ?? 0 : l.p[this.zone] ?? 0) : 0
    return { zone: this.zone, activity: this.activity, p, occupied: l?.occupied_p ?? 0 }
  }
}

/** Opacity from probability: a coin-flip guess is a ghost, a sure one is solid. */
export function estimateAlpha(p: number): number {
  const k = Math.max(0, Math.min(1, (p - 0.25) / 0.65))
  return 0.16 + 0.84 * k * k * (3 - 2 * k)
}

/** "estimate 82% · desk · typing" — the figure's label, in my own words. */
export function estimateLabel(h: Pick<Held, 'zone' | 'activity' | 'p'>): string {
  const pct = `${Math.round(Math.max(0, Math.min(1, h.p)) * 100)}%`
  if (h.zone === 'outside') return `outside the room · ${pct}`
  if (!h.zone) return ''
  return `estimate ${pct} · ${h.zone}` + (h.activity !== 'none' ? ` · ${h.activity}` : '')
}

/* ------------------------------------------------------------------ the body and its poses */
// Segment lengths, metres: a 1.72 m adult, proportions after Drillis & Contini (1966).
export const BODY = {
  hipZ: 0.92,          // hip joint above the floor, standing
  spine: 0.5,          // hip joint -> base of the neck
  shoulderZ: 0.45,     // shoulder joints above the hip joint
  shoulderY: 0.19,
  hipY: 0.09,
  upperArm: 0.28, forearm: 0.25, hand: 0.08,
  thigh: 0.43, shin: 0.43, ankle: 0.06,
  neck: 0.08, head: 0.105,
}

/** Joint angles, radians. Flex = forward from hanging down; abduct = outward. */
export interface PoseAngles {
  pelvisZ: number; lean: number; nod: number; breathe: number
  shLf: number; shLa: number; shRf: number; shRa: number
  elLf: number; elLb: number; elRf: number; elRb: number
  hipL: number; hipR: number; knL: number; knR: number
}
const KEYS: (keyof PoseAngles)[] = ['pelvisZ', 'lean', 'nod', 'breathe', 'shLf', 'shLa', 'shRf', 'shRa',
  'elLf', 'elLb', 'elRf', 'elRb', 'hipL', 'hipR', 'knL', 'knR']

export function zeroPose(): PoseAngles {
  return { pelvisZ: 0, lean: 0, nod: 0, breathe: 0, shLf: 0, shLa: 0, shRf: 0, shRa: 0, elLf: 0, elLb: 0, elRf: 0, elRb: 0, hipL: 0, hipR: 0, knL: 0, knR: 0 }
}

export interface PoseCtx { base: number; travel: number }
const TAU = Math.PI * 2

/** One posture doing one thing at time t. Rhythms: typing taps at ~4 Hz, a wave swings
 *  at ~1.7 Hz, a step at ~1.9 Hz, breathing at 15 a minute. */
export function poseAngles(posture: Posture, motion: Motion, t: number, ctx: PoseCtx, out: PoseAngles = zeroPose()): PoseAngles {
  const breath = Math.sin(TAU * 0.25 * t)
  // the posture's rest
  if (posture === 'seated') {
    Object.assign(out, { pelvisZ: ctx.base + 0.04, lean: 0.1, nod: 0.05, breathe: 1 + 0.02 * breath,
      shLf: 0.35, shLa: 0.12, shRf: 0.35, shRa: 0.12, elLf: 1.1, elLb: 0, elRf: 1.1, elRb: 0,
      hipL: Math.PI / 2, hipR: Math.PI / 2, knL: Math.PI / 2, knR: Math.PI / 2 })
  } else if (posture === 'lying') {
    Object.assign(out, { pelvisZ: ctx.base + 0.12, lean: 0, nod: -0.1, breathe: 1 + 0.03 * breath,
      shLf: 0.02, shLa: 0.16, shRf: 0.02, shRa: 0.16, elLf: 0.12, elLb: 0, elRf: 0.12, elRb: 0,
      hipL: 0.02, hipR: 0.02, knL: 0.06, knR: 0.06 })
  } else {
    Object.assign(out, { pelvisZ: BODY.hipZ, lean: 0.02, nod: 0, breathe: 1 + 0.02 * breath,
      shLf: 0.05, shLa: 0.13, shRf: 0.05, shRa: 0.13, elLf: 0.18, elLb: 0, elRf: 0.18, elRb: 0,
      hipL: 0, hipR: 0, knL: 0.04, knR: 0.04 })
  }
  if (motion === 'typing') {
    const tap = 0.07 * Math.sin(TAU * 4.2 * t), tap2 = 0.07 * Math.sin(TAU * 4.2 * t + 2.4)
    // seated: forearms level at desk height; standing or lying: a phone held at the chest
    const [sf, ef] = posture === 'seated' ? [0.62, 1.3] : posture === 'lying' ? [0.95, 1.25] : [0.42, 1.5]
    out.shLf = sf; out.shRf = sf; out.shLa = 0.16; out.shRa = 0.16
    out.elLf = ef + tap; out.elRf = ef + tap2
    out.lean += posture === 'seated' ? 0.04 : 0
    out.nod += 0.12
  } else if (motion === 'waving') {
    const sway = 0.42 * Math.sin(TAU * 1.7 * t)
    if (posture === 'lying') { out.shRf = 1.45; out.shRa = 0.15; out.elRf = 0.15; out.elRb = 0.35 + sway }
    else { out.shRf = 0.2; out.shRa = 2.05; out.elRf = 0.1; out.elRb = 0.95 + sway }
  } else if (motion === 'walking') {
    const ph = TAU * 0.95 * t, s = Math.sin(ph)
    // in place: a march (thigh up, shin under); travelling: a stride
    const march = 1 - Math.max(0, Math.min(1, ctx.travel))
    const mL = 0.55 * Math.max(0, s), mR = 0.55 * Math.max(0, -s)
    const gL = 0.4 * s, gR = -0.4 * s
    const kgL = 0.12 + 0.55 * Math.max(0, Math.sin(ph + 1.2)), kgR = 0.12 + 0.55 * Math.max(0, Math.sin(ph + Math.PI + 1.2))
    if (posture === 'standing') {
      out.hipL = march * mL + (1 - march) * gL
      out.hipR = march * mR + (1 - march) * gR
      out.knL = march * 1.7 * mL + (1 - march) * kgL
      out.knR = march * 1.7 * mR + (1 - march) * kgR
      out.pelvisZ += march * 0.02 * Math.abs(s) - (1 - march) * 0.015 * Math.abs(Math.cos(ph))
    } else {
      out.knL += 0.15 * Math.max(0, s); out.knR += 0.15 * Math.max(0, -s)   // restless legs, seated or lying
    }
    out.shLf = -0.3 * s; out.shRf = 0.3 * s; out.elLf = 0.35; out.elRf = 0.35
  }
  return out
}

/** Weighted sum of poses: transitions blend whole poses, so a rhythm is never damped. */
export function blendPose(wP: Record<Posture, number>, wM: Record<Motion, number>, t: number, ctxFor: (p: Posture) => PoseCtx,
  out: PoseAngles = zeroPose(), tmp: PoseAngles = zeroPose()): PoseAngles {
  for (const k of KEYS) out[k] = 0
  let total = 0
  for (const p of POSTURES) {
    if (wP[p] < 1e-3) continue
    for (const m of MOTIONS) {
      const w = wP[p] * wM[m]
      if (w < 1e-3) continue
      poseAngles(p, m, t, ctxFor(p), tmp)
      for (const k of KEYS) out[k] += w * tmp[k]
      total += w
    }
  }
  if (total > 0) for (const k of KEYS) out[k] /= total
  return out
}

/** Hand height and reach in the side view (x forward, z up), for the tests: does a
 *  seated typist's hand land on the desk? */
export function sagittalHand(p: PoseAngles, side: 'L' | 'R' = 'R'): { x: number; z: number } {
  const sf = side === 'L' ? p.shLf : p.shRf, ef = side === 'L' ? p.elLf : p.elRf
  const sx = BODY.shoulderZ * Math.sin(p.lean), sz = p.pelvisZ + BODY.shoulderZ * Math.cos(p.lean)
  const a1 = sf - p.lean, a2 = a1 + ef
  const ex = sx + BODY.upperArm * Math.sin(a1), ez = sz - BODY.upperArm * Math.cos(a1)
  const L = BODY.forearm + BODY.hand
  return { x: ex + L * Math.sin(a2), z: ez - L * Math.cos(a2) }
}
