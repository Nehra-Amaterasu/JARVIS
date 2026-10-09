/**
 * The people who hand out the work. A contract from a person with a face and a
 * voice is harder to ignore than a line in a list — and each one stands for a
 * part of the path that is easy to neglect (German, money, paperwork).
 *
 * They are fictional. No real professor, recruiter or official is portrayed.
 */

export type Track = 'silicon' | 'deutsch' | 'capital' | 'paper' | 'body' | 'academy'

export type NpcId = 'jarvis' | 'kruger' | 'weiss' | 'rhea' | 'chancellor' | 'brandt'

export interface Npc {
  id: NpcId
  name: string
  role: string
  track: Track | null
  /** One line that says who they are to you. */
  tagline: string
  lines: { assign: string[]; praise: string[]; warn: string[] }
}

export const TRACKS: Record<Track, { label: string; short: string; npc: NpcId; tint: string; blurb: string }> = {
  silicon: { label: 'Silicon', short: 'SIL', npc: 'kruger', tint: '#a9bfff', blurb: 'Digital design, Verilog, verification — the admit and the job.' },
  deutsch: { label: 'Deutsch', short: 'DEU', npc: 'weiss', tint: '#9fe3c4', blurb: 'German: an admission lever, a part-time-job lever, a life skill.' },
  capital: { label: 'Capital', short: 'CAP', npc: 'rhea', tint: '#e3c9a2', blurb: 'Internships, jobs, certifications, money.' },
  paper: { label: 'Paperwork', short: 'DOC', npc: 'chancellor', tint: '#c8b6ff', blurb: 'APS, dMAT, IELTS, SOP, LORs, deadlines.' },
  body: { label: 'Body', short: 'VIT', npc: 'brandt', tint: '#ffb4a8', blurb: 'The discipline you already have.' },
  academy: { label: 'Academy', short: 'ACA', npc: 'jarvis', tint: '#e8edf3', blurb: 'University exams — grades decide German admissions.' },
}

export const NPCS: Record<NpcId, Npc> = {
  jarvis: {
    id: 'jarvis', name: 'JARVIS', role: 'Handler', track: null,
    tagline: 'Runs the operation. Keeps score. Does not forget.',
    lines: {
      assign: ['New orders.', 'This one is from me.', 'Boot Camp. Ten minutes. Go.'],
      praise: ['Logged. That one counts.', 'Floor secured. The streak lives.', 'Good. Now the next one.'],
      warn: ['The floor is not secured.', 'You are letting the day decide for you.', 'The boss is still standing.'],
    },
  },
  kruger: {
    id: 'kruger', name: 'Prof. Krüger', role: 'Silicon · the TU9 standard', track: 'silicon',
    tagline: 'Reviews applications like he reviews timing reports: looking for the violation.',
    lines: {
      assign: [
        'Präzision. Build it, simulate it, show me the waveform.',
        'An admission committee reads your GitHub before your SOP. Give it something to read.',
        'Do not tell me you understand it. Show me the testbench.',
        'Small, exact, verified. That is how chips are made.',
      ],
      praise: ['Acceptable. Next.', 'The waveform does not lie. Good.', 'That is the standard. Keep it.'],
      warn: ['You are behind schedule. Silicon does not wait.', 'Unverified hardware is a rumour.'],
    },
  },
  weiss: {
    id: 'weiss', name: 'Frau Weiss', role: 'Deutsch · your German teacher', track: 'deutsch',
    tagline: 'Fünfzehn Minuten am Tag. Jeden Tag. Fifteen minutes. Every day.',
    lines: {
      assign: [
        'Heute: fünfzehn Minuten. Today, fifteen minutes. That is all I ask.',
        'Sprechen, nicht nur lesen. Say it out loud.',
        'Every word you learn now is a rent contract you can read in Aachen.',
        'Langsam, aber jeden Tag. Slowly — but every day.',
      ],
      praise: ['Sehr gut!', 'Wunderbar. Bis morgen.', 'Na also. There it is.'],
      warn: ['Wo warst du gestern? Where were you yesterday?', 'German forgotten in a week takes a month to return.'],
    },
  },
  rhea: {
    id: 'rhea', name: 'Rhea Kapoor', role: 'Capital · semiconductor recruiter', track: 'capital',
    tagline: 'Has read ten thousand fresher CVs. Remembers the ones with proof.',
    lines: {
      assign: [
        'Projects get you shortlisted. Fundamentals get you hired. Let us work on both.',
        'Nobody hires potential. They hire evidence.',
        'One targeted application beats twenty spray-and-pray ones.',
        'Money is a deadline too. Treat it like one.',
      ],
      praise: ['That goes on the CV. Today.', 'Now you are a candidate, not an applicant.', 'Good. Recruiters notice that.'],
      warn: ['Internship season does not wait for you to feel ready.', 'Your CV has not changed in weeks.'],
    },
  },
  chancellor: {
    id: 'chancellor', name: 'The Chancellor', role: 'Paperwork · Germany', track: 'paper',
    tagline: 'Every stamp, every deadline, every form. Das ist nicht korrekt ausgefüllt.',
    lines: {
      assign: [
        'Form first, feelings later.',
        'Deadlines are not suggestions. They are walls.',
        'The best application in the world is worthless one day late.',
        'Check the official page. Then check it again.',
      ],
      praise: ['Ordnungsgemäß. In order.', 'Stamped and filed.', 'Correct. Proceed.'],
      warn: ['A document you have not started is a document that will be late.', 'APS does not hurry for anyone.'],
    },
  },
  brandt: {
    id: 'brandt', name: 'Coach Brandt', role: 'Body · strength coach', track: 'body',
    tagline: 'You already keep a training split. That is proof you can keep anything.',
    lines: {
      assign: ['Train. Then study. The body carries the brain.', 'Same discipline, different muscle.', 'Twenty minutes. No negotiation.'],
      praise: ['Strong.', 'That is the habit. Use it everywhere.', 'Good session.'],
      warn: ['You skip the gym, you skip the desk. I have seen it.', 'Move. Twenty minutes saves the day.'],
    },
  },
}

export function npcLine(id: NpcId, kind: keyof Npc['lines'], seed: number): string {
  const ls = NPCS[id].lines[kind]
  return ls[Math.abs(Math.floor(seed)) % ls.length]
}
