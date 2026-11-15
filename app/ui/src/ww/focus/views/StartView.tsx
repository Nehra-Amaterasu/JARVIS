// focus.start under shell v2 (A.Y02): the Start form on the classic Crucible's engine. With the shell flag off the classic frame
// still renders ww/focus/FocusWorkspace.tsx exactly as before; this file is never read there.
import { FocusStart } from '../FocusStart'

export default function StartView() {
  return <FocusStart />
}
