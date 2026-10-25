/**
 * Measure my room (the Aankhen tab's guided form) and the drill-readiness check.
 * Pure, so it is unit-tested (src/__tests__/roomMeasure.test.ts). The server
 * (aankhen/measure.py) validates again and is the one that decides; this mirror only
 * catches the obvious before a round trip and turns the text boxes into numbers.
 *
 * Coordinates: metres from ONE floor corner, x along the first wall, y along the second.
 * "south" is the y = 0 wall, "north" y = depth, "west" x = 0, "east" x = width.
 */
export type Wall = 'south' | 'north' | 'west' | 'east'
export const WALLS: readonly Wall[] = ['south', 'west', 'north', 'east']
/** How each wall is named on screen, and which end its "from" distance starts at. */
export const WALL_NAME: Record<Wall, { short: string; long: string; from: string }> = {
  south: { short: 'A', long: 'Wall A (right of corner 0)', from: 'from the corner-0 end' },
  west: { short: 'B', long: 'Wall B (left of corner 0)', from: 'from the corner-0 end' },
  north: { short: 'C', long: 'Wall C (opposite A)', from: 'from the end touching Wall B' },
  east: { short: 'D', long: 'Wall D (opposite B)', from: 'from the end touching Wall A' },
}
/** Metres (server) <-> centimetres (form). One decimal of a centimetre is plenty. */
export const toCm = (m: number) => String(Math.round(m * 1000) / 10)
export const RECTS = ['bed', 'desk', 'wardrobe'] as const
export const DOORS = ['door', 'balcony_door'] as const
export const POINTS = ['board', 'router'] as const
export const OPTIONAL = new Set(['wardrobe', 'balcony_door'])
export const LABELS: Record<string, string> = {
  bed: 'Bed', desk: 'Desk', wardrobe: 'Wardrobe', door: 'Room door', balcony_door: 'Balcony door',
  board: 'ESP32 board', router: 'Wi-Fi router',
}

/** The form as typed: every value a string, so a half-typed "3." stays editable. */
export interface FormText {
  width: string; depth: string; height: string
  rects: Record<(typeof RECTS)[number], { x: string; y: string; w: string; d: string }>
  doors: Record<(typeof DOORS)[number], { wall: Wall; offset: string; width: string }>
  points: Record<(typeof POINTS)[number], { x: string; y: string; z: string }>
}
export interface FieldError { field: string; error: string }

const s = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? toCm(v) : '')

/** Prefill from the server's form (the current room.json, maybe estimated). */
export function fromServer(f: Record<string, any> | null | undefined): FormText {
  const r = (k: string) => ({ x: s(f?.[k]?.x), y: s(f?.[k]?.y), w: s(f?.[k]?.w), d: s(f?.[k]?.d) })
  const p = (k: string) => ({ x: s(f?.[k]?.x), y: s(f?.[k]?.y), z: s(f?.[k]?.z) })
  const door = (d: any, dflt: Wall) => ({ wall: (WALLS.includes(d?.wall) ? d.wall : dflt) as Wall, offset: s(d?.offset), width: s(d?.width) })
  return {
    width: s(f?.width), depth: s(f?.depth), height: s(f?.height),
    rects: { bed: r('bed'), desk: r('desk'), wardrobe: r('wardrobe') },
    doors: { door: door(f?.door, 'north'), balcony_door: door(f?.balcony_door, 'east') },
    points: { board: p('board'), router: p('router') },
  }
}

/** A typed centimetre value as metres for the server (null when it isn't a number). */
const n = (t: string): number | null => {
  const v = Number(t.trim().replace(',', '.'))
  return t.trim() !== '' && Number.isFinite(v) ? Math.round(v * 10) / 1000 : null
}
const NUM = 'a number in centimetres'
const blank = (o: Record<string, string>) => Object.entries(o).every(([k, v]) => k === 'wall' || v.trim() === '')

