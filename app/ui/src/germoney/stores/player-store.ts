import { Alert } from '../platform';
import { create } from 'zustand';
import { post } from '../../lib/api';
import AsyncStorage from '../platform';


export type BranchTier = {
  tier: number;
  completed: boolean;
};

export type SkillBranches = {
  siliconLogic: BranchTier[];
  theForge: BranchTier[];
  theChancellor: BranchTier[];
};

export type BossFight = {
  id: string;
  name: string;
  monthDue: number;
  completed: boolean;
  failed: boolean;
};

export type ActivityEntry = {
  date: string;
  type: 'commit' | 'stamina' | 'german' | 'workout';
  amount: number;
};

export type PlayerData = {
  level: number;
  xp: number;
  lastCommitDate: string | null;
  commitsCount: number;
  staminaHours: number;
  germanHours: number;
  completedQuests: string[];
  branches: SkillBranches;
  bosses: BossFight[];
  activityLog: ActivityEntry[];
  isPurgatoryActive: boolean;
  purgatoryHoursRemaining: number;
  /** Level held before an integrity drop, so a GitHub sync can reverse an unjust one. */
  levelBeforePurgatory: number | null;
};

const DEFAULT_BRANCHES: SkillBranches = {
  siliconLogic: [
    { tier: 1, completed: false }, // Number Systems & Boolean Algebra
    { tier: 2, completed: false }, // Combinational Logic
    { tier: 3, completed: false }, // Sequential Logic
    { tier: 4, completed: false }, // FSM & Timing
  ],
  theForge: [
    { tier: 1, completed: false }, // Verilog Basics & Sim
    { tier: 2, completed: false }, // RTL Design
    { tier: 3, completed: false }, // Testbenches & DV
    { tier: 4, completed: false }, // Architecture & Projects
  ],
  theChancellor: [
    { tier: 1, completed: false }, // Tooling (Icarus/GTKWave)
    { tier: 2, completed: false }, // German A1
    { tier: 3, completed: false }, // GRE Prep
    { tier: 4, completed: false }, // MS Applications
  ],
};

const DEFAULT_BOSSES: BossFight[] = [
  { id: 'b1', name: 'The Boolean Sentinel', monthDue: 2, completed: false, failed: false },
  { id: 'b2', name: 'The Combinational Demon', monthDue: 4, completed: false, failed: false },
  { id: 'b3', name: 'The Sequential Wraith', monthDue: 6, completed: false, failed: false },
  { id: 'b4', name: 'The RTL Architect', monthDue: 8, completed: false, failed: false },
  { id: 'b5', name: 'The Verification Reaper', monthDue: 10, completed: false, failed: false },
  { id: 'b6', name: 'The Pipeline Guardian', monthDue: 12, completed: false, failed: false },
  { id: 'b7', name: 'The Open-Source Forge', monthDue: 15, completed: false, failed: false },
  { id: 'b8', name: 'The Quant Sentinel', monthDue: 18, completed: false, failed: false },
  { id: 'b9', name: 'The Application Gauntlet', monthDue: 21, completed: false, failed: false },
  { id: 'b10', name: 'The Final Admit', monthDue: 24, completed: false, failed: false },
];

const DEFAULT_PLAYER: PlayerData = {
  level: 0,
  xp: 0,
  lastCommitDate: null,
  commitsCount: 0,
  staminaHours: 0,
  germanHours: 0,
  completedQuests: [],
  branches: DEFAULT_BRANCHES,
  bosses: DEFAULT_BOSSES,
  activityLog: [],
  isPurgatoryActive: false,
  purgatoryHoursRemaining: 0,
  levelBeforePurgatory: null,
};

/** Local (not UTC) YYYY-MM-DD, so "today" matches the user's clock + the checklist store. */
export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const num = (v: unknown, d: number): number =>
  typeof v === 'number' && !Number.isNaN(v) ? v : d;

/**
 * Deep-merge a stored blob over DEFAULT_PLAYER. This is the app-update safety
 * net: a save written by an older build (missing a field added later) must never
 * yield `undefined` — that would crash screens doing .includes/.map/.length and
 * read to the user as "my progress vanished". Every field is coerced.
 */
