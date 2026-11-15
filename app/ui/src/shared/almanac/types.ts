// The Almanac's nouns (package L01, spec 20.6.1). One table says what every mark is: its word, where it is read from and the
// two shapes it takes (filled when done, hollow when planned). The table is the fixture of the tests, so a shape cannot be
// reused by two kinds and a kind cannot lose its words without a test saying so.
import type { LampState } from '../lamp'

/** The eight kinds of 20.6.1 plus `classroom` (the amendment of A.L01: deadlines and exam dates from the Classroom door). */
export const KINDS = ['study', 'class', 'body', 'water', 'spend', 'rest', 'intent', 'google', 'classroom'] as const
export type Kind = (typeof KINDS)[number]

/** Every drawn shape, by name. A name is a path in DayMark.tsx and a word in the tests. */
export const SHAPE_NAMES = [
  'disc', 'ring', 'square', 'square-outline', 'triangle', 'triangle-outline', 'drop', 'drop-outline', 'bar', 'bar-outline',
  'dash', 'diamond', 'diamond-dashed', 'notch', 'notch-outline', 'hexagon', 'hexagon-outline',
] as const
export type ShapeName = (typeof SHAPE_NAMES)[number]

export interface ShapeSpec {
  /** The name shown in the legend and read by assistive technology. */
  word: string
  /** The source the mark is read from, said in the legend. */
  source: string
  done: ShapeName
  planned: ShapeName
}

/** The kind table of 20.6.1, one row per kind. Rest is the one kind whose two forms are the same dash (the cell is inset). */
export const SHAPES: Record<Kind, ShapeSpec> = {
  study: { word: 'Study block', source: 'focus log', done: 'disc', planned: 'ring' },
  class: { word: 'Class', source: 'attendance taps', done: 'square', planned: 'square-outline' },
  body: { word: 'Body', source: 'gym log', done: 'triangle', planned: 'triangle-outline' },
  water: { word: 'Water goal', source: 'water counter', done: 'drop', planned: 'drop-outline' },
  spend: { word: 'Spend', source: 'spending log', done: 'bar', planned: 'bar-outline' },
  rest: { word: 'Rest day', source: 'set by you', done: 'dash', planned: 'dash' },
  intent: { word: 'Intent due', source: 'intent store', done: 'diamond', planned: 'diamond-dashed' },
  google: { word: 'From Google', source: 'calendar link', done: 'notch', planned: 'notch-outline' },
  classroom: { word: 'Classroom', source: 'deadlines and exam dates', done: 'hexagon', planned: 'hexagon-outline' },
}

export const shapeOf = (kind: Kind, done: boolean): ShapeName => (done ? SHAPES[kind].done : SHAPES[kind].planned)

/** One kind of thing on one day. `state` is the lamp of the source it was read from: a count is drawn only for LIVE or SIMULATED. */
export interface MarkData {
  kind: Kind
  done: boolean
  count: number
  state: LampState
}

/** One day as the Almanac draws it. `minutes` and `state` belong to the study log (the stipple strip). */
export interface DayData {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  marks: MarkData[]
  minutes: number | null
  state: LampState
  /** A rest day set by the student: an inset tile with the word "Rest". */
  rest?: boolean
}

/** An exam or deadline date; it is drawn as a planned Classroom mark with its label in the tooltip and the name. */
export interface Exam {
  date: string
  label: string
}

export type AlmanacMode = 'year' | 'month' | 'week' | 'day'

/** Why a cell has no figure, said in words (the lamp word of the day's source). */
export interface CellView {
  date: string
  marks: { kind: Kind; done: boolean; count: number | null; state: LampState }[]
  /** Dots of the stipple strip, 0 to 12, or null when the study log is not LIVE or SIMULATED (no strip at all). */
  dots: number | null
  /** More than 12 dots of minutes: the strip ends in a plus. */
  more: boolean
  rest: boolean
  /** The words read by assistive technology and shown in the tooltip. */
  text: string
}
