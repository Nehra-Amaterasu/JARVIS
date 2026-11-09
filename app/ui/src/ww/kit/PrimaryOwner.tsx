import { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

/**
 * Who may hold the one saffron fill (plan 3.3, "Rules for the primary"), most specific first:
 *   overlay    an open overlay that declares a primary
 *   workspace  the active workspace's declared primary, if its precondition holds
 *   now        otherwise the Start button in Now
 * A pinned side panel and an overlay marked "none, close only" declare nothing, so they never claim.
 * The lowest rank among the claims whose `when` is true wins; ties go to the claim registered first.
 */
export const PRIMARY_RANK = { overlay: 0, workspace: 1, now: 2 } as const
export type PrimaryRank = keyof typeof PRIMARY_RANK

interface Claim {
  rank: number
  seq: number
}
function createStore() {
  const claims = new Map<string, Claim>()
  const subs = new Set<() => void>()
  let seq = 0
  let granted: string | null = null
  // the owner before the last change: a hand-over is a change from one owner to another, not the first grant
  let previous: string | null = null
  const recompute = () => {
    let best: [string, Claim] | null = null
    for (const e of claims) if (!best || e[1].rank < best[1].rank || (e[1].rank === best[1].rank && e[1].seq < best[1].seq)) best = e
    const next = best ? best[0] : null
    if (next !== granted) {
      previous = granted
      granted = next
      subs.forEach((f) => f())
    }
  }
  return {
    set(id: string, rank: number) {
      claims.set(id, { rank, seq: claims.get(id)?.seq ?? seq++ })
      recompute()
    },
    drop(id: string) {
      claims.delete(id)
      recompute()
    },
    subscribe(f: () => void) {
      subs.add(f)
      return () => void subs.delete(f)
    },
    granted: () => granted,
    previous: () => previous,
  }
}
type Store = ReturnType<typeof createStore>
const Ctx = createContext<Store | null>(null)

/** Wrap a page, or an overlay, in one of these. All claims below it compete for a single fill. */
export function PrimaryOwner({ children }: { children: ReactNode }) {
  const store = useMemo(createStore, [])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

/** True when this claim holds the fill. Outside a PrimaryOwner (a lone demo) a claim always wins. */
export function usePrimaryClaim(id: string, rank: PrimaryRank, when = true): boolean {
  return useClaim(id, rank, when).granted
}

function useClaim(id: string, rank: PrimaryRank, when: boolean): { granted: boolean; handedOver: boolean } {
  const store = useContext(Ctx)
  const r = PRIMARY_RANK[rank]
  useLayoutEffect(() => {
    if (!store || !when) return
    store.set(id, r)
    return () => store.drop(id)
  }, [store, id, r, when])
  const granted = useSyncExternalStore(store ? store.subscribe : noSubscribe, store ? store.granted : alwaysNull, alwaysNull)
  const isMine = store ? granted === id : when
  return { granted: isMine, handedOver: isMine && !!store && store.previous() !== null }
}
const noSubscribe = () => () => {}
const alwaysNull = () => null

export interface PrimaryButtonProps extends Omit<ButtonProps, 'tone'> {
  /** A stable name for this claim, e.g. "now-start". */
  claimId: string
  rank: PrimaryRank
  /** The precondition; a false `when` withdraws the claim and the button is drawn quiet. */
  when?: boolean
}

/**
 * A button that takes the fill when it wins and is quiet otherwise, so "one saffron fill on screen"
 * is a property of the tree, not a convention. Only the winner carries `data-primary`. When the fill
 * moves to this button inside a workspace it pops once (the soft pop, 5.7.2 #2 expressive class).
 */
export function PrimaryButton({ claimId, rank, when = true, ...rest }: PrimaryButtonProps) {
  const { granted, handedOver } = useClaim(claimId, rank, when)
  const ref = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    // only a change from one owner to another pops; the first grant on mount does not
    if (granted && handedOver && ref.current) ref.current.setAttribute('data-cycle', 'pop')
  }, [granted, handedOver])
  return <Button ref={ref} {...rest} tone={granted ? 'primary' : 'quiet'} data-primary={granted ? 'true' : undefined} onAnimationEnd={(e) => e.currentTarget.removeAttribute('data-cycle')} />
}
