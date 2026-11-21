// Room, Switches (A.J02, spec 20.9.2): operate the room and trust the board. One canvas, no document scroll at 1366 x 768:
// the JARVIS content box is 1286 x 652 and the rows are fixed (room.css names the numbers).
//
//   top (rest)   faceplate, the hero (dial, numbered modes, eight keys)   board plate 320 (link, LCD, All off)
//   bottom 272   day ring 264                                             "what just happened" (3 lines, all on focus), what to say
//
// Every lamp on the keys follows the board's report; a press only asks. The scrubber on the ring previews and sends nothing.
// Below 900 px it is one column that scrolls inside itself, two keys per row, the modes and All off in one sticky bar.
import { useEffect, useMemo, useState } from 'react'
import type { LimbsView } from '../../lib/limbs'
import { voiceLines } from '../../lib/wallbox'
import { Fold, LampGlyph } from '../../shared/kit'
import { BoardPlate, Faceplate, useSceneGuard } from './Faceplate'
import { DayRing24 } from './DayRing24'
import { RoomLog } from './RoomLog'
import { Zones, lookV3Enabled } from '../../shell/v3'
import { rulesFrom, type Asked, type HeavyFlags, type LogLine, type Rule, keySlots } from './model'
import { useRoomLive, useRuleWindows, type RoomActions } from './useRoomLive'
import './room.css'
import './room-v3.css'

export interface RoomSwitchesViewProps {
  view: LimbsView | null
  loading?: boolean
  asked: Record<string, Asked>
  confirmedAt?: Record<string, number>
  now: number
  log: LogLine[]
  heavy: HeavyFlags
  setHeavy: (n: HeavyFlags) => void
  actions: Pick<RoomActions, 'press' | 'scene' | 'allOff'>
  rules: Rule[]
  /** A fixture (the gallery and the jury page): the box says SIMULATED under the plate. */
  simulated?: boolean
  coverMs?: number
  defaultStop?: number
}

export function RoomSwitchesView({ view, loading, asked, confirmedAt, now, log, heavy, setHeavy, actions, rules, simulated, coverMs, defaultStop }: RoomSwitchesViewProps) {
  const slots = useMemo(() => keySlots(view, asked, now, confirmedAt), [view, asked, now, confirmedAt])
  const modes = view?.modes ?? []
  const guard = useSceneGuard(modes, slots, heavy, (id) => void actions.scene(id))
  const [clock, setClock] = useState(() => new Date(now))
  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])
  const voice = useMemo(() => (view ? voiceLines(view.devices, view.modes) : []), [view])
  const empty = !view && !loading

  if (lookV3Enabled()) {
    // Under the v3 look the same pieces sit in three trays: the wall box and its keys (the act), the day ring (what the rules
    // do with the day), then the board and the terminal (the proof the board answered). Nothing here sends anything new.
    const link = !view ? { lamp: 'waiting' as const, note: 'no report from the board yet' }
      : !view.usb ? { lamp: 'simulated' as const, note: 'virtual room, no board' }
        : { lamp: view.esp32 && !view.esp32.connected ? 'waiting' as const : 'live' as const, note: view.esp32 && !view.esp32.connected ? 'board offline' : 'board reporting' }
    return (
      <div className="jr jr-kit jr-v3" data-scene="immersive" data-view="switches" data-simulated={simulated ? 'true' : undefined}>
        <Zones ratio={[2.2, 0.95, 1.2]}
          first={{
            job: 'SWITCH',
            children: (
              <div className="jr-plate-slot">
                <Faceplate slots={slots} heavy={heavy} setHeavy={setHeavy} modes={modes} lastMode={view?.last_mode ?? null}
                  onPress={(id, on) => void actions.press(id, on)} onScene={guard.request} armedText={guard.armed?.text ?? null} coverMs={coverMs} defaultStop={defaultStop} />
                {simulated && <p className="jr-stamp"><LampGlyph state="simulated" size={12} /> SIMULATED: fixture room, no board</p>}
                {empty && <p className="jr-stamp"><LampGlyph state="waiting" size={12} /> WAITING: the app did not answer. Connect the board in Console.</p>}
              </div>
            ),
          }}
          second={{
            job: 'DAY',
            peek: { name: 'Day ring', lamp: rules.length ? 'live' : 'waiting', note: rules.length ? 'the standing rules, drawn' : 'no rule read yet' },
            children: (
              <section className="jr-day" aria-label="Day ring">
                <header className="jr-day-head"><span className="jr-tag">[ROM] DAY RING</span></header>
                <DayRing24 rules={rules} now={clock} size={204} />
              </section>
            ),
          }}
          third={{
            job: 'BOARD',
            peek: { name: 'Board', lamp: link.lamp, note: link.note },
            children: (
              <>
                <BoardPlate view={view} slots={slots} onAllOff={() => void actions.allOff()} modes={modes} lastMode={view?.last_mode ?? null} onScene={guard.request} armedText={guard.armed?.text ?? null} />
                <RoomLog lines={log} slots={slots} />
                <div className="jr-dropup">
                  <Fold title={`What to say (${voice.length})`}>
                    <table className="jr-voice"><tbody>{voice.map((l) => <tr key={l.say}><td>{l.say}</td><td>{l.does}</td></tr>)}</tbody></table>
                  </Fold>
                </div>
              </>
            ),
          }} />
      </div>
    )
  }

  return (
    <div className="jr jr-kit" data-scene="immersive" data-view="switches" data-simulated={simulated ? 'true' : undefined}>
      <div className="jr-plate-slot">
        <Faceplate slots={slots} heavy={heavy} setHeavy={setHeavy} modes={modes} lastMode={view?.last_mode ?? null}
          onPress={(id, on) => void actions.press(id, on)} onScene={guard.request} armedText={guard.armed?.text ?? null} coverMs={coverMs} defaultStop={defaultStop} />
        {simulated && <p className="jr-stamp"><LampGlyph state="simulated" size={12} /> SIMULATED: fixture room, no board</p>}
        {empty && <p className="jr-stamp"><LampGlyph state="waiting" size={12} /> WAITING: the app did not answer. Connect the board in Console.</p>}
      </div>
      <BoardPlate view={view} slots={slots} onAllOff={() => void actions.allOff()} modes={modes} lastMode={view?.last_mode ?? null} onScene={guard.request} armedText={guard.armed?.text ?? null} />
      <div className="jr-bottom">
        <section className="jr-day" aria-label="Day ring">
          <header className="jr-day-head"><span className="jr-tag">[ROM] DAY RING</span></header>
          <DayRing24 rules={rules} now={clock} size={204} />
        </section>
        <div className="jr-lower">
          <RoomLog lines={log} slots={slots} />
          <div className="jr-dropup">
            <Fold title={`What to say (${voice.length})`}>
              <table className="jr-voice"><tbody>{voice.map((l) => <tr key={l.say}><td>{l.say}</td><td>{l.does}</td></tr>)}</tbody></table>
            </Fold>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The live Switches view: the hook's data into the presentational view. */
export default function RoomSwitches() {
  const room = useRoomLive()
  const windows = useRuleWindows()
  const rules = useMemo(() => rulesFrom({ presence: windows.presence, energy: windows.energy }), [windows.presence, windows.energy])
  return (
    <RoomSwitchesView view={room.view} loading={room.loading} asked={room.asked} confirmedAt={room.confirmedAt} now={room.now} log={room.log}
      heavy={room.heavy} setHeavy={room.setHeavy} actions={room.actions} rules={rules} />
  )
}
