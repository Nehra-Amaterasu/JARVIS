// The 3D twin behind the "3D" key (D-V2-20): the existing spatial twin, mounted only while 3D is selected, so a Senses view
// never holds two canvases (the terrain unmounts first). This file adds no WebGL import: the twin module is loaded with a
// dynamic import() from the unchanged twin/ folder, on the first press of the key, and disposed when the key is released.
// It feeds the twin exactly what pages/Aankhen.tsx fed it (room, frames, heat, belief) from the shared store's raw stream.
import { useEffect, useRef } from 'react'
import type { Framing, Layer, SpatialTwin, BeliefSummary, RoomSpec } from '../../twin/SpatialTwin'
import type { Raw, SensesStore } from './store'

export interface TwinStageProps {
  store: SensesStore
  room: RoomSpec | null
  camera: '3d' | 'plan'
  framing: Framing
  layers: Record<Layer, boolean>
  /** Bump to reset the camera. */
  resetKey: number
  onEstimate?: (s: BeliefSummary | null) => void
}

export default function TwinStage({ store, room, camera, framing, layers, resetKey, onEstimate }: TwinStageProps) {
  const host = useRef<HTMLDivElement>(null)
  const twin = useRef<SpatialTwin | null>(null)
  const first = useRef({ room, camera, framing, layers })
  first.current = { room, camera, framing, layers }

  useEffect(() => {
    let dead = false
    let off = () => {}
    void import('../../twin/SpatialTwin').then(({ SpatialTwin: Twin }) => {
      if (dead || !host.current) return
      const t = new Twin(host.current)
      twin.current = t
      if (onEstimate) t.onEstimate = onEstimate
      t.setLayer('fov', false) // no radar in this project: never draw a field of view
      const f = first.current
      for (const [l, on] of Object.entries(f.layers) as [Layer, boolean][]) if (l !== 'fov') t.setLayer(l, on)
      if (f.camera === 'plan') t.setView('plan')
      t.setFraming(f.framing)
      if (f.room) t.setRoom(f.room)
      off = store.onRaw((m: Raw) => {
        if (m.type === 'room') t.setRoom((m as unknown as { room: RoomSpec }).room)
        else if (m.type === 'frame') t.onFrame(m as never)
        else if (m.type === 'heatmap') t.onHeatmap(m as never)
        else if (m.type === 'status') {
          const b = (m as { belief?: unknown }).belief
          if (b) t.onBelief(b, String((m as { source?: string }).source ?? ''))
        }
      })
      store.send({ type: 'hello', want: 'snapshot', layer: 'live' })
    })
    return () => {
      dead = true
      off()
      twin.current?.dispose()
      twin.current = null
    }
    // the twin is built once per mount; the settings below reach it through the effects that follow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => { twin.current?.setView(camera) }, [camera])
  useEffect(() => { twin.current?.setFraming(framing) }, [framing])
  useEffect(() => {
    for (const [l, on] of Object.entries(layers) as [Layer, boolean][]) if (l !== 'fov') twin.current?.setLayer(l, on)
  }, [layers])
  useEffect(() => { if (resetKey) twin.current?.resetCamera() }, [resetKey])

  return <div ref={host} className="js-twin-host" data-testid="twin-host" role="img" aria-label="3D twin of the room: where movement probably is, drawn as rings and dots, not as a person" />
}
