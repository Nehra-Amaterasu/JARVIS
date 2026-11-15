/**
 * Invented questions for the gallery and the tests. Nothing here is a real paper, a real course or a real student's work: the
 * subjects are generic (a resistor, a crystal, a word list), and every screen drawn from them is stamped SIMULATED. No result
 * here is an exam result.
 */
import type { Attempt, DrillQuestion, DrillSet, FocusPort, PickItem } from './ports'

export const FIX_QUESTIONS: DrillQuestion[] = [
  {
    id: 'fx-1', topic: 'Circuits', kind: 'numeric', unit: 'mA',
    stem: 'A 4.7 kOhm resistor sits across a 9 V supply. What current flows through it, in mA?',
    key: '1.91 mA', keyNumber: 1.915, tolerance: 0.01,
    working: ['I = V / R', 'I = 9 V / 4700 Ohm', 'I = 0.001915 A = 1.915 mA'],
    hints: ['Ohm\'s law relates the three quantities.', 'Divide the supply by the resistance, then change amperes to milliamperes.'],
  },
  {
    id: 'fx-2', topic: 'Signals', kind: 'numeric', unit: 'Hz',
    stem: 'A sine wave has a period of 2.5 ms. What is its frequency in Hz?',
    key: '400 Hz', keyNumber: 400,
    working: ['f = 1 / T', 'f = 1 / 0.0025 s = 400 Hz'],
    hints: ['Frequency and period are reciprocals.', 'Convert the period to seconds first.'],
  },
  {
    id: 'fx-3', topic: 'Vocabulary', kind: 'recall',
    stem: 'What does the word "Schaltung" name?',
    key: 'A circuit, the way the parts are connected.',
    hints: ['Starts with "A ", 42 characters in all.'],
  },
  {
    id: 'fx-4', topic: 'Circuits', kind: 'written',
    stem: 'State why a pull-up resistor is placed on an input that a switch grounds.',
    key: 'It holds the input at a defined high level while the switch is open.',
    rubric: ['names a defined or known level', 'says what happens with the switch open', 'says it is a resistor to the supply'],
    hints: ['Think about what the input sees when the switch is open.', 'Without it the input floats.'],
  },
  {
    id: 'fx-5', topic: 'Signals', kind: 'numeric', unit: 'V',
    stem: 'Two equal resistors divide a 12 V supply. What is the voltage across one of them, in V?',
    key: '6 V', keyNumber: 6,
    working: ['Equal resistors share the supply equally', 'V = 12 V / 2 = 6 V'],
    hints: ['Equal parts take equal shares.', 'Half of the supply.'],
  },
  {
    id: 'fx-6', topic: 'Vocabulary', kind: 'recall',
    stem: 'What does the word "Widerstand" name?',
    key: 'A resistor, or resistance.',
    hints: ['Starts with "A ", 25 characters in all.'],
  },
]

export const FIX_SET: DrillSet = { title: 'Practice set', state: 'simulated', reason: 'invented questions', questions: FIX_QUESTIONS }

export const FIX_PICK: PickItem = {
  id: 'fx-pick', title: 'Redo the circuits questions you missed', reason: 'your lowest first-try share, invented for the gallery', state: 'simulated',
  terms: [{ name: 'weak', value: 0.42 }, { name: 'due', value: 1 }, { name: 'recent', value: 0.3 }],
}

/** A port on the fixture: records what it was given so a test can read it back; Parking keeps nothing beyond the page. */
export function fixturePort(over: Partial<FocusPort> & { set?: DrillSet } = {}): FocusPort & { attempts: Attempt[]; parked: string[] } {
  const attempts: Attempt[] = []
  const parked: string[] = []
  return {
    id: 'fixture',
    attempts,
    parked,
    loadSet: async () => over.set ?? FIX_SET,
    record: async (a) => { attempts.push(a); return { nextOn: '2026-11-19' } },
    park: async (t) => { parked.push(t); return { stored: false } },
    pick: async () => FIX_PICK,
    ...over,
  }
}
