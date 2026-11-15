// The J05 gallery states: the five Console views on stamped fixtures, then the parts alone (job rows, the route plates, the
// VRAM dial, the command line with its answers). Loaded lazily by gallery/entries/J05.tsx behind the product gate, so a
// Well Wisher only build carries none of it. Every value is invented (fixtures.tsx) and every state is stamped SIMULATED.
import type { ReactNode } from 'react'
import { JARVIS_PLANNED } from '../planned'
import { CommandDeck } from './CommandDeck'
import type { CommandContext, OutLine } from './commands'
import { ConsoleFixture, FIXED_NOW, VITALS_ON, healthLive, type ConsoleFixtureKind } from './fixtures'
import { gpuModel, healthRows } from './model'
import { JobRow, RoutePlates, VramDial } from './parts'
import { LAT_ON } from './fixtures'
import './console.css'
import './views.css'

/** The real canvas under the shell's view row (1302 x 668), drawn at 0.66 to fit the specimen pane. */
export function J05State({ kind }: { kind: ConsoleFixtureKind }) {
  return (
    <div data-product="jarvis" style={{ position: 'relative', width: 1302, height: 668, zoom: 0.66, overflow: 'hidden' }}>
      <ConsoleFixture kind={kind} />
    </div>
  )
}

const rows = healthRows({ online: true, lat: LAT_ON, crew: healthLive('running').crew, vitals: VITALS_ON, now: FIXED_NOW, simulated: true })
const ctx: CommandContext = {
  rows: () => rows, jobs: () => [{ id: 'a', tag: 'BRD', label: 'compile firmware', fraction: 0.64, state: 'live' }, { id: 'b', tag: 'SYS', label: 'steward check', state: 'hollow' }],
  plan: () => JARVIS_PLANNED, restartBrain: async () => 'restarting JARVIS: fixture-brain:8b', freeGpu: async () => 'freed 3.3 GB', exportMemory: null,
}
const answers: OutLine[] = [
  { id: 1, tag: 'SYS', state: null, kind: 'echo', text: 'jobs' },
  { id: 2, tag: 'BRD', state: 'live', kind: 'out', text: 'compile firmware  [#######>----] 64 %' },
  { id: 3, tag: 'SYS', state: 'waiting', kind: 'out', text: 'steward check  [------------] --' },
  { id: 4, tag: 'SYS', state: null, kind: 'echo', text: 'export memory' },
  { id: 5, tag: 'SYS', state: 'planned', kind: 'out', text: 'export memory is not built: no route writes the memory export yet' },
]

export function J05Part({ part }: { part: 'jobs' | 'route' | 'dial-live' | 'dial-hollow' | 'dial-full' | 'deck' }): ReactNode {
  const box = (children: ReactNode, w = 460) => <div className="jx" data-product="jarvis" style={{ position: 'relative', inset: 'auto', inlineSize: w, display: 'block', overflow: 'visible' }}>{children}</div>
  switch (part) {
    case 'jobs': return box(
      <ul className="jx-jobs" aria-label="Job rows">
        <JobRow label="compile firmware" fraction={0.64} state="live" tag="BRD" reason="compiling" head="car" />
        <JobRow label="restart brain" state="hollow" reason="waking" />
        <JobRow label="free gpu" fraction={1} state="done" />
        <JobRow label="flash firmware" state="fault" tag="BRD" reason="the board did not answer" />
      </ul>,
    )
    case 'route': return box(<RoutePlates registry={JARVIS_PLANNED.slice(0, 7)} />, 1100)
    case 'dial-live': return box(<VramDial model={gpuModel(VITALS_ON)} />, 200)
    case 'dial-hollow': return box(<VramDial model={gpuModel(null)} />, 200)
    case 'dial-full': return box(<VramDial model={gpuModel({ ...VITALS_ON, gpu: { ...VITALS_ON.gpu!, mem_used_mb: 5950 } })} />, 200)
    case 'deck': return box(<div className="g-well" data-scene="immersive" style={{ padding: 12 }}><CommandDeck ctx={ctx} initial={answers} shown={5} /></div>, 760)
  }
}
