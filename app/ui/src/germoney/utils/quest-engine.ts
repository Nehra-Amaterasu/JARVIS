/**
 * DYNAMIC QUEST ENGINE — pure TypeScript, no React.
 *
 * Generates 3-5 deterministic daily micro-quests from a static pool derived
 * from docs/03_SKILL_TREE.md and the LEVELS ladder in AppContext. Same
 * (date, level) always yields the same quests, so re-renders never reshuffle.
 */

import { LEVELS, type PlayerData } from '../stores/player-store';

// ---------------------------------------------------------------------------
// Types (onboarding.tsx imports these — keeps deps one-directional)
// ---------------------------------------------------------------------------

/** The five self-rated skills captured during onboarding (0 = NONE … 3 = STRONG). */
export type SkillKey = 'digitalLogic' | 'verilog' | 'programming' | 'math' | 'german';

export type GoalPreset = 'tu9-vlsi' | 'iit-mtech' | 'industry' | 'custom';

export type OnboardingGoal = {
  preset: GoalPreset;
  /** Human-readable objective, e.g. "MS in Germany (TU9) — VLSI". */
  label: string;
};

/** Persisted at AsyncStorage key '@silicon_onboarding_v1'. */
export type OnboardingData = {
  goal: OnboardingGoal;
  skills: Record<SkillKey, number>;
  targetYear: number;
  weeklyHours: number;
  completedAt: string;
};

export type SkillBranchName = 'siliconLogic' | 'theForge' | 'theChancellor';

export type Quest = {
  id: string;
  title: string;
  description: string;
  xp: number;
  type: 'micro' | 'weekly';
  skillBranch: SkillBranchName;
};

type PoolEntry = Quest & {
  /** Skill this quest trains; null = career/meta tasks (never weakness-boosted). */
  skill: SkillKey | null;
  /** Inclusive level band, mapped to the LEVELS ranks (0-10). */
  minLevel: number;
  maxLevel: number;
};

// ---------------------------------------------------------------------------
// Deterministic PRNG — djb2 string hash seeding mulberry32
// ---------------------------------------------------------------------------

function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// QUEST_POOL — 40 entries covering levels 0-10 (docs/03_SKILL_TREE.md)
// ---------------------------------------------------------------------------

const q = (
  id: string,
  title: string,
  description: string,
  xp: number,
  type: Quest['type'],
  skillBranch: SkillBranchName,
  skill: SkillKey | null,
  minLevel: number,
  maxLevel: number
): PoolEntry => ({ id, title, description, xp, type, skillBranch, skill, minLevel, maxLevel });

