// Console, Connections (A.J05, spec 20.9.5, parity K02 K03 C10 O4e): what JARVIS thinks with and everything that plugs into
// him. Left, the detected integrations as lamp rows (the five words each mean one thing: "installed" is on disk and not
// loaded now, "planned" has no switch); right, one folder of detail: the brain (choose a model, restart), the selected
// integration, then the modules, exports, phone pairing and unprompted remarks cards. The brain is drawn here from the
// same routes the classic Connect page uses (lib/settings); the four other cards are the classic ones, mounted unchanged
// (their logic is large and is not rewritten), and they keep their classic look until their own package.
import { useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, RotateCcw } from 'lucide-react'
import type { BrainView } from '../../lib/settings'
import { ModulesSection, ExportsSection } from '../../components/ConnectControls'
import { PhoneCard } from '../../components/PhoneCard'
import { RemarksCard } from '../../components/RemarksCard'
import { Chip } from '../../shared/kit/v3'
import { Lamp, LampGlyph, type LampReading } from '../../shared/lamp'
import { Zones, lookV3Enabled } from '../../shell/v3'
import { STATUS_WORD, integrationCounts, integrationReading, type Integration } from './model'
import { ConsoleKey, ConsoleTabs, GuardKey, PartHead, LampLine } from './parts'
import { useConnectionsLive } from './useConsole'
import './console.css'
import './views.css'
import './console-v3.css'

export type ConnTab = 'brain' | 'detail' | 'modules' | 'exports' | 'phone' | 'remarks'

export interface ConnectionsViewProps {
  items: Integration[] | null
  loading?: boolean
  brain: BrainView | null
  onChoose: (model: string) => void
  onRestart: () => void
  /** The four classic cards, keyed by tab. A fixture draws a note instead. */
  panels?: Partial<Record<Exclude<ConnTab, 'brain' | 'detail'>, ReactNode>>
  initialTab?: ConnTab
  initialSelected?: string | null
  simulated?: boolean
}

const isCmd = (s: string | null) => !!s && /^(winget|ollama|pip|npm|python)\b/.test(s)

