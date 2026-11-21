// The registered view `memory.people` (shell/views/memory-people.view.ts): the People ring on the live port.
import { lookV3Enabled } from '../../shell/v3'
import { PeopleView } from './People'
import { LIVE_PEOPLE } from './port'

export default function MemoryPeople() {
  return <PeopleView port={LIVE_PEOPLE} v3={lookV3Enabled()} />
}
