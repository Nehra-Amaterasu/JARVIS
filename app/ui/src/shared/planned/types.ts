// The planned-feature record (spec 12.3). One shape for both products, so a page, the "What is coming"
// overlay and the tests read the same sentence. The lamp state of every entry is fixed at PLANNED and is
// deliberately not a field: a placeholder has no state to report.

/** E empty with a real first action, D disabled with a reason, C coming (dashed plate), R roadmap row only. */
export type Pattern = 'empty' | 'disabled' | 'coming' | 'roadmap'

/** Why it is not built; drives the overlay's group order (build first, account last, as the owner acts on them). */
export type Blocker = 'build' | 'hardware' | 'data' | 'decision' | 'licence' | 'account'

export type Product = 'jarvis' | 'ww'
export type Owner = 'ww-chat' | 'ui-chat' | 'aankhen-chat' | 'owner'

export interface PlannedEntry {
  /** The existing 28 keep their bare ids; every new id is '<product>.<slug>'. */
  id: string
  product: Product
  /** A view id of spec 3.2 (for example 'study.library'), or 'phone'. */
  home: string
  /** Sub-position inside the view, for example 'header-chip' or 'foot'. */
  slot?: string
  /** 2 to 6 words. */
  label: string
  pattern: Pattern
  /** 15 to 140 characters: what is missing and why. No count, no date. */
  line: string
  /** One line naming what already works instead (15 to 100 characters). */
  works_today?: string
  /** The precondition, shown on the overlay row. */
  needs: string
  blocker: Blocker
  /** Pattern E only: the label of the real first action the page supplies. */
  action?: string
  /** Only an owner-approved phrase such as 'needs a decision'; never a date. */
  when?: string
  /** 'YYYY-MM-DD' the entry was added. */
  since: string
  /** 'YYYY-MM-DD'; target since + 90 days. Drives a gate-report line, never a failing test (a calendar must not break unrelated work). */
  reviewBy: string
  owner: Owner
  /** Legacy plan chunk; Well Wisher entries only. */
  chunk?: string
  /** Legacy plan item number (7 to 19); Well Wisher entries only. */
  planItem?: number
  /** The row works; the entry holds only its blocked-state line (as built before the overhaul). */
  built?: boolean
  /**
   * Code exists but no check has shown its backend answers (spec 12.4, D20): the lamp is WAITING
   * "built, not verified", never PLANNED. The renderer draws the half disc, and T7 still forbids an enabled button.
   */
  state?: 'unverified'
}

export interface Registry<E extends PlannedEntry = PlannedEntry> {
  /** Live reference, not a copy: a test that pushes a synthetic entry sees it through every method. */
  readonly entries: readonly E[]
  byId(id: string): E | undefined
  /** Entries whose home is this view id, in registry order. */
  forHome(home: string): E[]
}
