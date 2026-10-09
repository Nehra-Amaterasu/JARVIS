/**
 * Core: JARVIS himself. Wake him (voice or text), watch his state, talk to him,
 * see what every subsystem is doing — and the week's mission numbers.
 */
import {
  AudioLines, BrainCircuit, Hand, Keyboard, Mic, Power, ScanEye, Send, Speaker,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, post, type CoreInfo, type Turn } from '../lib/api'
import { fmt, fmtDur, fmtGb, fmtInt, pad2, usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader, STATE_LABEL } from '../components/Shell'
import { Reactor } from '../components/Reactor'

const BOOT_STEPS = [
  { id: 'whisper', label: 'Ears', detail: 'Whisper on CUDA' },
  { id: 'audio', label: 'Voice', detail: 'audio + speech' },
  { id: 'wakeword', label: 'Wake word', detail: '“Hey Jarvis”' },
  { id: 'memory', label: 'Memory', detail: 'Yaadash + brain warm-up' },
]

export function CorePage() {
  const core = useStore((s) => s.core)
  const level = useStore((s) => s.micLevel)
  const threshold = useStore((s) => s.micThreshold)
  const refreshCore = useStore((s) => s.refreshCore)
  const toast = useStore((s) => s.toast)
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshCore()
    const id = window.setInterval(() => void refreshCore(), 5000)
    return () => window.clearInterval(id)
  }, [refreshCore])

  const running = !!core?.running
  const state = core?.state ?? 'offline'

  const toggle = async () => {
    setBusy(true)
    try {
      if (running) await post('/api/core/stop')
      else await post('/api/core/start', { mode })
      await refreshCore()
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page core-page fade-in">
      <PageHeader tab="core" />
      <div className="core-grid">
        <div className="core-col">
          <SystemsCard core={core} />
          <MissionCard />
        </div>

        <section className="core-center">
          <div className="reactor-wrap">
            <Reactor state={state} running={running} bootStep={core?.boot_step ?? null}
              level={level} threshold={threshold} error={!!core?.last_error && !running} />
            <div className="reactor-label">
              <div className={`display rl-state ${running ? '' : 'off'}`}>{STATE_LABEL[state] ?? state}</div>
              <div className="mono rl-sub">
                {running
                  ? `${core?.mode} mode · up ${fmtDur(core?.uptime_s)}`
                  : core?.last_error ? 'stopped with an error' : 'not running'}
              </div>
            </div>
          </div>

          {state === 'booting' && <BootSteps step={core?.boot_step ?? null} mode={core?.mode ?? mode} />}

          <div className="core-controls">
            {!running && (
              <div className="seg">
                <button className={mode === 'voice' ? 'on' : ''} onClick={() => setMode('voice')}>
                  <Mic size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Voice
                </button>
                <button className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
                  <Keyboard size={13} style={{ marginRight: 6, verticalAlign: -2 }} />Text only
                </button>
              </div>
            )}
            <button className={`btn power ${running ? 'danger' : 'primary'}`} onClick={toggle} disabled={busy}>
              <Power size={15} />
              {running ? 'Put to sleep' : 'Wake JARVIS'}
            </button>
          </div>
          <p className="core-hint muted">
            {running
              ? core?.mode === 'voice' ? 'Say “Hey Jarvis”, or type below.' : 'Text mode: no microphone, no speech, ~1 GB less VRAM.'
              : mode === 'voice' ? 'Voice loads Whisper on the GPU (~15–25 s) and opens the microphone.' : 'Text only starts in seconds and never touches the microphone.'}
          </p>
          {core?.last_error && !running && <p className="core-error mono">{core.last_error}</p>}
          <Latency timings={core?.timings ?? {}} />
        </section>

        <Conversation running={running} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ boot steps */
function BootSteps({ step, mode }: { step: string | null; mode: string }) {
  const idx = BOOT_STEPS.findIndex((s) => s.id === step)
  return (
    <div className="boot-steps">
      {BOOT_STEPS.map((s, i) => {
        const skipped = mode === 'text' && i < 3
        const st = i < idx ? 'done' : i === idx ? 'now' : 'todo'
        return (
          <div key={s.id} className={`boot-step ${st} ${skipped ? 'skip' : ''}`}>
            <i />
            <span>{s.label}</span>
            <em className="mono">{skipped ? 'skipped' : s.detail}</em>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ latency */
function Latency({ timings }: { timings: Record<string, number> }) {
  const items = [
    { k: 'stt', label: 'Hearing', hint: 'speech → text' },
    { k: 'first_token', label: 'First word', hint: 'question → first token' },
    { k: 'reply', label: 'Full reply', hint: 'question → last token' },
  ]
  if (!Object.keys(timings).length) return null
  return (
    <div className="latency">
      {items.map((it) => (
        <div key={it.k} title={it.hint}>
          <span className="eyebrow">{it.label}</span>
          <span className="dot">{timings[it.k] !== undefined ? `${fmt(timings[it.k], 1)}s` : '—'}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ conversation */
function Conversation({ running }: { running: boolean }) {
  const turns = useStore((s) => s.turns)
  const toast = useStore((s) => s.toast)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  const send = async () => {
    const t = text.trim()
    if (!t || !running) return
    setSending(true)
    try {
      await post('/api/core/say', { text: t })
      setText('')
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="card convo">
      <div className="card-head">
        <span className="card-title"><span className="track">A1</span>Conversation</span>
        <span className="pill">{turns.length ? `${turns.length} turns` : 'empty'}</span>
      </div>
      <div className="convo-list" ref={list}>
        {turns.length === 0 && (
          <div className="empty convo-empty">
            <AudioLines size={22} />
            <div>{running ? 'Say “Hey Jarvis” or type below.' : 'Wake JARVIS to start talking.'}</div>
          </div>
        )}
        {turns.map((t, i) => <TurnRow key={t.id} turn={t} n={i + 1} />)}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <input className="field" placeholder={running ? 'Type to JARVIS…' : 'Wake JARVIS first'} value={text}
          disabled={!running} onChange={(e) => setText(e.target.value)} />
        <button className="btn live icon" disabled={!running || sending || !text.trim()} aria-label="Send">
          <Send size={15} />
        </button>
      </form>
    </section>
  )
}

function TurnRow({ turn, n }: { turn: Turn; n: number }) {
  return (
    <div className={`turn ${turn.role} ${turn.done ? '' : 'streaming'}`}>
      <span className="turn-n mono">{pad2(n)}</span>
      <div>
        <div className="turn-who eyebrow">{turn.role === 'you' ? 'You' : 'Jarvis'}
          {turn.seconds !== undefined && <span className="mono turn-time">{fmt(turn.seconds, 1)}s</span>}
        </div>
        <div className="turn-text">{turn.text || '…'}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ systems */
interface MemStats { memories: number | null; archive_messages: number | null; people: number | null; beliefs: Record<string, number> | null }
interface Snapshot { source: string | null; presence: { state: string; count: number | null; p: number } | null; people?: { id: string; zone: string | null }[] }

function SystemsCard({ core }: { core: CoreInfo | null }) {
  const vitals = useStore((s) => s.vitals)
  const [mem] = usePoll(() => api<MemStats>('/api/memory/stats'), 60000)
  const [snap] = usePoll(() => api<Snapshot>('/api/aankhen/snapshot'), 2000)
  const setTab = useStore((s) => s.setTab)
  const voice = core?.running && core.mode === 'voice'
  const llm = vitals?.ollama?.find((m) => m.name.startsWith('qwen3'))
  const pres = snap?.presence
  const eyesSim = snap?.source && snap.source !== 'hardware'
  const room = core?.room ?? {}

  const rows = [
    { icon: BrainCircuit, name: 'Brain', tone: llm ? 'live' : core?.running ? 'idle' : 'off', tab: 'system' as const,
      value: llm ? `Qwen3-4B · ${fmtGb(llm.vram_mb)} GB` : vitals?.ollama ? 'loads on first question' : 'Ollama not reachable' },
    { icon: Mic, name: 'Ears', tone: voice ? 'live' : 'off', tab: 'core' as const,
      value: voice ? 'Whisper turbo · CUDA' : core?.running ? 'off in text mode' : 'asleep' },
    { icon: Speaker, name: 'Voice', tone: voice ? 'live' : 'off', tab: 'core' as const,
      value: voice ? 'Edge TTS · Prabhat' : '—' },
    { icon: BrainCircuit, name: 'Memory', tone: mem?.memories ? 'idle' : 'off', tab: 'yaadash' as const,
      value: mem ? `${fmtInt(mem.memories)} facts · ${fmtInt(mem.archive_messages)} msgs` : 'loading…' },
    { icon: ScanEye, name: 'Eyes', tone: pres ? (eyesSim ? 'sim' : 'live') : 'off', tab: 'aankhen' as const,
      value: pres ? `${pres.state}${pres.count != null ? ` · ${pres.count} seen` : ''}${eyesSim ? ' · sim' : ''}` : 'no source' },
    { icon: Hand, name: 'Limbs', tone: Object.keys(room).length ? 'idle' : 'off', tab: 'limbs' as const,
      value: Object.keys(room).length
        ? Object.entries(room).map(([d, s]) => `${d} ${s.on ? `${s.level}%` : 'off'}`).join(' · ')
        : 'virtual · JARVIS asleep' },
  ]
  return (
    <section className="card systems">
      <div className="card-head">
        <span className="card-title"><span className="track">B1</span>Subsystems</span>
      </div>
      {rows.map((r) => (
        <button key={r.name} className={`sys-row ${r.tone}`} onClick={() => setTab(r.tab)}>
          <r.icon size={15} strokeWidth={1.8} />
          <span className="sys-name">{r.name}</span>
          <span className="sys-val">{r.value}</span>
          <i className="led" />
        </button>
      ))}
    </section>
  )
}

/* ------------------------------------------------------------------ mission */
interface Mission {
  week: string; days_left: number; targets: Record<string, number>; labels: Record<string, string>
  current: Record<string, number>; history: Record<string, number | string>[]
}

function MissionCard() {
  const [m, , reload] = usePoll(() => api<Mission>('/api/mission'), 60000)
  const [local, setLocal] = useState<Mission | null>(null)
  const data = local ?? m
  const add = async (kind: string, delta: number) => {
    setLocal(await post<Mission>('/api/mission', { kind, delta }))
    reload()
  }
  const items = useMemo(() => data ? [
    { k: 'numericals', label: 'VLSI numericals', unit: '', steps: [1, 5] },
    { k: 'german_min', label: 'German', unit: 'min', steps: [15, 30] },
  ] : [], [data])
  if (!data) return <section className="card mission"><div className="empty">…</div></section>
  return (
    <section className="card mission">
      <div className="card-head">
        <span className="card-title"><span className="track">B2</span>Mission · Germany 2028</span>
        <span className="mono muted">{data.week} · {data.days_left}d left</span>
      </div>
      {items.map((it) => {
        const cur = data.current[it.k] ?? 0
        const tgt = data.targets[it.k]
        const pct = Math.min(1, cur / tgt)
        return (
          <div key={it.k} className="mission-row">
            <Ring pct={pct} done={pct >= 1} />
            <div className="mission-body">
              <div className="mission-label">{it.label}</div>
              <div className="mission-num">
                <span className="dot">{it.k === 'german_min' ? fmt(cur / 60, 1) : cur}</span>
                <span className="muted mono"> / {it.k === 'german_min' ? `${tgt / 60} h` : tgt}</span>
              </div>
              <Spark values={data.history.map((h) => Number(h[it.k]) / tgt)} />
            </div>
            <div className="mission-btns">
              {it.steps.map((s) => (
                <button key={s} className="btn sm" onClick={() => void add(it.k, s)}>+{s}{it.unit && ` ${it.unit}`}</button>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 22, c = 2 * Math.PI * r
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="ring">
      <circle cx="28" cy="28" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="5" fill="none" />
      <circle cx="28" cy="28" r={r} stroke={done ? 'var(--live)' : 'var(--ink)'} strokeWidth="5" fill="none"
        strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round" transform="rotate(-90 28 28)"
        style={{ transition: 'stroke-dasharray 520ms var(--ease)' }} />
      <text x="28" y="32" textAnchor="middle" className="ring-txt">{Math.round(pct * 100)}</text>
    </svg>
  )
}

/** Eight weeks of history as bars: the trend matters more than one week. */
function Spark({ values }: { values: number[] }) {
  return (
    <div className="spark" title="last 8 weeks vs target">
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(6, Math.min(1, v) * 100)}%` }} className={v >= 1 ? 'hit' : i === values.length - 1 ? 'now' : ''} />
      ))}
    </div>
  )
}
