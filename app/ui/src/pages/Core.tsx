/**
 * Core: JARVIS himself. Wake him (voice or text), watch his state, talk to him,
 * see what every subsystem is doing — and the week's mission numbers.
 */
import {
  AudioLines, BrainCircuit, Check, Ear, FileText, Flame, FolderOpen, Hand, Keyboard, Mic, Power, ScanEye, Send,
  Snail, Speaker, ThumbsDown,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, post, type CoreInfo, type Turn } from '../lib/api'
import { fmt, fmtDur, fmtGb, fmtInt, pad2, usePoll } from '../lib/format'
import { DAILY_ITEMS, useChecklistStore } from '../germoney/stores/checklist-store'
import { LEVELS, usePlayerStore } from '../germoney/stores/player-store'
import { useStore } from '../lib/store'
import { PageHeader, STATE_LABEL } from '../components/Shell'
import { Reactor } from '../components/Reactor'
import { StaffCard } from '../components/Staff'

const BOOT_STEPS = [
  { id: 'whisper', label: 'Ears', detail: 'Whisper on CUDA' },
  { id: 'audio', label: 'Voice', detail: 'audio + speech' },
  { id: 'wakeword', label: 'Wake word', detail: '“Hey Jarvis”' },
  { id: 'memory', label: 'Memory', detail: 'Yaadash + brain warm-up' },
]

/** Accent tags ([us]…[/us], [hi]…[/hi]) steer JARVIS's voice; they are never shown. */
const VOICE_TAG = /\[\/?(uk|british|gb|us|american|usa|hi|hindi|in|indian)\]/gi
const stripVoiceTags = (t: string) => (t || '').replace(VOICE_TAG, '').replace(/[ \t]{2,}/g, ' ')

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
          <StaffCard />
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
    { k: 'first_audio', label: 'Voice', hint: 'question → JARVIS starts speaking (what you actually wait for)' },
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
        <ReviewButton />
      </div>
      <div className="convo-list" ref={list}>
        {turns.length === 0 && (
          <div className="empty convo-empty">
            <AudioLines size={22} />
            <div>{running ? 'Say “Hey Jarvis” or type below.' : 'Wake JARVIS to start talking.'}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <TurnRow key={t.id} turn={t} n={i + 1}
            question={t.role === 'jarvis' ? turns.slice(0, i).reverse().find((p) => p.role === 'you')?.text : undefined} />
        ))}
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

type Verdict = 'good' | 'wrong' | 'slow' | 'misheard'

/** Every turn can be judged. A verdict is stored with the transcript, and the
 *  review file for Claude lists flagged turns first, with what you expected.
 *  A wrong answer can also be taught back: the right answer becomes a correction
 *  in his memory, which he follows from his next reply on. */