function mergePlayer(raw: unknown): PlayerData {
  if (!raw || typeof raw !== 'object') return DEFAULT_PLAYER;
  const r = raw as Record<string, any>;
  const mergeBranch = (key: keyof SkillBranches): BranchTier[] => {
    const stored: any[] = Array.isArray(r.branches?.[key]) ? r.branches[key] : [];
    return DEFAULT_BRANCHES[key].map(def => {
      const hit = stored.find(t => t && t.tier === def.tier);
      return hit ? { tier: def.tier, completed: !!hit.completed } : def;
    });
  };
  const bosses: BossFight[] = DEFAULT_BOSSES.map(def => {
    const hit = Array.isArray(r.bosses) ? r.bosses.find((b: any) => b && b.id === def.id) : null;
    return hit ? { ...def, completed: !!hit.completed, failed: !!hit.failed } : def;
  });
  return {
    level: num(r.level, 0),
    xp: num(r.xp, 0),
    lastCommitDate: typeof r.lastCommitDate === 'string' ? r.lastCommitDate : null,
    commitsCount: num(r.commitsCount, 0),
    staminaHours: num(r.staminaHours, 0),
    germanHours: num(r.germanHours, 0),
    completedQuests: Array.isArray(r.completedQuests)
      ? r.completedQuests.filter((x: any) => typeof x === 'string')
      : [],
    branches: {
      siliconLogic: mergeBranch('siliconLogic'),
      theForge: mergeBranch('theForge'),
      theChancellor: mergeBranch('theChancellor'),
    },
    bosses,
    activityLog: Array.isArray(r.activityLog)
      ? r.activityLog.filter((e: any) => e && typeof e.date === 'string')
      : [],
    isPurgatoryActive: !!r.isPurgatoryActive,
    purgatoryHoursRemaining: num(r.purgatoryHoursRemaining, 0),
    levelBeforePurgatory: typeof r.levelBeforePurgatory === 'number' ? r.levelBeforePurgatory : null,
  };
}

export const LEVELS = [
  { level: 0, rank: 'The Blank Slate', phase: 'Phase I', req: 'Install Icarus Verilog & GTKWave; Master Number Systems' },
  { level: 1, rank: 'The Logic Builder', phase: 'Phase I', req: 'Design & Simulate a 4-bit Ripple Carry Adder (Defeat Boss 1)' },
  { level: 2, rank: 'The ALU Architect', phase: 'Phase I', req: 'Design a parameterized ALU with testbench (Defeat Boss 2)' },
  { level: 3, rank: 'The Clock Tamer', phase: 'Phase II', req: 'Design a Universal Shift Register & Traffic Light FSM' },
  { level: 4, rank: 'The Comm Engineer', phase: 'Phase II', req: 'Implement a UART Transmitter & Receiver in Verilog (Defeat Boss 3)' },
  { level: 5, rank: 'The Verifier', phase: 'Phase II', req: 'Master SystemVerilog Testbenches & Coverage (Defeat Boss 5)' },
  { level: 6, rank: 'The Pipeline Master', phase: 'Phase III', req: 'Complete a single-cycle RISC-V CPU (Defeat Boss 6)' },
  { level: 7, rank: 'The Silicon Forge', phase: 'Phase III', req: 'Submit an Open-Source RTL project to GitHub (Defeat Boss 7)' },
  { level: 8, rank: 'The Scholar Candidate', phase: 'Phase IV', req: 'GRE Quant 165+; German A1 Certification' },
  { level: 9, rank: 'The Applicant', phase: 'Phase IV', req: 'Submit 5 applications to Top German TUs (Defeat Boss 9)' },
  { level: 10, rank: 'The Silicon Architect', phase: 'Endgame', req: 'German MS Admission Offer Secured (Defeat Boss 10)' },
];

const STORAGE_KEY = '@silicon_player_v2'; // unchanged — existing saves stay valid

const persist = (data: PlayerData) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(e =>
    console.error('Failed to save player data', e)
  );
};

/*
 * ONE XP total (Mission v2). The server's plan engine (@mission_v2) owns it: it
 * started from this save's XP, contracts and logs add to it there (also by voice,
 * with the window closed), and every XP change made in the window is sent to it
 * as a delta. `player.xp` here is the window's mirror of that number, so the rest
 * of the game (levels, the ring, Core's card) keeps reading it where it always did.
 */
let xpChain: Promise<unknown> = Promise.resolve();
const sendXp = (amount: number, reason: string) => {
  if (!amount) return;
  xpChain = xpChain
    .catch(() => undefined)
    .then(() => post('/api/mission/xp', { amount, reason }))
    .catch(() => undefined);
};

