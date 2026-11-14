// What D02 added in wave 6: the series forms of spec 20.5.2. Every sample here is a seeded FIXTURE (nothing is read from
// the app), so the first state of each entry is SIMULATED; the LIVE state shows the same component on a fixed clock so
// the reader can see the live ink, and the hollow states show what WAITING, FAULT and PLANNED draw instead of a number.
import type { ReactElement } from 'react'
import { mulberry32 } from '../../shared/grammar'
import { DotHistogram, SkyLedger, Trace, type SkyDay } from '../../shared/data/series'
import { NOW } from '../fixtures'
import type { GalleryEntryX } from '../types'

const merged = 'D02, 13 Nov 2026'
const DAY = 86_400_000

/** 45 days of study minutes ending on the fixture clock: a slow rise, a three-day hole (null) and one day with no row. */
function studyMinutes() {
  const rnd = mulberry32(2026_11_13)
  const out: { t: number; v: number | null }[] = []
  for (let k = 44; k >= 0; k--) {
    if (k === 30) continue // no row at all for this day: the trace breaks and hatches it
    const base = 34 + (44 - k) * 0.45 + Math.sin(k / 3) * 7
    const v = k >= 17 && k <= 19 ? null : Math.round(base + (rnd() - 0.5) * 16)
    out.push({ t: NOW - k * DAY, v })
  }
  return out
}
const TRACE_PTS = studyMinutes()
const TRACE_MEDIAN = 41

/** Study block lengths in minutes (48 blocks) and a long log of 640 water entries in ml for the multiplier. */
function blocks(n: number, mean: number, spread: number, seed: number) {
  const rnd = mulberry32(seed)
  return Array.from({ length: n }, () => Math.max(5, Math.round(mean + (rnd() + rnd() + rnd() - 1.5) * spread)))
}
const BLOCKS = blocks(48, 32, 26, 7)
const WATER = blocks(640, 260, 160, 11)

/** 90 days ending 13 Nov 2026: kept days carry one of three neutral habits, every seventh day or so is a rest day. */
function skyDays(): SkyDay[] {
  const rnd = mulberry32(42)
  const habits = ['physics', 'gym', 'water']
  const out: SkyDay[] = []
  for (let k = 89; k >= 0; k--) {
    const d = new Date(Date.UTC(2026, 10, 13) - k * DAY)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const r = rnd()
    if (k % 7 === 3) out.push({ date, kind: 'rest' })
    else if (r < 0.68 + (89 - k) * 0.002) out.push({ date, kind: 'kept', habit: habits[Math.floor(rnd() * 3)] })
    // otherwise no row: the day stays a faint point in its place
  }
  return out
}
const SKY = skyDays()
const TODAY = '2026-11-13'

const wrap = (node: ReactElement) => <div style={{ inlineSize: '100%', minInlineSize: 0 }}>{node}</div>

const entries: GalleryEntryX[] = [
  {
    id: 'data/Trace',
    title: 'Trace',
    group: 'data',
    merged,
    note: 'The time-series instrument: gaps hatched and never filled in, an ASCII ruler, your own median as a dashed datum. Hover or use the arrow keys to scrub; Enter pins a point to compare two days.',
    states: [
      { label: 'SIMULATED: seeded sample', node: wrap(<Trace points={TRACE_PTS} median={TRACE_MEDIAN} state="simulated" label="Study minutes" unit="min" />) },
      { label: 'LIVE ink, fixture clock', node: wrap(<Trace points={TRACE_PTS} median={TRACE_MEDIAN} state="live" label="Study minutes" unit="min" />) },
      { label: 'WAITING: hollow', node: wrap(<Trace points={[]} state="waiting" label="Study minutes" unit="min" />) },
      { label: 'FAULT: hollow, says why', node: wrap(<Trace points={TRACE_PTS} state="fault" label="Study minutes" unit="min" reason="the focus log could not be read" />) },
      { label: 'PLANNED: dashed', node: wrap(<Trace points={[]} state="planned" label="Signal amplitude" />) },
    ],
  },
  {
    id: 'data/DotHistogram',
    title: 'DotHistogram',
    group: 'data',
    merged,
    note: 'One lit dot per observation in a dot-matrix of sockets; past 200 dots one dot stands for several and says so. Median tick and the middle half bracketed. Left and Right move across the bins; Ridge flips the form.',
    states: [
      { label: 'SIMULATED: 48 blocks', node: wrap(<DotHistogram values={BLOCKS} state="simulated" label="Study block length" unit="min" noun="blocks" />) },
      { label: 'LIVE ink, 640 entries, one dot = 5', node: wrap(<DotHistogram values={WATER} bins={10} state="live" label="Water per entry" unit="ml" noun="entries" />) },
      { label: 'WAITING: empty sockets', node: wrap(<DotHistogram values={[]} state="waiting" label="Study block length" unit="min" noun="blocks" />) },
    ],
  },
  {
    id: 'data/SkyLedger',
    title: 'SkyLedger',
    group: 'data',
    merged,
    note: 'The last 60 or 90 days as a calm field: a star for a kept day, a crescent for a rest day, a faint point for an untouched one. The headline is one slow ratio over the window; kept days of one habit form a figure.',
    states: [
      { label: 'SIMULATED: 60 days', node: wrap(<SkyLedger days={SKY} window={60} today={TODAY} state="simulated" label="Days kept" />) },
      { label: 'LIVE ink, 90 days', node: wrap(<SkyLedger days={SKY} window={90} today={TODAY} state="live" label="Days kept" />) },
      { label: 'WAITING: sixty faint points', node: wrap(<SkyLedger days={[]} window={60} today={TODAY} state="waiting" label="Days kept" />) },
    ],
  },
]

export default entries