export const QUEST_POOL: readonly PoolEntry[] = [
  // --- GERMAN (theChancellor) — roadmap mandate: 10h/week ---------------------
  q('ger-01', 'German A1: Nominativ Drill', '45 min German A1: Nominativ articles (der/die/das) on Nicos Weg. Log every miss.', 20, 'micro', 'theChancellor', 'german', 0, 3),
  q('ger-02', 'German A1: Core Vocab Sprint', 'Drill 25 A1 flashcards: numbers, days, greetings. Zero-hesitation recall required.', 15, 'micro', 'theChancellor', 'german', 0, 3),
  q('ger-03', 'German A1: Akkusativ Offensive', '45 min A1: Akkusativ case. Write 10 sentences and say each one aloud twice.', 20, 'micro', 'theChancellor', 'german', 2, 5),
  q('ger-04', 'German A2: Perfekt Report', '45 min A2: Perfekt tense. Write 8 sentences describing your training day in German.', 25, 'micro', 'theChancellor', 'german', 4, 7),
  q('ger-05', 'German B1: Listening Intercept', '45 min B1 listening: one Nicos Weg episode. Transcribe 10 lines without subtitles.', 30, 'micro', 'theChancellor', 'german', 6, 10),
  q('ger-06', 'Goethe Mock Section', 'Complete one full Goethe A1/A2 mock exam section under timed conditions. Score it honestly.', 60, 'weekly', 'theChancellor', 'german', 3, 10),

  // --- DIGITAL LOGIC (siliconLogic) ------------------------------------------
  q('dig-01', 'Number Systems Gauntlet', 'Convert 15 numbers between binary, hex, and decimal by hand. No calculator.', 15, 'micro', 'siliconLogic', 'digitalLogic', 0, 1),
  q('dig-02', 'Boolean Algebra Reps', 'Simplify 10 Boolean expressions using algebra laws. Verify 3 with truth tables.', 15, 'micro', 'siliconLogic', 'digitalLogic', 0, 1),
  q('dig-03', 'K-Map Minimization Set', 'Solve 5 K-map minimization problems (4-variable). Note every don’t-care exploited.', 20, 'micro', 'siliconLogic', 'digitalLogic', 0, 2),
  q('dig-04', 'MUX On Paper', 'Design a 4-to-1 MUX: truth table, Boolean expression, and gate-level diagram on paper.', 20, 'micro', 'siliconLogic', 'digitalLogic', 1, 3),
  q('dig-05', 'Sequence Detector Blueprint', 'Draw the Mealy state diagram for a "1011" sequence detector, then derive the state table.', 25, 'micro', 'siliconLogic', 'digitalLogic', 2, 4),
  q('dig-06', 'Flip-Flop Excitation Drill', 'Derive excitation tables for D and JK flip-flops; solve 5 conversion problems.', 25, 'micro', 'siliconLogic', 'digitalLogic', 3, 5),
  q('dig-07', 'Timing Path Audit', 'Hand-compute setup/hold slack for 5 timing paths given clk period, delays, and skew.', 30, 'micro', 'siliconLogic', 'digitalLogic', 4, 6),
  q('dig-08', 'Cache Address Breakdown', 'For a direct-mapped cache spec, compute tag/index/offset for 10 addresses and mark hits.', 30, 'micro', 'siliconLogic', 'digitalLogic', 5, 8),

  // --- MATH / GATE / GRE (siliconLogic) ---------------------------------------
  q('mat-01', 'GATE: Boolean Numericals', '25 GATE numericals on Boolean algebra and number systems. Target 80%+ accuracy.', 20, 'micro', 'siliconLogic', 'math', 0, 2),
  q('mat-02', 'GATE: Combinational Timed Set', '20 GATE problems on combinational circuits, timed 40 minutes. Review every error.', 25, 'micro', 'siliconLogic', 'math', 1, 4),
  q('mat-03', 'GATE: Sequential & FSM Set', '15 GATE problems on sequential circuits and FSMs. Redraw each wrong answer’s circuit.', 25, 'micro', 'siliconLogic', 'math', 3, 6),
  q('mat-04', 'GRE Quant: Hard Probability', '20 hard GRE Quant problems: probability and combinatorics. Log error categories.', 30, 'micro', 'siliconLogic', 'math', 7, 10),
  q('mat-05', 'GRE Quant: Timed Section', 'One full timed GRE Quant section (35 min). Score, then dissect the three worst misses.', 35, 'micro', 'siliconLogic', 'math', 8, 10),

  // --- VERILOG / HDL (theForge) ------------------------------------------------
  q('ver-01', 'Arm The Toolchain', 'Install Icarus Verilog + GTKWave; compile and simulate a hello-world module end to end.', 20, 'micro', 'theForge', 'verilog', 0, 1),
  q('ver-02', 'First Blood: 2-to-1 MUX', 'Write and simulate a 2-to-1 mux in Verilog; view the waveform in GTKWave.', 20, 'micro', 'theForge', 'verilog', 0, 2),
  q('ver-03', 'Ripple Carry Assembly', 'Build a 4-bit ripple carry adder from full-adder instances; write a testbench covering 8 cases.', 30, 'micro', 'theForge', 'verilog', 1, 3),
  q('ver-04', 'HDLBits Sortie', 'Solve 5 HDLBits problems in the Verilog Language set. No peeking at solutions.', 20, 'micro', 'theForge', 'verilog', 1, 3),
  q('ver-05', 'Parameterized Comparator', 'Write a parameterized N-bit comparator using generate blocks; simulate at N=4 and N=8.', 30, 'micro', 'theForge', 'verilog', 2, 4),
  q('ver-06', 'Universal Shift Register', 'Implement a universal shift register; verify all 4 modes (hold/left/right/load) in GTKWave.', 30, 'micro', 'theForge', 'verilog', 3, 5),
  q('ver-07', 'Traffic Light FSM', 'Code a Moore FSM traffic light controller with $dumpvars; confirm state timing in the waveform.', 30, 'micro', 'theForge', 'verilog', 3, 5),
  q('ver-08', 'UART TX Strike', 'Write a UART transmitter (8N1); verify start/stop bit timing in the waveform viewer.', 35, 'micro', 'theForge', 'verilog', 4, 6),
  q('ver-09', 'Self-Checking Testbench', 'Write a self-checking testbench with randomized stimulus for your ALU; report pass/fail counts.', 35, 'micro', 'theForge', 'verilog', 5, 7),
  q('ver-10', 'Assertion Fortification', 'Add 3 SystemVerilog assertions (immediate or concurrent) to an existing module and trip each one.', 30, 'micro', 'theForge', 'verilog', 5, 7),
  q('ver-11', 'RISC-V: One Instruction', 'Implement one RISC-V instruction (ADDI) end-to-end through your single-cycle datapath.', 40, 'micro', 'theForge', 'verilog', 6, 8),
  q('ver-12', 'Open-Source Polish', 'Write a README with waveform screenshots for one RTL repo; push it to GitHub today.', 30, 'micro', 'theForge', 'verilog', 6, 9),

  // --- PROGRAMMING (theForge) ---------------------------------------------------
  q('pro-01', 'Python Base Converter', 'Write a Python CLI script converting binary↔hex↔decimal from command-line args.', 15, 'micro', 'theForge', 'programming', 0, 2),
  q('pro-02', 'One-Command Sim Flow', 'Write a Makefile that compiles and runs an iverilog testbench with a single `make` command.', 20, 'micro', 'theForge', 'programming', 1, 4),
  q('pro-03', 'C Pointer Conditioning', 'Solve 3 array/pointer exercises in C; compile with -Wall and eliminate every warning.', 20, 'micro', 'theForge', 'programming', 2, 5),
  q('pro-04', 'VCD Parser Script', 'Write a Python script that parses a VCD file and counts signal toggles per net.', 30, 'micro', 'theForge', 'programming', 4, 7),
  q('pro-05', 'Bash Sim Automation', 'Automate your sim flow with a bash script: compile, run, and open GTKWave in one shot.', 25, 'micro', 'theForge', 'programming', 5, 8),
  q('pro-06', 'Branch Predictor In C', 'Write ~30 lines of C simulating a 2-bit branch predictor over a branch trace; print accuracy.', 35, 'micro', 'theForge', 'programming', 6, 9),

  // --- CAREER / APPLICATIONS (theChancellor) -------------------------------------
  q('app-01', 'SoP: First Strike Paragraph', 'Draft one tight paragraph of your Statement of Purpose: why VLSI, why Germany.', 30, 'micro', 'theChancellor', null, 7, 10),
  q('app-02', 'TU9 Target Recon', 'Shortlist 2 TU9 programs; log ECTS requirements, deadlines, and language demands in a sheet.', 30, 'micro', 'theChancellor', null, 8, 10),
  q('app-03', 'Europass CV Update', 'Update your Europass CV with your latest RTL project, quantified (LOC, coverage, sim results).', 25, 'micro', 'theChancellor', null, 8, 10),
  q('app-04', 'Professor Outreach', 'Email one German professor whose lab matches your GitHub work. Reference a specific paper.', 40, 'micro', 'theChancellor', null, 9, 10),
  q('app-05', 'Weekly Commit Quota', 'Push 3 meaningful commits this week and write a 5-line progress log in the repo.', 50, 'weekly', 'theForge', null, 0, 10),
] as const;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Maps a level to its LEVELS entry, clamped to the ladder (difficulty band source). */
function clampLevel(level: number): number {
  const max = LEVELS.length - 1; // rank 10: The Silicon Architect
  return Math.min(max, Math.max(0, Math.floor(level)));
}

