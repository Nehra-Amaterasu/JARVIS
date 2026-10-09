/**
 * Season One: Year Zero — twelve monthly bosses, October 2026 → September 2027.
 *
 * Each boss is a REAL deliverable. HP is the preparation gauge (daily work chips it);
 * the kill is always the deliverable's proof. Names come from the original
 * Mission Germoney plan (Boolean Sentinel, Pipeline Guardian, Quant Sentinel…).
 *
 * Season Two (applications, 2028) is drawn on the map as the horizon.
 */
import type { Track } from './characters'
import { addDays, addMonths, monthEnd } from './util'

export interface Resource { label: string; url: string }

export interface BossDef {
  id: string
  name: string
  epithet: string
  /** Season month 1-12 (1 = the season's first month). */
  month: number
  tracks: Track[]
  hp: number
  deliverable: string
  steps: string[]
  proofHint: string
  lore: string
  taunts: { start: string; hurt: string; low: string; escaped: string; defeated: string }
  reward: { xp: number; marks: number; rank?: number; title: string }
  why: string
  resources: Resource[]
  /** Sigil geometry: polygon sides, horns, eye count, inner glyph. */
  sigil: { sides: number; horns: number; eyes: number; glyph: string }
}

export const ACTS = [
  { id: 'I', name: 'Ignition', months: [1, 3], blurb: 'From zero to first silicon — in simulation. Toolchain, logic, state.' },
  { id: 'II', name: 'The Forge', months: [4, 6], blurb: 'Talk to the outside world: a UART, a CV, a German exam.' },
  { id: 'III', name: 'Proof', months: [7, 9], blurb: 'Verify like industry does, cross clock domains, build a CPU.' },
  { id: 'IV', name: 'Launch', months: [10, 12], blurb: 'Scores, a flagship repo, and the paperwork that gates everything.' },
] as const

