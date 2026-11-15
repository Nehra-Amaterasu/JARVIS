// Console, Hardware (A.J05, spec 20.9.5, parity K05 R06): diagnostics for the board and the relays. Left, the board's own
// report as rows (link, firmware, uptime, reset reason, signal, csi) and the USB ports the scan found; middle, the relay
// rack, one RackRow per relay with the lamp that lights only after the board has said so; right, one folder: the Wi-Fi
// link card, the firmware, the relay pin map. FIRMWARE NEVER OFFERS A FLASH WHILE THE APP HOLDS THE PORT (model.flashGate):
// then the folder shows why and a Compile key and the job; the classic firmware card, which carries the flash keys, is only
// mounted when the port is free. The Wi-Fi link card and the firmware card are the classic ones, unchanged.
import { useMemo, useState, type ReactNode } from 'react'
import { Hammer } from 'lucide-react'
import { post } from '../../lib/api'
import { sizeLine, type BoardView } from '../../lib/board'
import type { BoardsView } from '../../lib/boards'
import { type LimbsView } from '../../lib/limbs'
import { useStore } from '../../lib/store'
import { Esp32LinkCard } from '../../components/Esp32LinkCard'
import { FirmwareCard } from '../../components/FirmwareCard'
import { Rack, RackRow, type RackState } from '../../shared/data/specimen'
import { Lamp, LampGlyph } from '../../shared/lamp'
import { PinMap } from '../room/pins/PinMap'
import { boardJobSpec, boardRows, flashGate, portRows, waiting } from './model'
import { ConsoleKey, ConsoleRow, ConsoleTabs, JobRow, PartHead, LampLine } from './parts'
import { useHardwareLive } from './useConsole'
import './console.css'
import './views.css'

export type HwTab = 'link' | 'firmware' | 'wiring'

export interface HardwareViewProps {
  board: BoardView | null
  ports: BoardsView | null
  limbs: LimbsView | null
  /** Epoch ms; the report time of a relay row is the moment this view of it arrived. */
  now?: number
  onCompile?: () => void
  onRelay?: (id: string, on: boolean) => void
  onReload?: () => void
  /** The port scan (POST /api/boards/scan): the key of the classic USB boards card. */
  onScan?: () => void
  scanning?: boolean
  /** The classic cards by tab. A fixture draws a note. */
  panels?: Partial<Record<'link' | 'firmware', ReactNode>>
  initialTab?: HwTab
  simulated?: boolean
}

/** The state of a relay unit, from what the limbs route says: confirmed by the board, else sent and not acknowledged. */
export function relayState(d: LimbsView['devices'][number]): RackState {
  if (d.link === 'virtual') return 'planned'
  return d.confirmed ? 'confirmed' : 'unconfirmed'
}