/** Weight = 1 base, +1 per missing skill point (0-rated skills weigh 4x). */
function questWeight(entry: PoolEntry, onboarding: OnboardingData | null): number {
  if (entry.skill === null || onboarding === null) return 1;
  const rating = onboarding.skills[entry.skill] ?? 0;
  return 1 + Math.max(0, 3 - rating);
}

/** Deterministic weighted sample without replacement. */
function weightedSample(
  entries: PoolEntry[],
  weights: number[],
  count: number,
  rand: () => number
): PoolEntry[] {
  const pool = entries.slice();
  const w = weights.slice();
  const picked: PoolEntry[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = w.reduce((a, b) => a + b, 0);
    let roll = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      roll -= w[idx];
      if (roll <= 0) break;
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
    w.splice(idx, 1);
  }
  return picked;
}

function toQuest(entry: PoolEntry): Quest {
  const { id, title, description, xp, type, skillBranch } = entry;
  return { id, title, description, xp, type, skillBranch };
}

/**
 * Returns 3-5 quests for the given day. Deterministic per (date, level):
 * the PRNG is seeded from the date string + clamped level, so the same
 * day and rank always produce the same set.
 *
 * - Level bands come from the LEVELS ladder (0-10 ranks).
 * - Lowest-rated onboarding skills are weighted heavier.
 * - A German quest is always included while onboarding.skills.german < 3
 *   (10h/week German is a roadmap mandate) — also when onboarding is absent.
 * - Mondays additionally surface one eligible weekly quest.
 */
