/**
 * Trials: every certificate, exam and document on the path — and the War Chest,
 * what it all costs and when each payment falls.
 *
 * Every figure carries its source and the date it was checked (2026-10-09). Fees
 * change; the UI says "verify before paying" next to each one. Funding paths are
 * listed as things to research, never as advice.
 */
import type { Track } from './characters'

export interface Cost { amount: number; currency: 'INR' | 'EUR'; note: string; source: string; asOf: string }

export interface TrialDef {
  id: string
  name: string
  issuer: string
  track: Track
  kind: 'certificate' | 'exam' | 'document' | 'experience'
  admit: string
  job: string
  cost?: Cost
  when: string
  prep: string
  stages: string[]
  reward: { xp: number; marks: number }
  links: { label: string; url: string }[]
  optional?: boolean
}

const CHECKED = '2026-10-09'
const STAGES_CERT = ['Scouted', 'Enrolled', 'Preparing', 'Exam booked', 'Passed']
const STAGES_EXAM = ['Scouted', 'Preparing', 'Mock passed', 'Booked', 'Passed']
const STAGES_DOC = ['Read the rules', 'Documents ready', 'Registered / paid', 'Submitted', 'Issued']

export const TRIALS: TrialDef[] = [
  {
    id: 'nptel-verilog', name: 'NPTEL — Hardware Modeling using Verilog', issuer: 'IIT Kharagpur (Prof. Indranil Sengupta) via NPTEL',
    track: 'silicon', kind: 'certificate',
    admit: 'Structured HDL coursework beyond your curriculum, from an IIT.',
    job: 'An IIT-branded Verilog certificate Indian recruiters recognise.',
    cost: { amount: 1000, currency: 'INR', note: 'per course exam; courses are free to audit', source: 'NPTEL exam announcements', asOf: CHECKED },
    when: 'Its last run was an 8-week course, Jul–Sep 2025. Check the Jan and Jul semester lists for the next run.',
    prep: '8 weeks of lectures + weekly assignments (they count toward the final score).',
    stages: STAGES_CERT, reward: { xp: 600, marks: 500 },
    links: [{ label: 'NPTEL courses', url: 'https://onlinecourses.nptel.ac.in/' }],
  },
  {
    id: 'nptel-vlsi', name: 'NPTEL — a CMOS / digital VLSI course', issuer: 'NPTEL (IIT faculty)',
    track: 'silicon', kind: 'certificate',
    admit: 'Shows device-to-circuit depth that aptitude interviews probe.',
    job: 'Backs up "VLSI" on a fresher CV with an exam score.',
    cost: { amount: 1000, currency: 'INR', note: 'per course exam', source: 'NPTEL exam announcements', asOf: CHECKED },
    when: 'Pick the one running in the next semester (Jan–Apr or Jul–Oct).',
    prep: '8–12 weeks with weekly assignments.',
    stages: STAGES_CERT, reward: { xp: 600, marks: 500 },
    links: [{ label: 'NPTEL courses', url: 'https://onlinecourses.nptel.ac.in/' }],
  },
  {
    id: 'goethe-a1', name: 'Goethe-Zertifikat A1: Start Deutsch 1', issuer: 'Goethe-Institut / Max Mueller Bhavan',
    track: 'deutsch', kind: 'exam',
    admit: 'Proof of starting German; RWTH requires German courses after admission below B1.',
    job: 'Shows commitment to Germany; first step toward Werkstudent jobs that need German.',
    cost: { amount: 8500, currency: 'INR', note: 'third-party figure, April 2026', source: 'Plan Beta exam-fee guide', asOf: CHECKED },
    when: 'Target March 2027 — Der Prüfer\'s month.',
    prep: 'Roughly the first half of an A1 course plus the official practice set.',
    stages: STAGES_EXAM, reward: { xp: 700, marks: 600 },
    links: [{ label: 'Goethe-Institut India — exams', url: 'https://www.goethe.de/ins/in/en/spr/prf.html' }],
  },
  {
    id: 'goethe-a2', name: 'Goethe-Zertifikat A2', issuer: 'Goethe-Institut / Max Mueller Bhavan',
    track: 'deutsch', kind: 'exam',
    admit: 'A stronger language signal for English-taught programmes in Germany.',
    job: 'Everyday German for part-time work and life.',
    when: 'Late 2027 or early 2028.',
    prep: 'A2 course + practice set. Fee: check the Goethe-Institut India page.',
    stages: STAGES_EXAM, reward: { xp: 800, marks: 650 },
    links: [{ label: 'Goethe-Institut India — exams', url: 'https://www.goethe.de/ins/in/en/spr/prf.html' }],
  },
  {
    id: 'ielts', name: 'IELTS Academic', issuer: 'IDP / British Council',
    track: 'paper', kind: 'exam',
    admit: 'Mandatory English proof for English-taught master\'s; 6.5 is a common minimum, aim for 7.0.',
    job: 'A recognised English score helps for jobs abroad.',
    cost: { amount: 19000, currency: 'INR', note: 'reported increase from 1 April 2026', source: 'GradRight news report', asOf: CHECKED },
    when: 'Jul–Sep 2027 (the Quant Sentinel). Results are valid for 2 years.',
    prep: '6 weeks: 2 full timed mocks, daily speaking practice, writing checked against the band descriptors.',
    stages: STAGES_EXAM, reward: { xp: 800, marks: 650 },
    links: [{ label: 'IELTS preparation', url: 'https://ielts.org/take-a-test/preparation-resources' }],
  },
  {
    id: 'dmat', name: 'dMAT — Digital Master Test', issuer: 'g.a.s.t. (with APS India)',
    track: 'paper', kind: 'exam',
    admit: 'Required in the APS file for engineering master\'s applicants (summer 2027 intake onward). Not pass/fail, but the APS certificate waits for it.',
    job: '—',
    cost: { amount: 150, currency: 'EUR', note: 'separate from the APS fee', source: 'Expatrio dMAT guide', asOf: CHECKED },
    when: 'The first sitting was 26 Sep 2026; watch the APS dMAT page for 2027 dates. Take it before submitting APS documents.',
    prep: 'Figure sequences, mathematical equations, Latin squares (core, ~75 min) + a general academic module (~90 min). In English.',
    stages: STAGES_EXAM, reward: { xp: 700, marks: 600 },
    links: [{ label: 'APS India — dMAT', url: 'https://aps-india.de/dmat/' }],
  },
  {
    id: 'aps', name: 'APS certificate', issuer: 'Akademische Prüfstelle, New Delhi',
    track: 'paper', kind: 'document',
    admit: 'Required for every German university application from India.',
    job: '—',
    cost: { amount: 18000, currency: 'INR', note: 'non-refundable', source: 'APS India leaflet for graduates, June 2026', asOf: CHECKED },
    when: 'Register by Sep–Oct 2027: about 3–6 weeks normally, much longer in peak months, and RWTH closes 1 March 2028.',
    prep: 'Marksheets of every semester, degree/provisional certificate (or current status), dMAT certificate if applicable.',
    stages: STAGES_DOC, reward: { xp: 900, marks: 700 },
    links: [{ label: 'APS India', url: 'https://aps-india.de/' }],
  },
  {
    id: 'uniassist', name: 'uni-assist applications / VPD', issuer: 'uni-assist e.V.',
    track: 'paper', kind: 'document',
    admit: 'Many universities process international applications (or the VPD) through uni-assist.',
    job: '—',
    cost: { amount: 75, currency: 'EUR', note: 'first application; +€30 each additional in the same semester', source: 'third-party, 2026', asOf: CHECKED },
    when: 'Season Two: Dec 2027 – May 2028, per programme deadline.',
    prep: 'APS certificate, transcripts, CV, SOP, LORs, English score.',
    stages: STAGES_DOC, reward: { xp: 900, marks: 700 },
    links: [{ label: 'uni-assist', url: 'https://www.uni-assist.de/en/' }],
  },
  {
    id: 'internship', name: 'Summer internship 2027', issuer: 'a company or lab',
    track: 'capital', kind: 'experience',
    admit: 'The strongest single line a 2028 applicant can add, and an LOR from industry.',
    job: 'Real experience, a referral network, and the first income.',
    when: 'Apply Feb 2027 (the Recruiter); work May–Jul 2027.',
    prep: 'CV v2, a target list, tailored applications, mock interviews.',
    stages: ['Target list', 'Applying', 'Interviewing', 'Offer', 'Completed'], reward: { xp: 1200, marks: 900 },
    links: [{ label: 'Internshala', url: 'https://internshala.com/' }, { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/' }],
  },
  {
    id: 'tinytapeout', name: 'Tiny Tapeout — your design on a real chip', issuer: 'Tiny Tapeout',
    track: 'silicon', kind: 'experience', optional: true,
    admit: 'Very few applicants have taped out silicon. A standout line.',
    job: 'Shows the full open-source flow, RTL to GDS.',
    when: 'Any shuttle. It costs money — only if it is funded.',
    prep: 'A small design that fits a tile; the free online flow.',
    stages: ['Read the docs', 'Design', 'Hardened', 'Submitted', 'Silicon back'], reward: { xp: 1500, marks: 1000 },
    links: [{ label: 'Tiny Tapeout', url: 'https://tinytapeout.com/' }],
  },
]

/* ======================================================================= War Chest */
export interface ChestItem { id: string; label: string; cost: Cost; due: string; trial?: string }

/** Dated payments on the path. `due` is the month the money must exist (YYYY-MM). */
export const CHEST_ITEMS: ChestItem[] = [
  { id: 'nptel1', label: 'NPTEL exam (Verilog)', cost: TRIALS[0].cost!, due: '2027-04', trial: 'nptel-verilog' },
  { id: 'nptel2', label: 'NPTEL exam (VLSI)', cost: TRIALS[1].cost!, due: '2027-10', trial: 'nptel-vlsi' },
  { id: 'goethe', label: 'Goethe A1 exam', cost: TRIALS[2].cost!, due: '2027-02', trial: 'goethe-a1' },
  { id: 'ielts', label: 'IELTS Academic', cost: TRIALS[4].cost!, due: '2027-07', trial: 'ielts' },
  { id: 'dmat', label: 'dMAT', cost: TRIALS[5].cost!, due: '2027-08', trial: 'dmat' },
  { id: 'aps', label: 'APS certificate', cost: TRIALS[6].cost!, due: '2027-09', trial: 'aps' },
  { id: 'uniassist', label: 'uni-assist (first + 4 more)', cost: { amount: 195, currency: 'EUR', note: '€75 + 4 × €30', source: 'third-party, 2026', asOf: CHECKED }, due: '2027-12', trial: 'uniassist' },
  { id: 'visa', label: 'German national visa fee', cost: { amount: 75, currency: 'EUR', note: 'standard national (D) visa fee — not re-checked today; verify with the mission', source: 'German missions (standard fee)', asOf: CHECKED }, due: '2028-06' },
  { id: 'blocked', label: 'Blocked account (first year)', cost: { amount: 11904, currency: 'EUR', note: '€992/month, released monthly; plus a provider fee', source: 'study.eu / Expatrio, 2026', asOf: CHECKED }, due: '2028-06' },
]

export const FUNDING_PATHS = [
  { label: 'Education loan', note: 'A common route for the blocked account and fees. Compare lenders\' terms; read every condition.' },
  { label: 'DAAD scholarships', note: 'Competitive; search the database for master\'s funding open to Indian applicants and note deadlines.' },
  { label: 'Deutschlandstipendium', note: '€300/month for strong students — applied for AFTER enrolment, so it cannot fund the visa.' },
  { label: 'Earnings now', note: 'Tutoring, small embedded projects, the summer internship — every rupee shortens the gap.' },
]

export function toInr(c: Cost, inrPerEur: number): number {
  return c.currency === 'INR' ? c.amount : Math.round(c.amount * inrPerEur)
}
