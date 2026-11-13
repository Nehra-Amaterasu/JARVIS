// The pure layout and wording functions of the Capture Line (A.D04).
import { describe, expect, it } from 'vitest'
import { CHIP_INPUT_MAX_CH, CHIP_INPUT_MIN_CH, HISTORY_MAX, caretView, chipInputCh, chipsOf, pushHistory, statusOf, stepHistory } from '../layout'
import { WW_HINT, parseJarvis, parseWw } from '../parse'

const NOW = new Date(2026, 10, 13, 10, 30)

describe('statusOf', () => {
  it('names the five states and shows the WAITING lamp only while a question waits', () => {
    const w = (t: string) => statusOf(parseWw(t, NOW), 'ww', [])
    expect(w('')).toMatchObject({ status: 'idle', word: 'IDLE', lamp: null, line: WW_HINT })
    expect(w('sp')).toMatchObject({ status: 'parsing', word: 'PARSING', lamp: null })
    expect(w('spent 120 chai')).toMatchObject({ status: 'ready', word: 'READY', lamp: null })
    expect(w('120')).toMatchObject({ status: 'ambiguous', word: 'AMBIGUOUS', lamp: 'waiting', line: '? what is 120' })
    expect(statusOf(parseJarvis('rm -rf'), 'jarvis', ['help'])).toMatchObject({ status: 'unknown', line: 'unknown verb; try help' })
  })
  it('only a question or an unknown verb is spoken as an alert', () => {
    expect(statusOf(parseWw('spent 120 chai', NOW), 'ww', []).alert).toBe('')
    expect(statusOf(parseWw('120', NOW), 'ww', []).alert).toContain('Nothing is logged until this is clear')
  })
  it('the idle line of the jarvis grammar lists its verbs', () => {
    expect(statusOf({ status: 'empty' }, 'jarvis', ['remember', 'help']).line).toBe('verbs: remember · help')
  })
  it('the ready line says log for ww and send for jarvis', () => {
    expect(statusOf(parseWw('water 250', NOW), 'ww', []).line).toMatch(/^Enter logs it/)
    expect(statusOf(parseJarvis('remember x'), 'jarvis', []).line).toMatch(/^Enter sends it/)
  })
})

describe('chipsOf', () => {
  it('gives the understood parts of an entry and of a question, and none for anything else', () => {
    expect(chipsOf(parseWw('spent 120 chai', NOW)).fields.map((f) => f.key)).toEqual(['verb', 'amount', 'label', 'date'])
    expect(chipsOf(parseWw('spent 120', NOW))).toMatchObject({ verb: 'spent' })
    expect(chipsOf(parseWw('120', NOW))).toEqual({ verb: null, fields: [] })
    expect(chipsOf({ status: 'empty' }).fields).toEqual([])
  })
})

describe('caretView', () => {
  it('clamps the caret to the text and hides the block over a selection', () => {
    expect(caretView(5, 3, 3)).toEqual({ col: 3, shown: true })
    expect(caretView(5, 9, 9)).toEqual({ col: 5, shown: true })
    expect(caretView(5, 1, 4)).toEqual({ col: 1, shown: false })
    expect(caretView(5, null, null)).toEqual({ col: 5, shown: true })
  })
})

describe('chipInputCh', () => {
  it('is the text plus two, never under 6 or over 28', () => {
    expect(chipInputCh('')).toBe(CHIP_INPUT_MIN_CH)
    expect(chipInputCh('abcdefgh')).toBe(10)
    expect(chipInputCh('x'.repeat(100))).toBe(CHIP_INPUT_MAX_CH)
  })
})

describe('history', () => {
  it('keeps at most HISTORY_MAX lines, skips blanks and an immediate repeat', () => {
    let h: string[] = []
    for (let i = 0; i < 20; i++) h = pushHistory(h, `water ${100 + i}`)
    expect(h.length).toBe(HISTORY_MAX)
    expect(h[h.length - 1]).toBe('water 119')
    expect(pushHistory(h, 'water 119')).toEqual(h)
    expect(pushHistory(h, '   ')).toEqual(h)
  })
  it('steps back and forward and returns to the typed line', () => {
    expect(stepHistory(0, -1, 'up')).toBe(-1)
    expect(stepHistory(3, -1, 'up')).toBe(2)
    expect(stepHistory(3, 2, 'up')).toBe(1)
    expect(stepHistory(3, 0, 'up')).toBe(0)
    expect(stepHistory(3, 1, 'down')).toBe(2)
    expect(stepHistory(3, 2, 'down')).toBe(-1)
    expect(stepHistory(3, -1, 'down')).toBe(-1)
  })
})
