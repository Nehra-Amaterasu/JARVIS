// Registration of the intake store adapter. The intake desk has its own wider port (`registerIntakeDesk`, not a member of the sixteen of
// the Study port), so this file is imported for its effect by the desk and by nothing else; it never collects into `STUDY_PORT`.
// It registers in every build but speaks only when it may: the product test is written in place so a JARVIS-only build folds it to false
// and no request is made, and with no token in the window every member answers what the null desk answers (WAITING).
import { TOKEN } from '../../../../lib/api'
import { registerIntakeDesk } from '../port'
import { createIntakeStore } from './store'

const adapter = createIntakeStore({ gate: () => import.meta.env.VITE_PRODUCT !== 'jarvis', token: () => TOKEN })

registerIntakeDesk(adapter.port)

/** A view that reads the desk calls this when it unmounts: every request in flight stops. */
export const abortIntake = (): void => adapter.abortAll()
export const intakeStoreAdapter = adapter