export function ConnectionsView({ items, loading, brain, onChoose, onRestart, panels = {}, initialTab = 'brain', initialSelected = null, simulated = false }: ConnectionsViewProps) {
  const [tab, setTab] = useState<ConnTab>(initialTab)
  const [sel, setSel] = useState<string | null>(initialSelected)
  const [copied, setCopied] = useState<string | null>(null)
  const detected = useMemo(() => (items ?? []).filter((i) => !['instagram', 'chatgpt', 'spotify', 'ytmusic'].includes(i.id)), [items])
  const counts = integrationCounts(detected)
  const current = detected.find((i) => i.id === sel) ?? null
  const tabs = [
    { id: 'brain', label: 'Brain' }, { id: 'detail', label: 'Detail' }, { id: 'modules', label: 'Modules' },
    { id: 'exports', label: 'Exports' }, { id: 'phone', label: 'Phone' }, { id: 'remarks', label: 'Remarks' },
  ]
  const pick = (id: string) => { setSel(id); setTab('detail') }
  const listReading: LampReading = items === null
    ? { state: 'waiting', since: null, reason: loading ? 'scanning ports, models and exports' : 'the scan has not answered' }
    : { state: simulated ? 'simulated' : 'live', since: null, reason: 'found live by the local server' }

  const countsBody = (
    <p className="jx-counts" aria-label="Counts by status">
      {(['connected', 'installed', 'available', 'missing', 'planned'] as const).map((s) => <span key={s}><b>{counts[s]}</b> {STATUS_WORD[s]}</span>)}
    </p>
  )
  const listBody = (
    <>
      {items === null ? (
        <p className="jx-empty"><LampLine reading={listReading} subject="Detected list" /></p>
      ) : (
        <ul className="jx-int-list" aria-label="Detected, press one for its detail">
          {detected.map((i) => {
            const r = integrationReading(i)
            return (
              <li key={i.id}>
                <button type="button" className="jx-int" data-integration={i.id} data-status={i.status} aria-pressed={sel === i.id} onClick={() => pick(i.id)}>
                  <LampGlyph state={r.state} size={14} />
                  <span className="jx-int-name">{i.name}</span>
                  <span className="jx-int-word">{STATUS_WORD[i.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
  const folderBody = (
    <>
      <ConsoleTabs tabs={tabs} value={tab} onChange={(id) => setTab(id as ConnTab)} label="Connection settings" />
      <div className="jx-folder-body" role="tabpanel" aria-label={`${tab} panel`} data-tab={tab}>
        {tab === 'brain' && <BrainPanel brain={brain} onChoose={onChoose} onRestart={onRestart} simulated={simulated} />}
        {tab === 'detail' && (
          current ? (
            <article className="jx-detail" aria-label={current.name}>
              <PartHead tag="SYS" title={current.name} seed={`jarvis.console.int.${current.id}`} right={<Lamp reading={integrationReading(current)} showLabel size={12} subject={current.name} />} />
              <p className="jx-detail-line"><span className="jx-dim">{current.group} · </span>{current.detail || 'no detail reported'}</p>
              {current.next && (
                <div className="jx-next">
                  <code>{current.next}</code>
                  {isCmd(current.next) && (
                    <ConsoleKey
                      label={copied === current.id ? 'Copied' : 'Copy command'} icon={copied === current.id ? <Check size={14} /> : <Copy size={14} />}
                      onPress={() => { void navigator.clipboard?.writeText(current.next!); setCopied(current.id) }}
                    />
                  )}
                </div>
              )}
            </article>
          ) : <p className="jx-empty"><span className="jx-tag">[SYS]</span> press an integration on the left to see what it reports</p>
        )}
        {tab !== 'brain' && tab !== 'detail' && (panels[tab] ?? <p className="jx-empty"><span className="jx-tag">[SYS]</span> the {tab} card draws here in the app</p>)}
      </div>
    </>
  )

  if (lookV3Enabled()) {
    return (
      <div className="jx jx3 jx-conn" data-view="connections" data-simulated={simulated ? 'true' : undefined}>
        <Zones
          ratio="console"
          first={{ job: 'CONNECT', chip: <Chip state={listReading.state} reason={listReading.reason} />, children: <div className="jx3-folder">{folderBody}</div> }}
          second={{
            job: 'DETECTED', chip: <Chip state={listReading.state} reason={listReading.reason} />,
            peek: { name: 'Detected', lamp: listReading.state, note: items === null ? 'scanning' : undefined },
            children: <div className="jx3-detected">{listBody}</div>,
          }}
          third={{ job: 'STATUS', peek: { name: 'Status', lamp: listReading.state }, children: <div className="jx3-notes">{countsBody}</div> }}
        />
      </div>
    )
  }

  return (
    <div className="jx jx-conn" data-view="connections" data-simulated={simulated ? 'true' : undefined}>
      <section className="jx-card jx-detected" aria-label="Detected integrations">
        <PartHead tag="SYS" title="Detected" stamp={simulated} seed="jarvis.console.detected" right={<Lamp reading={listReading} showLabel={false} size={12} subject="Detected list" />} />
        {countsBody}
        {listBody}
      </section>

      <section className="jx-card jx-folder" aria-label="Connection settings">
        {folderBody}
      </section>
    </div>
  )
}

function BrainPanel({ brain, onChoose, onRestart, simulated }: { brain: BrainView | null; onChoose: (m: string) => void; onRestart: () => void; simulated: boolean }) {
  if (!brain) return <p className="jx-empty"><LampLine reading={{ state: 'waiting', since: null, reason: 'the brain list has not answered' }} subject="Brain" /></p>
  const using = brain.running
  const head: LampReading = brain.core_running
    ? { state: simulated ? 'simulated' : 'live', since: null, reason: `thinking with ${using ?? 'a model'}` }
    : { state: 'waiting', since: null, reason: `JARVIS is off, starts with ${brain.chosen}` }
  return (
    <div className="jx-brain">
      <PartHead tag="BRN" title="Brain" seed="jarvis.console.brain" right={<Lamp reading={head} showLabel size={12} subject="Brain" />} />
      {!brain.ollama && <p className="jx-empty" role="status"><LampGlyph state="fault" size={12} /> Ollama is not answering on port 11434: start the Ollama app.</p>}
      {brain.pending_restart && (
        <div className="jx-pending" role="status">
          <span><b>{brain.chosen}</b> is chosen; JARVIS is still thinking with {brain.running}. It applies when he restarts.</span>
          <GuardKey label="Restart brain" armedLabel="Restart now?" accent icon={<RotateCcw size={16} />} onConfirm={onRestart} />
        </div>
      )}
      <div className="jx-models" role="radiogroup" aria-label="Brain model">
        {brain.models.map((m) => (
          <button
            key={m.name} type="button" role="radio" className="jx-model" aria-checked={m.chosen} aria-disabled={m.why_not ? true : undefined}
            data-chosen={m.chosen ? 'true' : undefined} title={m.why_not ?? undefined}
            onClick={() => { if (!m.why_not && !m.chosen) onChoose(m.name) }}
          >
            <span className="jx-radio" aria-hidden="true" />
            <span className="jx-model-body">
              <span className="jx-model-name">{m.name}{m.running && <em className="jx-badge">in use</em>}{m.loaded_gb != null && <em className="jx-badge">{m.loaded_gb} GB in VRAM</em>}</span>
              <span className="jx-model-meta">{m.params ?? '?'} · {m.capabilities.join(', ') || 'capabilities unknown'}</span>
              {m.why_not && <span className="jx-model-why"><LampGlyph state="fault" size={12} /> {m.why_not}</span>}
              {!m.why_not && (m.warn || m.note) && <span className="jx-model-why">{m.warn || m.note}</span>}
            </span>
            <span className="jx-model-size jx-dim">{m.gb.toFixed(1)} GB file</span>
          </button>
        ))}
      </div>
      {brain.core_running && !brain.pending_restart && (
        <div className="jx-brain-foot">
          <GuardKey label="Restart brain" armedLabel="Restart now?" icon={<RotateCcw size={16} />} onConfirm={onRestart} />
          <span className="jx-dim">Stops JARVIS and starts him again in the same mode, about 20 s.</span>
        </div>
      )}
    </div>
  )
}

/** The registered view (shell/views/console-connections.view.ts): the live data and the four classic cards. */
export default function Connections() {
  const live = useConnectionsLive()
  const panels = useMemo(() => ({
    modules: <div className="jx-classic"><ModulesSection /></div>,
    exports: <div className="jx-classic"><ExportsSection /></div>,
    phone: <div className="jx-classic"><PhoneCard /></div>,
    remarks: <div className="jx-classic"><RemarksCard /></div>,
  }), [])
  return <ConnectionsView items={live.items} loading={live.loading} brain={live.brain} onChoose={(m) => void live.choose(m)} onRestart={() => void live.restart()} panels={panels} />
}