export function generateDailyQuests(
  player: PlayerData,
  onboarding: OnboardingData | null,
  date: Date
): Quest[] {
  const level = clampLevel(player.level);
  const rand = mulberry32(hashString(`${dateKey(date)}|L${level}`));

  const eligible = QUEST_POOL.filter(
    (entry) => level >= entry.minLevel && level <= entry.maxLevel
  );
  const micros = eligible.filter((entry) => entry.type === 'micro');
  const weeklies = eligible.filter((entry) => entry.type === 'weekly');

  // 3-5 total; leave room for the Monday weekly slot.
  const isWeeklyDay = date.getDay() === 1 && weeklies.length > 0;
  const microTarget = Math.min(
    micros.length,
    3 + Math.floor(rand() * (isWeeklyDay ? 2 : 3)) // 3-4 with weekly, 3-5 without
  );

  const weights = micros.map((entry) => questWeight(entry, onboarding));
  let picked = weightedSample(micros, weights, microTarget, rand);

  // German mandate: force-include one German quest while german < 3.
  const germanRequired = onboarding === null || (onboarding.skills.german ?? 0) < 3;
  if (germanRequired && !picked.some((entry) => entry.skill === 'german')) {
    const germanPool = micros.filter((entry) => entry.skill === 'german');
    if (germanPool.length > 0) {
      const forced = germanPool[Math.floor(rand() * germanPool.length)];
      // Replace the last (lowest-priority) pick to stay within count.
      picked = picked.length >= microTarget && picked.length > 0
        ? [...picked.slice(0, -1), forced]
        : [...picked, forced];
    }
  }

  const quests = picked.map(toQuest);
  if (isWeeklyDay && quests.length < 5) {
    quests.push(toQuest(weeklies[Math.floor(rand() * weeklies.length)]));
  }
  return quests;
}
