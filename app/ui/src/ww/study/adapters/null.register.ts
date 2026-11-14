// The null adapter (package Y01): every member of the Study port answers WAITING with the reason it is waiting for. It is
// rank 0, so any real adapter that supplies a member replaces it for that member and the rest stay honest. Nothing here
// fabricates a paper, a question or a count: the screens read `data: null` and draw a hollow form with the reason.
import { planned, waiting, type StudyAdapterRegistration } from './types'
import type { StudyPort } from '../ports'

const ENGINE = 'the paper engine is not connected yet'

export const nullStudyPort: StudyPort = {
  papers: async () => waiting(ENGINE),
  questions: async () => waiting(ENGINE),
  ingest: async () => waiting('reading a paper needs the paper engine'),
  decide: async () => waiting('a review is saved by the paper engine'),
  crop: async () => waiting('re-cutting a crop needs the paper engine'),
  blueprints: async () => waiting('a blueprint is inferred from a paper on file'),
  generate: async () => waiting('a practice paper needs a blueprint and reviewed questions'),
  patterns: async () => waiting('too few papers to show a pattern'),
  practiseNext: async () => waiting('ranking needs reviewed questions and your marks'),
  check: async () => waiting('the checker is not connected yet'),
  readiness: async () => waiting('counting needs marked attempts'),
  tonight: async () => waiting('it is built from your own records'),
  queue: async () => waiting(ENGINE),
  harvest: async () => waiting('the harvester is not connected yet'),
  intake: async () => waiting('choose a folder to watch'),
  classroom: async () => planned('Classroom is not built; it would pull course files you can already open'),
}

export const registration: StudyAdapterRegistration = { id: 'null', rank: 0, port: nullStudyPort }
export default registration