/** The JSON body for POST /api/aankhen/room-measure, and the errors that stop it. */
export function toPayload(t: FormText): { body: Record<string, unknown>; errors: FieldError[] } {
  const errors: FieldError[] = []
  const body: Record<string, unknown> = {}
  const need = (field: string, v: number | null, lo: number, hi: number) => {
    if (v === null) errors.push({ field, error: NUM })
    else if (v < lo || v > hi) errors.push({ field, error: `between ${lo * 100} and ${hi * 100} cm` })
    return v
  }
  body.width = need('width', n(t.width), 1.5, 12)
  body.depth = need('depth', n(t.depth), 1.5, 12)
  body.height = need('height', n(t.height), 2, 5)
  for (const k of RECTS) {
    const r = t.rects[k]
    if (OPTIONAL.has(k) && blank(r)) continue
    const v = { x: n(r.x), y: n(r.y), w: n(r.w), d: n(r.d) }
    for (const [a, x] of Object.entries(v)) if (x === null) errors.push({ field: `${k}.${a}`, error: NUM })
    body[k] = v
  }
  for (const k of DOORS) {
    const d = t.doors[k]
    if (OPTIONAL.has(k) && blank(d)) continue
    const v = { wall: d.wall, offset: n(d.offset), width: n(d.width) }
    if (v.offset === null) errors.push({ field: `${k}.offset`, error: NUM })
    if (v.width === null) errors.push({ field: `${k}.width`, error: NUM })
    body[k] = v
  }
  for (const k of POINTS) {
    const p = t.points[k]
    const v = { x: n(p.x), y: n(p.y), z: n(p.z) }
    for (const [a, x] of Object.entries(v)) if (x === null) errors.push({ field: `${k}.${a}`, error: NUM })
    body[k] = v
  }
  return { body, errors }
}

/** Server errors arrive as HTTP 422 {detail: {errors: [...]}}; the api helper throws
 *  Error(message) with that JSON in it, or a plain message. */
export function parseServerErrors(raw: unknown): FieldError[] {
  const d = (raw as any)?.detail ?? raw
  const list = (d as any)?.errors
  return Array.isArray(list) ? list.filter((e) => e && typeof e.error === 'string').map((e) => ({ field: String(e.field ?? ''), error: e.error })) : []
}

/* ------------------------------------------------------------------ readiness */
export interface ReadinessItem { id: string; ok: boolean; label: string; detail: string; how: string }
export interface Readiness { ready: boolean; zones_trusted: boolean; zone_floor: number | null; layout_measured: boolean; drill_days: number; items: ReadinessItem[]; missing: string[] }

export function readinessLine(r: Readiness | null): string {
  if (!r) return 'checking…'
  if (r.ready) return 'Zones trusted: measured room, both baselines, 7 drill days, day-7 test passed'
  return `Zones not trusted yet: ${r.missing.length} missing`
}

/* ------------------------------------------------------------------ the learned card */
export interface LearnedView { rows: { id: string; p: number }[]; top: string; occupied: number }
/** What the Spatial model card may show. Trusted: every state. Not trusted: desk / bed /
 *  room fold into "In my room" (not sure where), and nothing above 90 %. */
export function learnedView(l: { state: string; p: Record<string, number>; occupied_p: number } | null | undefined, trusted: boolean): LearnedView | null {
  if (!l) return null
  if (trusted) return { rows: Object.entries(l.p).map(([id, p]) => ({ id, p })), top: l.state, occupied: l.occupied_p }
  const cap = (v: number) => Math.min(0.9, Math.max(0, v || 0))
  const inRoom = (l.p.desk ?? 0) + (l.p.bed ?? 0) + (l.p.room ?? 0)
  const top = ['desk', 'bed', 'room'].includes(l.state) ? 'room' : l.state
  return {
    rows: [{ id: 'empty', p: cap(l.p.empty ?? 0) }, { id: 'outside', p: cap(l.p.outside ?? 0) }, { id: 'room', p: cap(inRoom) }],
    top, occupied: cap(l.occupied_p),
  }
}