type PlayerStore = {
  player: PlayerData;
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  logExecution: (type: ActivityEntry['type'], amount: number) => void;
  completeTier: (branch: keyof SkillBranches, tier: number) => void;
  /** xp: the reward the quest card PROMISES. The phone app always added 25 here
   *  while weekly milestone cards advertised +200..+500 (JARVIS port fix). */
  completeQuest: (questId: string, isBoss?: boolean, xp?: number) => void;
  levelUp: () => void;
  /** Rank up to at least `rank` — called when a Mission boss is defeated. Never lowers rank. */
  promote: (rank: number) => void;
  checkIntegrity: () => void;
  /** Feed real GitHub data into Rule 1: update last-commit + lifetime commit count. */
  syncGithub: (lastContribution: string | null, totalContributions: number) => void;
  resetProgress: () => void;
  updateXP: (amount: number) => void;
  resolvePurgatory: (hours: number) => void;
  triggerPurgatory: () => void;
  /** Set the mirror to the server's XP total (never sent back). */
  syncXP: (xp: number) => void;
  /** Wait until every XP change made here has reached the server. */
  flushXp: () => Promise<void>;
  /** Hours and commits for the stats (Core's card, Rule 1), with no XP: the plan's log pays XP. */
  recordHours: (type: ActivityEntry['type'], amount: number) => void;
};

