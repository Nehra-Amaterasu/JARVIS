/**
 * USB boards: every serial port with what it SAID when Aankhen listened, and what
 * the hot-plug watcher will do (ROADMAP F2-F4).
 *
 * A port is cyan only once it has sent a valid Aankhen frame; a CH340 that printed
 * text is "not Aankhen", whatever its vendor id. "Scan" asks every port again, even
 * those that said no before, because a person pressed it.
 *
 * Motion: rows rise in (staggered); a verdict that changes pops; the card scans
 * while a scan runs; the live board's LED breathes; the port count rolls.
 */
import { Cable, RefreshCw, Usb } from 'lucide-react'
import { useState } from 'react'
import { api, post } from '../lib/api'
import { boardsHeadline, hotplugLine, portIds, verdictLabel, verdictTone, type BoardsView, type PortView } from '../lib/boards'
import { usePoll } from '../lib/format'
import { Ticker } from '../lib/motion'
import '../styles/boards.css'

export function BoardPorts({ pollMs = 5000 }: { pollMs?: number }) {
  const [v, loading, reload] = usePoll(() => api<BoardsView>('/api/boards'), pollMs)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = async () => {
    setScanning(true)
    setError(null)
    try {
      await post<BoardsView>('/api/boards/scan')
      reload()                                     // the poll shows what the scan stored
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false)
    }
  }

  const live = v?.ports.some((p) => p.verdict === 'aankhen' && p.in_use)
  return (
    <section className={`card boards ${scanning ? 'scan' : ''}`} aria-busy={scanning}>
      <div className="card-head">
        <span className="card-title"><Usb size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />USB boards</span>
        <span className="boards-count mono muted"><Ticker value={v?.ports.length ?? null} /> port{v?.ports.length === 1 ? '' : 's'}</span>
      </div>
      {loading && !v && <div className="skeleton boards-skel" />}
      {v && (
        <>
          <div key={boardsHeadline(v)} className={`boards-headline pop ${live ? 'live' : ''}`}>
            {live && <i className="led breathe" />}{boardsHeadline(v)}
          </div>
          <div className="boards-hotplug muted">{hotplugLine(v)}</div>
          {v.ports.length === 0 && (
            <div className="empty boards-empty"><Cable size={18} />Nothing on USB. Bluetooth COM ports are ignored on purpose.</div>
          )}
          <ul className="boards-list">
            {v.ports.map((p, i) => <PortRow key={p.device} port={p} i={i} />)}
          </ul>
          {v.hotplug.last && <div className="boards-last mono muted rise">{v.hotplug.last.text}</div>}
        </>
      )}
      {error && <div className="boards-error fault rise">{error}</div>}
      <div className="boards-actions">
        <button className="btn sm" onClick={() => void scan()} disabled={scanning}>
          <RefreshCw size={13} className={scanning ? 'spin' : ''} />{scanning ? 'Listening…' : 'Scan'}
        </button>
        <span className="muted boards-note">Listens only: nothing is sent to a port until it identifies itself.</span>
      </div>
    </section>
  )
}

function PortRow({ port, i }: { port: PortView; i: number }) {
  const tone = verdictTone(port)
  return (
    <li className="boards-row rise press" style={{ ['--i' as string]: i }}>
      <div className="boards-row-top">
        <span className="boards-dev mono">{port.device}</span>
        <span className="boards-ids mono muted">{portIds(port)}</span>
        <span key={`${port.verdict}-${port.in_use}`} className={`pill pop ${tone}`}>
          {tone && <i className={`led ${port.in_use ? 'breathe' : ''}`} />}{verdictLabel(port)}
        </span>
      </div>
      <div className="boards-detail muted">{port.chip || port.description}{port.chip || port.description ? ' · ' : ''}{port.detail}</div>
    </li>
  )
}
