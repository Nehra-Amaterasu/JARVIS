// X03 on the gallery: the practice-paper maker (Blueprint, Slots, Print), its parts and the printed sheets, every state on INVENTED blueprints
// and questions (the states live in ww/study/generator/gallery.tsx). That file is loaded lazily, only where the build holds Well Wisher (the
// same product gate as shell/views/core.view.ts and gallery/entries/L04.tsx), so a JARVIS only build carries none of it. The fixtures are
// templates, never a real paper; every reading drawn from them is stamped SIMULATED, and the null adapter's own empty state (WAITING) is shown
// beside them. Nothing here reads a route.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

const LABELS = [
  'Blueprint step, balanced (SIMULATED)',
  'Blueprint step, unbalanced: the lamp shows FAULT with the reason and drawing is refused',
  'Blueprint step, null adapter (WAITING: no blueprint yet)',
  'Blueprint step, inferred by a rule (RULE, not saved)',
  'Blueprint step, seven sections in 48 px rows',
  'Slots step, drawn from seed 48271 with one hollow slot',
  'Slots step with a dashed MODEL slot',
  'Print step, the paper (preview of page 1)',
  'Print step, the answer key',
  'Print step, the marking sheet',
  'BlueprintTable, balanced',
  'BlueprintTable, unbalanced (FAULT)',
  'SlotStrip: HAND, RULE, TEMPLATE, MODEL, hollow',
  'Paper skeleton at 0.42',
  'Printed paper at A4, page 1 (black on white, SIMULATED stamp)',
  'Printed paper, key and marking sheet in order',
]

const State: ComponentType<{ index: number }> | null = import.meta.env.VITE_PRODUCT !== 'jarvis'
  ? lazy(() => import('../../ww/study/generator/gallery').then((m) => ({ default: m.X03State })))
  : null

const node = (index: number) => (State
  ? <Suspense fallback={<p role="status">Loading the Well Wisher state…</p>}><State index={index} /></Suspense>
  : <p>Well Wisher is not in this build.</p>)

const list: GalleryEntryX[] = [{
  id: 'X03',
  title: 'Blueprint, slots and print',
  group: 'data',
  states: LABELS.map((label, i) => ({ label, node: node(i) })),
  note: 'The generator screens on invented blueprints and questions. The student confirms a blueprint, sees its issues before anything is drawn, draws a seeded paper whose slots name their source (hollow ones stay hollow), and prints the paper, its key and its marking sheet. Nothing here is read from a file: every reading is SIMULATED, and the null adapter answers WAITING with a reason.',
  also: ['BlueprintTable', 'SlotStrip', 'PaperSkeleton', 'PrintSheet', 'PrintFrame', 'GeneratorDesk', 'Stepper', 'SourceChip'],
  merged: 'X03, 15 Nov 2026',
}]

export default list
