// The checks of spec 12.5 that look at rendered DOM (T1, T2, T3, T7, T8, T9). Each takes a root and a
// registry and returns the offending ids, so a unit test, a Playwright spec and a gate report can share it.
import { LOOP_VIEWS } from './homes'
import type { Registry } from './types'

const planned = (root: ParentNode) => root.querySelectorAll<HTMLElement>('[data-planned]')

/**
 * T1 (as built, kept): a feature that ships carries `data-feature="<id>"` on its live control. An entry whose
 * id is still registered while an enabled control with that id exists is stale and is deleted in the commit
 * that shipped the feature.
 */
export function staleEntries(root: ParentNode, reg: Registry): string[] {
  const out: string[] = []
  for (const p of reg.entries) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-feature="${CSS.escape(p.id)}"]`)) {
      const inert = el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true
      if (!inert && !el.closest('[data-planned]')) {
        out.push(p.id)
        break
      }
    }
  }
  return out
}

/**
 * T2: a registry id with no renderer. `rendered` is the set of view ids the page currently mounts (for a
 * whole-app check, every view the shell can show). An entry homed in a mounted view needs a
 * `data-planned="<id>"` element there, unless its pattern is `roadmap` (a row in the chip and the overlay).
 */
export function orphanEntries(root: ParentNode, reg: Registry, mountedViews: readonly string[]): string[] {
  const present = new Set([...planned(root)].map((el) => el.getAttribute('data-planned')))
  return reg.entries
    .filter((e) => e.pattern !== 'roadmap' && mountedViews.includes(e.home) && !present.has(e.id))
    .map((e) => e.id)
}

/** T3: a `data-planned` id on the page that has no entry (a renderer outliving its entry). */
export function orphanRenderers(root: ParentNode, reg: Registry): string[] {
  const out: string[] = []
  for (const el of planned(root)) {
    const id = el.getAttribute('data-planned') ?? ''
    if (!reg.byId(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/**
 * T7: a planned element holding something a person can press as if it worked. Every button, link or input
 * inside `[data-planned]` must be `aria-disabled="true"`; the one exception is the real first action of an
 * empty-state entry (pattern E), which the page supplies and which does something real.
 */
export function enabledPlannedControls(root: ParentNode): string[] {
  const out: string[] = []
  for (const box of planned(root)) {
    const id = box.getAttribute('data-planned') ?? ''
    const own = box.matches('button, a, input, select, textarea, [role="button"]') ? [box] : []
    const inside = [...box.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"]')]
    for (const el of [...own, ...inside]) {
      const isEmptyAction = box.getAttribute('data-pattern') === 'empty' && el !== box && !el.hasAttribute('data-planned-open')
      if (isEmptyAction) continue
      if (el.getAttribute('aria-disabled') !== 'true') out.push(id)
    }
  }
  return out
}

/**
 * T8: the four loop views render no plate or chip. `viewRoot` is the page root carrying `data-view`; a
 * view that is a loop view and holds a `data-planned` or `data-planned-chip` element is a violation.
 */
export function loopViewViolations(root: ParentNode): string[] {
  const out: string[] = []
  for (const view of root.querySelectorAll<HTMLElement>('[data-view]')) {
    const id = view.getAttribute('data-view') ?? ''
    if (LOOP_VIEWS.includes(id) && view.querySelector('[data-planned], [data-planned-chip]')) out.push(id)
  }
  return out
}

/**
 * T9: density. More than one `coming` or two `disabled` entries rendered at once in one view. A master-detail
 * list renders one plate at a time and so counts as one; extra entries on a crowded home use `roadmap`.
 * Returns the view ids over the limit.
 */
export function densityViolations(root: ParentNode, reg: Registry): string[] {
  const out: string[] = []
  for (const view of root.querySelectorAll<HTMLElement>('[data-view]')) {
    const id = view.getAttribute('data-view') ?? ''
    let coming = 0
    let disabled = 0
    for (const el of view.querySelectorAll<HTMLElement>('[data-planned]')) {
      const e = reg.byId(el.getAttribute('data-planned') ?? '')
      if (e?.pattern === 'coming') coming += 1
      else if (e?.pattern === 'disabled') disabled += 1
    }
    if (coming > 1 || disabled > 2) out.push(id)
  }
  return out
}
