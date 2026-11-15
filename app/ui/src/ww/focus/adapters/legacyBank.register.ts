// The legacy bank registers itself on import (the glob in adapters/index.ts loads every *.register.ts), so the Drill finds the
// cards of the game store with no wiring. The null port stays under it: with no store the Drill still says "Nothing queued".
import { registerFocusPort } from '../ports'
import { legacyBankPort } from './legacyBank'

registerFocusPort(legacyBankPort)