export const BOSSES: BossDef[] = [
  {
    id: 'b1', name: 'The Boolean Sentinel', epithet: 'Guardian of the first gate', month: 1, tracks: ['silicon'], hp: 100,
    deliverable: 'A public GitHub repo with a 4-bit ripple-carry adder built from full-adder instances, a self-checking testbench, and a waveform screenshot in the README.',
    steps: [
      'Install Icarus Verilog + GTKWave; simulate a hello-world module.',
      'Write a 1-bit full adder (assign sum/carry); test all 8 input combinations.',
      'Instantiate four of them into a 4-bit RCA.',
      'Testbench: loop over all 256 (a, b) pairs, compare with a + b, count mismatches.',
      'Dump a VCD, screenshot GTKWave, push repo + README.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'Every chip ever made began as a gate someone got right. The Sentinel lets no one pass who has not.',
    taunts: { start: 'You have never written a line of hardware. Prove me wrong.', hurt: 'Hm. You found the toolchain.', low: 'One adder. That is all that stands between you and the gate.', escaped: 'A month, and not even an adder.', defeated: 'The first gate opens.' },
    reward: { xp: 500, marks: 400, rank: 1, title: 'The Logic Builder' },
    why: 'A working, tested adder on GitHub is the smallest proof that you can take a spec to verified hardware — the loop every later project repeats.',
    resources: [
      { label: 'HDLBits (interactive Verilog)', url: 'https://hdlbits.01xz.net/' },
      { label: 'Icarus Verilog', url: 'https://steveicarus.github.io/iverilog/' },
      { label: 'GTKWave', url: 'https://gtkwave.sourceforge.net/' },
    ],
    sigil: { sides: 4, horns: 0, eyes: 2, glyph: 'AND' },
  },
  {
    id: 'b2', name: 'The Combinational Demon', epithet: 'Lord of the truth table', month: 2, tracks: ['silicon'], hp: 110,
    deliverable: 'A parameterised N-bit ALU (at least ADD, SUB, AND, OR, XOR, SLT, shift) with a self-checking testbench, simulated at N=8 and N=16, on GitHub.',
    steps: [
      'Spec the opcodes and flags (zero, carry, overflow) in the README first.',
      'Write the ALU with a case statement; parameter WIDTH.',
      'Reference model in the testbench (the same ops in plain Verilog arithmetic).',
      'Random + corner-case stimulus (0, max, sign boundaries); count mismatches.',
      'Synthesize with Yosys once; note the cell count in the README.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'It hides in the corners: the overflow you forgot, the sign bit you assumed. It feeds on untested cases.',
    taunts: { start: 'Your adder was cute. Now handle signed overflow.', hurt: 'Corner cases. You are learning.', low: 'Your testbench is getting dangerous.', escaped: 'The corners remain unchecked.', defeated: 'Every case accounted for. I am undone.' },
    reward: { xp: 500, marks: 400, rank: 2, title: 'The ALU Architect' },
    why: 'An ALU with a reference-model testbench is the textbook design-verification interview question — and the heart of the CPU you will build in June.',
    resources: [
      { label: 'HDLBits — Circuits / Combinational', url: 'https://hdlbits.01xz.net/wiki/Problem_sets' },
      { label: 'ChipVerify Verilog tutorial', url: 'https://www.chipverify.com/verilog/verilog-tutorial' },
      { label: 'Yosys', url: 'https://yosyshq.net/yosys/' },
    ],
    sigil: { sides: 6, horns: 2, eyes: 2, glyph: 'XOR' },
  },
  {
    id: 'b3', name: 'The Sequential Wraith', epithet: 'It remembers', month: 3, tracks: ['silicon'], hp: 120,
    deliverable: 'An FSM suite on GitHub: a Moore traffic-light controller, a Mealy "1011" overlapping sequence detector, and a universal shift register — each with a testbench and waveform.',
    steps: [
      'Draw each state diagram on paper first; photograph it into the README.',
      'Code FSMs in the 3-block style: state register, next-state logic, output logic.',
      'Test the detector on a stream with overlapping patterns (101011011).',
      'Shift register: verify hold / left / right / parallel-load.',
      'Explain Moore vs Mealy in two sentences in the README.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'A circuit with memory can lie to you about the past. The Wraith lives in every reset you forgot.',
    taunts: { start: 'You think in gates. I think in states.', hurt: 'You drew the diagram first. Clever.', low: 'Your detector sees me coming.', escaped: 'State lost. As always.', defeated: 'Reset… complete.' },
    reward: { xp: 600, marks: 450, rank: 3, title: 'The Clock Tamer' },
    why: 'FSMs are the control logic of every chip and the most common RTL interview task ("design a sequence detector").',
    resources: [
      { label: 'HDLBits — Sequential / FSM', url: 'https://hdlbits.01xz.net/wiki/Problem_sets' },
    ],
    sigil: { sides: 8, horns: 0, eyes: 3, glyph: 'FSM' },
  },
  {
    id: 'b4', name: 'The RTL Architect', epithet: 'Speaks in start bits', month: 4, tracks: ['silicon'], hp: 130,
    deliverable: 'A UART transmitter + receiver (8N1, parameterised baud) with a loopback testbench that sends a string and checks it arrives intact; timing diagram in the README.',
    steps: [
      'Baud tick generator from CLK_FREQ / BAUD.',
      'TX FSM: idle → start → 8 data (LSB first) → stop.',
      'RX: sample mid-bit (16× oversampling or a centred counter).',
      'Loopback TB: send "Hello", compare received bytes.',
      'Measure one bit time in GTKWave; write it next to the expected value.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'Your chip has been talking only to itself. The Architect demands it speak to the world.',
    taunts: { start: 'A chip that cannot communicate is a very expensive heater.', hurt: 'Your start bit is clean.', low: 'Mid-bit sampling. Of course.', escaped: 'Silence on the line.', defeated: 'H… e… l… l… o. Received.' },
    reward: { xp: 650, marks: 500, rank: 4, title: 'The Comm Engineer' },
    why: 'UART is the first real protocol on most RTL CVs; it proves timing reasoning and a proper testbench, and it carries into your FPGA and RISC-V work.',
    resources: [
      { label: 'Nandland — UART', url: 'https://nandland.com/uart-serial-port-module/' },
      { label: 'ZipCPU blog (testbenches, formal)', url: 'https://zipcpu.com/' },
    ],
    sigil: { sides: 5, horns: 2, eyes: 1, glyph: 'TX' },
  },
  {
    id: 'b12', name: 'The Recruiter', epithet: 'Seven seconds to impress', month: 5, tracks: ['capital'], hp: 100,
    deliverable: 'CV v2 (one page, every project quantified, GitHub link) and 15 targeted applications for summer-2027 VLSI / embedded internships, logged in a tracker.',
    steps: [
      'Rewrite every bullet as: built X, verified with Y, result Z (numbers).',
      'Pin your three best repos; add READMEs with waveforms.',
      'List 25 target companies/labs; pick 15 with real openings.',
      'One tailored line per application; ask for a referral where you know someone.',
      'Log each: company, role, date, status, follow-up date.',
    ],
    proofHint: 'Link to your tracker sheet or CV PDF',
    lore: 'It does not care how hard you worked. It cares what you can show in one page.',
    taunts: { start: 'Next.', hurt: 'Hm. Quantified bullets.', low: 'Your GitHub is… actually interesting.', escaped: 'Applications close. Others got the seats.', defeated: 'Shortlisted.' },
    reward: { xp: 600, marks: 500, title: 'The Candidate' },
    why: 'A summer internship is the strongest single line a 2028 applicant can add — and the first money. Internship hiring happens months before summer.',
    resources: [
      { label: 'Internshala', url: 'https://internshala.com/' },
      { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/' },
      { label: 'Europass CV', url: 'https://europass.europa.eu/en/create-europass-cv' },
    ],
    sigil: { sides: 3, horns: 0, eyes: 1, glyph: 'CV' },
  },
  {
    id: 'b11', name: 'Der Prüfer', epithet: 'The Examiner', month: 6, tracks: ['deutsch'], hp: 120,
    deliverable: 'Goethe-Zertifikat A1 (Start Deutsch 1) — or, if the exam date is later, a full timed A1 mock with at least 60% in every part (Hören, Lesen, Schreiben, Sprechen).',
    steps: [
      'Download the free official A1 practice set (Übungssatz) from goethe.de.',
      'Time each part exactly as the exam does.',
      'Record the Sprechen part on your phone; play it back.',
      'Score honestly against the official answer key.',
      'Book the real exam if you are above 60% everywhere.',
    ],
    proofHint: 'Certificate photo, or your scored mock sheet',
    lore: 'He speaks slowly. He will not repeat himself. He is not interested in excuses — auf Deutsch, bitte.',
    taunts: { start: 'Wie heißen Sie? …Nichts?', hurt: 'Ah. Sie lernen.', low: 'Nicht schlecht.', escaped: 'Nächstes Mal. Vielleicht.', defeated: 'Bestanden. Herzlichen Glückwunsch.' },
    reward: { xp: 700, marks: 550, title: 'Deutschlerner' },
    why: 'A1 is the first certificate you can show; RWTH requires German courses after admission if you are below B1, and everyday life in Germany runs in German.',
    resources: [
      { label: 'Goethe A1 free exam training (3 mocks)', url: 'https://www.goethe.de/en/spr/prf/ueb/pa1.html' },
      { label: 'DW Nicos Weg (free A1–B1 course)', url: 'https://learngerman.dw.com/en/nicos-weg/c-36519789' },
    ],
    sigil: { sides: 4, horns: 2, eyes: 2, glyph: 'A1' },
  },
  {
    id: 'b5', name: 'The Verification Reaper', epithet: 'Finds the bug you shipped', month: 7, tracks: ['silicon'], hp: 140,
    deliverable: 'A class-based SystemVerilog testbench for your ALU or UART: transaction class, constrained-random generator, driver, monitor, scoreboard, and a functional-coverage report.',
    steps: [
      'Interface + modport for the DUT.',
      'Transaction class with rand fields and constraints.',
      'Generator → driver → DUT → monitor → scoreboard (mailboxes).',
      'Covergroup over opcodes × operand classes; reach 100% or explain the holes.',
      'Inject a bug on purpose; show the scoreboard catching it.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'Most engineers on a chip team write tests, not designs. The Reaper collects those who never learned.',
    taunts: { start: 'Your design works? Says who?', hurt: 'Constrained random. Annoying.', low: 'Coverage closing. I can feel it.', escaped: 'Untested. Unshippable.', defeated: 'Coverage: 100%. Bug found. I yield.' },
    reward: { xp: 750, marks: 550, rank: 5, title: 'The Verifier' },
    why: 'Design verification is where most VLSI fresher roles are. A class-based TB with coverage is exactly what DV interviews probe.',
    resources: [
      { label: 'ChipVerify SystemVerilog', url: 'https://www.chipverify.com/systemverilog/systemverilog-tutorial' },
      { label: 'Verification Academy', url: 'https://verificationacademy.com/' },
      { label: 'EDA Playground (free simulators)', url: 'https://www.edaplayground.com/' },
    ],
    sigil: { sides: 7, horns: 2, eyes: 2, glyph: 'UVM' },
  },
  {
    id: 'b13', name: 'The FIFO Sentinel', epithet: 'Lives between two clocks', month: 8, tracks: ['silicon'], hp: 140,
    deliverable: 'An asynchronous FIFO with gray-code pointers and two-flop synchronisers, full/empty logic, and a testbench with unrelated read/write clocks.',
    steps: [
      'Read Cummings, "Simulation and Synthesis Techniques for Asynchronous FIFO Design".',
      'Binary → gray pointers; 2-FF synchronise each into the other domain.',
      'Full/empty from the synchronised gray pointers (one extra bit).',
      'TB: write at 100 MHz, read at 37 MHz, random stalls; check order and no loss.',
      'Explain metastability and MTBF in the README in your own words.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'Two clocks that never agree. Bits that are neither 0 nor 1. The Sentinel guards the border.',
    taunts: { start: 'Single-clock designs are for children.', hurt: 'Gray code. So you have read the paper.', low: 'Your synchronisers hold.', escaped: 'Metastable. Forever.', defeated: 'Crossing… safe.' },
    reward: { xp: 750, marks: 600, title: 'Clock-Domain Crosser' },
    why: 'CDC and async FIFOs are the classic "separate the freshers" interview topic; getting them right signals real understanding.',
    resources: [
      { label: 'Cummings papers (Paradigm Works library)', url: 'https://www.paradigm-works.com/technical-library' },
      { label: 'ZipCPU on clock-domain crossing', url: 'https://zipcpu.com/' },
    ],
    sigil: { sides: 6, horns: 0, eyes: 4, glyph: 'CDC' },
  },
  {
    id: 'b6', name: 'The Pipeline Guardian', epithet: 'Executes one instruction at a time — for now', month: 9, tracks: ['silicon'], hp: 160,
    deliverable: 'A single-cycle RV32I core (at least ADD/SUB/AND/OR/ADDI/LW/SW/BEQ/JAL) running a test program (e.g. sum 1..10) to the correct result in simulation, on GitHub.',
    steps: [
      'Datapath diagram first (PC, regfile, ALU, immgen, data memory).',
      'Reuse your ALU from November.',
      'Decoder + control from the RISC-V spec tables.',
      'Hand-assemble a test program; load with $readmemh.',
      'Self-check: final register value matches; README with the trace.',
    ],
    proofHint: 'GitHub repo link',
    lore: 'Every instruction you have ever run passed a guardian like this. Now you build one.',
    taunts: { start: 'Fetch. Decode. Execute. You cannot even fetch.', hurt: 'Your ALU returns. Sentimental.', low: 'The branch… resolves.', escaped: 'Halted.', defeated: 'PC advances. You built a computer.' },
    reward: { xp: 900, marks: 700, rank: 6, title: 'The Pipeline Master' },
    why: 'A CPU you designed is the single most persuasive project for an MS application in VLSI and for computer-architecture-heavy interviews.',
    resources: [
      { label: 'RISC-V specifications', url: 'https://riscv.org/specifications/ratified/' },
      { label: 'Harris & Harris — DDCA RISC-V edition (book)', url: 'https://pages.hmc.edu/harris/ddca/ddcarv.html' },
    ],
    sigil: { sides: 10, horns: 2, eyes: 2, glyph: 'RV' },
  },
  {
    id: 'b8', name: 'The Quant Sentinel', epithet: 'Measures you in numbers', month: 10, tracks: ['paper'], hp: 130,
    deliverable: 'IELTS Academic at 7.0 or above — or a full timed mock at 7.0 if the exam is booked later — plus one complete timed dMAT-style practice set (figure sequences, equations, Latin squares).',
    steps: [
      'One full timed IELTS mock; band each section honestly.',
      'Writing: 2 Task-2 essays checked against the public band descriptors.',
      'Speaking: record a Part 2 long turn daily for a week.',
      'dMAT: time yourself on figure sequences and Latin squares.',
      'Book the IELTS date that leaves 2 weeks of buffer before APS.',
    ],
    proofHint: 'Score report, or your scored mock sheets',
    lore: 'It does not read your projects. It reads your score — and it reads it in English.',
    taunts: { start: 'Numbers do not care about your story.', hurt: 'Band 6.5. Adequate.', low: 'Seven is within reach.', escaped: 'Untested. Unadmitted.', defeated: 'Band confirmed.' },
    reward: { xp: 800, marks: 650, rank: 8, title: 'The Scholar Candidate' },
    why: 'English proof is mandatory for English-taught programmes (6.5 is a common minimum); the dMAT is now part of the APS file for engineering master\'s applicants.',
    resources: [
      { label: 'IELTS — official prep', url: 'https://ielts.org/take-a-test/preparation-resources' },
      { label: 'APS India — dMAT', url: 'https://aps-india.de/dmat/' },
    ],
    sigil: { sides: 9, horns: 0, eyes: 2, glyph: '7.0' },
  },
  {
    id: 'b7', name: 'The Open-Source Forge', epithet: 'Where hobbies become evidence', month: 11, tracks: ['silicon'], hp: 150,
    deliverable: 'One flagship repo (your CPU + UART, or a polished IP) with CI: Verilator lint + your testbenches running in GitHub Actions, a docs page, block diagram, and waveforms.',
    steps: [
      'Pick the flagship; cut everything half-finished.',
      'Makefile: one command runs every test.',
      'GitHub Actions: lint + tests on every push; badge in the README.',
      'Block diagram, interface table, how-to-run, results.',
      'Post it (LinkedIn) with what you learned — one paragraph.',
    ],
    proofHint: 'GitHub repo link with a green CI badge',
    lore: 'Code nobody can run is a diary. The Forge turns it into a reference.',
    taunts: { start: 'Your repos are a graveyard of "WIP".', hurt: 'A Makefile. Civilised.', low: 'Green badge. Hmm.', escaped: 'WIP forever.', defeated: 'Reproducible. Respected.' },
    reward: { xp: 900, marks: 700, rank: 7, title: 'The Silicon Forge' },
    why: 'Reviewers and interviewers click one repo. CI and docs show professional habits that most student repos lack.',
    resources: [
      { label: 'Verilator', url: 'https://www.veripool.org/verilator/' },
      { label: 'GitHub Actions docs', url: 'https://docs.github.com/actions' },
    ],
    sigil: { sides: 12, horns: 2, eyes: 2, glyph: 'CI' },
  },
  {
    id: 'b9', name: 'The Application Gauntlet', epithet: 'Every form, every stamp', month: 12, tracks: ['paper'], hp: 150,
    deliverable: 'APS registration done (with the dMAT booked or done), SOP v1 written, two LOR requests sent, and a locked shortlist with each programme\'s deadline, language rule and tuition.',
    steps: [
      'Read the current APS leaflet and dMAT page; register.',
      'Shortlist from the DAAD database; record deadline / language / tuition each.',
      'SOP v1: why this programme, these courses, these labs — one page.',
      'Ask two professors for LORs with your CV and project list attached.',
      'Calendar every deadline with 3-week alarms.',
    ],
    proofHint: 'APS registration confirmation + shortlist sheet',
    lore: 'The final gate before the gate. It has turned away better engineers for a missing stamp.',
    taunts: { start: 'Paperwork is a boss too. You forgot.', hurt: 'APS registered. Good.', low: 'The shortlist is… sensible.', escaped: 'The window closes without you.', defeated: 'Dossier complete. Season Two awaits.' },
    reward: { xp: 1000, marks: 800, rank: 9, title: 'The Applicant' },
    why: 'APS (with the dMAT for engineering degrees) gates every application from India; RWTH\'s non-EU deadline for the winter intake is 1 March.',
    resources: [
      { label: 'APS India', url: 'https://aps-india.de/' },
      { label: 'DAAD International Programmes', url: 'https://www2.daad.de/deutschland/studienangebote/international-programmes/en/' },
      { label: 'uni-assist', url: 'https://www.uni-assist.de/en/' },
    ],
    sigil: { sides: 4, horns: 4, eyes: 2, glyph: 'APS' },
  },
]

/** Season Two: the horizon. Shown, not fought, in Year Zero. */
export const SEASON_TWO = [
  { id: 'b14', name: 'The Aptitude Inquisitor', when: 'Dec 2027 – Mar 2028', what: 'Submit applications; prepare for aptitude interviews (MOSFET basics, timing, your own projects).' },
  { id: 'b10', name: 'The Final Admit', when: 'Apr – Jul 2028', what: 'An admission letter, the blocked account, the visa. Rank 10: The Silicon Architect.' },
]

export interface DatedBoss extends BossDef { start: string; deadline: string }

/** Bosses dated from the season start (YYYY-MM-01), with exam-mode extensions. */
export function seasonBosses(seasonStart: string, examDays: (from: string, to: string) => number = () => 0): DatedBoss[] {
  return BOSSES.map((b) => {
    const start = addMonths(seasonStart, b.month - 1)
    const end = monthEnd(start)
    return { ...b, start, deadline: addDays(end, examDays(start, end)) }
  }).sort((a, b) => a.month - b.month)
}

export function actFor(month: number) {
  return ACTS.find((a) => month >= a.months[0] && month <= a.months[1]) ?? ACTS[ACTS.length - 1]
}
