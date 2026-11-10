// Chunk 12's overlays in one import: loading this module registers O1 Date sheet, O2 Phone, O6 Log minutes and
// O7 Confirm (each file calls registerOverlay on import). MissionRoot's flag branch imports it with the Frame, so
// the pairing doorway works from the left column before the Setup page has ever been opened, and with the flag
// off none of this code is downloaded. It also re-applies the stored Motion choice, because that is a
// <html data-motion> attribute and nothing else would set it on a fresh load.
import { applyMotion, readMotion } from '../setup/appearance'
import './DateSheet'
import './Phone'
import './LogMinutes'
import './Confirm'

applyMotion(readMotion())
