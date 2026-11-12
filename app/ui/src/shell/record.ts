/**
 * The Resume record (spec 3.4 "Resume pill", 4.2.3): what was open, per product, and when it was last
 * confirmed. Stored in localStorage under one key per product. NOT done in this package: the copy in the
 * server's scene memory (the spec names `workspaceMemory.ts`, which today is sessionStorage only); the pill
 * reads the local record alone until that lands.
 *
 * Honesty rule: a record not confirmed within two planned block lengths reads "last seen ..." with Pick up
 * and Drop it, and never shows a running time. The block length is an assumption (50 min, the default
 * block of the Focus workspace); two of them is 100 min.
 */
import { PRODUCT_LABEL, VIEW_LABEL, homeOf, sectionById, type ProductId } from './ids'

export interface ResumeRecord {
  product: ProductId
  section: string
  view: string
  /** A short name of the open thing, when a page reports one ("Paper 2"). */
  object: string | null
  openedAt: number
  lastConfirmedAt: number
}

export const BLOCK_MS = 50 * 60_000
export const STALE_MS = 2 * BLOCK_MS

const keyOf = (p: ProductId) => `shell.resume.${p}`

export function readRecord(product: ProductId): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(keyOf(product))
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<ResumeRecord>
    const s = typeof r.section === 'string' ? sectionById(r.section) : undefined
    if (!s || s.product !== product || typeof r.view !== 'string' || !s.views.includes(r.view)) return null
    const openedAt = Number(r.openedAt)
    const lastConfirmedAt = Number(r.lastConfirmedAt)
    if (!Number.isFinite(openedAt) || !Number.isFinite(lastConfirmedAt)) return null
    return { product, section: s.id, view: r.view, object: typeof r.object === 'string' ? r.object.slice(0, 60) : null, openedAt, lastConfirmedAt }
  } catch {
    return null
  }
}

export function writeRecord(r: ResumeRecord): void {
  try {
    localStorage.setItem(keyOf(r.product), JSON.stringify(r))
  } catch {
    /* storage blocked: the pill falls back to the first-run line */
  }
}

export function clearRecord(product: ProductId): void {
  try {
    localStorage.removeItem(keyOf(product))
  } catch {
    /* nothing kept, nothing to clear */
  }
}

export type PillState =
  | { kind: 'start'; text: string }
  | { kind: 'open'; text: string }
  | { kind: 'stale'; text: string }

const placeText = (r: ResumeRecord) => `${sectionById(r.section)?.label ?? r.section} / ${VIEW_LABEL[r.view] ?? r.view}`

function ago(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return h < 48 ? 'yesterday' : `${Math.round(h / 24)} days ago`
}

/** What the pill says. The record of the place you are standing in reads as "Start" text, never as resumable. */
export function pillState(product: ProductId, r: ResumeRecord | null, now: number): PillState {
  if (!r) return { kind: 'start', text: product === 'ww' ? 'Start: plan the day' : `Start: wake ${PRODUCT_LABEL.jarvis}` }
  const what = r.object ? `${placeText(r)}: ${r.object}` : placeText(r)
  if (now - r.lastConfirmedAt > STALE_MS) return { kind: 'stale', text: `${r.object ?? placeText(r)}, last seen ${ago(now - r.lastConfirmedAt)}` }
  return { kind: 'open', text: what }
}

/** Where Pick up / the pill goes: the record's place, else the product's home. */
export function resumeTarget(product: ProductId, r: ResumeRecord | null) {
  return r ? { product, section: r.section, view: r.view } : homeOf(product)
}
