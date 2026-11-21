// The registered view `memory.recall` (shell/views/memory-recall.view.ts): the live ports and the palette's pending query.
import { useStore } from '../../lib/store'
import { lookV3Enabled } from '../../shell/v3'
import { RecallView } from './Recall'
import { LIVE_RECALL, LIVE_REMINDERS } from './port'

export default function MemoryRecall() {
  const pending = useStore((s) => s.pendingQuery)
  const setPending = useStore((s) => s.setPendingQuery)
  return <RecallView port={LIVE_RECALL} reminders={LIVE_REMINDERS} initialQuery={pending} onQueryTaken={() => setPending(null)} v3={lookV3Enabled()} />
}
