/**
 * Relay wiring on the classic Limbs page: the compact pin map of RW1 (D-V3-35). The Arduino Uno wiring guide is gone (the
 * ESP32 is the board in use); the map keeps one row per relay with its GPIO, state word and a test key, and the same
 * export and props so the classic page mounts it unchanged. It draws with the classic classes only (ClassicPins); the
 * Room view mounts the kit's PinMap fold (jarvis/room/pins/PinMap.tsx) from the same model.
 */
import { ClassicPins } from '../jarvis/room/pins/ClassicPins'
import type { LimbsView } from '../lib/limbs'

export function RelayWiring({ v, onTested }: { v: LimbsView | null; onTested: () => void }) {
  return (
    <section className="card wiring">
      <ClassicPins v={v} onTested={onTested} />
    </section>
  )
}
