// The Memory section's gallery states (A.J04): the real views on invented fixtures, stamped SIMULATED. The box is the real
// canvas under the shell's view row (1302 x 668), drawn zoomed down to fit the specimen pane. Loaded lazily by
// gallery/entries/J04.tsx, only in a build that holds JARVIS.
import { MemoryFixture, type MemoryFixtureKind } from './MemoryFixture'

export function J04State({ state, zoom = 0.62 }: { state: MemoryFixtureKind; zoom?: number }) {
  return (
    <div style={{ position: 'relative', width: 1302, height: 668, zoom, overflow: 'hidden', isolation: 'isolate' }} data-clay-scope>
      <MemoryFixture kind={state} />
    </div>
  )
}
