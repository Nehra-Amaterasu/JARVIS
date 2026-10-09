import { create } from 'zustand';
import AsyncStorage from '../platform';

import type { MuscleGroup } from '../data/exercises';

/** One logged exercise within a session. */
export type WorkoutEntry = {
  exerciseId: string;
  sets: number;
  reps: number;
  weight: number;
};

/** A completed training session — the muscles chosen + what was logged. */
export type WorkoutSession = {
  id: string;
  /** ISO timestamp */
  date: string;
  muscles: MuscleGroup[];
  entries: WorkoutEntry[];
};

const STORAGE_KEY = '@silicon_workouts_v1';

const persist = (sessions: WorkoutSession[]) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)).catch(e =>
    console.error('Failed to save workouts', e)
  );
};

type WorkoutStore = {
  sessions: WorkoutSession[];
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  addSession: (partial: {
    muscles: MuscleGroup[];
    entries: WorkoutEntry[];
  }) => WorkoutSession;
  /** Last logged numbers for an exercise across all past sessions, or null. */
  getLast: (exerciseId: string) => WorkoutEntry | null;
};

export const useWorkoutStore = create<WorkoutStore>((set, get) => ({
  sessions: [],
  isLoaded: false,

  hydrate: async () => {
    if (get().isLoaded) return; // StrictMode / double-mount guard
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<{ sessions: WorkoutSession[] }> | WorkoutSession[];
        // Legacy shape stored the bare array; newer shape may wrap it. Coerce
        // defensively so a changed shape can never make `sessions` non-array.
        const sessions = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { sessions?: unknown }).sessions)
            ? (parsed as { sessions: WorkoutSession[] }).sessions
            : [];
        set({ sessions });
      }
    } catch (e) {
      console.error('Failed to load workouts', e);
    } finally {
      set({ isLoaded: true });
    }
  },

  addSession: partial => {
    const session: WorkoutSession = {
      id: `w_${Date.now()}`,
      date: new Date().toISOString(),
      muscles: partial.muscles,
      entries: partial.entries,
    };
    // Newest first — getLast reads top-down for the most recent numbers.
    const next = [session, ...get().sessions];
    persist(next);
    set({ sessions: next });
    return session;
  },

  getLast: exerciseId => {
    // sessions are newest-first, so the first hit is the most recent.
    for (const session of get().sessions) {
      const entry = session.entries.find(e => e.exerciseId === exerciseId);
      if (entry) return entry;
    }
    return null;
  },
}));
