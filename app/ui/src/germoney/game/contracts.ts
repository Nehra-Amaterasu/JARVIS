/**
 * Daily contracts: hyper-specific tasks from a person, each with Intel —
 * why it matters, the concept, one free resource, and a check question.
 *
 * Doc 11 is blunt: "learn Verilog" produces nothing; "write a 4-bit ripple-carry
 * adder, simulate it, view the waveform" gets done. Every task here is the second kind.
 *
 * Generation is deterministic per day (seeded), weighted toward the current boss,
 * so the daily work visibly moves the monthly fight.
 */
import type { NpcId, Track } from './characters'
import { pickWeighted, rngFor, weekday } from './util'

export interface Intel {
  why?: string
  concept: string
  resource?: { label: string; url: string }
  check?: { q: string; a: string }
}

export interface ContractDef {
  id: string
  npc: NpcId
  track: Track
  title: string
  task: string
  minutes: number
  xp: number
  /** Rank band (player rank 0-10) — for skill-gated tracks. */
  rank?: [number, number]
  /** Season-month band (1-12) — for calendar-gated tracks (German level, paperwork timing). */
  months?: [number, number]
  /** Boss ids this contract prepares for: 3× weight while that boss is active, and it damages it. */
  bosses?: string[]
  intel: Intel
}

