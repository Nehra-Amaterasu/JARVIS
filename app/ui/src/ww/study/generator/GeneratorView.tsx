// The registered face of `study.practice` under shell v2 (package X03): the practice-paper maker on the Study port. With the shell flag off
// the classic frame still renders the Drill page for this id exactly as before; this file is never read there.
// Under the v3 look the view has two faces (package N2): tonight's sheet first, because it is what he opens each evening, and the practice-paper
// maker one press away with everything it did before. The face not shown is not mounted.
import { lookV3Enabled } from '../../../shell/v3'
import { TonightFace } from '../tonight/TonightView'
import { Faces } from '../tonight/shared'
import { GeneratorDesk } from './GeneratorDesk'

export default function GeneratorView() {
  if (!lookV3Enabled()) return <GeneratorDesk />
  return (
    <Faces first="tonight" label="Practice faces" className="tsh-practice" faces={[
      { id: 'tonight', label: "Tonight's sheet", node: <TonightFace /> },
      { id: 'paper', label: 'Practice paper', node: <GeneratorDesk /> },
    ]} />
  )
}
