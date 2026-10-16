/**
 * The ESP32's Wi-Fi link (firmware 3.5.0): which link to use, where the board is, the
 * secrets.h line for the shared key, and the one firewall rule the laptop needs.
 *
 * The key is shown only when asked ("Show the secrets.h line"), never kept in the page
 * after it is hidden, and never in a log or an event; the card shows its fingerprint,
 * beside the board's own, so a board flashed with another key is plain to see.
 */
import { Copy, KeyRound, ShieldCheck, Wifi } from 'lucide-react'
import { useState } from 'react'
import { api, post } from '../lib/api'
import { keyState, PREFER_WORDS, type Esp32LinkView, type Prefer } from '../lib/esp32link'
import { usePoll } from '../lib/format'
import { useStore } from '../lib/store'

async function copy(text: string, toast: (t: string, tone?: 'live' | 'fault') => void, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`${what} copied`, 'live')
  } catch {
    toast('Copy failed: select the text and copy it by hand', 'fault')
  }
}

export function Esp32LinkCard() {
  const toast = useStore((s) => s.toast)
  const [v, , reload] = usePoll(() => api<Esp32LinkView>('/api/esp32-link'), 5000)
  const [line, setLine] = useState<string | null>(null)
  const [addr, setAddr] = useState<string | null>(null)
  if (!v) return <section className="card board-panel"><div className="skeleton boards-skel" /></section>
  const ks = keyState(v)
  const address = addr ?? v.address ?? ''
  const save = async (body: Record<string, unknown>, said: string) => {
    try {
      await post('/api/esp32-link/settings', body)
      toast(said, 'live')
      setAddr(null)
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const showLine = async () => {
    try {
      setLine((await post<{ line: string }>('/api/esp32-link/secrets-line', {})).line)
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const connect = async () => {
    try {
      await post('/api/esp32-link/connect', { link: 'wifi' })
      toast('Aankhen is greeting the board over Wi-Fi', 'live')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  return (
    <section className="card board-panel">
      <div className="card-head">
        <span className="card-title"><Wifi size={15} strokeWidth={1.8} style={{ marginRight: 8 }} />Wi-Fi link</span>
        <span className={`pill ${ks.tone}`}>{ks.tone === 'live' && <i className="led breathe" />}{ks.text}</span>
      </div>
      <div className="kv board-kv">
        <span>Link</span>
        <span>
          <select className="field" value={v.prefer} aria-label="Which link to the board"
            onChange={(e) => void save({ prefer: e.target.value as Prefer }, `Link: ${PREFER_WORDS[e.target.value as Prefer]}`)}>
            {(Object.keys(PREFER_WORDS) as Prefer[]).map((p) => <option key={p} value={p}>{PREFER_WORDS[p]}</option>)}
          </select>
        </span>
        <span>Tried, in order</span><span className="mono">{v.addresses.join(' → ') || '—'}</span>
        <span>Ports</span><span className="mono">board UDP {v.board_port} · laptop UDP {v.host_port}</span>
      </div>
      <div className="board-ip">
        <Wifi size={14} className="muted" />
        <input className="field mono" value={address} placeholder={`board address (else ${v.last_ip ?? v.mdns})`}
          onChange={(e) => setAddr(e.target.value.trim())} aria-label="Board address for the Wi-Fi link"
          onKeyDown={(e) => { if (e.key === 'Enter' && address) void save({ address }, `Board address: ${address}`) }} />
        <button className="btn sm" disabled={!address || address === v.address} onClick={() => void save({ address }, `Board address: ${address}`)}>Set</button>
        <button className="btn sm" onClick={() => void connect()}>Connect over Wi-Fi</button>
      </div>

      <div className="board-note">
        <KeyRound size={13} className="muted" /> <b>1. The key in the firmware.</b> Put this line in <span className="mono">{v.secrets_file}</span>,
        then flash 3.5.0 once over USB.
        {line ? (
          <div className="board-ip">
            <input className="field mono" readOnly value={line} aria-label="secrets.h line" onFocus={(e) => e.target.select()} />
            <button className="btn sm" onClick={() => void copy(line, toast, 'secrets.h line')}><Copy size={13} /> Copy</button>
            <button className="btn sm" onClick={() => setLine(null)}>Hide</button>
          </div>
        ) : (
          <div><button className="btn sm" onClick={() => void showLine()}>Show the secrets.h line</button></div>
        )}
      </div>
      <div className="board-note">
        <ShieldCheck size={13} className="muted" /> <b>2. The firewall, once.</b> The board's datagrams arrive on UDP {v.host_port}.
        In an <b>administrator</b> PowerShell (JARVIS never runs it):
        <div className="board-ip">
          <input className="field mono" readOnly value={v.firewall} aria-label="Firewall rule" onFocus={(e) => e.target.select()} />
          <button className="btn sm" onClick={() => void copy(v.firewall, toast, 'Firewall rule')}><Copy size={13} /> Copy</button>
        </div>
        <span className="muted">Private networks and the home subnet only. Your Wi-Fi must be a Private network in Windows.</span>
      </div>
    </section>
  )
}
