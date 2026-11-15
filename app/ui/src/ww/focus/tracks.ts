/**
 * The track host (A.Y02): `tracks/*.track.tsx`. A file exports one `TrackRegistration` (as `track` or `default`); the Crucible is the
 * first, the paper track is X08's and arrives by adding one file. The registry is collected the way shell/views is: validated,
 * sorted by path, a second file for an id already taken is refused, and the Crucible always comes first.
 */
import type { ComponentType } from 'react'

export type TrackRegistration = { id: string; Session: ComponentType<{ onEnd(): void }> }

const isTrack = (x: unknown): x is TrackRegistration =>
  !!x && typeof x === 'object' && typeof (x as TrackRegistration).id === 'string' && typeof (x as TrackRegistration).Session === 'function'

export interface CollectedTracks { tracks: TrackRegistration[]; errors: string[] }

export function collectTracks(modules: Record<string, unknown>): CollectedTracks {
  const byId = new Map<string, TrackRegistration>()
  const errors: string[] = []
  for (const path of Object.keys(modules).sort()) {
    const m = modules[path] as { default?: unknown; track?: unknown } | undefined
    const reg = isTrack(m?.track) ? m!.track : isTrack(m?.default) ? m!.default : null
    if (!reg) { errors.push(`${path}: exports no TrackRegistration`); continue }
    if (byId.has(reg.id)) { errors.push(`${path}: ${reg.id} is already registered`); continue }
    byId.set(reg.id, reg)
  }
  const tracks = [...byId.values()].sort((a, b) => (a.id === 'crucible' ? -1 : b.id === 'crucible' ? 1 : 0))
  return { tracks, errors }
}

export const TRACKS: CollectedTracks = collectTracks(import.meta.glob('./tracks/*.track.tsx', { eager: true }))

export const trackById = (id: string): TrackRegistration | undefined => TRACKS.tracks.find((t) => t.id === id)