const R = {
  hdlbits: { label: 'HDLBits', url: 'https://hdlbits.01xz.net/' },
  iverilog: { label: 'Icarus Verilog', url: 'https://steveicarus.github.io/iverilog/' },
  chipverify: { label: 'ChipVerify', url: 'https://www.chipverify.com/' },
  edaplay: { label: 'EDA Playground', url: 'https://www.edaplayground.com/' },
  nandland: { label: 'Nandland', url: 'https://nandland.com/' },
  sunburst: { label: 'Cummings papers (Paradigm Works library)', url: 'https://www.paradigm-works.com/technical-library' },
  riscv: { label: 'RISC-V specifications', url: 'https://riscv.org/specifications/ratified/' },
  verilator: { label: 'Verilator', url: 'https://www.veripool.org/verilator/' },
  yosys: { label: 'Yosys', url: 'https://yosyshq.net/yosys/' },
  nicos: { label: 'DW Nicos Weg', url: 'https://learngerman.dw.com/en/nicos-weg/c-36519789' },
  dw: { label: 'DW Learn German', url: 'https://learngerman.dw.com/en/overview' },
  goethe: { label: 'Goethe-Institut India — exams', url: 'https://www.goethe.de/ins/in/en/spr/prf.html' },
  goetheA1: { label: 'Goethe A1 free exam training', url: 'https://www.goethe.de/en/spr/prf/ueb/pa1.html' },
  goetheTrain: { label: 'Goethe exam trainings (all levels)', url: 'https://www.goethe.de/en/spr/prf/ueb.html' },
  daad: { label: 'DAAD International Programmes', url: 'https://www2.daad.de/deutschland/studienangebote/international-programmes/en/' },
  aps: { label: 'APS India', url: 'https://aps-india.de/' },
  dmat: { label: 'APS India — dMAT', url: 'https://aps-india.de/dmat/' },
  ielts: { label: 'IELTS preparation', url: 'https://ielts.org/take-a-test/preparation-resources' },
  internshala: { label: 'Internshala', url: 'https://internshala.com/' },
  linkedin: { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/jobs/' },
  nptel: { label: 'NPTEL courses', url: 'https://onlinecourses.nptel.ac.in/' },
  europass: { label: 'Europass CV', url: 'https://europass.europa.eu/en/create-europass-cv' },
  ghactions: { label: 'GitHub Actions', url: 'https://docs.github.com/actions' },
  rwth: { label: 'RWTH Micro- & Nanoelectronics (DAAD listing)', url: 'https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/4811/' },
  tud: { label: 'TU Dresden — Nanoelectronic Systems', url: 'https://tu-dresden.de/et/nes' },
  tummcd: { label: 'TUM — Microelectronics & Chip Design', url: 'https://www.tum.de/en/studies/degree-programs/detail/microelectronics-and-chip-design-master-of-science-msc' },
  daadschol: { label: 'DAAD scholarship database', url: 'https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/' },
}

let _n = 0
const c = (d: Omit<ContractDef, 'id'> & { id?: string }): ContractDef => ({ id: d.id ?? `x${++_n}`, ...d })

/* ======================================================================= SILICON — Prof. Krüger */
const S = (id: string, title: string, minutes: number, xp: number, rank: [number, number], task: string, intel: Intel, bosses?: string[]) =>
  c({ id, npc: 'kruger', track: 'silicon', title, minutes, xp, rank, task, intel, bosses })

export const SILICON: ContractDef[] = [
  S('s01', 'Arm the toolchain', 20, 20, [0, 1], 'Install Icarus Verilog and GTKWave. Compile a hello-world module with a testbench, run it, open the VCD in GTKWave.',
    { why: 'No simulator, no hardware. Everything else this year runs through this loop.', concept: 'Simulation executes your HDL against a testbench in software; $dumpfile/$dumpvars record every signal change into a VCD file.', resource: R.iverilog, check: { q: 'What file do $dumpfile/$dumpvars produce, and what opens it?', a: 'A VCD (value change dump) file; GTKWave opens it.' } }, ['b1']),
  S('s02', 'First blood: a 2:1 mux', 25, 20, [0, 1], 'Write a 2:1 mux with one assign and the ternary operator. Testbench drives all 8 input combinations. Screenshot the waveform.',
    { concept: 'A multiplexer forwards one of N inputs chosen by select bits: assign y = s ? b : a;', resource: R.hdlbits, check: { q: 'How many select bits does an 8:1 mux need?', a: '3 (2³ = 8).' } }, ['b1']),
  S('s03', 'HDLBits sortie: Basics', 30, 20, [0, 1], 'Solve 8 problems in HDLBits → Verilog Language → Basics. No solutions tab.',
    { concept: 'A wire is driven continuously (assign, ports); a reg holds a value assigned in procedural blocks — reg does NOT mean flip-flop.', resource: R.hdlbits, check: { q: 'Does declaring "reg q" create a flip-flop?', a: 'No. Only an edge-triggered always block infers a flop; reg is just the variable type.' } }, ['b1']),
  S('s04', 'Number-systems gauntlet', 20, 15, [0, 1], 'By hand, no calculator: convert 10 numbers between binary, hex and decimal; write the 8-bit two\'s complement of −1, −8, −37, −100, −128.',
    { concept: 'Two\'s complement: invert all bits and add 1. N bits hold −2^(N−1) … 2^(N−1)−1.', check: { q: 'What is −1 in 8-bit two\'s complement?', a: '11111111 (0xFF).' } }, ['b1']),
  S('s05', 'Boolean algebra reps', 25, 15, [0, 2], 'Simplify 10 Boolean expressions with algebra laws. Prove 3 of them with truth tables.',
    { concept: 'De Morgan: (AB)\' = A\' + B\' and (A + B)\' = A\'B\'. Absorption: A + AB = A.', check: { q: 'Simplify A + A\'B.', a: 'A + B.' } }, ['b1', 'b2']),
  S('s06', 'K-map minimisation set', 30, 20, [0, 2], 'Solve 5 four-variable K-maps, two with don\'t-cares. Circle every group; write the minimal SOP.',
    { concept: 'Groups are powers of two and wrap around the edges; each doubling removes one variable from the term. Don\'t-cares may be used as 1 or 0.', check: { q: 'Why must K-map groups be 1, 2, 4, 8 cells?', a: 'Each doubling covers both values of one more variable, so that variable drops out.' } }, ['b1', 'b2']),
  S('s07', 'Full adder, derived', 30, 25, [0, 1], 'Derive sum and carry from the truth table, code the full adder, test all 8 cases with a self-checking loop.',
    { concept: 'S = A ⊕ B ⊕ Cin; Cout = AB + Cin(A ⊕ B).', check: { q: 'What are S and Cout for A=1, B=1, Cin=1?', a: 'S = 1, Cout = 1 (1+1+1 = 11₂).' } }, ['b1']),
  S('s08', 'Ripple-carry assembly', 45, 30, [0, 2], 'Instantiate four full adders into a 4-bit RCA (named port connections). Testbench: all 256 (a, b) pairs vs a + b; print the mismatch count.',
    { concept: 'In an RCA the carry ripples through every stage, so delay grows linearly with width — the reason carry-lookahead exists.', resource: R.hdlbits, check: { q: 'What limits the speed of a ripple-carry adder?', a: 'The carry chain: worst-case delay passes through every full adder.' } }, ['b1']),
  S('s09', 'HDLBits: vectors & hierarchy', 40, 25, [1, 2], 'Solve 10 problems across HDLBits → Vectors and → Modules: Hierarchy.',
    { concept: 'Connect ports by name (.a(x)) — order-independent and safe when a module\'s port list changes.', resource: R.hdlbits, check: { q: 'Why connect ports by name instead of position?', a: 'It survives port re-ordering and makes mistakes visible.' } }, ['b2']),
  S('s10', 'Parameterised comparator', 35, 30, [1, 3], 'Write an N-bit magnitude comparator with a parameter WIDTH. Simulate at N = 4 and N = 8 with corner cases (equal, max, 0).',
    { concept: 'Parameters make one module reusable at many widths; localparam is a constant that cannot be overridden from outside.', resource: R.chipverify, check: { q: 'parameter vs localparam?', a: 'A parameter can be overridden at instantiation; a localparam cannot.' } }, ['b2']),
  S('s11', 'Decoder & priority encoder', 30, 25, [1, 2], 'Build a 3:8 decoder and an 8:3 priority encoder with a valid output. Testbench every input.',
    { concept: 'A priority encoder outputs the index of the highest-priority active input; "valid" says whether any input was active.', check: { q: 'Inputs 3 and 6 are both high in an 8:3 priority encoder (higher index wins). Output?', a: '6 (110), valid = 1.' } }, ['b2']),
  S('s12', 'The signed-overflow trap', 35, 30, [1, 3], 'For an 8-bit signed adder, write the overflow flag and test it on +127+1, −128−1, and 20 random pairs.',
    { concept: 'Signed overflow happens when both operands share a sign and the result\'s sign differs.', check: { q: 'Overflow condition for signed A + B = S?', a: 'V = (A[n−1] == B[n−1]) && (S[n−1] != A[n−1]).' } }, ['b2']),
  S('s13', 'A self-checking testbench', 40, 35, [1, 4], 'Give your current module a reference model in the testbench, a mismatch counter, and $fatal if any check fails. Run it from one command.',
    { why: 'Verification engineers write testbenches that judge themselves; staring at waveforms does not scale past 10 signals.', concept: 'Self-checking TB: drive stimulus, compute the expected result independently, compare, count, fail loudly.', resource: R.chipverify, check: { q: 'Why compute expected values with a different method than the DUT?', a: 'Copying the DUT\'s logic would copy its bugs; an independent model catches them.' } }, ['b2', 'b4']),
  S('s14', 'HDLBits: combinational circuits', 45, 30, [1, 3], 'Solve 10 problems in HDLBits → Circuits → Combinational Logic.',
    { concept: 'Combinational logic has no memory: outputs depend only on current inputs. In always @* blocks, assign every output on every path or you infer a latch.', resource: R.hdlbits, check: { q: 'What do you get if an always @* block misses an else branch for an output?', a: 'An inferred latch.' } }, ['b2']),
  S('s15', 'Reset styles, side by side', 30, 25, [2, 3], 'Write a DFF with synchronous reset and one with asynchronous reset. One testbench shows the difference in the waveform.',
    { concept: 'Asynchronous reset acts immediately (in the sensitivity list); synchronous reset waits for the clock edge.', check: { q: 'Which reset style appears in the sensitivity list?', a: 'Asynchronous: always @(posedge clk or posedge rst).' } }, ['b3']),
  S('s16', 'Blocking vs non-blocking', 30, 25, [2, 3], 'Write a 3-stage shift register twice: once with =, once with <=. Simulate both and explain the difference in 3 lines.',
    { concept: 'Use <= in clocked blocks (all flops update together) and = in combinational blocks.', check: { q: 'What happens to a 3-stage shift register written with = in one clocked block?', a: 'The value passes through all stages in one cycle — it collapses into one register.' } }, ['b3']),
  S('s17', 'Counters', 35, 25, [2, 3], 'Build an up/down counter with enable and a mod-10 counter. Testbench shows wrap-around in both directions.',
    { concept: 'A mod-N counter resets to 0 when it reaches N−1 (+1); counters are the timers inside every FSM.', check: { q: 'How many flip-flops does a mod-10 counter need?', a: '4 (2³ = 8 < 10 ≤ 16).' } }, ['b3']),
  S('s18', '"1011" detector — on paper', 30, 25, [2, 3], 'Draw the Mealy state diagram for an overlapping "1011" detector; derive the state table. Photograph it for the boss repo.',
    { concept: 'Mealy outputs depend on state AND input (react in the same cycle); Moore outputs depend on state only (one cycle later, glitch-free).', check: { q: 'For overlapping 1011 detection, where do you go after detecting 1011?', a: 'To the state meaning "seen 1" (the last 1 can start the next pattern) — not back to idle.' } }, ['b3']),
  S('s19', 'Traffic-light FSM', 50, 35, [2, 4], 'Code a Moore traffic-light controller in 3-block style with a timer counter. Verify state durations in the waveform.',
    { concept: '3-block FSM: (1) state register, (2) next-state logic, (3) output logic. It keeps registered and combinational logic apart.', resource: R.hdlbits, check: { q: 'Why separate next-state logic from the state register?', a: 'Clean flop inference, no accidental latches, easier to read and verify.' } }, ['b3']),
  S('s20', 'HDLBits: FSM set', 45, 30, [2, 4], 'Solve 8 problems in HDLBits → Sequential Logic → Finite State Machines.',
    { concept: 'One-hot vs binary encoding: one-hot uses more flops but simpler, faster next-state logic — common in FPGAs.', resource: R.hdlbits }, ['b3']),
  S('s21', 'Setup & hold by hand', 35, 30, [2, 5], 'Compute setup and hold slack for 5 timing paths given clock period, clk→q, logic delay, setup/hold and skew.',
    { why: '"Fix this hold violation" is one of the most common VLSI interview questions.', concept: 'Setup slack = T − (t_cq + t_logic + t_setup) + skew. Hold slack = (t_cq + t_logic) − t_hold − skew.', check: { q: 'Can a hold violation be fixed by slowing the clock?', a: 'No — hold does not depend on the clock period. Add delay on the path (or reduce skew).' } }, ['b3', 'b13']),
  S('s22', 'Baud-rate generator', 30, 25, [3, 4], 'Write a tick generator from CLK_FREQ / BAUD. Measure the tick period in simulation and compare with the expected value.',
    { concept: 'A counter divides the system clock: one tick every CLK_FREQ / BAUD cycles.', check: { q: 'Clock cycles per bit at 50 MHz and 115200 baud?', a: '≈ 434 (50,000,000 / 115,200).' } }, ['b4']),
  S('s23', 'UART TX', 50, 35, [3, 5], 'UART transmitter, 8N1: idle-high line, start bit 0, 8 data bits LSB first, stop bit 1, busy flag. Send 0x55 and 0xA3 in the TB.',
    { concept: 'UART frames are asynchronous: no shared clock, only an agreed baud rate. 0x55 alternates bits — perfect for checking bit timing.', resource: R.nandland, check: { q: 'In what order are UART data bits sent?', a: 'Least-significant bit first.' } }, ['b4']),
  S('s24', 'UART RX, mid-bit sampling', 50, 35, [3, 5], 'UART receiver: detect the start edge, wait half a bit, then sample every bit at its centre. Loop it back to your TX and send "Hello".',
    { concept: 'Sampling in the middle of each bit tolerates small baud mismatches; 16× oversampling is the common way.', check: { q: 'Why sample in the middle of the bit?', a: 'It is farthest from both edges, so clock mismatch and jitter are least likely to cause a wrong read.' } }, ['b4']),
  S('s25', 'One-command sim flow', 25, 20, [1, 6], 'Write a Makefile: "make" compiles and runs your testbench, "make wave" opens GTKWave.',
    { concept: 'Reproducibility: anyone (including you in a month) runs every test with one command. CI later uses the same entry point.' }, ['b7']),
  S('s26', 'SystemVerilog: interfaces & logic', 35, 25, [4, 6], 'Port your ALU testbench to SystemVerilog: logic types, an interface with modports, a clocking block.',
    { concept: 'logic replaces most wire/reg uses; interfaces bundle signals so drivers and monitors share one handle.', resource: R.chipverify, check: { q: 'What does a modport define?', a: 'The direction of the interface signals as seen by one side (e.g. DUT vs testbench).' } }, ['b5']),
  S('s27', 'Classes & constrained random', 40, 30, [4, 6], 'Write a transaction class with rand fields and two constraints. Randomize 20 objects and print them. Add one constraint that must fail and handle it.',
    { concept: 'randomize() solves the constraints; it returns 1 on success and 0 when they cannot be satisfied.', resource: R.chipverify, check: { q: 'What does randomize() return when constraints conflict?', a: '0 (failure) — always check it.' } }, ['b5']),
  S('s28', 'Covergroups', 40, 30, [4, 6], 'Add a covergroup over opcode × operand class (zero / max / negative / random). Run until coverage stops rising; list the holes.',
    { concept: 'Code coverage says what lines ran; functional coverage says which scenarios you actually tested.', check: { q: 'Code coverage vs functional coverage?', a: 'Code: which code executed. Functional: which spec scenarios were exercised (you define them).' } }, ['b5']),
  S('s29', 'Three assertions', 35, 30, [4, 7], 'Add 3 SystemVerilog assertions to your UART or FIFO (e.g. busy never drops mid-frame). Break the design on purpose and trip each one.',
    { concept: 'Concurrent assertions check temporal rules every clock: assert property (@(posedge clk) req |-> ##[1:3] ack);', check: { q: 'What does |-> mean?', a: 'Overlapping implication: if the left side matches, the right side must hold starting in the same cycle.' } }, ['b5', 'b13']),
  S('s30', 'Metastability & the 2-FF synchroniser', 30, 25, [5, 7], 'Write a two-flop synchroniser. In the README, explain metastability and why a second flop raises MTBF.',
    { why: 'CDC questions separate freshers who memorised from freshers who understand.', concept: 'A flop sampling a changing input can go metastable; a second flop gives it a full cycle to resolve, raising MTBF exponentially.', check: { q: 'Why can\'t a 2-FF synchroniser pass a multi-bit binary counter safely?', a: 'Bits may resolve in different cycles, giving a value that never existed — hence gray code or handshakes.' } }, ['b13']),
  S('s31', 'Read Cummings on async FIFOs', 45, 30, [5, 7], 'Read Clifford Cummings, "Simulation and Synthesis Techniques for Asynchronous FIFO Design". Summarise the pointer logic in 10 lines.',
    { concept: 'Gray-code pointers change one bit per increment, so a synchronised pointer is either the old or the new value, never garbage.', resource: R.sunburst, check: { q: 'Why use gray code for async FIFO pointers?', a: 'Only one bit changes per step, so synchronisation cannot produce an invalid in-between value.' } }, ['b13']),
  S('s32', 'Async FIFO build', 60, 40, [5, 7], 'Implement the async FIFO: binary/gray pointers, 2-FF synchronisers both ways, full and empty. Testbench with 100 MHz write and 37 MHz read clocks.',
    { concept: 'Full/empty compare synchronised gray pointers with one extra MSB to tell "full" from "empty".', resource: R.sunburst }, ['b13']),
  S('s33', 'RISC-V decode table', 40, 30, [5, 7], 'From the spec, tabulate opcode / funct3 / funct7 and control signals for ADD, SUB, AND, OR, ADDI, LW, SW, BEQ, JAL.',
    { concept: 'RV32I keeps register fields in fixed positions across formats, which makes the decoder small.', resource: R.riscv, check: { q: 'Which RV32I register always reads zero?', a: 'x0.' } }, ['b6']),
  S('s34', 'Register file', 35, 30, [5, 7], 'A 32×32 register file: two read ports, one write port, x0 hard-wired to zero. Testbench proves writes to x0 are ignored.',
    { concept: 'Reads are combinational, writes happen on the clock edge; x0 = 0 simplifies the ISA (mv, nop, compares).', resource: R.riscv }, ['b6']),
  S('s35', 'Immediate generator', 35, 30, [5, 7], 'Decode I, S, B, U and J immediates with sign extension. Test one encoded instruction per format.',
    { concept: 'B and J immediates are scrambled in the encoding so the sign bit is always bit 31 — sign extension stays one wire.', resource: R.riscv }, ['b6']),
  S('s36', 'One instruction, end to end', 50, 40, [6, 8], 'Run ADDI through your datapath: fetch, decode, read, ALU, write back. Verify the register value in the waveform.',
    { concept: 'Single-cycle: every instruction completes in one (long) cycle; pipelining later splits that path into stages.' }, ['b6']),
  S('s37', 'Verilator lint pass', 30, 25, [3, 10], 'Run verilator --lint-only -Wall on your flagship design and fix every warning (or justify it in a comment).',
    { concept: 'Linting catches width mismatches, latches and unused signals before simulation ever runs.', resource: R.verilator }, ['b7']),
  S('s38', 'CI on GitHub Actions', 40, 35, [5, 10], 'Add a workflow that installs iverilog/Verilator and runs "make test" on every push. Put the badge in the README.',
    { concept: 'Continuous integration proves your tests pass for everyone, not just on your laptop.', resource: R.ghactions }, ['b7']),
  S('s39', 'README like a datasheet', 40, 30, [3, 10], 'For your best repo: block diagram, port table, how to run, results (waveform + numbers). No "WIP".',
    { why: 'Reviewers click one repo and read one page.', concept: 'Document like a datasheet: what it is, its interface, how to verify it, measured results.' }, ['b7', 'b12']),
  S('s40', 'GATE numericals: digital', 40, 25, [0, 10], 'Solve 15 GATE-style digital-electronics numericals in 40 minutes. Re-solve every wrong one without looking.',
    { why: 'Your roadmap asks for 50 numericals a week; timed sets build exam speed and interview fluency.', concept: 'Error log: write the category of each miss (concept, arithmetic, misread) — patterns tell you what to study.' }),
  S('s41', 'Explain it back', 25, 20, [0, 10], 'Write 150 words explaining today\'s concept to a first-year student, without notes. Fix what you couldn\'t explain.',
    { concept: 'The Feynman technique: gaps in your explanation are gaps in your understanding.' }),
  S('s42', 'Synthesize and read the report', 30, 25, [2, 8], 'Synthesize your ALU with Yosys; note cell counts. Change one coding style (case vs if-chain) and compare.',
    { concept: 'Synthesis turns RTL into gates; coding style changes the netlist, and the report is where you see it.', resource: R.yosys }, ['b2', 'b7']),
  S('s43', 'CMOS inverter basics', 30, 25, [4, 10], 'Sketch the CMOS inverter, its voltage-transfer curve, and mark the noise margins. Explain static vs dynamic power in 3 lines.',
    { why: 'Aptitude interviews for German master\'s programmes often start from device basics.', concept: 'Dynamic power ≈ α·C·V²·f; static power is leakage, because in steady state the pull-up or pull-down network is off.', check: { q: 'Why does an ideal CMOS gate draw almost no static current?', a: 'In steady state one network is always off, so there is no direct VDD→GND path (leakage aside).' } }),
]

/* ======================================================================= DEUTSCH — Frau Weiss */
const D = (id: string, title: string, minutes: number, xp: number, months: [number, number], task: string, intel: Intel, bosses?: string[]) =>
  c({ id, npc: 'weiss', track: 'deutsch', title, minutes, xp, months, task, intel, bosses })

export const DEUTSCH: ContractDef[] = [
  D('d01', 'Nicos Weg: the next lesson', 20, 15, [1, 12], 'Do the next DW Nicos Weg lesson. Write 5 new words with their articles in your notebook.',
    { why: 'A free, structured A1→B1 course: no money, no excuses.', concept: 'Always learn a noun WITH its article and plural: der Tisch, die Tische.', resource: R.nicos }, ['b11']),
  D('d02', 'Der, die, das — sprint', 15, 15, [1, 5], 'Learn 20 nouns with their articles. Colour-code them (der blue, die red, das green) and test yourself twice.',
    { concept: 'Endings help: -ung, -heit, -keit, -schaft → die; -chen, -lein → das; days, months, seasons → der.', check: { q: 'Article for "Zeitung"?', a: 'die (-ung nouns are feminine).' } }, ['b11']),
  D('d03', 'Sein & haben', 15, 15, [1, 3], 'Conjugate sein and haben in all persons; write 10 sentences about yourself using both.',
    { concept: 'ich bin, du bist, er ist, wir sind, ihr seid, sie sind · ich habe, du hast, er hat, wir haben, ihr habt, sie haben.', check: { q: 'ich ___ müde (sein)', a: 'bin.' } }, ['b11']),
  D('d04', 'Numbers & clock time', 15, 15, [1, 4], 'Count 0–100 aloud. Then say 10 random clock times aloud, informally ("Viertel nach drei").',
    { concept: 'Numbers read units first: 21 = einundzwanzig. "halb drei" means half TO three = 2:30.', check: { q: '"halb drei" is what time?', a: '2:30.' } }, ['b11']),
  D('d05', 'Introduce yourself', 15, 20, [1, 4], 'Write and record a 60-second self-introduction: Name, Alter, Land, Wohnort, Sprachen, Beruf/Studium, Hobby.',
    { why: 'Goethe A1 Sprechen Teil 1 is exactly this.', concept: 'Ich heiße … · Ich bin … Jahre alt · Ich komme aus Indien · Ich studiere Elektrotechnik.' }, ['b11']),
  D('d06', 'Akkusativ offensive', 20, 20, [2, 7], 'Write 10 sentences with an Akkusativ object (der → den, ein → einen). Say each aloud twice.',
    { concept: 'Only the masculine changes in Akkusativ: den/einen. die/das/eine/ein stay the same.', check: { q: 'Ich sehe ___ Hund. (der Hund)', a: 'den.' } }, ['b11']),
  D('d07', 'Dativ basics', 20, 20, [4, 9], 'Write 10 sentences with mit, zu, bei, nach, von + Dativ.',
    { concept: 'Dativ: der/das → dem, die → der, plural → den (+n). mit, zu, bei, nach, von, aus, seit always take Dativ.', check: { q: 'Ich fahre mit ___ Bus. (der Bus)', a: 'dem.' } }),
  D('d08', 'Modal verbs', 20, 20, [3, 8], 'Write 10 sentences with können, müssen, wollen, dürfen. The infinitive goes to the END.',
    { concept: 'Satzklammer: the modal is in position 2, the infinitive at the end: Ich muss heute Deutsch lernen.', check: { q: 'Order the words: muss / ich / heute / lernen / Deutsch', a: 'Ich muss heute Deutsch lernen.' } }, ['b11']),
  D('d09', 'Perfekt report', 25, 25, [5, 12], 'Write 8 sentences about yesterday in the Perfekt. Mark which verbs take sein.',
    { concept: 'Perfekt = haben/sein + Partizip II at the end. Verbs of movement or change of state take sein: Ich bin gegangen.', check: { q: 'Ich ___ nach Hause gegangen.', a: 'bin.' } }),
  D('d10', 'Listening intercept', 20, 20, [3, 12], 'Watch one DW video without subtitles. Write 5 things you understood, then check with subtitles.',
    { concept: 'Comprehensible input: listen slightly above your level, often. Understanding the gist is the goal, not every word.', resource: R.dw }, ['b11']),
  D('d11', 'Shadowing', 15, 15, [1, 12], 'Shadow 3 minutes of native audio: play a sentence, pause, repeat it with the same rhythm and melody.',
    { concept: 'Shadowing trains pronunciation and listening at once; German stress usually falls on the first syllable of the stem.' }),
  D('d12', 'Write a short message', 20, 20, [3, 12], 'Goethe A1 Schreiben style: a 30-word message (invite a friend, cancel an appointment, ask for information). Cover all 3 content points.',
    { why: 'Schreiben Teil 2 asks for exactly this.', concept: 'Opening (Liebe/Lieber …), three content points, closing (Viele Grüße).' }, ['b11']),
  D('d13', 'A1 mock: Hören', 25, 25, [4, 7], 'Do one timed Hören part from the official A1 practice set. Score it with the answer key.',
    { concept: 'Read the questions BEFORE the audio plays; the exam gives you time for this — use it.', resource: R.goetheA1 }, ['b11']),
  D('d14', 'A1 mock: Lesen', 25, 25, [4, 7], 'Do one timed Lesen part from the official A1 practice set. Score it.',
    { concept: 'Scan for the information asked (times, prices, places); you do not need every word.', resource: R.goetheA1 }, ['b11']),
  D('d15', 'A1 Sprechen cards', 20, 25, [4, 7], 'Practise Sprechen Teil 2 and 3: make 6 questions and 6 requests from topic cards (Essen, Wohnen, Freizeit). Record them.',
    { concept: 'Teil 2: ask about a topic word (W-Frage). Teil 3: make a polite request: Können Sie … bitte …?' }, ['b11']),
  D('d16', 'Renting vocabulary', 15, 15, [6, 12], 'Learn 20 words you will need to rent a room: Miete, Kaltmiete, Warmmiete, Nebenkosten, Kaution, WG, Mietvertrag, Anmeldung…',
    { why: 'You will read a German rental contract within a year of landing.', concept: 'Kaltmiete = rent without utilities; Warmmiete = rent including heating and service charges (Nebenkosten).', check: { q: 'What is a Kaution?', a: 'A rental deposit.' } }),
  D('d17', 'University vocabulary', 15, 15, [6, 12], 'Learn 20 university words: Vorlesung, Übung, Prüfung, Studiengang, Bewerbung, Zulassung, Immatrikulation, Semesterbeitrag…',
    { concept: 'Zulassung = admission; Immatrikulation = enrolment; Semesterbeitrag = semester contribution.' }),
  D('d18', 'weil & dass — verb to the end', 20, 20, [7, 12], 'Write 10 sentences with weil and dass. The conjugated verb goes to the very end.',
    { concept: 'Subordinate clauses push the conjugated verb to the end: …, weil ich in Deutschland studieren will.', check: { q: 'Ich lerne Deutsch, weil ich in Deutschland studieren ___ (wollen).', a: 'will (at the end).' } }),
  D('d19', 'A2 mock section', 30, 30, [9, 12], 'Do one timed section of an A2 practice exam. Score it and log the weakest part.',
    { concept: 'A2 adds past tense, Dativ, comparisons and longer texts; the exam format mirrors A1.', resource: R.goetheTrain }),
]

/* ======================================================================= CAPITAL — Rhea Kapoor */
const K = (id: string, title: string, minutes: number, xp: number, months: [number, number], task: string, intel: Intel, bosses?: string[]) =>
  c({ id, npc: 'rhea', track: 'capital', title, minutes, xp, months, task, intel, bosses })

export const CAPITAL: ContractDef[] = [
  K('k01', 'CV skeleton', 40, 30, [1, 12], 'Build a one-page CV: education, projects (above certificates), skills, links. No "objective" paragraph.',
    { why: 'Every application this year — internship, job, university — starts with this page.', concept: 'Freshers are hired on projects; put them high, with links and numbers.', resource: R.europass }, ['b12']),
  K('k02', 'Quantify three bullets', 20, 20, [1, 12], 'Rewrite 3 CV bullets as: built X, verified with Y, result Z — with numbers.',
    { concept: '"Designed a UART" < "Designed a parameterised UART (8N1, 115200 baud); loopback testbench, 0 mismatches over 10k bytes".' }, ['b12']),
  K('k03', 'GitHub profile that sells', 30, 25, [1, 12], 'Pin your 3 best repos, write a profile README (what you build, what you are learning), delete or archive junk.',
    { concept: 'Your GitHub is a portfolio; reviewers judge it in seconds by the pinned repos and READMEs.' }, ['b12']),
  K('k04', 'LinkedIn: headline & about', 30, 25, [1, 12], 'Headline: "ECE student · RTL & verification · Verilog/SystemVerilog". About: 4 lines + links.',
    { concept: 'Recruiters search keywords; put the skills you can prove in the headline.', resource: R.linkedin }, ['b12']),
  K('k05', 'Target list', 40, 30, [3, 12], 'List 25 companies or labs doing VLSI / embedded work in India: careers page, one person to contact, internship timing.',
    { concept: 'Targeting beats volume: a list makes applying a daily 20-minute task instead of a dreaded event.' }, ['b12']),
  K('k06', 'One tailored application', 30, 30, [4, 12], 'Apply to one internship or role with one tailored line about why you fit. Log it in your tracker with a follow-up date.',
    { concept: 'Tailor the top: mirror the job post\'s skills you can prove; link the matching repo.', resource: R.internshala }, ['b12']),
  K('k07', 'Ask for a referral', 20, 25, [3, 12], 'Message one senior, alum or engineer with a specific ask: a referral for a named role, with your CV and one repo link.',
    { concept: 'Specific asks get answers: role, link, why you, one line. Vague "any openings?" messages get ignored.' }, ['b12']),
  K('k08', 'Mock interview', 45, 35, [4, 12], 'Record yourself answering 5 VLSI drill questions out loud, as in an interview. Watch it; rewrite the weakest answer.',
    { concept: 'Interview skill is recall under pressure; rehearsing aloud is a different skill from knowing.' }),
  K('k09', 'Aptitude set', 30, 20, [1, 12], 'Solve 20 quantitative / logical aptitude questions in 30 minutes. Log error categories.',
    { why: 'Campus and off-campus screens often start with an aptitude test — and the dMAT is a reasoning test too.', concept: 'Speed comes from patterns: percentages, ratios, time-work, sequences.' }),
  K('k10', 'Job-post teardown', 25, 20, [2, 12], 'Take 3 fresher RTL/DV job posts. List the required skills; mark which you can PROVE with a repo or certificate.',
    { concept: 'The gaps you find are next month\'s contracts.' }),
  K('k11', 'Certification recon', 20, 15, [1, 10], 'Check NPTEL\'s next-semester list for a Verilog or VLSI course. Note enrolment and exam dates in Trials.',
    { why: 'An IIT-run NPTEL certificate costs about ₹1,000 per exam and is recognised by Indian recruiters.', concept: 'Courses are free to audit; you pay only for the proctored exam that gives the certificate.', resource: R.nptel }),
  K('k12', 'War Chest check-in', 15, 15, [1, 12], 'Update your savings in the Armory\'s War Chest. Read the next payment that falls due and its date.',
    { concept: 'Money becomes manageable when it is a dated list instead of a fog.' }),
  K('k13', 'Funding recon', 30, 20, [2, 12], 'Research funding paths and note 3 with dates: education-loan options, the DAAD scholarship database, Deutschlandstipendium (after enrolment).',
    { why: 'Research, not advice: verify every figure with the provider.', concept: 'The blocked account (€11,904/year) is the big number; plan its source a year ahead.', resource: R.daadschol }),
  K('k14', 'Earn with your skill', 30, 20, [1, 12], 'List 3 ways to earn money with what you already know (tutoring juniors in digital logic, small Arduino/ESP32 projects). Pick one to try this month.',
    { concept: 'Small income now builds the war chest and the CV at the same time.' }),
  K('k15', 'Story bank', 30, 25, [3, 12], 'Write 3 STAR stories: a bug you fixed, a project you finished, a time something went wrong.',
    { concept: 'STAR: Situation, Task, Action, Result. Behavioural questions are scored on the Action and the Result.' }),
]

/* ======================================================================= PAPERWORK — The Chancellor */
const P = (id: string, title: string, minutes: number, xp: number, months: [number, number], task: string, intel: Intel, bosses?: string[]) =>
  c({ id, npc: 'chancellor', track: 'paper', title, minutes, xp, months, task, intel, bosses })

export const PAPER: ContractDef[] = [
  P('p01', 'Recon: RWTH EE & IT', 25, 20, [1, 12], 'Read the official RWTH EE & IT master page. Record: language, non-EU deadline, required ECTS (maths/physics/EE), tuition.',
    { why: 'English-taught, no tuition, a Micro- & Nanoelectronics major — and the earliest deadline (1 March for non-EU).', concept: 'Curricular match (ECTS per area) decides admission as much as grades.', resource: R.rwth }, ['b9']),
  P('p02', 'Recon: TU Dresden NES', 25, 20, [1, 12], 'Read the TU Dresden Nanoelectronic Systems page. Record: language, deadline, English score, tuition, required background.',
    { concept: 'TU Dresden sits in "Silicon Saxony" — Europe\'s largest microelectronics cluster.', resource: R.tud }, ['b9']),
  P('p03', 'Recon: TUM Chip Design', 25, 20, [1, 12], 'Read the TUM Microelectronics & Chip Design page. Record: tuition for non-EU students, the aptitude-assessment stages, the window.',
    { why: 'English and a real tape-out — but TUM charges non-EU students tuition. Know the number before you aim.', concept: 'TUM\'s EE & IT master is mainly German-taught and asks for German proof; Chip Design is the English route.', resource: R.tummcd }, ['b9']),
  P('p04', 'DAAD database sweep', 30, 20, [1, 12], 'Search DAAD International Programmes: master\'s, electrical engineering / microelectronics, English. Add 5 programmes to your shortlist.',
    { concept: 'The DAAD database lists English-taught programmes with deadlines, fees and language rules in one place.', resource: R.daad }, ['b9']),
  P('p05', 'Your German grade', 20, 15, [1, 12], 'Compute your grade with the modified Bavarian formula. Find your university\'s minimum passing grade first.',
    { concept: 'German grade = 1 + 3 × (Nmax − Nd) / (Nmax − Nmin). 1.0 is best, 4.0 is a pass.', check: { q: 'Nmax = 10, Nmin = 4, CGPA 8.0 → German grade?', a: '1 + 3 × (10 − 8) / (10 − 4) = 2.0.' } }),
  P('p06', 'ECTS audit', 40, 30, [2, 12], 'Map every course you have passed into maths / physics / EE / CS buckets with credits. Compare with one programme\'s requirement.',
    { concept: 'One ECTS ≈ 25–30 hours of work; a master is 120 ECTS. Missing credits can mean rejection or conditional admission.' }, ['b9']),
  P('p07', 'APS: read the leaflet', 20, 15, [6, 12], 'Read the current APS India leaflet for graduates. List every document; tick the ones you already have.',
    { why: 'APS gates every German application from India; the fee is ₹18,000 (June 2026 leaflet) and it is not refundable.', concept: 'APS verifies your documents; for engineering degrees the dMAT is now part of the file.', resource: R.aps }, ['b9']),
  P('p08', 'dMAT watch', 10, 10, [1, 12], 'Check the APS dMAT page for new test dates and registration windows. Note them in Trials.',
    { concept: 'dMAT: a 3.5-hour English reasoning test (figure sequences, equations, Latin squares + an academic module), required in the APS file for engineering master\'s applicants.', resource: R.dmat }, ['b8', 'b9']),
  P('p09', 'IELTS battle plan', 20, 15, [6, 11], 'Choose a test date and centre. Work backwards: 6 weeks of prep, 2 full mocks, a buffer before APS and deadlines.',
    { concept: 'IELTS results are valid for 2 years; 6.5 is a common minimum for English-taught master\'s programmes.', resource: R.ielts }, ['b8']),
  P('p10', 'SOP outline', 40, 30, [9, 12], 'Outline your SOP in 5 paragraphs: a concrete moment that made you choose VLSI, your preparation (courses + projects), why this programme (2 modules, 1 lab), goals, fit.',
    { concept: 'German SOPs are academic and specific: courses, labs and projects — not life stories.' }, ['b9']),
  P('p11', 'LOR brag sheet', 30, 25, [9, 12], 'Write a one-page brag sheet for each recommender: courses with them, your grades there, projects, what you want highlighted.',
    { concept: 'Professors write better letters when you hand them the specifics.' }, ['b9']),
  P('p12', 'Deadline calendar', 20, 15, [1, 12], 'Put every known deadline (exams, APS, dMAT, applications) in your calendar with alarms 3 weeks early.',
    { concept: 'A deadline you see 3 weeks ahead is a plan; one you see 3 days ahead is a crisis.' }),
  P('p13', 'Passport check', 10, 10, [1, 9], 'Check your passport\'s expiry. It should be valid well beyond your planned arrival in 2028; if not, plan the renewal now.',
    { concept: 'Every step after admission (blocked account, visa) needs a valid passport — renewal takes weeks.' }),
]

export const ALL_CONTRACTS: ContractDef[] = [...SILICON, ...DEUTSCH, ...CAPITAL, ...PAPER]
export const CONTRACT_BY_ID: Record<string, ContractDef> = Object.fromEntries(ALL_CONTRACTS.map((x) => [x.id, x]))

/* ======================================================================= Boot Camp — days 1-7 */
export interface BootDay { day: number; title: string; task: string; auto: string }
export const BOOT_CAMP: BootDay[] = [
  { day: 1, title: 'Secure the floor', task: 'Tick all three reps today — any size counts. Ten minutes of each is enough.', auto: 'floor' },
  { day: 2, title: 'First Crucible', task: 'Run a 25-minute Crucible on Silicon. Nothing else open.', auto: 'focus25' },
  { day: 3, title: 'Drill 20 cards', task: 'Open Drill and review 20 cards in any deck.', auto: 'drill20' },
  { day: 4, title: 'A contract with proof', task: 'Complete one contract and attach proof (a link, a photo or a note).', auto: 'contract' },
  { day: 5, title: 'Stock the Armory', task: 'Set the real-life rewards you will buy with Marks, and their prices.', auto: 'shop' },
  { day: 6, title: 'Face the boss', task: 'Open the Campaign, read this month\'s boss, and do its first step.', auto: 'campaign' },
  { day: 7, title: 'Commit to an operation', task: 'Choose a weekly operation (or preview Monday\'s), then ask JARVIS for a brief.', auto: 'brief' },
]

/* ======================================================================= generation */
export type Slot = 'silicon' | 'deutsch' | 'capital' | 'paper' | 'silicon2'

/** Weekday → slots. The rest day (Sunday by default, movable) gets none. */
export const SLOTS: Record<number, Slot[]> = {
  1: ['silicon', 'deutsch', 'capital'],
  2: ['silicon', 'deutsch', 'paper'],
  3: ['silicon', 'deutsch', 'capital'],
  4: ['silicon', 'deutsch', 'paper'],
  5: ['silicon', 'deutsch', 'capital'],
  6: ['silicon', 'silicon2', 'deutsch'],
  0: ['silicon', 'deutsch', 'capital'],
}

export interface DailyContract {
  /** Dated id: unique per day, so the same task can come back another week. */
  key: string
  slot: Slot
  def: ContractDef
  crit: boolean
}

export interface GenContext {
  date: string
  rank: number
  seasonMonth: number
  activeBossIds: string[]
  /** Reroll counts per slot for this date. */
  rerolls?: Partial<Record<string, number>>
  /** Today is the week's rest day: no contracts. */
  rest: boolean
}

function eligible(pool: ContractDef[], ctx: GenContext): ContractDef[] {
  return pool.filter((d) =>
    (!d.rank || (ctx.rank >= d.rank[0] && ctx.rank <= d.rank[1])) &&
    (!d.months || (ctx.seasonMonth >= d.months[0] && ctx.seasonMonth <= d.months[1])))
}

function poolFor(slot: Slot): ContractDef[] {
  return slot === 'silicon' || slot === 'silicon2' ? SILICON : slot === 'deutsch' ? DEUTSCH : slot === 'capital' ? CAPITAL : PAPER
}

export function dailyContracts(ctx: GenContext): DailyContract[] {
  if (ctx.rest) return []
  const slots = SLOTS[weekday(ctx.date)] ?? SLOTS[1]
  const taken = new Set<string>()
  const out: DailyContract[] = []
  slots.forEach((slot) => {
    const rr = ctx.rerolls?.[slot] ?? 0
    const rand = rngFor(`contract|${ctx.date}|${slot}|${rr}|R${ctx.rank}`)
    let pool = eligible(poolFor(slot), ctx).filter((d) => !taken.has(d.id))
    if (!pool.length) pool = poolFor(slot).filter((d) => !taken.has(d.id))
    if (!pool.length) return
    const weights = pool.map((d) => (d.bosses?.some((b) => ctx.activeBossIds.includes(b)) ? 3 : 1))
    const def = pool[pickWeighted(weights, rand)]
    taken.add(def.id)
    out.push({ key: `${ctx.date}:${slot}:${def.id}`, slot, def, crit: false })
  })
  if (out.length) {
    const critIdx = Math.floor(rngFor(`crit|${ctx.date}`)() * out.length)
    out[critIdx] = { ...out[critIdx], crit: true }
  }
  return out
}
