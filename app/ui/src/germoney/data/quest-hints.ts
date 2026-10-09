/**
 * QUEST HINTS — deterministic, offline "how to crack it" intel for any quest.
 *
 * `getQuestHints` matches keywords in a quest's title/description against a
 * priority-ordered rule table sourced from docs/03_SKILL_TREE.md and general
 * ECE practice. Every hint is meant to be actionable: it names the exact tool,
 * command, or free resource to reach for. No AI, no network — this is the
 * fallback intelligence layer that always works.
 */

export interface QuestResource {
  label: string;
  url: string;
}

export interface QuestHints {
  hints: string[];
  resources: QuestResource[];
}

interface QuestLike {
  id: string;
  title: string;
  desc: string;
}

interface HintRule {
  /** Keywords (lowercase) — any match selects this rule. */
  match: string[];
  hints: string[];
  resources: QuestResource[];
}

/**
 * Ordered most-specific → most-general. The first rule whose keyword appears in
 * the combined title+desc wins, so put narrow topics (UART) above broad ones
 * (verilog).
 */
const RULES: HintRule[] = [
  {
    match: ['uart', 'serial', 'rs-232', 'rs232'],
    hints: [
      'Start with the frame: 1 start bit (low), 8 data bits LSB-first, optional parity, 1 stop bit (high). Idle line sits high.',
      'Build a baud-tick generator first — a counter that pulses once every (clk_freq / baud_rate) cycles. Everything else is clocked off that tick.',
      'Model the TX as an FSM: IDLE → START → DATA (shift 8 bits) → STOP. Drive a shift register, not 8 separate assigns.',
      'Verify in GTKWave: dump the tx line and confirm bit widths match your baud period exactly before trusting it.',
    ],
    resources: [
      { label: 'nandland — UART project (Verilog)', url: 'https://nandland.com/uart-serial-port-module/' },
      { label: 'HDLBits — sequential/FSM problems', url: 'https://hdlbits.01xz.net/wiki/Exams/review2015_uart' },
    ],
  },
  {
    match: ['fsm', 'state machine', 'moore', 'mealy', 'traffic'],
    hints: [
      'Draw the state diagram on paper first. Name every state, list the exact transition condition on each arrow, then translate — never code an FSM you have not drawn.',
      'Use the 2-block (or 3-block) style: one clocked always block for state register, one combinational always block for next-state/output logic.',
      'For a Moore machine, outputs depend on state ONLY — assign them from the current state, not the inputs. That is the whole point of Moore.',
      'Add a synchronous reset that forces a known start state; a floating FSM after power-up is the #1 traffic-light bug.',
    ],
    resources: [
      { label: 'Neso Academy — FSM (Moore/Mealy)', url: 'https://www.youtube.com/c/nesoacademy' },
      { label: 'HDLBits — FSM section', url: 'https://hdlbits.01xz.net/wiki/Fsm1' },
    ],
  },
  {
    match: ['alu', 'adder', 'ripple carry', 'ripple-carry'],
    hints: [
      'Build the 1-bit full adder first (sum = a^b^cin, cout = (a&b)|(cin&(a^b))), then chain N of them via a generate block for the ripple-carry version.',
      'For the ALU, use a case statement on the opcode select lines; keep Add/Sub/AND/OR as separate expressions and mux the result.',
      'Implement subtraction as A + (~B) + 1 (two’s complement) so you reuse the same adder for Sub — do not build a separate subtractor.',
      'Write a self-checking testbench that loops over operand corners (0, all-ones, carry-in edge cases) and $displays a PASS/FAIL, not just waveforms.',
    ],
    resources: [
      { label: 'ChipVerify — Verilog examples', url: 'https://www.chipverify.com/verilog/verilog-examples' },
      { label: 'HDLBits — arithmetic circuits', url: 'https://hdlbits.01xz.net/wiki/Exams/m2014_q4a' },
    ],
  },
  {
    match: ['mux', 'demux', 'decoder', 'encoder', 'combinational', 'comparator'],
    hints: [
      'Describe combinational logic with continuous assign or an always @(*) block — never a clocked block. If you see a flop inferred, you used the wrong block.',
      'For a MUX use a case (or nested ternary) on the select lines; make sure every select value is covered or you will infer an unwanted latch.',
      'Cover the default branch in every case statement — an incomplete case in combinational logic latches the old value.',
      'Prove it exhaustively: a small combinational block has few inputs, so loop over ALL input combinations in the testbench.',
    ],
    resources: [
      { label: 'HDLBits — combinational logic', url: 'https://hdlbits.01xz.net/wiki/Mux2to1' },
      { label: 'ASIC World — Verilog tutorial', url: 'https://www.asic-world.com/verilog/index.html' },
    ],
  },
  {
    match: ['k-map', 'kmap', 'karnaugh', 'boolean', 'logic gate', 'quine'],
    hints: [
      'Group in powers of two only (1,2,4,8 cells), wrap edges/corners, and always grab the LARGEST legal group first — bigger groups drop more literals.',
      'A term you can cover two ways is a "don’t-care for grouping" — pick whichever grouping simplifies neighbours, not the isolated cell.',
      'Sanity-check the minimized expression against the original truth table row-by-row before you trust it.',
      'For 5+ variables, stop hand-mapping — feed the truth table to a minimizer and study the Espresso/Quine-McCluskey output instead.',
    ],
    resources: [
      { label: 'Neso Academy — K-Map tutorials', url: 'https://www.youtube.com/c/nesoacademy' },
      { label: 'All About Circuits — Karnaugh Maps', url: 'https://www.allaboutcircuits.com/textbook/digital/chpt-8/karnaugh-maps/' },
    ],
  },
  {
    match: ['flip-flop', 'flip flop', 'latch', 'sequential', 'counter', 'shift register', 'register'],
    hints: [
      'Clock everything on one edge: always @(posedge clk). Mixing posedge and negedge across a design is a metastability trap.',
      'Use non-blocking assignments (<=) inside clocked blocks and blocking (=) in combinational blocks — swapping them causes race conditions that only bite in synthesis.',
      'For a counter, decide sync vs async reset up front; async reset needs it in the sensitivity list: always @(posedge clk or negedge rst_n).',
      'For a shift register, shift with a concatenation ({q[N-2:0], serial_in}) rather than N separate bit assignments.',
    ],
    resources: [
      { label: 'HDLBits — sequential logic', url: 'https://hdlbits.01xz.net/wiki/Dff' },
      { label: 'nandland — Verilog basics', url: 'https://nandland.com/introduction-to-verilog-for-beginners-with-code-examples/' },
    ],
  },
  {
    match: ['testbench', 'test bench', 'self-checking', 'verification', 'coverage', 'assertion', 'uvm'],
    hints: [
      'A testbench is a checker, not a viewer. Compute the expected result in the TB and compare — $display a PASS/FAIL count, do not eyeball waveforms.',
      'Add $dumpfile("dump.vcd"); $dumpvars(0, tb); at the top of the initial block so GTKWave has signals to show when a check fails.',
      'Drive stimulus with randomization and cover corners deliberately (0, max, overflow, back-to-back). Directed-only tests miss the bugs that matter.',
      'Always $finish at the end, and add a timeout watchdog (#N $fatal) so a hung DUT fails loudly instead of simulating forever.',
    ],
    resources: [
      { label: 'EDA Playground — run TBs in browser', url: 'https://www.edaplayground.com/' },
      { label: 'ChipVerify — testbench writing', url: 'https://www.chipverify.com/verilog/verilog-testbench' },
    ],
  },
  {
    match: ['systemverilog', 'oop', 'class', 'randomized', 'packet'],
    hints: [
      'Model the packet as a class with rand fields, then add constraints (constraint c { addr inside {[0:255]}; }) — let the solver generate legal stimulus.',
      'Call randomize() and CHECK its return value; an unsatisfiable constraint silently returns 0 and leaves stale data.',
      'Use logic instead of reg/wire everywhere in SystemVerilog — it collapses the two and prevents multi-driver mistakes.',
      'Keep the generator (class) separate from the driver (interface) — that separation is exactly what UVM formalizes later.',
    ],
    resources: [
      { label: 'ChipVerify — SystemVerilog', url: 'https://www.chipverify.com/systemverilog/systemverilog-tutorial' },
      { label: 'SystemVerilog.io — language guide', url: 'https://www.systemverilog.io/' },
    ],
  },
  {
    match: ['risc-v', 'riscv', 'risc v', 'datapath', 'cpu', 'pipeline', 'processor', 'isa'],
    hints: [
      'Get the RV32I instruction encoding open beside you — decode fields (opcode, rd, funct3, rs1, rs2, funct7) are fixed-position; wire them straight off the instruction bits.',
      'Build fetch + decode before execute: a program counter, an instruction memory, and a register file read. Prove decode with a handful of hand-assembled instructions.',
      'Keep the register file writes clocked and reads combinational, and hardwire x0 to zero — forgetting x0=0 breaks almost every program.',
      'Simulate against a known instruction trace; compare your register file to the expected state after each instruction with a self-checking TB.',
    ],
    resources: [
      { label: 'RISC-V unprivileged spec (RV32I)', url: 'https://riscv.org/technical/specifications/' },
      { label: 'ZipCPU — building a CPU', url: 'https://zipcpu.com/tutorial/' },
    ],
  },
  {
    match: ['yosys', 'synthesis', 'openlane', 'tapeout', 'tiny tapeout', 'gds', 'silicon'],
    hints: [
      'Synthesize early and often: run `yosys -p "read_verilog top.v; synth; stat"` to catch non-synthesizable constructs before they surprise you at tapeout.',
      'Only synthesizable RTL survives: no #delays, no initial blocks for logic, no real/time types. If it is not clocked logic or pure combinational, cut it.',
      'For Tiny Tapeout, keep to the fixed pin budget and the provided project template — read the pinout doc first, wire your top to it exactly.',
      'Check the gate-level netlist matches RTL behaviour with the SAME testbench (gate-level sim) before you sign off.',
    ],
    resources: [
      { label: 'Tiny Tapeout — getting started', url: 'https://tinytapeout.com/' },
      { label: 'YosysHQ — documentation', url: 'https://yosyshq.readthedocs.io/' },
    ],
  },
  {
    match: ['icarus', 'iverilog', 'gtkwave', 'verilator', 'install', 'toolchain', 'simulate'],
    hints: [
      'Compile then run: `iverilog -o sim tb.v dut.v` followed by `vvp sim`. If it will not compile, the error line number is exact — read it.',
      'Add $dumpfile/$dumpvars to your TB, then open the .vcd in GTKWave (`gtkwave dump.vcd`) and drag the signals you care about into the wave window.',
      'For large designs (a CPU), switch to Verilator — it compiles Verilog to C++ and runs orders of magnitude faster than iverilog.',
      'Automate the compile→run→view loop in a Makefile now; you will run it thousands of times.',
    ],
    resources: [
      { label: 'Icarus Verilog — getting started', url: 'https://steveicarus.github.io/iverilog/usage/getting_started.html' },
      { label: 'nandland — Icarus + GTKWave setup', url: 'https://nandland.com/set-up-iverilog-and-gtkwave/' },
    ],
  },
  {
    match: ['verilog', 'hdl', 'rtl', 'module'],
    hints: [
      'Think hardware, not software: every assign is a wire, every clocked block is a register. If you cannot draw the circuit it describes, the code is wrong.',
      'Declare port directions and widths explicitly (input [7:0] a). Width mismatches truncate silently and produce baffling bugs.',
      'Separate combinational (always @(*)) from sequential (always @(posedge clk)) logic into distinct blocks — never mix them.',
      'Grind HDLBits problems — it auto-checks your Verilog against a reference and is the fastest way to build real fluency.',
    ],
    resources: [
      { label: 'HDLBits — interactive Verilog', url: 'https://hdlbits.01xz.net/' },
      { label: 'ASIC World — Verilog tutorial', url: 'https://www.asic-world.com/verilog/index.html' },
    ],
  },
  {
    match: ['gate ', 'gate exam', 'past paper', 'previous year', 'pyq'],
    hints: [
      'Timed sets only: do full past papers under a strict clock. Untimed practice trains knowledge, not the exam-stamina this quest is about.',
      'Log every wrong answer in a mistakes sheet with the root cause (concept gap vs silly error) — review that sheet, not the questions you already nail.',
      'For Digital Logic specifically, drill number systems, K-maps, and FSM state-count questions — they are high-frequency and fast points.',
      'After each paper, redo only the ones you missed the next day. Spaced repetition on your errors beats re-solving the whole set.',
    ],
    resources: [
      { label: 'NPTEL — Digital Circuits', url: 'https://nptel.ac.in/courses/108105132' },
      { label: 'Neso Academy — Digital Electronics', url: 'https://www.youtube.com/c/nesoacademy' },
    ],
  },
  {
    match: ['german', 'deutsch', 'a1', 'a2', 'b1', 'goethe'],
    hints: [
      'Front-load the 500 highest-frequency words plus articles (der/die/das) — learn each noun WITH its article, never bare.',
      'Do 15 focused minutes daily rather than a weekly binge; language retention is spacing-dependent, and streaks beat marathons here.',
      'Shadow native audio: play a sentence, pause, repeat it aloud matching the rhythm. Output practice unlocks speaking far faster than reading.',
      'Target the concrete A1/A2 can-do list (introduce yourself, order food, ask directions) and drill those dialogues to automaticity.',
    ],
    resources: [
      { label: 'DW — Learn German (free, A1–C)', url: 'https://learngerman.dw.com/' },
      { label: 'Goethe-Institut — practice material', url: 'https://www.goethe.de/en/spr/kup/prf.html' },
    ],
  },
  {
    match: ['gre', 'quant', 'quantitative'],
    hints: [
      'Rebuild the fundamentals (number properties, ratios, exponents) before grinding hard sets — GRE quant punishes shaky basics under time pressure.',
      'Keep an error log tagged by concept; your score climbs by killing recurring mistake-types, not by doing more random questions.',
      'Learn the calculator’s limits and estimation tricks — many questions are faster solved by bounding the answer than by computing it.',
      'Do full timed sections weekly so pacing (≈1.75 min/question) becomes muscle memory, not a scramble.',
    ],
    resources: [
      { label: 'ETS — official free GRE prep', url: 'https://www.ets.org/gre/test-takers/general-test/prepare.html' },
      { label: 'GregMat — GRE quant prep', url: 'https://www.gregmat.com/' },
    ],
  },
  {
    match: ['ielts', 'toefl', 'english proficiency'],
    hints: [
      'Practice under real test conditions and timing — the format (task order, word counts) is as much the test as the English itself.',
      'For writing, memorize a repeatable essay skeleton (intro/2 body/conclusion) and a bank of linking phrases so you spend brain on content, not structure.',
      'For speaking, record yourself answering prompts and grade against the band descriptors — fluency and coherence outrank fancy vocabulary.',
      'Read/listen to academic English daily (news, lectures) to build the passive vocabulary the reading/listening sections assume.',
    ],
    resources: [
      { label: 'IELTS Liz — free lessons', url: 'https://ieltsliz.com/' },
      { label: 'ETS — TOEFL practice', url: 'https://www.ets.org/toefl/test-takers/ibt/prepare.html' },
    ],
  },
  {
    match: ['git', 'github', 'open source', 'open-source', 'commit', 'portfolio', 'university', 'shortlist', 'application', 'tu9'],
    hints: [
      'Ship small and public: a documented repo with a clear README and a working demo beats a private half-finished monolith for applications.',
      'Commit in small, described increments — a clean history is itself evidence you can work like an engineer.',
      'For a university/application shortlist, capture hard filters first (deadline, GPA/GRE minimums, English cert, tuition) in a single sheet before ranking on fit.',
      'Cross-check every requirement against the official program page — third-party summaries go stale and cost you an application cycle.',
    ],
    resources: [
      { label: 'Pro Git — free book', url: 'https://git-scm.com/book/en/v2' },
      { label: 'DAAD — study in Germany database', url: 'https://www2.daad.de/deutschland/studienangebote/international-programmes/en/' },
    ],
  },
];

const DEFAULT_HINTS: QuestHints = {
  hints: [
    'Break the objective into one concrete, testable deliverable you can finish in a single session — vague quests never get completed.',
    'Do the hardest 20% first while your focus is fresh; the rest is momentum.',
    'Prove it works before you call it done: a quick self-check (test, run, or read-back) turns "I think it works" into evidence.',
    'Capture what you learned in one line — that note becomes the proof you attach and the memory you reuse later.',
  ],
  resources: [
    { label: 'HDLBits — practice HDL', url: 'https://hdlbits.01xz.net/' },
    { label: 'Neso Academy — ECE fundamentals', url: 'https://www.youtube.com/c/nesoacademy' },
  ],
};

/**
 * Returns actionable hints + resource links for a quest by keyword-matching its
 * title and description. Always returns a usable set (falls back to DEFAULT_HINTS).
 */
export function getQuestHints(quest: QuestLike): QuestHints {
  const haystack = `${quest.title} ${quest.desc}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.some(kw => haystack.includes(kw))) {
      return { hints: rule.hints, resources: rule.resources };
    }
  }
  return DEFAULT_HINTS;
}
