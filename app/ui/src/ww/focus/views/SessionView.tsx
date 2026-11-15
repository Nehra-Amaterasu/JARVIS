// focus.session under shell v2 (A.Y02): the registered track of the block that is running (the Crucible is the first), then Rest.
import { TRACKS, trackById } from '../tracks'
import { goFocus } from '../nav'
import { useFocusViews } from '../store'

export default function SessionView() {
  const kind = useFocusViews((s) => s.runKind)
  const reg = trackById(kind) ?? TRACKS.tracks[0]
  if (!reg) return null
  const Session = reg.Session
  return <Session onEnd={() => goFocus('rest')} />
}
