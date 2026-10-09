import { create } from 'zustand';
import AsyncStorage from '../platform';

import type { FailureAnalysis } from '../platform';

/** The six root-cause categories (mirrors FailureAnalysisSchema.category). */
export type FailureCategory =
  | 'energy'
  | 'planning'
  | 'distraction'
  | 'overreach'
  | 'external'
  | 'avoidance';

export const FAILURE_CATEGORIES: FailureCategory[] = [
  'energy',
  'planning',
  'distraction',
  'overreach',
  'external',
  'avoidance',
];

export type FailureEntry = {
  id: string;
  /** ISO timestamp */
  date: string;
  whatHappened: string;
  /** 1-5 self-reported energy */
  energy: number;
  category: FailureCategory;
  /** Present once the AI (or fallback) has issued a verdict. */
  analysis?: FailureAnalysis;
};

/** Rule-based pattern summary — NO AI. Computed on demand over stored entries. */
export type PatternSummary = {
  totalFailures: number;
  /** Most-common root-cause category + how many share it. */
  topCategory: FailureCategory | null;
  topCategoryCount: number;
  /** Most-common day-of-week of failures, e.g. "SUNDAY". */
  worstDay: string | null;
  worstDayCount: number;
  /** Mean energy across all failure days (0 when no entries). */
  avgEnergy: number;
  /** True when >=3 failures share a single category — a hard pattern. */
  repeatOffender: boolean;
  repeatCategory: FailureCategory | null;
};

const DAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

const STORAGE_KEY = '@silicon_failures_v1';

const persist = (entries: FailureEntry[]) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(e =>
    console.error('Failed to save failure log', e)
  );
};

/** Highest-count key in a tally, ties broken by first-seen insertion order. */
function topOf<T extends string>(counts: Record<string, number>): { key: T | null; count: number } {
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return { key: bestKey as T | null, count: bestCount };
}

type FailureStore = {
  entries: FailureEntry[];
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  addEntry: (partial: {
    whatHappened: string;
    energy: number;
    category: FailureCategory;
    analysis?: FailureAnalysis;
  }) => FailureEntry;
  getPatterns: () => PatternSummary;
};

export const useFailureStore = create<FailureStore>((set, get) => ({
  entries: [],
  isLoaded: false,

  hydrate: async () => {
    if (get().isLoaded) return; // StrictMode / double-mount guard
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<{ entries: FailureEntry[] }> | FailureEntry[];
        // Legacy shape stored the bare array; newer shape may wrap it. Coerce
        // defensively so a changed shape can never make `entries` non-array.
        const raw = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { entries?: unknown }).entries)
            ? (parsed as { entries: FailureEntry[] }).entries
            : [];
        set({ entries: raw });
      }
    } catch (e) {
      console.error('Failed to load failure log', e);
    } finally {
      set({ isLoaded: true });
    }
  },

  addEntry: partial => {
    const entry: FailureEntry = {
      id: `f_${Date.now()}`,
      date: new Date().toISOString(),
      whatHappened: partial.whatHappened.trim().slice(0, 280),
      energy: partial.energy,
      category: partial.category,
      analysis: partial.analysis,
    };
    // Newest first — the interrogation log reads top-down.
    const next = [entry, ...get().entries];
    persist(next);
    set({ entries: next });
    return entry;
  },

  getPatterns: () => {
    const { entries } = get();
    const total = entries.length;

    if (total === 0) {
      return {
        totalFailures: 0,
        topCategory: null,
        topCategoryCount: 0,
        worstDay: null,
        worstDayCount: 0,
        avgEnergy: 0,
        repeatOffender: false,
        repeatCategory: null,
      };
    }

    const categoryCounts: Record<string, number> = {};
    const dayCounts: Record<string, number> = {};
    let energySum = 0;

    for (const e of entries) {
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
      const day = DAY_NAMES[new Date(e.date).getDay()];
      dayCounts[day] = (dayCounts[day] ?? 0) + 1;
      energySum += e.energy;
    }

    const topCat = topOf<FailureCategory>(categoryCounts);
    const topDay = topOf<string>(dayCounts);
    const repeatOffender = topCat.count >= 3;

    return {
      totalFailures: total,
      topCategory: topCat.key,
      topCategoryCount: topCat.count,
      worstDay: topDay.key,
      worstDayCount: topDay.count,
      avgEnergy: Math.round((energySum / total) * 10) / 10,
      repeatOffender,
      repeatCategory: repeatOffender ? topCat.key : null,
    };
  },
}));
