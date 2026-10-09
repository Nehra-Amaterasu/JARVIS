/**
 * Cinematic moments: a level, a secured floor, a crit, a boss down. One banner at a
 * time, queued, a couple of seconds each — loud enough to feel, short enough to
 * never block the next action.
 */
import { create } from 'zustand'

export interface Banner { id: number; kicker: string; title: string; sub?: string; tone: 'chrome' | 'live' | 'fault' | 'sim' | 'gold' }

export const useBanners = create<{ queue: Banner[]; show: (b: Omit<Banner, 'id'>) => void; next: () => void }>((set, get) => ({
  queue: [],
  show: (b) => {
    const q = [...get().queue, { ...b, id: Date.now() + Math.random() }]
    set({ queue: q })
    if (q.length === 1) window.setTimeout(() => get().next(), 2600)
  },
  next: () => {
    const q = get().queue.slice(1)
    set({ queue: q })
    if (q.length) window.setTimeout(() => get().next(), 2600)
  },
}))

export function GameFx() {
  const b = useBanners((s) => s.queue[0])
  if (!b) return null
  return (
    <div className={`game-banner ${b.tone}`} key={b.id} role="status" aria-live="polite">
      <span className="gb-kicker mono">{b.kicker}</span>
      <span className="gb-title display">{b.title}</span>
      {b.sub && <span className="gb-sub">{b.sub}</span>}
    </div>
  )
}
