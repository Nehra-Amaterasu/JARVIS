// The registered view `memory.beliefs` (shell/views/memory-beliefs.view.ts): the Belief board on the live ports.
import { lookV3Enabled } from '../../shell/v3'
import { BeliefsView } from './Beliefs'
import { LIVE_BELIEFS } from './port'

export default function MemoryBeliefs() {
  return <BeliefsView port={LIVE_BELIEFS} v3={lookV3Enabled()} />
}
