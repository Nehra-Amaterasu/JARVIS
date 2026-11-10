/**
 * The overlay registry (plan 3.1 O1 to O8, 5.5): one place that knows every overlay and opens exactly
 * one at a time ("never more than one overlay deep", 5.7.4 #7). A page calls `openOverlay('add')` and
 * does not import the overlay; the overlay's chunk calls `registerOverlay('add', Component)` and the
 * stub in OverlayHost is replaced without a page changing.
 *
 * No JSX here: the store and the table are testable without a DOM, and OverlayHost.tsx draws them.
 */
import { create } from 'zustand'
import type { ComponentType } from 'react'

export const OVERLAYS = [
  { id: 'date', n: 'O1', title: 'Date sheet', chunk: 12 },
  { id: 'phone', n: 'O2', title: 'Phone', chunk: 12 },
  { id: 'reader', n: 'O3', title: 'Reader', chunk: 7 },
  { id: 'record', n: 'O4', title: 'Record', chunk: 9 }, // built: ww/overlays/Record.tsx registers over this stub
  { id: 'roadmap', n: 'O5', title: 'Roadmap', chunk: 5 },
  { id: 'log', n: 'O6', title: 'Log minutes', chunk: 12 },
  { id: 'confirm', n: 'O7', title: 'Confirm', chunk: 12 },
  { id: 'add', n: 'O8', title: 'Add questions', chunk: 7 },
] as const

export type OverlayId = (typeof OVERLAYS)[number]['id']
export type OverlayProps = Record<string, unknown>

export const overlayDef = (id: OverlayId) => OVERLAYS.find((o) => o.id === id)!
export const isOverlayId = (id: unknown): id is OverlayId => OVERLAYS.some((o) => o.id === id)

interface OverlayState {
  open: OverlayId | null
  props: OverlayProps
}
export const useOverlay = create<OverlayState>(() => ({ open: null, props: {} }))

const registered = new Map<OverlayId, ComponentType<OverlayProps>>()

/** A chunk replaces a stub by registering the real overlay. Returns the undo (tests). */
export function registerOverlay(id: OverlayId, component: ComponentType<OverlayProps>): () => void {
  registered.set(id, component)
  return () => void registered.delete(id)
}
export const registeredOverlay = (id: OverlayId): ComponentType<OverlayProps> | undefined => registered.get(id)

/**
 * Open an overlay. A second call while one is open REPLACES it (one deep, never a stack), so Esc
 * has one overlay to close. An unknown id returns false and opens nothing.
 */
export function openOverlay(id: OverlayId, props: OverlayProps = {}): boolean {
  if (!isOverlayId(id)) return false
  useOverlay.setState({ open: id, props })
  return true
}

export function closeOverlay(): void {
  if (useOverlay.getState().open !== null) useOverlay.setState({ open: null })
}
