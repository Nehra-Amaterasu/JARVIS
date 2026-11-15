// The adapter side of the Day port (package L01). `ports.ts` collects every `adapters/*.register.ts` file, and each file
// exports one `DayAdapterRegistration`. This file holds the registration type and the two honest answers an adapter uses when
// it has nothing to say, so the null adapter (and any later adapter that is half built) cannot invent a day.
import type { DayPort, PortReply } from '../ports'

/** One adapter file's registration. A later adapter overrides only the members it supplies, by rank. */
export interface DayAdapterRegistration {
  id: string
  /** The null adapter is 0; a real adapter is 10 or more. A higher rank wins per member. */
  rank: number
  port: Partial<DayPort>
}

/** WAITING with a reason, and no data. The default answer of every member until its source is connected. */
export const waiting = <T,>(reason: string): PortReply<T> => ({ state: 'waiting', reason, since: null, data: null })

/** PLANNED: no code path exists yet (the Google link, for one). */
export const planned = <T,>(reason: string): PortReply<T> => ({ state: 'planned', reason, since: null, data: null })
