import { create } from 'zustand';
import AsyncStorage from '../platform';

/**
 * CHECKLIST STORE — daily + weekly execution checklists.
 * Persistence + hydrate pattern mirrors failure-store. Daily state auto-resets
 * on a new ISO date; weekly state auto-resets on a new ISO week. No AI, no
 * server — just local discipline tracking.
 */

const STORAGE_KEY = '@silicon_checklists_v1';

export type ChecklistItem = {
  id: string;
  label: string;
};

/** Fixed daily directives. Cleared every new day. */
export const DAILY_ITEMS: ChecklistItem[] = [
  { id: 'gate', label: '50 GATE numericals' },
  { id: 'commit', label: '1 GitHub commit' },
  { id: 'german', label: '45 min German' },
  { id: 'crucible', label: '1 Crucible session' },
  { id: 'log', label: "Log today's execution" },
];

/** Fixed Sunday wind-down ritual. Cleared every new week. */
export const SUNDAY_ITEMS: ChecklistItem[] = [
  { id: 'github', label: 'GitHub Integrity Check' },
  { id: 'ects', label: 'ECTS Health Check (Monthly)' },
  { id: 'concept', label: 'The "One-Concept" Test (Explain aloud)' },
  { id: 'german_audit', label: 'German Hours Audit (≥10?)' },
];

/** Local ISO date key, e.g. "2026-07-21". Resets the daily checklist. */
export function isoDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO-8601 week key, e.g. "2026-W30". Resets the weekly checklist. */
export function isoWeekKey(d: Date = new Date()): string {
  // Copy so we don't mutate the caller's date; work in UTC to avoid DST drift.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO weeks start Monday; shift Sunday(0) to 7.
  const dayNum = date.getUTCDay() || 7;
  // Thursday of this week decides the ISO year.
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${`${week}`.padStart(2, '0')}`;
}

type ChecklistState = {
  dailyKey: string;
  weeklyKey: string;
  daily: Record<string, boolean>;
  weekly: Record<string, boolean>;
};

type ChecklistStore = ChecklistState & {
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  toggleDaily: (id: string) => void;
  toggleWeekly: (id: string) => void;
  /** Count of checked daily items (current period only). */
  dailyDoneCount: () => number;
  /** Count of checked weekly items (current period only). */
  weeklyDoneCount: () => number;
};

const persist = (state: ChecklistState) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(e =>
    console.error('Failed to save checklists', e)
  );
};

/** Roll expired period keys forward, clearing the matching record. Pure. */
function rollPeriods(state: ChecklistState): ChecklistState {
  const today = isoDateKey();
  const week = isoWeekKey();
  let next = state;
  if (state.dailyKey !== today) {
    next = { ...next, dailyKey: today, daily: {} };
  }
  if (state.weeklyKey !== week) {
    next = { ...next, weeklyKey: week, weekly: {} };
  }
  return next;
}

const countTrue = (record: Record<string, boolean>): number =>
  Object.values(record).filter(Boolean).length;

export const useChecklistStore = create<ChecklistStore>((set, get) => ({
  dailyKey: isoDateKey(),
  weeklyKey: isoWeekKey(),
  daily: {},
  weekly: {},
  isLoaded: false,

  hydrate: async () => {
    if (get().isLoaded) return; // StrictMode / double-mount guard
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ChecklistState>;
        // Coerce to a full state, then roll any expired period.
        const base: ChecklistState = {
          dailyKey: parsed.dailyKey ?? isoDateKey(),
          weeklyKey: parsed.weeklyKey ?? isoWeekKey(),
          daily: parsed.daily ?? {},
          weekly: parsed.weekly ?? {},
        };
        const rolled = rollPeriods(base);
        if (rolled !== base) persist(rolled);
        set(rolled);
      }
    } catch (e) {
      console.error('Failed to load checklists', e);
    } finally {
      set({ isLoaded: true });
    }
  },

  toggleDaily: id => {
    // Roll first so a toggle after midnight lands in the fresh day.
    const rolled = rollPeriods(get());
    const daily = { ...rolled.daily, [id]: !rolled.daily[id] };
    const next: ChecklistState = { ...rolled, daily };
    persist(next);
    set(next);
  },

  toggleWeekly: id => {
    const rolled = rollPeriods(get());
    const weekly = { ...rolled.weekly, [id]: !rolled.weekly[id] };
    const next: ChecklistState = { ...rolled, weekly };
    persist(next);
    set(next);
  },

  dailyDoneCount: () => countTrue(get().daily),
  weeklyDoneCount: () => countTrue(get().weekly),
}));