export function HardwareView({ board, ports, limbs, now = Date.now(), onCompile, onRelay, onReload, onScan, scanning, panels = {}, initialTab = 'link', simulated = false }: HardwareViewProps) {
  const [tab, setTab] = useState<HwTab>(initialTab)
  const rows = useMemo(() => boardRows(board), [board])
  const usb = useMemo(() => portRows(ports), [ports])
  const gate = flashGate(board)
  const job = boardJobSpec(board?.job)
  const devices = limbs?.devices ?? []
  const seen = useMemo(() => Date.now(), [limbs]) // eslint-disable-line react-hooks/exhaustive-deps
  const link = rows[0].reading
  const tabs = [{ id: 'link', label: 'Wi-Fi link' }, { id: 'firmware', label: 'Firmware' }, { id: 'wiring', label: 'Pins' }]
  const running = board?.job?.state === 'running'

  return (
    <div className="jx jx-hw" data-view="hardware" data-simulated={simulated ? 'true' : undefined}>
      <section className="jx-card jx-board" aria-label="Board">
        <PartHead tag="BRD" title="Board" stamp={simulated} seed="jarvis.console.board" right={<Lamp reading={link} showLabel size={12} subject="Board link" />} />
        <ul className="jx-rows" aria-label="Board report">{rows.map((r) => <ConsoleRow key={r.tag} row={r} />)}</ul>
        <PartHead tag="USB" title="Ports" seed="jarvis.console.ports" right={onScan ? <ConsoleKey label="Scan" busy={scanning} onPress={onScan} /> : undefined} />
        {ports === null ? (
          <p className="jx-empty"><LampLine reading={waiting('the port scan has not answered')} subject="USB ports" /></p>
        ) : usb.length === 0 ? (
          <p className="jx-empty"><span className="jx-tag">[USB]</span> no USB serial device found</p>
        ) : (
          <ul className="jx-rows" aria-label="USB ports">{usb.map((r, i) => <ConsoleRow key={`${r.text}-${i}`} row={r} />)}</ul>
        )}
      </section>

      <section className="jx-card jx-rack" aria-label="Relays">
        <PartHead tag="RLY" title="Relays" seed="jarvis.console.relays" />
        {limbs === null ? (
          <p className="jx-empty"><LampLine reading={waiting('the relay list has not answered')} subject="Relays" /></p>
        ) : devices.length === 0 ? (
          <p className="jx-empty"><span className="jx-tag">[RLY]</span> no relay is configured</p>
        ) : (
          <Rack title="RELAY BOARD" note={`${devices.length} unit${devices.length === 1 ? '' : 's'}`}>
            {devices.map((d) => (
              <RackRow
                key={d.id} device={d.name} serial={`CH${d.channel}`} state={relayState(d)} reportedAt={d.confirmed ? seen : null}
                on={d.state.on} onToggle={() => onRelay?.(d.id, !d.state.on)} now={now}
                lastSeen={d.link === 'virtual' ? undefined : d.confirmed ? 'board confirmed' : d.hardware_on === null ? 'not on the board' : 'waiting'}
              />
            ))}
          </Rack>
        )}
        {!!limbs?.problems?.length && <p className="jx-empty" role="status"><LampGlyph state="fault" size={12} /> {limbs.problems.join(' · ')}</p>}
        <p className="jx-dim">The rocker sends the command; the lamp lights only when the board says it switched. MAINS 230 V: the same switch as Room.</p>
      </section>

      <section className="jx-card jx-folder" aria-label="Board settings">
        <ConsoleTabs tabs={tabs} value={tab} onChange={(id) => setTab(id as HwTab)} label="Board settings" />
        <div className="jx-folder-body" role="tabpanel" aria-label={`${tab} panel`} data-tab={tab}>
          {tab === 'link' && (panels.link ?? <p className="jx-empty"><span className="jx-tag">[SYS]</span> the Wi-Fi link card draws here in the app</p>)}
          {tab === 'firmware' && (
            <div className="jx-fw">
              {gate.allowed ? (
                panels.firmware ?? <p className="jx-empty"><span className="jx-tag">[SYS]</span> the firmware card draws here in the app</p>
              ) : (
                <>
                  <p className="jx-gate" role="status" data-flash="closed"><LampGlyph state="waiting" size={14} /> <span><b>Flash is closed.</b> {gate.reason}.</span></p>
                  <ul className="jx-rows" aria-label="Firmware">{rows.slice(1, 2).map((r) => <ConsoleRow key={r.tag} row={r} />)}</ul>
                  {board?.build && <p className="jx-dim">last build {board.build.version ?? 'unversioned'}, {sizeLine(board.build)}</p>}
                  {job && <ul className="jx-jobs" aria-label="Board job"><JobRow {...job} /></ul>}
                  <div className="jx-keys">
                    <ConsoleKey
                      label="Compile" icon={<Hammer size={16} />} onPress={() => onCompile?.()} busy={running}
                      disabledReason={board && !board.tools.arduino_cli ? 'arduino-cli was not found' : undefined}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'wiring' && <div className="jx-wiring"><PinMap v={limbs} onTested={onReload} defaultOpen /></div>}
        </div>
      </section>
    </div>
  )
}

/** The registered view (shell/views/console-hardware.view.ts): the live data and the classic Wi-Fi link and firmware cards. */
export default function Hardware() {
  const live = useHardwareLive()
  const toast = useStore((s) => s.toast)
  const panels = useMemo(() => ({
    link: <div className="jx-classic"><Esp32LinkCard /></div>,
    firmware: <div className="jx-classic"><FirmwareCard v={live.board} reload={live.reloadBoard} /></div>,
  }), [live.board, live.reloadBoard])
  const compile = async () => {
    try { await post('/api/board/compile'); live.reloadBoard() } catch (e) { toast((e as Error).message, 'fault') }
  }
  const [scanning, setScanning] = useState(false)
  const scan = async () => {
    setScanning(true)
    try { await post('/api/boards/scan'); live.reloadPorts() } catch (e) { toast((e as Error).message, 'fault') } finally { setScanning(false) }
  }
  const relay = async (id: string, on: boolean) => {
    try {
      const r = await post<{ delivered?: Record<string, boolean> }>(`/api/limbs/${encodeURIComponent(id)}`, { action: on ? 'on' : 'off' })
      const failed = Object.entries(r.delivered ?? {}).filter(([, ok]) => !ok).map(([d]) => d)
      if (failed.length) toast(`Saved, but the relay board did not confirm: ${failed.join(', ')}.`, 'fault')
      window.setTimeout(live.reloadLimbs, 120)
    } catch (e) { toast((e as Error).message, 'fault') }
  }
  return <HardwareView board={live.board} ports={live.ports} limbs={live.limbs} now={live.now} onCompile={() => void compile()} onRelay={(id, on) => void relay(id, on)} onReload={live.reloadLimbs} onScan={() => void scan()} scanning={scanning} panels={panels} />
}
