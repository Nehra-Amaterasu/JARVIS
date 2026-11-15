// Registration of the exam adapter (package AD08). ports.ts collects every `adapters/*.register.ts`, and this file is rank 10, so
// for the ten members it supplies it replaces the null adapter; the six it does not (readiness, tonight, queue, harvest, intake,
// classroom) stay the null adapter's WAITING and PLANNED answers.
//
// The adapter registers in every build but speaks only when it may: the product test is written in place (as in the shell views)
// so a JARVIS-only build folds it to false and no request is ever made, and with no token in the window every member answers what
// the null adapter answers. While the engine routes are absent (a 404 "Not Found" on the prefix) every member is WAITING
// "engine routes not found", so the null adapter's honesty is never lost.
import { TOKEN } from '../../../lib/api'
import { createPyqPort } from './pyq'
import type { StudyAdapterRegistration } from './types'

const adapter = createPyqPort({ gate: () => import.meta.env.VITE_PRODUCT !== 'jarvis', token: () => TOKEN })

/** A view that reads the exam port calls this when it unmounts: every request and poll of the adapter stops. */
export const abortPyq = (): void => adapter.abortAll()
/** The subject the pattern, practise-next and ingest members work on, when the papers do not say (null clears it). */
export const setPyqSubject = (subject: string | null): void => adapter.setSubject(subject)

export const registration: StudyAdapterRegistration = { id: 'pyq', rank: 10, port: adapter.port }
export default registration
