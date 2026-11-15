// The Crucible is the first track of the Focus host (tracks.ts). The paper track of X08 adds a file beside this one.
import { Crucible } from '../CrucibleSession'
import type { TrackRegistration } from '../tracks'

export const track: TrackRegistration = { id: 'crucible', Session: ({ onEnd }) => <Crucible onEnd={onEnd} /> }
