// The dock's Capture mode for the Day views under the v3 look (rule 4.14: the capture line moves into the dock). The grammar is the
// Capture Line's own (parseWw); a line that is not a whole sentence of it is not taken, so the dock keeps the text for a retry and a
// toast says what the line still needs. Nothing is saved here: the views decide what a parsed line does.
import { parseWw, WW_HINT, type Parsed } from '../../../shared/capture'
import type { DockMode } from '../../../shell/v3'

export const CAPTURE_MODE: DockMode = { id: 'capture', label: 'Capture', prefix: '>', example: WW_HINT, action: 'Add' }

/** Returns false when the line was not taken (the dock then keeps the text). */
export function takeLine(text: string, take: (p: Parsed) => void, say: (message: string) => void, now: Date = new Date()): boolean {
  const r = parseWw(text, now)
  if (r.status === 'ok') {
    take(r.parsed)
    return true
  }
  if (r.status === 'ask') say(r.question.replace(/^\?\s*/, ''))
  else if (r.status === 'unknown') say(r.message)
  else if (r.status === 'partial') say(`Not a whole line yet. ${WW_HINT}`)
  return false
}