export const usePlayerStore = create<PlayerStore>((set, get) => {
  /** Apply a pure update to player; returning the unchanged object skips save/set. */
  const mutate = (fn: (prev: PlayerData) => PlayerData) => {
    const prev = get().player;
    const updated = fn(prev);
    if (updated === prev) return;
    persist(updated);
    set({ player: updated });
    if (updated.xp !== prev.xp) sendXp(updated.xp - prev.xp, 'window');
  };

  return {
    player: DEFAULT_PLAYER,
    isLoaded: false,

    hydrate: async () => {
      if (get().isLoaded) return; // StrictMode / double-mount guard
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        // mergePlayer() is the app-update safety net — never blind-parse into state.
        if (stored) set({ player: mergePlayer(JSON.parse(stored)) });
      } catch (e) {
        console.error('Failed to load player data', e);
      } finally {
        set({ isLoaded: true });
      }
      // Rule 1 v2: lift any Purgatory an old save still carries (see checkIntegrity).
      get().checkIntegrity();
    },

    // Rule 1, v2: 14 days without a commit is a nudge, not a punishment. The old
    // rule dropped a rank and locked a 3-hour Purgatory; ranks are retired (one XP
    // system) and shame stalls him, so now Log shows a friendly "ship one small
    // commit" card. A Purgatory left over from an old save is lifted, and the
    // level it took is given back.
    checkIntegrity: () =>
      mutate(prev => {
        if (!prev.isPurgatoryActive) return prev;
        Alert.alert('PURGATORY CLEARED', 'Rule 1 is a nudge now, not a lock. Ship one small commit when you can.');
        return {
          ...prev,
          level: prev.levelBeforePurgatory !== null ? Math.max(prev.level, prev.levelBeforePurgatory) : prev.level,
          levelBeforePurgatory: null,
          isPurgatoryActive: false,
          purgatoryHoursRemaining: 0,
        };
      }),

    syncXP: xp => {
      const prev = get().player;
      if (typeof xp !== 'number' || !Number.isFinite(xp) || xp === prev.xp) return;
      const updated = { ...prev, xp: Math.max(0, Math.round(xp)) };
      persist(updated);
      set({ player: updated });
    },

    flushXp: async () => {
      await xpChain.catch(() => undefined);
    },

    recordHours: (type, amount) =>
      mutate(prev => {
        const today = dateKey();
        const updated: PlayerData = { ...prev, activityLog: [...prev.activityLog, { date: today, type, amount }] };
        if (type === 'commit') {
          updated.commitsCount += Math.max(1, amount);
          updated.lastCommitDate = new Date().toISOString();
        } else if (type === 'stamina') updated.staminaHours += amount;
        else if (type === 'german') updated.germanHours += amount;
        return updated;
      }),

    syncGithub: (lastContribution, totalContributions) =>
      mutate(prev => {
        // Only advance the real signals — never regress a manually-logged date.
        const newer =
          lastContribution &&
          (!prev.lastCommitDate || new Date(lastContribution) > new Date(prev.lastCommitDate));
        if (!newer && totalContributions <= prev.commitsCount) return prev;
        const updated: PlayerData = {
          ...prev,
          commitsCount: Math.max(prev.commitsCount, totalContributions),
          lastCommitDate: newer ? new Date(lastContribution!).toISOString() : prev.lastCommitDate,
        };
        // A real recent commit proves activity → clear purgatory AND reverse an
        // unjust integrity drop (restore the level that checkIntegrity took).
        if (newer && updated.isPurgatoryActive) {
          const days = Math.floor((Date.now() - new Date(lastContribution!).getTime()) / 86400000);
          if (days < 14) {
            updated.isPurgatoryActive = false;
            updated.purgatoryHoursRemaining = 0;
            if (prev.levelBeforePurgatory !== null) {
              updated.level = Math.max(updated.level, prev.levelBeforePurgatory);
              updated.levelBeforePurgatory = null;
            }
          }
        }
        return updated;
      }),

    logExecution: (type, amount) =>
      mutate(prev => {
        const today = dateKey(); // local date — matches heatmap + checklist reset
        const updated: PlayerData = {
          ...prev,
          activityLog: [...prev.activityLog, { date: today, type, amount }],
          xp: prev.xp + 15, // standard execution XP
        };
        if (type === 'commit') {
          updated.commitsCount += amount;
          updated.lastCommitDate = new Date().toISOString();
        } else if (type === 'stamina') {
          updated.staminaHours += amount;
        } else if (type === 'german') {
          updated.germanHours += amount;
        }
        return updated;
      }),

    updateXP: amount =>
      mutate(prev => ({ ...prev, xp: Math.max(0, prev.xp + amount) })),

    triggerPurgatory: () =>
      mutate(prev => ({
        ...prev,
        isPurgatoryActive: true,
        purgatoryHoursRemaining: 3,
        xp: Math.max(0, prev.xp - 50),
      })),

    resolvePurgatory: hours =>
      mutate(prev => {
        if (!prev.isPurgatoryActive) return prev;
        const newRemaining = Math.max(0, prev.purgatoryHoursRemaining - hours);
        if (newRemaining === 0) {
          Alert.alert('PURGATORY CLEARED', 'System unlocked.');
        }
        return {
          ...prev,
          purgatoryHoursRemaining: newRemaining,
          isPurgatoryActive: newRemaining > 0,
          // Cleared via Crucible = the drop was earned; forget the restore point.
          levelBeforePurgatory: newRemaining > 0 ? prev.levelBeforePurgatory : null,
        };
      }),

    completeTier: (branch, tier) =>
      mutate(prev => {
        if (tier > 1) {
          const prevTier = prev.branches[branch].find(t => t.tier === tier - 1);
          if (!prevTier?.completed) {
            Alert.alert('SYSTEM CRASH', 'You cannot skip tiers. Complete the lower tier first.');
            return prev;
          }
        }
        return {
          ...prev,
          branches: {
            ...prev.branches,
            [branch]: prev.branches[branch].map(t =>
              t.tier === tier ? { ...t, completed: true } : t
            ),
          },
          xp: prev.xp + 50,
        };
      }),

    completeQuest: (questId, isBoss = false, xp) =>
      mutate(prev => {
        if (prev.completedQuests.includes(questId)) return prev;
        if (isBoss) {
          return {
            ...prev,
            completedQuests: [...prev.completedQuests, questId],
            bosses: prev.bosses.map(b => (b.id === questId ? { ...b, completed: true } : b)),
            xp: prev.xp + 200,
          };
        }
        return {
          ...prev,
          completedQuests: [...prev.completedQuests, questId],
          xp: prev.xp + (typeof xp === 'number' && xp > 0 ? xp : 25),
        };
      }),

    levelUp: () =>
      mutate(prev => (prev.level >= 10 ? prev : { ...prev, level: prev.level + 1 })),

    promote: rank =>
      mutate(prev => (rank <= prev.level ? prev : { ...prev, level: Math.min(10, rank) })),

    resetProgress: () => {
      persist(DEFAULT_PLAYER);
      set({ player: DEFAULT_PLAYER });
      // True factory reset: wipe EVERY @silicon_* key — the other stores
      // (checklists, failures, proofs, workouts, logs), onboarding, and all the
      // per-day caches. Otherwise months of orphaned data survive the "reset".
      // In-memory state of the other stores clears on next app launch.
      AsyncStorage.getAllKeys()
        .then(keys => {
          const silicon = keys.filter(k => k.startsWith('@silicon_') && k !== STORAGE_KEY);
          if (silicon.length) return AsyncStorage.multiRemove(silicon);
        })
        .catch(() => {});
    },
  };
});
