/**
 * Connect: everything that can plug into JARVIS, detected live (ports, files,
 * sockets). Four statuses, each meaning one thing; "planned" is drawn dashed and
 * has no switch, because pretending would be worse than saying so.
 */
import {
  AudioLines, BrainCircuit, Cable, Check, Copy, Cpu, Database, Mic, MessageSquare, Music, Plug, Radar,
  Terminal, ToggleRight, Waves,
} from 'lucide-react'
import { api } from '../lib/api'
import { usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'
import { useState } from 'react'

interface Item { id: string; group: string; name: string; status: 'connected' | 'available' | 'missing' | 'planned'; detail: string; next: string | null }

const GLYPH: Record<string, typeof Cable> = {
  esp32: Cpu, ld2450: Radar, relay: ToggleRight, mic: Mic, ollama: BrainCircuit, whisper: AudioLines,
  tts: Waves, wake: AudioLines, mqtt: Plug, instagram: MessageSquare, chatgpt: MessageSquare,
  claude: Terminal, gemini: Terminal, spotify: Music, ytmusic: Music,
}
const TONE: Record<Item['status'], string> = { connected: 'live', available: '', missing: 'fault', planned: 'planned' }
const GROUP_N: Record<string, string> = { Hardware: '05.1', Brain: '05.2', Memory: '05.3' }

export function ConnectPage() {
  const [items, loading] = usePoll(() => api<Item[]>('/api/connect'), 15000)
  const groups = ['Hardware', 'Brain', 'Memory']
  const count = (s: Item['status']) => items?.filter((i) => i.status === s).length ?? 0
  return (
    <div className="page fade-in">
      <PageHeader tab="connect" right={
        <div className="connect-summary">
          <span className="pill live"><i className="led" />{count('connected')} connected</span>
          <span className="pill">{count('available')} available</span>
          <span className="pill fault">{count('missing')} missing</span>
          <span className="pill planned">{count('planned')} planned</span>
        </div>
      } />
      {loading && !items && <div className="empty">Scanning ports, models and exports…</div>}
      {groups.map((g) => (
        <section key={g} className="connect-group">
          <h2><span className="mono muted" style={{ fontSize: 12 }}>{GROUP_N[g]}</span>{g}</h2>
          <div className="connect-grid">
            {items?.filter((i) => i.group === g).map((i) => <Integration key={i.id} item={i} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function Integration({ item }: { item: Item }) {
  const Icon = GLYPH[item.id] ?? Database
  const toast = useStore((s) => s.toast)
  const [copied, setCopied] = useState(false)
  const isCmd = !!item.next && /^(winget|ollama|pip|npm|python)\b/.test(item.next)
  return (
    <section className={`card integ ${item.status}`}>
      <div className="integ-top">
        <span className="integ-name"><Icon size={17} strokeWidth={1.7} />{item.name}</span>
        <span className={`pill ${TONE[item.status]}`}>{item.status !== 'planned' && <i className="led" />}{item.status}</span>
      </div>
      <div className="integ-detail">{item.detail}</div>
      {item.next && (
        <div className="integ-next">
          <span>{item.next}</span>
          {isCmd && (
            <button className="btn ghost sm icon" aria-label="Copy command" onClick={() => {
              void navigator.clipboard.writeText(item.next!)
              setCopied(true)
              toast('Copied — run it in a terminal.', 'info')
              window.setTimeout(() => setCopied(false), 1500)
            }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          )}
        </div>
      )}
    </section>
  )
}
