// The null adapter (package L01): every member of the Day port answers WAITING (or PLANNED, where nothing exists yet) with the
// reason. It is rank 0, so any real adapter that supplies a member replaces it for that member and the rest stay honest.
// Nothing here fabricates a day, a count or a deadline: the screens read `data: null` and draw a hollow form with the reason.
import { planned, waiting, type DayAdapterRegistration } from './types'
import type { DayPort } from '../ports'

export const nullDayPort: DayPort = {
  month: async () => waiting('the day log is not connected yet'),
  day: async () => waiting('the day log is not connected yet'),
  intake: async () => waiting('add a calendar file or paste a line to bring deadlines in'),
  intents: async () => waiting('the intent store is not connected yet'),
  logs: async () => waiting('the day log is not connected yet, so nothing was saved'),
  reminders: async () => waiting('reminders are not connected yet'),
  gcal: async () => planned('the Google link is not built; it will need your sign-in'),
  dashboards: async () => planned('dashboards are not built yet'),
}

export const registration: DayAdapterRegistration = { id: 'null', rank: 0, port: nullDayPort }
export default registration
