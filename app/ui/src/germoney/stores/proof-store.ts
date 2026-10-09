/**
 * PROOF STORE — honor-system proof-of-work for quest completion.
 *
 * Every completed quest must be backed by evidence: either a typed reflection
 * or a photo. This store persists that evidence (keyed by quest id) so a
 * completed quest can display a "PROOF LOCKED" state and surface what was
 * attached. Proof is NOT validated — this is accountability, not verification.
 *
 * Mirrors the Zustand + AsyncStorage hydrate pattern of failure-store.ts.
 */
import { create } from 'zustand';
import AsyncStorage from '../platform';

export type ProofType = 'text' | 'photo';

export type ProofEntry = {
  /** The quest this proof belongs to (daily/weekly/side/boss id). */
  questId: string;
  type: ProofType;
  /** Reflection text for 'text', or local image uri for 'photo'. */
  value: string;
  /** ISO timestamp of when the proof was locked in. */
  date: string;
};

const STORAGE_KEY = '@silicon_proofs_v1';

const persist = (proofs: Record<string, ProofEntry>) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(proofs)).catch(e =>
    console.error('Failed to save proofs', e)
  );
};

type ProofStore = {
  /** questId -> proof entry. Record for O(1) lookup on completed cards. */
  proofs: Record<string, ProofEntry>;
  isLoaded: boolean;
  hydrate: () => Promise<void>;
  /** Records (or overwrites) the proof for a quest and persists it. */
  addProof: (entry: {
    questId: string;
    type: ProofType;
    value: string;
  }) => ProofEntry;
  getProof: (questId: string) => ProofEntry | undefined;
};

export const useProofStore = create<ProofStore>((set, get) => ({
  proofs: {},
  isLoaded: false,

  hydrate: async () => {
    if (get().isLoaded) return; // StrictMode / double-mount guard
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        // Guard against a changed/corrupt shape: `proofs` must always be a
        // plain object so O(1) lookups on completed cards never crash.
        const proofs =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, ProofEntry>)
            : {};
        set({ proofs });
      }
    } catch (e) {
      console.error('Failed to load proofs', e);
    } finally {
      set({ isLoaded: true });
    }
  },

  addProof: partial => {
    const entry: ProofEntry = {
      questId: partial.questId,
      type: partial.type,
      value: partial.type === 'text' ? partial.value.trim().slice(0, 500) : partial.value,
      date: new Date().toISOString(),
    };
    const next = { ...get().proofs, [entry.questId]: entry };
    persist(next);
    set({ proofs: next });
    return entry;
  },

  getProof: questId => get().proofs[questId],
}));