function TurnRow({ turn, n, question }: { turn: Turn & { session?: string }; n: number; question?: string }) {
  const toast = useStore((s) => s.toast)
  const [flag, setFlag] = useState<Verdict | null>(null)
  const [asking, setAsking] = useState(false)
  const [expected, setExpected] = useState('')
  const [teach, setTeach] = useState(true)
  const canFlag = !!turn.session && turn.done
  const send = async (verdict: Verdict, exp = '') => {
    try {
      await post('/api/transcripts/flag', { session: turn.session, id: turn.id, verdict, expected: exp })
      setFlag(verdict)
      setAsking(false)
      if (verdict === 'wrong' && teach && exp.trim()) {
        const r = await post<{ added: boolean }>('/api/memory/teach', { question: question ?? '', answer: exp.trim() })
        toast(r.added ? 'Taught. He will give that answer from now on.' : 'He already had that correction.', 'live')
        return
      }
      toast(verdict === 'good' ? 'Marked as a good answer.' : `Marked as ${verdict} — it'll be in the next review.`, verdict === 'good' ? 'live' : 'info')
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  return (
    <div className={`turn ${turn.role} ${turn.done ? '' : 'streaming'} ${flag ? `flag-${flag}` : ''}`}>
      <span className="turn-n mono">{pad2(n)}</span>
      <div>
        <div className="turn-who eyebrow">{turn.role === 'you' ? 'You' : 'Jarvis'}
          {turn.seconds !== undefined && <span className="mono turn-time">{fmt(turn.seconds, 1)}s</span>}
          {flag && <span className={`pill ${flag === 'good' ? 'live' : 'fault'}`}>{flag}</span>}
        </div>
        <div className="turn-text">{stripVoiceTags(turn.text) || '…'}</div>
        {canFlag && !flag && (
          <div className="turn-actions">
            {turn.role === 'jarvis' ? (
              <>
                <button onClick={() => void send('good')} title="Good answer"><Check size={12} />Good</button>
                <button onClick={() => setAsking(true)} title="Wrong or made-up answer"><ThumbsDown size={12} />Wrong</button>
                <button onClick={() => void send('slow')} title="Took too long"><Snail size={12} />Slow</button>
              </>
            ) : (
              <button onClick={() => setAsking(true)} title="JARVIS heard something else"><Ear size={12} />Misheard</button>
            )}
          </div>
        )}
        {asking && (
          <form className="flag-form fade-in" onSubmit={(e) => { e.preventDefault(); void send(turn.role === 'jarvis' ? 'wrong' : 'misheard', expected) }}>
            <input className="field" autoFocus value={expected} onChange={(e) => setExpected(e.target.value)}
              placeholder={turn.role === 'jarvis' ? 'What should he have said? (optional)' : 'What did you actually say? (optional)'} />
            {turn.role === 'jarvis' && expected.trim() && (
              <label className="teach-toggle" title="Keep the right answer in his memory as a correction">
                <input type="checkbox" checked={teach} onChange={(e) => setTeach(e.target.checked)} />Teach him
              </label>
            )}
            <button className="btn sm primary">Flag</button>
            <button type="button" className="btn sm ghost" onClick={() => setAsking(false)}>Cancel</button>
          </form>
        )}
      </div>
    </div>
  )
}

/** Writes data/app/reviews/review-*.md: flagged turns first, errors, slow replies,
 *  then the full transcript — written for Claude to diagnose where JARVIS fails. */
function ReviewButton() {
  const toast = useStore((s) => s.toast)
  const [sum] = usePoll(() => api<{ turns: number; flags: Record<string, number> }>('/api/transcripts/summary?days=7'), 30000)
  const [busy, setBusy] = useState(false)
  const flagged = Object.entries(sum?.flags ?? {}).filter(([k]) => k !== 'good').reduce((a, [, v]) => a + v, 0)
  const run = async () => {
    setBusy(true)
    try {
      const r = await post<{ name: string }>('/api/transcripts/export', { days: 7 })
      toast(`Review written: ${r.name}. Tell Claude: "read data/app/reviews/${r.name}".`, 'live')
      await post('/api/open', { which: 'reviews' })
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="review-btn">
      <span className="mono muted">{sum ? `${sum.turns} turns · ${flagged} flagged · 7 d` : ''}</span>
      <button className="btn sm" disabled={busy || !sum?.turns} onClick={() => void run()} title="Write a review file for Claude">
        <FileText size={13} />Review for Claude
      </button>
      <button className="btn sm ghost icon" aria-label="Open the reviews folder" onClick={() => void post('/api/open', { which: 'reviews' })}><FolderOpen size={13} /></button>
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
      value: llm ? `Qwen3-4B · ${fmtGb(llm.vram_mb)} GB` : vitals?.ollama ? 'loads on first question' : core?.running ? 'Ollama not reachable' : 'Ollama off · starts when he wakes' },
    { icon: Mic, name: 'Ears', tone: voice ? 'live' : 'off', tab: 'core' as const,
      value: voice ? 'Whisper turbo · CUDA' : core?.running ? 'off in text mode' : 'asleep' },
    { icon: Speaker, name: 'Voice', tone: voice ? 'live' : 'off', tab: 'core' as const,
      value: voice ? 'Ryan, British · Edge TTS (Kokoro offline)' : '—' },
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
/** The Mission Germoney summary: rank, XP, today's directives, Rule 1 — one click
 *  from the Crucible. (Reads the same stores as the Mission tabs.) */
function MissionCard() {
  const player = usePlayerStore((s) => s.player)
  const loaded = usePlayerStore((s) => s.isLoaded)
  const daily = useChecklistStore((s) => s.daily)
  const setTab = useStore((s) => s.setTab)
  useEffect(() => {
    void usePlayerStore.getState().hydrate()
    void useChecklistStore.getState().hydrate()
  }, [])
  if (!loaded) return <section className="card mission"><div className="empty">…</div></section>
  const info = LEVELS.find((l) => l.level === player.level) ?? LEVELS[0]
  const done = DAILY_ITEMS.filter((i) => daily[i.id]).length
  const since = player.lastCommitDate ? Math.floor((Date.now() - new Date(player.lastCommitDate).getTime()) / 86_400_000) : null
  return (
    <section className={`card mission ${player.isPurgatoryActive ? 'warn' : ''}`}>
      <div className="card-head">
        <span className="card-title"><span className="track">B2</span>Mission · Germoney</span>
        <button className="btn sm ghost" onClick={() => setTab('mission')}>Open</button>
      </div>
      <div className="mission-sum">
        <div><span className="eyebrow">Rank {player.level}/10</span><b>{info.rank}</b></div>
        <div className="xp-mini"><span className="dot">{player.xp}</span><span className="mono muted">XP</span></div>
      </div>
      <div className="mission-stats">
        <div><span className="dot">{done}/{DAILY_ITEMS.length}</span><span className="eyebrow">Directives</span></div>
        <div><span className={`dot ${since !== null && since >= 11 ? 'fault' : ''}`}>{since === null ? '—' : `${since}d`}</span><span className="eyebrow">Since commit</span></div>
        <div><span className="dot">{player.germanHours}h</span><span className="eyebrow">German</span></div>
      </div>
      <button className={`btn power ${player.isPurgatoryActive ? 'danger' : 'primary'}`} style={{ width: '100%', marginTop: 12 }} onClick={() => setTab('crucible')}>
        <Flame size={15} />{player.isPurgatoryActive ? 'Purgatory: enter the Crucible' : 'Enter the Crucible'}
      </button>
    </section>
  )
}
