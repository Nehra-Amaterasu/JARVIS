/**
 * Globbed chrome slots (15.6 rule 2, A.N02 g). A package adds `shell/slots/<slot>.<name>.tsx` with a default
 * export (a component with no props), and the shell renders every file of that slot in path order. Nothing is
 * registered today; G04 (wave 9) adds the boot sequence, the title-bar sigil and the cursor root. An empty slot
 * renders nothing at all, so the shell looks exactly as before until a file lands.
 *
 *   boot            once, at the root, above the canvas (a one-shot boot sequence; calm shows all rows)
 *   titlebar-sigil  in the title bar, after the wordmark (decorative, aria-hidden by its author)
 *   cursor-root     at the root, for a cursor layer
 *   notify          beside the toasts
 */
import type { ComponentType } from 'react'

export type SlotName = 'boot' | 'titlebar-sigil' | 'cursor-root' | 'notify'
export const SLOT_NAMES: readonly SlotName[] = ['boot', 'titlebar-sigil', 'cursor-root', 'notify']

export interface CollectedSlots {
  bySlot: Readonly<Record<SlotName, readonly { path: string; Component: ComponentType }[]>>
  errors: readonly string[]
}

/** Index the modules of `<slot>.<name>.tsx` by slot; a file with an unknown slot or no default component is refused. */
export function collectSlots(modules: Record<string, unknown>): CollectedSlots {
  const bySlot = Object.fromEntries(SLOT_NAMES.map((s) => [s, [] as { path: string; Component: ComponentType }[]])) as Record<SlotName, { path: string; Component: ComponentType }[]>
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = /(?:^|\/)([a-z-]+)\.[a-z0-9-]+\.tsx$/.exec(path)
    const slot = m?.[1] as SlotName | undefined
    if (!slot || !SLOT_NAMES.includes(slot)) {
      errors.push(`${path}: not a slot file (<${SLOT_NAMES.join('|')}>.<name>.tsx)`)
      continue
    }
    const C = (modules[path] as { default?: unknown } | undefined)?.default
    if (typeof C !== 'function' && !(C && typeof C === 'object')) {
      errors.push(`${path}: no default component`)
      continue
    }
    bySlot[slot].push({ path, Component: C as ComponentType })
  }
  return { bySlot, errors }
}

export const SLOTS: CollectedSlots = collectSlots(import.meta.glob('./{boot,titlebar-sigil,cursor-root,notify}.*.tsx', { eager: true }))

/** Render every component of one slot; an empty slot renders nothing (no wrapper element). */
export function Slot({ name, from = SLOTS }: { name: SlotName; from?: CollectedSlots }) {
  const list = from.bySlot[name]
  if (!list.length) return null
  return <>{list.map(({ path, Component }) => <Component key={path} />)}</>
}
