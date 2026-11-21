/**
 * The contract the section layout passes build against (README.md in this folder says it in prose). Everything a view
 * hands to the v3 chrome goes through ONE registration, `useViewChrome(spec)` or `<ViewChrome {...spec} />`:
 *
 *   - the dock: the view's own modes and its one input (the capture line or command line a view owns today moves into
 *     the dock, rule 4.14);
 *   - More: the rare actions of the view (rule 4.7), listed under "RARELY NEEDED".
 *
 * A view that registers nothing still gets a dock (the Ask mode alone) and a More with the shell's own two rows.
 * The registration is removed when the view unmounts, so a place change never leaves the last view's modes behind.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface DockMode {
  /** Stable id of the mode, kept per view (`say`, `capture`, `command`). */
  id: string
  /** The key's word. It must not repeat a view's name on the same screen: Core's view is Talk, so its mode is Type. */
  label: string
  /** The prompt glyphs before the input, mono (`you>`, `>`, `jrv>`). */
  prefix: string
  /** The dimmed example in the input, WITHOUT the "e.g." (the dock adds it, so an example never reads as typed text). */
  example: string
  /** The submit key's word (`Send`, `Add`, `Run`). */
  action: string
}

export interface DockSpec {
  /** The view's own modes, usually one. The Ask mode is always added by the dock, last. */
  modes: readonly DockMode[]
  /**
   * Called on Enter or the submit key in one of the view's own modes. Ask is the shell's (it opens the palette).
   * Return `false` (or a promise that resolves to `false`, or throw) when the line was not taken: the dock then keeps the
   * person's text so they can retry. Returning nothing, or `true`, clears the input.
   */
  onSubmit?: (mode: string, text: string) => boolean | void | Promise<boolean | void>
}

export interface MoreAction {
  id: string
  label: string
  onSelect: () => void
}

export interface ViewChromeSpec {
  dock?: DockSpec
  /** Rare actions (used less than about once a week), in the order shown. Never place these loose in a tray. */
  more?: readonly MoreAction[]
}

interface Registry {
  set: (spec: ViewChromeSpec) => () => void
}

const NOOP: Registry = { set: () => () => undefined }
const RegisterCtx = createContext<Registry>(NOOP)
const SpecCtx = createContext<ViewChromeSpec | null>(null)

/** The shell mounts this once around the stage; views never do. */
export function ChromeProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ViewChromeSpec | null>(null)
  const registry = useMemo<Registry>(
    () => ({
      set: (s) => {
        setSpec(s)
        return () => setSpec((cur) => (cur === s ? null : cur))
      },
    }),
    [],
  )
  return (
    <RegisterCtx.Provider value={registry}>
      <SpecCtx.Provider value={spec}>{children}</SpecCtx.Provider>
    </RegisterCtx.Provider>
  )
}

/** What the dock and More read. Shell only. */
export const useChromeSpec = (): ViewChromeSpec | null => useContext(SpecCtx)

/**
 * A view registers its dock and its rare actions. Memoise the spec (useMemo or a module constant): the registration is
 * re-made only when its identity changes. Outside the v3 shell this does nothing, so a view can call it unconditionally.
 */
export function useViewChrome(spec: ViewChromeSpec | null): void {
  const reg = useContext(RegisterCtx)
  useEffect(() => (spec ? reg.set(spec) : undefined), [reg, spec])
}

/** The same as a component, for a view that would rather render it: `<ViewChrome dock={DOCK} more={MORE} />`. */
export function ViewChrome(spec: ViewChromeSpec): null {
  const memo = useMemo(() => spec, [spec.dock, spec.more]) // eslint-disable-line react-hooks/exhaustive-deps
  useViewChrome(memo)
  return null
}

/* ------------------------------------------------------------------ trays */
export type StepNumber = 1 | 2 | 3

/** The three named ratios (design-language-v3.md 4.1 rule 1). A view may also pass its own three numbers. */
export const ZONE_RATIOS = {
  default: [1.85, 1.05, 0.95],
  core: [1.85, 1.05, 0.8],
  console: [1.6, 1.15, 1],
} as const
export type ZoneRatioName = keyof typeof ZONE_RATIOS
export type ZoneRatio = ZoneRatioName | readonly [number, number, number]

export function ratioOf(r: ZoneRatio | undefined): readonly [number, number, number] {
  if (!r) return ZONE_RATIOS.default
  return typeof r === 'string' ? ZONE_RATIOS[r] : r
}

/** What a view says about one tray. `job` is the verb of the tray in caps (WAKE, CONVERSATION, VOICE PATH); the numeral is added. */
export interface TraySpec {
  job: string
  /** A state chip or a real datum at the head's right edge (a date). A chip is the kit's Chip, never plain text. */
  chip?: ReactNode
  /** Draw the ruler under the head. Default: only the first tray (rule 3). Set false to leave it out. */
  ruler?: boolean
  /** Phone only: what the second and third tray's pill under the accent key says. Led by a state, not by a count of empty slots. */
  peek?: { name?: string; lamp?: 'live' | 'waiting' | 'simulated' | 'planned' | 'fault'; note?: string }
  /** The first tray glare brightens for 1.3 s each time this number rises above 0 (a wake, a block start, a cleared fault). */
  flare?: number
  /** The tray's own accessible name when `job` alone is not enough. */
  label?: string
  className?: string
  children: ReactNode
}
