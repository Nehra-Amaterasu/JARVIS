/**
 * Which product a build ships (seam S2/S5 groundwork, docs/design/jarvis-product-overhaul.md 15.1).
 *
 *   VITE_PRODUCT=jarvis  JARVIS only: no ww/ or germoney/ module, no Well Wisher bridge
 *   VITE_PRODUCT=ww      Well Wisher only: no page, no three.js, no jarvis/ module
 *   unset                both, exactly as the app ships today
 *
 * Vite replaces import.meta.env.VITE_PRODUCT with a string literal at build time, so a test written
 * in place, `import.meta.env.VITE_PRODUCT !== 'ww'`, folds to a constant and the dead branch (with
 * its dynamic import()) is removed before chunking. Measured 12 Nov: the same test through an
 * exported constant (`HAS_WW`) did NOT fold, because Rollup does not propagate a constant across
 * modules, and the ww and jarvis builds came out identical to the full one. So gates are written in
 * place; scripts/bundle-budget.mjs proves the result from the emitted module list.
 */
export type Product = 'jarvis' | 'ww' | 'both'

/** For runtime reads that need no dead-code removal (a label, a log line). Gates use the inline form. */
export const PRODUCT: Product = import.meta.env.VITE_PRODUCT === 'jarvis' || import.meta.env.VITE_PRODUCT === 'ww' ? import.meta.env.VITE_PRODUCT : 'both'
