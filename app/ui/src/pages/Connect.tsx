/**
 * Connect: what JARVIS thinks and speaks with, and everything that plugs into him.
 *
 *   05.1 Brain and voice   choose the model (applies on restart), the voice, the speed,
 *                          how he says words; test it out loud
 *   05.2 Modules           heavy capabilities switched on for a moment
 *   05.3 Memory exports    request each export, bring the file in, see what is in it
 *   05.4 Phone             JARVIS from the phone on the home Wi-Fi: off by default; pair
 *                          by QR, remove a phone, firewall + HTTPS steps
 *   05.5 Detected          ports, models, services, found live. Four statuses, each
 *                          meaning one thing; "planned" is dashed and has no switch.
 */
import {
  AudioLines, BrainCircuit, Cable, Check, Copy, Cpu, Database, Mic, MessageSquare, Music, Plug, Radar,
  Terminal, ToggleRight, Waves,
} from 'lucide-react'
import { api } from '../lib/api'
import { usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'
import { BrainCard, ExportsSection, ModulesSection, PronunciationCard, VoiceCard } from '../components/ConnectControls'
import { RemarksCard } from '../components/RemarksCard'
import { PhoneCard } from '../components/PhoneCard'
import { useState } from 'react'

interface Item { id: string; group: string; name: string; status: 'connected' | 'available' | 'missing' | 'planned'; detail: string; next: string | null }

const GLYPH: Record<string, typeof Cable> = {
  esp32: Cpu, ld2450: Radar, relay: ToggleRight, mic: Mic, ollama: BrainCircuit, whisper: AudioLines,
  tts: Waves, wake: AudioLines, mqtt: Plug, instagram: MessageSquare, chatgpt: MessageSquare,
  claude: Terminal, gemini: Terminal, spotify: Music, ytmusic: Music,
}
const TONE: Record<Item['status'], string> = { connected: 'live', available: '', missing: 'fault', planned: 'planned' }
// These four have their own export cards (05.3), with the real state of the file.
const HAS_EXPORT_CARD = new Set(['instagram', 'chatgpt', 'spotify', 'ytmusic'])

function Group({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="connect-group">
      <h2><span className="mono muted" style={{ fontSize: 12 }}>{n}</span>{title}</h2>
      {children}
    </section>
  )
}

export function ConnectPage() {
  const [items, loading] = usePoll(() => api<Item[]>('/api/connect'), 15000)
  const detected = items?.filter((i) => !HAS_EXPORT_CARD.has(i.id))
  const count = (s: Item['status']) => detected?.filter((i) => i.status === s).length ?? 0
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

      <Group n="05.1" title="Brain and voice">
        <div className="cx-two">
          <BrainCard />
          <div className="cx-card" style={{ gap: 14 }}>
            <VoiceCard />
            <PronunciationCard />
            <RemarksCard />
          </div>
        </div>
      </Group>

      <Group n="05.2" title="Modules">
        <ModulesSection />
      </Group>

      <Group n="05.3" title="Memory exports">
        <ExportsSection />
      </Group>

      <Group n="05.4" title="Phone">
        <PhoneCard />
      </Group>

      <Group n="05.5" title="Detected">
        {loading && !items && <div className="empty">Scanning ports, models and exports…</div>}
        <div className="connect-grid">
          {detected?.map((i) => <Integration key={i.id} item={i} />)}
        </div>
      </Group>
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
      <div className="integ-detail"><span className="mono muted">{item.group} · </span>{item.detail}</div>
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
