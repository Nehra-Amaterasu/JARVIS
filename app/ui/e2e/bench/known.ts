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
export const KNOWN: Known[] = [
  { component: 'kit/Button', rule: 'edge-contrast', measured: 'dark: edge 1.12:1 needs 3:1: button.ww-btn "Pay" (x1) | light: edge 1.23:1 needs 3:1: button.ww-btn "Pay" (x1)' },
  { component: 'kit/Drawer', rule: 'hit', measured: '408.0x41.0 px effective (box 407x40 plus probes l1 r0 t1 b0): input.ww-input "" (x1)' },
  { component: 'kit/Field', rule: 'edge-contrast', measured: 'dark: edge 1.12:1 needs 3:1: input.ww-input "" (x1) | light: edge 1.23:1 needs 3:1: input.ww-input "" (x1)' },
  { component: 'kit/Field', rule: 'focus', measured: 'outline none on focus: input.ww-input "" (x1)' },
  { component: 'kit/Field', rule: 'hit', measured: '186.0x41.0 px effective (box 185x40 plus probes l1 r0 t1 b0): input.ww-input "" (x7)' },
  { component: 'kit/Fold', rule: 'edge', measured: 'no border, outline or underline: button.ww-fold-btn "Closed fold" (x3)' },
  { component: 'kit/Fold', rule: 'edge-contrast', measured: 'edge 1.00:1 needs 3:1: button.ww-fold-btn "Closed fold" (x3)' },
  { component: 'kit/FolderTabs', rule: 'contrast', measured: 'dark: 3.67:1 needs 4.5:1 for "Soon" at 14.0px (button.k-tab) (x1) | light: 2.41:1 needs 4.5:1 for "Soon" at 14.0px (button.k-tab) (x1)' },
  { component: 'kit/IconButton', rule: 'hit', measured: '41.0x43.0 px effective (box 40x40 plus probes l1 r0 t2 b1): button.ww-btn "Search more" (x1)' },
  { component: 'kit/Knob', rule: 'edge-contrast', measured: 'dark: edge 1.05:1 needs 3:1: span[slider].k-knob "Volume" (x3) | light: edge 1.14:1 needs 3:1: span[slider].k-knob "Volume" (x3)' },
  { component: 'kit/MasterDetail', rule: 'hit', measured: '64.2x40.0 px effective (box 63x36 plus probes l1 r0 t4 b0): button.ww-btn "Item a" (x1)' },
  { component: 'kit/NotchedToastStack', rule: 'reflow', measured: '27 px past the 390 px viewport: div[status].k-toasts "Notifications" (x1)' },
  { component: 'kit/Plate', rule: 'edge-contrast', measured: 'dark: edge 1.15:1 needs 3:1: a.k-plate "LINK" (x1) | light: edge 1.09:1 needs 3:1: a.k-plate "LINK" (x1)' },
  { component: 'kit/Plate', rule: 'hit', measured: '59.0x24.0 px effective: a.k-plate "LINK" (x1)' },
  { component: 'kit/Rocker', rule: 'hit', measured: '13.9x45.0 px effective (box 13x44 plus probes l1 r0 t1 b0): button[radio].k-rocker-half "I ON" (x8)' },
  { component: 'kit/Switch', rule: 'contrast', measured: 'dark: 3.67:1 needs 4.5:1 for "OFF" at 12.0px (span.k-switch-word) (x2) | light: 2.41:1 needs 4.5:1 for "OFF" at 12.0px (span.k-switch-word) (x2)' },
  { component: 'kit/Switch', rule: 'edge-contrast', measured: 'dark: edge 1.50:1 needs 3:1: button[switch].k-switch "OFFPump" (x1) | light: edge 1.41:1 needs 3:1: button[switch].k-switch "OFFPump" (x1)' },
  { component: 'kit/Switch', rule: 'hit', measured: '57.0x41.0 px effective (box 56x32 plus probes l1 r0 t5 b4): button[switch].k-switch "ONRelay" (x1)' },
]
