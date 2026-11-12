/**
 * The ONE binding table (spec 3.4 "Keys"). The key handler (useShellKeys) and every hint the palette or the
 * shortcuts sheet shows read this table, so a hint can never name a key that does nothing. That fixes
 * today's false "Ctrl 7..21" hints (Strand 0, 1.1): the old palette printed `Ctrl ${i + 1}` for 21 tabs while
 * the handler only knew Ctrl 1-6.
 *
 * Only keys this package actually handles are listed. Ctrl+, (settings sheet), Alt+L (events overlay) and
 * Ctrl+Shift+Space (push to talk) belong to later packages and are absent until their action exists.
 */
import { sectionsOf, type ProductId } from './ids'

export interface Combo {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export type ShellAction =
  | { kind: 'slot'; n: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'swap-product' }
  | { kind: 'resume' }
  | { kind: 'view-step'; delta: -1 | 1 }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
  | { kind: 'back' }
  | { kind: 'place'; id: 'app.new' }

export interface Binding {
  id: string
  group: 'Go' | 'Views' | 'Shell'
  label: string
  combos: readonly Combo[]
  action: ShellAction
  /** Single keys are focus-scoped (Strand 6): never fire inside a text field. */
  notInText?: boolean
}

const SLOTS = [1, 2, 3, 4, 5] as const

export const BINDINGS: readonly Binding[] = [
  // Ctrl+n is the key; Alt+n is the alias (3.4). Ctrl+0 is NOT used: it resets browser zoom (decision I1).
  ...SLOTS.map((n): Binding => ({
    id: `slot.${n}`,
    group: 'Go',
    label: `Section ${n}`,
    combos: [{ key: String(n), ctrl: true }, { key: String(n), alt: true }],
    action: { kind: 'slot', n },
  })),
  { id: 'product.swap', group: 'Go', label: 'Swap product', combos: [{ key: '0', alt: true }], action: { kind: 'swap-product' } },
  { id: 'resume', group: 'Go', label: 'Resume', combos: [{ key: 'r', alt: true }], action: { kind: 'resume' } },
  { id: 'view.prev', group: 'Views', label: 'Previous view', combos: [{ key: '[' }], action: { kind: 'view-step', delta: -1 }, notInText: true },
  { id: 'view.next', group: 'Views', label: 'Next view', combos: [{ key: ']' }], action: { kind: 'view-step', delta: 1 }, notInText: true },
  // A.N02 (g): "What is new", the gallery place of wave 5; Alt+N is free in the frame and in every legacy page
  { id: 'app.new', group: 'Go', label: 'What is new', combos: [{ key: 'n', alt: true }], action: { kind: 'place', id: 'app.new' } },
  { id: 'back', group: 'Views', label: 'Back one view', combos: [{ key: 'ArrowLeft', alt: true }], action: { kind: 'back' } },
  { id: 'palette', group: 'Shell', label: 'Command palette', combos: [{ key: 'k', ctrl: true }], action: { kind: 'palette' } },
  { id: 'shortcuts', group: 'Shell', label: 'Shortcuts', combos: [{ key: '?', shift: true }], action: { kind: 'shortcuts' }, notInText: true },
]

/** The words a hint shows for one combo, e.g. "Ctrl 1", "Alt 0", "]". */
export function comboText(c: Combo): string {
  const key = c.key === 'ArrowLeft' ? 'Left' : c.key.length === 1 ? c.key.toUpperCase() : c.key
  return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && c.key.length !== 1 && 'Shift', key].filter(Boolean).join(' ')
}

export function bindingById(id: string): Binding | undefined {
  return BINDINGS.find((b) => b.id === id)
}

/** The hint for a binding: its first combo. Undefined when there is no binding, so no hint is shown. */
export function hintFor(id: string): string | undefined {
  const b = bindingById(id)
  return b ? comboText(b.combos[0]) : undefined
}

/** The binding id that opens the section at this rail position, for a product. */
export function slotBindingOf(product: ProductId, section: string): string | undefined {
  const i = sectionsOf(product).findIndex((s) => s.id === section)
  return i >= 0 && i < SLOTS.length ? `slot.${i + 1}` : undefined
}

/** The section a slot opens for a product: the rail order IS the key order. */
export function sectionForSlot(product: ProductId, n: number): string | undefined {
  return sectionsOf(product)[n - 1]?.id
}

interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

function keyOf(e: KeyLike): string {
  // Alt+digit gives odd e.key values on some layouts; the physical code is the stable part.
  const m = e.code ? /^(?:Digit|Numpad)([0-9])$/.exec(e.code) : null
  if (m && (e.altKey || e.ctrlKey)) return m[1]
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

function matches(c: Combo, e: KeyLike): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  if (!!c.ctrl !== ctrl || !!c.alt !== e.altKey) return false
  // Shift is part of the character for '?' and '[': only a named key compares it.
  if (c.key.length !== 1 && !!c.shift !== e.shiftKey) return false
  if (c.key.length === 1 && c.key === c.key.toLowerCase() && /[a-z0-9]/.test(c.key) && e.shiftKey) return false
  return keyOf(e) === c.key.toLowerCase()
}

/** The binding a key event triggers, or null. `inText` is true when focus is in an editable field. */
export function matchBinding(e: KeyLike, inText: boolean): Binding | null {
  for (const b of BINDINGS) {
    if (b.notInText && inText) continue
    if (b.combos.some((c) => matches(c, e))) return b
  }
  return null
}

export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}
