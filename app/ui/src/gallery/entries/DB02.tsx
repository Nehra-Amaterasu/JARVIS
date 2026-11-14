// Package DB02: the Legend flip side. Each demo draws a small specimen and builds its legend from the SAME array, which is
// the point: the specimen and the legend cannot drift because they read one list.
import { Legend, type SpecimenEntry } from '../../shared/data/legend'
import type { GalleryEntryX } from '../types'

const merged = 'DB02, 14 Nov 2026'

const marks: SpecimenEntry[] = [
  { id: 'disc', name: 'tip disc', meaning: 'practised in the last 7 days', glyph: 'disc' },
  { id: 'ring', name: 'ring', meaning: 'not practised in the last 7 days', glyph: 'ring' },
  { id: 'dashed', name: 'dashed ring', meaning: 'never practised', glyph: 'dashed-ring' },
]

const week: SpecimenEntry[] = [
  { id: 'dots', name: 'dot field', meaning: 'one dot per answered question', glyph: 'dots' },
  { id: 'line', name: 'median line', meaning: 'your own median for the week', glyph: 'line' },
  { id: 'bar', name: 'bar', meaning: 'minutes studied that day', glyph: 'bar' },
  { id: 'hatch', name: 'hatch', meaning: 'past the plan you set', glyph: 'hatch' },
]

/** A tiny specimen drawn from the same entries: one swatch per entry, so the face visibly uses every mark in the legend. */
function Face({ entries, caption }: { entries: SpecimenEntry[]; caption: string }) {
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 10, justifyItems: 'start' }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '14px 18px', borderRadius: 12, background: 'var(--surface-sunk)', boxShadow: 'var(--elev-recessed)' }}>
        {entries.map((e, i) => (
          <svg key={e.id} width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={e.name} data-mark={e.glyph}>
            {e.glyph === 'disc' && <circle cx="22" cy="22" r={10 + i} fill="var(--ink-1)" />}
            {e.glyph === 'ring' && <circle cx="22" cy="22" r="10" fill="none" stroke="var(--ink-1)" strokeWidth="2" />}
            {e.glyph === 'dashed-ring' && <circle cx="22" cy="22" r="10" fill="none" stroke="var(--ink-1)" strokeWidth="2" strokeDasharray="3 3" />}
            {e.glyph === 'dots' && [12, 22, 32].flatMap((x) => [14, 30].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="2.4" fill="var(--ink-1)" />))}
            {e.glyph === 'line' && <path d="M5 32 15 18 25 26 39 10" fill="none" stroke="var(--ink-1)" strokeWidth="2" strokeLinecap="round" />}
            {e.glyph === 'bar' && <rect x="8" y="14" width="28" height="14" rx="3" fill="var(--ink-1)" />}
            {e.glyph === 'hatch' && <><rect x="8" y="10" width="28" height="24" rx="3" fill="none" stroke="var(--ink-1)" strokeWidth="2" /><path d="M14 34 24 10M22 34 32 10M8 26 16 10" stroke="var(--ink-1)" strokeWidth="2" /></>}
            {e.glyph === 'diamond' && <path d="M22 8 36 22 22 36 8 22Z" fill="var(--ink-1)" />}
          </svg>
        ))}
      </div>
      <figcaption style={{ font: '12px var(--font-mono, monospace)', color: 'var(--ink-2)' }}>{caption}</figcaption>
    </figure>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'data/Legend',
    title: 'Legend',
    group: 'data',
    merged,
    note: 'The flip side of a specimen. ? swaps the picture for a list of its marks, ? or Esc swaps back, at once with no flip. The list is built from the very entries the specimen is drawn from. Under reduced motion and forced colours the two stack as one static page.',
    states: [
      { label: 'the picture side (press ? or the key)', node: <Legend entries={marks} label="Practice marks"><Face entries={marks} caption="practice, last 7 days" /></Legend> },
      { label: 'the legend side, three marks', node: <Legend entries={marks} label="Practice marks" flipped><Face entries={marks} caption="practice, last 7 days" /></Legend> },
      { label: 'the legend side, four marks', node: <Legend entries={week} label="Week marks" flipped><Face entries={week} caption="the week" /></Legend> },
      { label: 'no marks yet (empty)', node: <Legend entries={[]} label="Empty" flipped><p>nothing drawn</p></Legend> },
    ],
  },
]

export default entries
