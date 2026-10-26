/**
 * Typography and areas for the tree canvas, as pure functions the tests check.
 *
 * Every node owns a fixed area: the 30 × 34 hexagon plus a label box under it,
 * LABEL_W wide and MAX_LINES lines tall. The layout spaces a row 175 px apart and
 * rows 150 px apart, so a 150 px box with a 13 px gutter on each side can never
 * touch its neighbour, and 3 lines (y 32..71) end well before the row above (-17+150).
 * Text width is estimated at CHAR_W per character: 11 px Inter averages ≈5.9 px a
 * glyph, so 6.6 leaves room for capitals and wide letters without measuring the DOM.
 */
import type { Layout } from '../game/tree'

export const LABEL_W = 150
export const LINE_H = 13
export const MAX_LINES = 3
export const CHAR_W = 6.6
export const LABEL_TOP = 22          // first baseline at y=32; 11 px type starts ≈10 px above it
export const HEX_W = 30
export const HEX_H = 34
export const MAX_CHARS = Math.floor(LABEL_W / CHAR_W)   // 22

/** Split a name into at most `lines` lines of at most `max` characters, at word breaks; overflow ends in an ellipsis. */
export function wrapLines(name: string, max = MAX_CHARS, lines = MAX_LINES): string[] {
  const tokens: string[] = []
  for (const w of name.trim().split(/\s+/).filter(Boolean)) for (let i = 0; i < w.length; i += max) tokens.push(w.slice(i, i + max))
  const out: string[] = []
  let cur = ''
  for (const t of tokens) {
    const next = cur ? `${cur} ${t}` : t
    if (next.length <= max) cur = next
    else { out.push(cur); cur = t }
  }
  if (cur) out.push(cur)
  if (out.length <= lines) return out.length ? out : ['']
  const kept = out.slice(0, lines)
  kept[lines - 1] = `${kept[lines - 1].slice(0, max - 1).trimEnd()}…`
  return kept
}
export const textWidth = (s: string) => s.length * CHAR_W

export interface Rect { x: number; y: number; w: number; h: number }
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The fixed area of a node at (x, y): hexagon on top, the 3-line label box under it. */
export function nodeArea(x: number, y: number): Rect {
  return { x: x - LABEL_W / 2, y: y - HEX_H / 2, w: LABEL_W, h: HEX_H / 2 + LABEL_TOP + MAX_LINES * LINE_H }
}
export function labelBox(x: number, y: number): Rect {
  return { x: x - LABEL_W / 2, y: y + LABEL_TOP, w: LABEL_W, h: MAX_LINES * LINE_H }
}
/** A branch caption (12 px mono, 0.12 em tracking ≈ 8.6 px a glyph), centred on x with its baseline at y. */
export function branchBox(name: string, x: number, y: number): Rect {
  const w = name.length * 8.6
  return { x: x - w / 2, y: y - 11, w, h: 13 }
}

/**
 * Check a layout: no two node areas overlap, every label fits its box after wrapping,
 * and no branch caption sits on a node area. Returns the problems (empty = clean).
 */
export function checkLayout(layout: Layout): string[] {
  const bad: string[] = []
  const areas = layout.nodes.map((p) => ({ id: p.id, r: nodeArea(p.x, p.y) }))
  // Rows are horizontal bands; sort by y then x so the pair scan stays near-linear.
  areas.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x)
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      if (areas[j].r.y >= areas[i].r.y + areas[i].r.h) break
      if (overlap(areas[i].r, areas[j].r)) bad.push(`overlap: ${areas[i].id} / ${areas[j].id}`)
    }
  }
  for (const p of layout.nodes) {
    const ls = wrapLines(p.node.name)
    if (ls.length > MAX_LINES) bad.push(`too many lines: ${p.id}`)
    for (const l of ls) if (textWidth(l) > LABEL_W) bad.push(`too wide: ${p.id} "${l}"`)
  }
  for (const b of layout.branches) {
    const r = branchBox(b.name.replace(/_/g, ' '), b.x, b.y)
    for (const a of areas) if (overlap(r, a.r)) bad.push(`branch ${b.name} on ${a.id}`)
  }
  return bad
}
