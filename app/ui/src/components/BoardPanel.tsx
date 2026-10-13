/**
 * The ESP32 itself: which link reaches it (USB port or Wi-Fi address), and what it
 * says about itself — firmware, uptime, RSSI, packet rate, relays, link 2, OTA.
 *
 * Every number here is the board's own report: its STATUS frame over USB, or
 * GET /status over Wi-Fi (firmware 3.4.0+). Nothing is filled in from the app's own
 * state, and the simulator's STATUS never reaches this card (board_ctl.py drops it).
 */
import { Cpu, Radio, Wifi } from 'lucide-react'
import { useState } from 'react'
import { post } from '../lib/api'
import { beaconLine, fmtUptime, linkPill, liveStatus, resetLine, rssiWord, type BoardView } from '../lib/board'
import { useStore } from '../lib/store'

export function BoardPanel({ v, reload }: { v: BoardView | null; reload: () => void }) {
  const toast = useStore((s) => s.toast)
  const [typed, setIp] = useState<string | null>(null)
  const ip = typed ?? v?.ip ?? ''
  if (!v) return <section className="card board-panel"><div className="skeleton boards-skel" /></section>
  const pill = linkPill(v)
  const st = liveStatus(v)
  const relays = st?.relays
  const reset = resetLine(st?.reset)
  const fw = v.firmware
  const saveIp = async () => {
    try {
      await post('/api/board/wifi', { ip })
      toast(`Board address set to ${ip}`, 'live')
      setIp(null)
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  return (
    <section className="card board-panel">
      <div className="card-head">
        <span className="card-title"><Cpu size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />ESP32-S3 board</span>
        <span className={`pill ${pill.tone}`}>{pill.tone === 'live' && <i className="led breathe" />}{pill.text}</span>
      </div>

      <div className="board-fw">
        <div>
          <span className="eyebrow">Running</span>
          <b className={st ? 'live' : 'muted'}>{fw.running ?? (v.link === 'none' ? 'unknown: no board' : '—')}</b>
        </div>
        <div>
          <span className="eyebrow">In the repo</span>
          <b>{fw.repo ?? '—'}</b>
        </div>
        {fw.differs && <span className="pill sim">update ready</span>}
      </div>

      {st ? (
        <div className="kv board-kv">
          <span>Uptime</span><span className="mono">{fmtUptime(st.uptime_s)}</span>
          <span>Wi-Fi</span><span className="mono">{rssiWord(st.rssi)}{st.channel ? ` · ch ${st.channel}` : ''}</span>
          <span>Packet rate</span>
          <span className="mono">{st.csi_hz ?? '—'} CSI/s{st.csi_dropped ? ` · ${st.csi_dropped.toLocaleString('en-US')} dropped` : ''}</span>
          <span>Relays</span>
          <span className="board-relays">
            {relays ? Object.entries(relays).map(([k, on]) => (
              <span key={k} className={`pill ${on ? 'live' : ''}`}>{k} {on === null ? 'not wired' : on ? 'on' : 'off'}</span>
            )) : <span className="muted mono">{st.full === false ? 'set AANKHEN_RELAY_TOKEN to read them' : '—'}</span>}
          </span>
          <span>Link 2 (phone)</span><span className="mono">{beaconLine(st)}</span>
          <span>Firmware over Wi-Fi</span>
          <span className={`mono ${st.ota ? 'live' : 'sim'}`}>{st.ota === undefined ? 'firmware < 3.4.0: no OTA' : st.ota ? 'on · UDP 3232' : 'off: no OTA_PASS_VALUE'}</span>
          <span>Last start</span><span className={`mono ${reset.tone}`}>{reset.text}</span>
          {v.link === 'usb' && <>
            <span>Host link</span>
            <span className="mono">{(v.link_stats.frames_ok ?? 0).toLocaleString('en-US')} frames · {v.link_stats.crc_errors ?? 0} CRC errors</span>
            <span>Report</span>
            <span className="mono">{st.age_s === null || st.age_s === undefined ? '—' : `${st.age_s.toFixed(1)} s ago`}{st.heap_free ? ` · ${Math.round(st.heap_free / 1024)} KB free` : ''}</span>
          </>}
          {v.link === 'wifi' && <>
            <span>Answered in</span><span className="mono">{v.wifi?.latency_ms ?? '—'} ms over Wi-Fi</span>
          </>}
        </div>
      ) : (
        <div className="empty board-empty">
          <Radio size={18} />
          {v.hub.hold ? `Aankhen is paused: ${v.hub.hold}.`
            : v.wifi && !v.wifi.reachable ? v.wifi.note
            : v.wifi?.note ? v.wifi.note
            : 'Plug the ESP32 in over USB, or give its Wi-Fi address below.'}
        </div>
      )}

      <div className="board-ip">
        <Wifi size={14} className="muted" />
        <input className="field mono" value={ip} placeholder="board's Wi-Fi address, e.g. 192.168.1.50"
          onChange={(e) => setIp(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter' && ip) void saveIp() }}
          aria-label="Board Wi-Fi address" />
        <button className="btn sm" disabled={!ip || ip === v.ip} onClick={() => void saveIp()}>Set</button>
      </div>
      <div className="muted board-note">
        {v.ip_source === 'usb' ? 'Address learnt from the board over USB. ' : v.ip ? 'Address typed here. ' : ''}
        Over Wi-Fi the board answers GET /status: who it is and how it is doing; relays only with the token.
      </div>
    </section>
  )
}
