// JARVIS planned entries (spec 12.6): the 13 starter rows plus the phone twin, one record shape shared with
// Well Wisher through shared/planned. The lines are the DRAFT lines of spec 12.6; the owner approves the wording
// in V02 and the approved lines replace these then. Every line is 15 to 140 characters with no count and no date.
//
// Three rows stand for orphan cards that are built and not verified (Strand 0 section 7.2, D20): library,
// reminder alerts and energy. Their lamp is WAITING "built, not verified" (never PLANNED, never "not built"),
// so they carry `state: 'unverified'` and the renderer draws the half disc. Each is deleted in the commit that
// mounts its card after the backend is confirmed live (B06).
//
// `jarvis.mode-schedule` and `jarvis.memory-delete-all` are assumptions to verify in B06 against what the Modes
// editor and the Yaadash keep and wrong buttons already do; if the feature exists the row is dropped, not kept.
import { createRegistry } from '../shared/planned/registry'
import type { PlannedEntry } from '../shared/planned/types'

const SINCE = '2026-11-12'
const REVIEW_BY = '2027-02-10' // since + 90 days (spec 12.3 target)

const j = (e: Omit<PlannedEntry, 'product' | 'since' | 'reviewBy' | 'owner'>): PlannedEntry => ({
  ...e, product: 'jarvis', since: SINCE, reviewBy: REVIEW_BY, owner: 'ui-chat',
})

export const JARVIS_PLANNED: PlannedEntry[] = [
  j({ id: 'jarvis.agents', home: 'console.crew', pattern: 'coming', label: 'Agents', blocker: 'decision',
    line: 'Agents that act on their own are not built. The staff roster below only reports what runs now.',
    needs: 'A decision on what an agent may do without asking.' }),
  j({ id: 'jarvis.spotify-play', home: 'core.sound', pattern: 'disabled', label: 'Play a track by name', blocker: 'account',
    line: 'Starting a track by name is not built. The Spotify app opens on a search and you press play.',
    needs: 'A Spotify developer account and its sign-in.' }),
  j({ id: 'jarvis.library', home: 'core.sound', pattern: 'coming', label: 'Local music library', blocker: 'build', state: 'unverified',
    line: 'The local library panel is built and not verified yet. It stays out of the app until a check shows its routes answer.',
    needs: 'A check that the library routes answer, then the card is mounted.' }),
  j({ id: 'jarvis.reminder-alerts', home: 'memory.recall', pattern: 'coming', label: 'Reminder alerts', blocker: 'build', state: 'unverified',
    line: 'Spoken and chime alerts for due reminders are built and not verified yet. They stay off until the reminder route answers.',
    needs: 'A check that the reminder route answers.' }),
  j({ id: 'jarvis.memory-delete-all', home: 'memory.keep', pattern: 'disabled', label: 'Delete a whole namespace', blocker: 'build',
    line: 'Deleting everything under one heading in one step is not built. Delete items one at a time for now.',
    needs: 'A delete-by-heading route and a confirm step.' }),
  j({ id: 'jarvis.memory-meaning', home: 'memory.recall', pattern: 'roadmap', label: 'Hinglish meaning search', blocker: 'data',
    line: 'Search by meaning in Hinglish is not tested yet. Search by words works now.',
    needs: 'A private retrieval test on Hinglish notes that beats the current model.' }),
  j({ id: 'jarvis.senses-multilink', home: 'senses.signal', pattern: 'coming', label: 'More links', blocker: 'hardware',
    line: 'A second link would add coverage, not pose. No second transmitter is set up.',
    needs: 'A second transmitter, a phone or another board, on the same network.' }),
  j({ id: 'jarvis.senses-phone-tx', home: 'senses.teach', pattern: 'roadmap', label: 'Phone as a transmitter', blocker: 'build',
    line: 'Using a phone as an extra transmitter is not built.',
    needs: 'A phone page that sends the traffic the board listens for.' }),
  j({ id: 'jarvis.senses-rti', home: 'senses.presence', pattern: 'roadmap', label: 'Room tomography', blocker: 'hardware',
    line: 'A coarse region of motion in the room, never a position or a pose, is not built. It needs more links and a passed readiness check.',
    needs: 'More links and a passed readiness check.' }),
  j({ id: 'jarvis.away-mode', home: 'room.rules', pattern: 'coming', label: 'Away mode', blocker: 'decision',
    line: 'Away mode would watch for motion only. It cannot see a still person, so it is not a security alarm. Off until you decide.',
    needs: 'Your decision to turn it on, knowing it is motion only.', when: 'needs a decision' }),
  j({ id: 'jarvis.energy', home: 'room.rules', pattern: 'coming', label: 'Energy use', blocker: 'hardware', state: 'unverified',
    line: 'The energy view is built and not verified yet. Without a current sensor any figure is an estimate and will say so.',
    needs: 'A current sensor, or a view that labels every figure an estimate.' }),
  j({ id: 'jarvis.mode-schedule', home: 'room.rules', pattern: 'roadmap', label: 'Modes at set times', blocker: 'build',
    line: 'Modes that start at a set time are not built. A mode runs when you pick it or a rule fires.',
    needs: 'A time trigger in the rules engine.' }),
  j({ id: 'jarvis.wake-custom', home: 'console.connections', pattern: 'disabled', label: 'Your own wake word', blocker: 'licence',
    line: 'A wake word of your own is not built. The pretrained one is licensed for personal use only.',
    needs: 'A licence that allows a custom model, or a model trained on your own recordings.' }),
  j({ id: 'jarvis.phone-twin', home: 'phone', pattern: 'disabled', label: 'Spatial twin on the phone', blocker: 'build',
    line: 'The spatial twin stays on the desktop. The phone lists each reading as measured or not measured.',
    needs: 'A phone view of the twin, which is not planned for the phone page.' }),
]

export const jarvisRegistry = createRegistry(JARVIS_PLANNED)
