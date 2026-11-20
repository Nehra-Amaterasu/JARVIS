// The registered face of `study.dmat` under shell v2 (package Y03): the dMAT board on the same logic as the classic page. If the dMAT
// routes are absent the board falls back to the registry's one-line placeholder, as the classic page does.
import { Planned } from '../../Planned'
import { DmatBoard } from './DmatBoard'
import { useDmat } from './useDmat'
import '../plan/y3.css'

export default function DmatView() {
  const d = useDmat()
  if (d.hist === 'absent') {
    return <div className="ww-dmat y3 dm" data-view="dmat"><section className="y3-card" data-card="study-dmat"><h2 className="y3-title">dMAT practice</h2><Planned id="dmat-practice" hint /></section></div>
  }
  return <DmatBoard d={d} />
}
