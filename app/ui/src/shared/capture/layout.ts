// The pure layout and wording functions of the Capture Line, with their numbers named (A.D04). The component only
// puts these on screen; the tests pin them without a DOM.
import { WW_HINT, type Field, type ParseResult } from './parse'

/** The field row is 44 px (the hit size) and its text is 14 px mono; the block cursor is 0.6 em wide, 1.15 em tall. */
export const LINE_PX = 44
export const CURSOR_W_EM = 0.6
export const CURSOR_H_EM = 1.15
/** The text inset of the field, in px: the block is placed from it. */
export const FIELD_PAD_PX = 4
/** A chip is edited in an input this many characters wide: its text plus two, never under 6 or over 28. */
export const CHIP_INPUT_MIN_CH = 6
export const CHIP_INPUT_MAX_CH = 28
/** The Undo toast stays 6 s (the kit's NotchedToast, NOTCHED_TOAST_MS) and the line remembers this many past lines for the up arrow. */
export const UNDO_MS = 6000
export const HISTORY_MAX = 8

export type CaptureStatus = 'idle' | 'parsing' | 'ready' | 'ambiguous' | 'unknown'

export interface StatusPlan {
  status: CaptureStatus
  /** The word on the plate: what the line is doing. */
  word: string
  /** The WAITING lamp glyph shows only while a question waits for the person. */
  lamp: 'waiting' | null
  /** The line under the chips. */
  line: string
  /** The sentence a screen reader hears when the state needs the person (a question, an unknown verb); '' otherwise. */
  alert: string
}

export function statusOf(r: ParseResult, grammar: 'ww' | 'jarvis', verbs: readonly string[]): StatusPlan {
  switch (r.status) {
    case 'ok':
      return { status: 'ready', word: 'READY', lamp: null, line: `${grammar === 'ww' ? 'Enter logs it' : 'Enter sends it'}. Press a chip to change it.`, alert: '' }
    case 'ask':
      return { status: 'ambiguous', word: 'AMBIGUOUS', lamp: 'waiting', line: r.question, alert: `Question: ${r.question.replace(/^\? /, '')}. Nothing is logged until this is clear.` }
    case 'partial':
      return { status: 'parsing', word: 'PARSING', lamp: null, line: `… ${r.candidates.join(' · ')}`, alert: '' }
    case 'unknown':
      return { status: 'unknown', word: 'UNKNOWN', lamp: null, line: r.message, alert: r.message }
    default:
      return { status: 'idle', word: 'IDLE', lamp: null, line: grammar === 'ww' ? WW_HINT : `verbs: ${verbs.join(' · ')}`, alert: '' }
  }
}

/** The chips to draw: what was understood, in order, with the missing ones as hollow plates. */
export function chipsOf(r: ParseResult): { verb: string | null; fields: Field[] } {
  if (r.status === 'ok') return { verb: r.parsed.verb, fields: r.parsed.fields }
  if (r.status === 'ask') return { verb: r.verb, fields: r.fields }
  return { verb: null, fields: [] }
}

/** Where the block cursor sits: the caret column, or nowhere while a range is selected (the selection shows itself). */
export function caretView(len: number, start: number | null, end: number | null): { col: number; shown: boolean } {
  const a = start ?? len
  const b = end ?? a
  return { col: Math.max(0, Math.min(len, a)), shown: a === b }
}

export const chipInputCh = (value: string): number => Math.max(CHIP_INPUT_MIN_CH, Math.min(CHIP_INPUT_MAX_CH, value.length + 2))

/** Past lines, newest last, no repeats of the last one, at most HISTORY_MAX. */
export function pushHistory(h: readonly string[], line: string): string[] {
  const t = line.trim()
  if (!t || h[h.length - 1] === t) return [...h]
  return [...h, t].slice(-HISTORY_MAX)
}

/** Up arrow walks back through the history, down arrow walks forward; index -1 is the line being typed. */
export function stepHistory(len: number, index: number, dir: 'up' | 'down'): number {
  if (len === 0) return -1
  if (dir === 'up') return index === -1 ? len - 1 : Math.max(0, index - 1)
  return index === -1 || index >= len - 1 ? -1 : index + 1
}
