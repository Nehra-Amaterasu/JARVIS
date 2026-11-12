// The debt list of the jury bench: each entry is one component failing one rule, with the value measured the day it was
// listed. The suite is green while an entry fails and red when it stops failing (the debt is paid: delete the entry) or
// when anything not listed fails (a new regression). Never weaken an assertion in bench.spec.ts to empty this list.
export type Rule = 'edge' | 'focus' | 'hit' | 'tab' | 'motion' | 'churn' | 'idle-loop' | 'grey' | 'contrast' | 'edge-contrast' | 'reflow'
export interface Known {
  /** 'pkg/Name', as data-bench on the bench page. */
  component: string
  rule: Rule
  /** Omitted = both themes. */
  themes?: ('light' | 'dark')[]
  /** What was measured, and the rule it breaks. */
  measured: string
}
export const KNOWN: Known[] = []
