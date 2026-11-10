/**
 * The Focus workspace (plan 4.8, chunk 10): Crucible | Drill. The frame draws the one h1 ("Focus");
 * this page has none. The view comes from a deep link (legacy `drill` / `crucible` tabs set the frame's
 * view) or from what was open last, remembered per workspace. One canvas, nothing scrolls.
 */
import { useFrame } from '../frame/frameStore'
import { useWorkspaceValue } from '../frame/workspaceMemory'
import { Segmented } from '../kit'
import { WwCrucible } from './Crucible'
import { WwDrill } from './Drill'
import './focus.css'

type View = 'crucible' | 'drill'
const isView = (v: unknown): v is View => v === 'crucible' || v === 'drill'

export function WwFocusPage() {
  const linked = useFrame((s) => s.view)
  const [mem, setMem] = useWorkspaceValue<View>('focus', 'view', 'crucible')
  const view: View = isView(linked) ? linked : mem
  const pick = (v: View) => {
    setMem(v)
    useFrame.setState({ view: v })
  }
  return (
    <div className="ww-focus" data-ws="focus" data-view={view}>
      <div className="ww-focus-bar">
        <Segmented<View> label="Focus view" variant="view" value={view} onChange={pick}
          options={[{ id: 'crucible', label: 'Crucible' }, { id: 'drill', label: 'Drill' }]} />
      </div>
      <div className="ww-focus-body">{view === 'drill' ? <WwDrill /> : <WwCrucible />}</div>
    </div>
  )
}
