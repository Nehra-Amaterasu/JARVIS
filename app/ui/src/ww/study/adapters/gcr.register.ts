// Registration of the Classroom adapter. ports.ts collects every `adapters/*.register.ts`; this one is rank 10 and supplies only
// `classroom`, so for that member it replaces the null adapter's PLANNED answer, and the other fifteen are not touched.
//
// It registers in every build but speaks only when it may: the product test is written in place (as in pyq.register.ts) so a
// JARVIS-only build folds it to false and no request is made, and with no token in the window the status answers what the null
// adapter answers (PLANNED), so a window that cannot sign in never invents a link.
import { TOKEN } from '../../../lib/api'
import { createGcr } from './gcr'
import type { StudyAdapterRegistration } from './types'

const adapter = createGcr({ gate: () => import.meta.env.VITE_PRODUCT !== 'jarvis', token: () => TOKEN })

/** The typed client of the Classroom screens (the plate on the Intake desk and the Classroom shelf). */
export const gcrClient = adapter.client
/** Stop every Classroom request in flight. */
export const abortGcr = (): void => adapter.abortAll()

export const registration: StudyAdapterRegistration = { id: 'gcr', rank: 10, port: adapter.port }
export default registration
