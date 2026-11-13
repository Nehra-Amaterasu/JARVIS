/**
 * The Resume record (spec 3.4 "Resume pill", 4.2.3): what was open, per product, and when it was last
 * confirmed. Stored in localStorage under one key per product. NOT done in this package: the copy in the
 * server's scene memory (the spec names `workspaceMemory.ts`, which today is sessionStorage only); the pill
 * reads the local record alone until that lands.
 *
 * Two records per product (A.N02 d, the B05 review): `current` is the place on screen, kept confirmed while it
 * stays open (ShellV2 refreshes lastConfirmedAt on its one clock tick, at most once a minute, only while the
 * window is visible); `prev` is the place the student left to come here, with the time it was last confirmed.
 * The pill is a breadcrumb over `prev`: it names where the student was BEFORE the current place, never the
 * current place itself (before, it named the place you stood in and read "Here").
 *
 * Honesty rule: a record not confirmed within two planned block lengths reads "last seen ..." with Pick up
 * and Drop it, and never shows a running time. A fresh one shows the clock time it was left, which does not
 * tick. The block length is an assumption (50 min, the default block of the Focus workspace); two of them is
 * 100 min.
 */
import { clock } from '../lib/format'
import { homeOf, isAppPlace, placeLabel, sectionById, type ProductId } from './ids'

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
const prevKeyOf = (p: ProductId) => `shell.resume.prev.${p}`

export function readRecord(product: ProductId): ResumeRecord | null {
  return readAt(keyOf(product), product)
}

/** The place the student left to come to the current one, or null on a first run. */
export function readPrev(product: ProductId): ResumeRecord | null {
  return readAt(prevKeyOf(product), product)
}

/**
 * The record Resume names and goes to from `here`. The shell's own places (app.new) are never recorded, so on
 * one of them the current record IS the place the student came from; anywhere else it is the place before.
 * Without this, Alt+N then Alt+R skipped the place just left and went one further back.
 */
export function readResume(product: ProductId, here: { section: string }): ResumeRecord | null {
  return isAppPlace(here) ? readRecord(product) : readPrev(product)
}

export function writePrev(r: ResumeRecord): void {
  try {
    localStorage.setItem(prevKeyOf(r.product), JSON.stringify(r))
  } catch {
    /* storage blocked: the pill falls back to the first-run line */
  }
}

/** Drop it: forget the place before (the current record stays, it is where the student is). */
export function clearPrev(product: ProductId): void {
  try {
    localStorage.removeItem(prevKeyOf(product))
  } catch {
    /* nothing kept, nothing to clear */
  }
}

/** Confirm the open place, at most once a minute (the clock ticks every 15 s; four writes a minute buy nothing). */
export const CONFIRM_EVERY_MS = 60_000
export function confirmRecord(product: ProductId, section: string, view: string, now: number): boolean {
  const r = readRecord(product)
  if (!r || r.section !== section || r.view !== view || now - r.lastConfirmedAt < CONFIRM_EVERY_MS) return false
  writeRecord({ ...r, lastConfirmedAt: now })
  return true
}

function readAt(key: string, product: ProductId): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(key)
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
    localStorage.removeItem(prevKeyOf(product))
  } catch {
    /* nothing kept, nothing to clear */
  }
}

export type PillState =
  | { kind: 'start'; text: string }
  | { kind: 'open'; text: string }
  | { kind: 'stale'; text: string }

const placeText = (r: ResumeRecord) => placeLabel(r)

function ago(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return h < 48 ? 'yesterday' : `${Math.round(h / 24)} days ago`
}

/**
 * What the pill says about the place before (`prev`). With none it is navigation, worded as navigation: it goes
 * to the product's home and runs nothing there (A.N02 e; "Start: wake JARVIS" read as a promise to wake it).
 */
export function pillState(product: ProductId, prev: ResumeRecord | null, now: number): PillState {
  if (!prev) return { kind: 'start', text: `Go to ${placeLabel(homeOf(product))}` }
  const what = prev.object ? `${placeText(prev)}: ${prev.object}` : placeText(prev)
  if (now - prev.lastConfirmedAt > STALE_MS) return { kind: 'stale', text: `${prev.object ?? placeText(prev)}, last seen ${ago(now - prev.lastConfirmedAt)}` }
  return { kind: 'open', text: `${what}, left ${clock(prev.lastConfirmedAt / 1000).slice(0, 5)}` }
}

/** Where Pick up, the pill and Alt+R go: the place before, else the product's home. */
export function resumeTarget(product: ProductId, prev: ResumeRecord | null) {
  return prev ? { product, section: prev.section, view: prev.view } : homeOf(product)
}
