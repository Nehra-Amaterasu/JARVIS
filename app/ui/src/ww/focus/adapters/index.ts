// The adapter host: importing this folder loads every `*.register.ts` once. A later package (the question store of the engine
// lane, the paper track) adds ONE file here and edits nothing else.
import.meta.glob('./*.register.ts', { eager: true })
export { legacyBankPort, cardToQuestion, SET_MAX } from './legacyBank'
