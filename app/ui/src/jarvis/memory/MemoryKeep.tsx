// The registered view `memory.keep` (shell/views/memory-keep.view.ts): the vault on the live ports. "Share a review" uses the
// same three routes as Core's key (LIVE_REVIEW), so the export has two homes and one implementation.
import { LIVE_REVIEW } from '../core/ShareReview'
import { KeepView } from './Keep'
import { LIVE_RECALL, LIVE_SOURCES } from './port'

export default function MemoryKeep() {
  return <KeepView recall={LIVE_RECALL} sources={LIVE_SOURCES} review={LIVE_REVIEW} />
}
