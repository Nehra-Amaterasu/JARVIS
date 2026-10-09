import { create } from 'zustand';
import AsyncStorage from '../platform';

/**
 * The Daily Log's "RECENT EXECUTION" history. Previously this lived in local
 * component state seeded with fake demo rows, so real entries vanished on
 * navigation. This store persists them for real (mirrors failure-store).
 */
export type LogType = 'commit' | 'stamina' | 'german';

export type LogEntry = {
  id: string;
  /** ISO timestamp */
  date: string;
  type: LogType;
  text: string;
  xp: number;
};

const STORAGE_KEY = '@silicon_logs_v1';

const persist = (entries: LogEntry[]) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(e =>
    console.error('Failed to save execution log', e)
  );
};

type LogStore = {
  entries: LogEntry[];
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  addEntry: (partial: { type: LogType; text: string; xp: number }) => LogEntry;
};

export const useLogStore = create<LogStore>((set, get) => ({
  entries: [],
  isLoaded: false,

  hydrate: async () => {
    if (get().isLoaded) return; // StrictMode / double-mount guard
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Defensive: entries must always be an array (app-update safety).
        set({ entries: Array.isArray(parsed) ? parsed : [] });
      }
    } catch (e) {
      console.error('Failed to load execution log', e);
    } finally {
      set({ isLoaded: true });
    }
  },

  addEntry: partial => {
    const entry: LogEntry = {
      id: `log_${Date.now()}`,
      date: new Date().toISOString(),
      type: partial.type,
      text: partial.text.trim().slice(0, 280),
      xp: partial.xp,
    };
    const next = [entry, ...get().entries]; // newest first
    persist(next);
    set({ entries: next });
    return entry;
  },
}));
