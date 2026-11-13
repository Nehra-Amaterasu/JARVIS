// The two pure functions every generated glyph rests on (spec 20.4.1: "FNV-1a 32 of the id seeds mulberry32").
// No Math.random anywhere in the grammar: the same id must give the same bytes on every machine and every run,
// which is what the golden files in __tests__/grammar check.

/** FNV-1a, 32 bit, over UTF-16 code units. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32: a 32-bit state PRNG returning floats in [0, 1). Small, fast, and identical across JS engines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick from a list by weights with one draw of `r`. */
export function pickWeighted<T>(r: number, items: readonly T[], weights: readonly number[]): T {
  let total = 0
  for (const w of weights) total += w
  let x = r * total
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]
    if (x < 0) return items[i]
  }
  return items[items.length - 1]
}

/** The seed as 8 hex digits: what the DOM may show instead of the id (an id can be a person's name). */
export const seedHex = (id: string): string => fnv1a32(id).toString(16).padStart(8, '0')
