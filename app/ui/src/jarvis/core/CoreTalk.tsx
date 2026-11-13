// Core, the Talk view of shell v2 (spec 20.9.1, 20.9.7, A.J01). One canvas, no document scroll at 1366 x 768: the
// JARVIS content box J is 1286 x 652 and every part below has a fixed share of it (core.css names the numbers).
//
//   left 720                                         right 550
//   controls 56   Wake (the one accent key), mode    header 44   [JRV] conversation, turns, Earlier
//   stage 360     VoiceHill + SigilRing + the art    strata      the last four turns as terminal rows
//   strip 64      voice state, level, Pause          composer 56 you> ... Send
//   ribbon 44     HEAR WRITE THINK SAY
//   organs 44     BRAIN VOICE ROOM SENSE MEM
//
// Tab order follows the spec: Wake, mode, Anatomy, Pause, ribbon, organs, turns, composer. Keys: Ctrl+Shift+Space
// wakes or puts to sleep from anywhere in the view; I (focus in the view, not in a field) or Alt+I opens Anatomy;
// J, K and F work inside the transcript. Below 900 px the view is the phone Talk tab: one column that scrolls inside
// itself, the ribbon as four rows, the organs as five lamps, the last three turns.
//
// Honesty: every number on this view is drawn only for LIVE or SIMULATED (shared/lamp showsNumber); the centrepiece art
// is aria-hidden, fills only the empty stage and steps aside the moment a real frame arrives (core.css, :has()).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { CoreInfo, Turn } from '../../lib/api'
import { ArtSlot } from '../../art/ArtSlot'
import { Lamp, showsNumber, type LampReading, type LampState } from '../../shared/lamp'
import { getPort, subscribePorts } from '../../shell/ports'
import { useShell } from '../../shell/store'
import { VoiceHill, type CoreView, type VoiceSignal } from '../voice'
import { Anatomy } from './Anatomy'
import { CoreDrawer } from './CoreDrawer'
import { LiveSigil } from './LiveSigil'
import { OrganStrip } from './OrganStrip'
import { PipelineRibbon } from './PipelineRibbon'
import { Transcript, TurnRow } from './Transcript'
import { FIT_TURNS, FIT_TURNS_PHONE, fitTurns, type Organ, type OrganId, type RibbonStage, type StageId, type StageMedian } from './model'
import { useCoreLive, type CoreActions } from './useCoreLive'
import './core.css'

/** The phone layout begins below this width (the shell's own one-column break, D6). */
export const PHONE_MAX = 899
export const CORE_ART_ID = 'art.core.hill-ring'

export interface CoreTalkViewProps {
  core: CoreInfo | null
  coreView: CoreView
  turns: Turn[]
  organs: Organ[]
  stages: RibbonStage[]
  last: Record<StageId, number | null>
  medians: Record<StageId, StageMedian>
  signal: VoiceSignal
  now: number
  actions: CoreActions
  /** A fixture (gallery, jury bench): every LIVE is drawn SIMULATED and the stage is stamped. */
  simulated?: boolean
  /** The `notify` port: Well Wisher is in this build, so a hand-off chip may link. */
  notifyPresent?: boolean
  onHandoff?: (place: { product: 'ww'; section: string; view: string }) => void
  /** `none` forces the static voice picture (the gallery); default `auto`. */
  motion?: 'auto' | 'none'
}

/** LIVE becomes SIMULATED for a fixture; nothing else changes. */
const simState = (s: LampState, sim: boolean): LampState => (sim && s === 'live' ? 'simulated' : s)

function useNarrow(): boolean {
  const q = `(max-width: ${PHONE_MAX}px)`
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q)?.matches)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [q])
  return narrow
}

/** The notify port's presence, re-read when the composition root installs a port. */
function useNotifyPresent(): boolean {
  const [present, setPresent] = useState(() => getPort('notify').present)
  useEffect(() => subscribePorts(() => setPresent(getPort('notify').present)), [])
  return present
}

const uptimeText = (s: number | null | undefined): string | null => {
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return null
  if (s < 90) return `${Math.round(s)} s`
  const m = Math.round(s / 60)
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/* ------------------------------------------------------------------ controls */
function Controls({ core, busy, onWake, onSleep, mode, setMode, onAnatomy, simulated }: {
  core: CoreInfo | null
  busy: boolean
  onWake: () => void
  onSleep: () => void
  mode: 'voice' | 'text'
  setMode: (m: 'voice' | 'text') => void
  onAnatomy: () => void
  simulated: boolean
}) {
  const running = !!core?.running
  const booting = core?.state === 'booting'
  const reading: LampReading = core?.last_error && !running
    ? { state: 'fault', since: null, reason: core.last_error }
    : running
      ? { state: simState(booting ? 'waiting' : 'live', simulated), since: core?.started_at ? core.started_at * 1000 : null, reason: booting ? `waking: ${core?.boot_step ?? 'starting'}` : `${core?.mode ?? 'voice'} mode` }
      : { state: 'waiting', since: null, reason: 'asleep' }
  const up = running && !booting && showsNumber(reading.state) ? uptimeText(core?.uptime_s) : null
  const hint = running
    ? core?.status_line || (core?.mode === 'voice' ? 'Say "Hey Jarvis", or type.' : 'Text only: no microphone, no speech.')
    : mode === 'voice' ? 'Voice loads Whisper on the GPU and opens the microphone.' : 'Text only starts in seconds and never opens the microphone.'
  const onRadioKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const next = mode === 'voice' ? 'text' : 'voice'
    setMode(next)
    requestAnimationFrame(() => (e.currentTarget.querySelector<HTMLElement>(`[data-mode='${next}']`))?.focus())
  }
  return (
    <div className="jc-controls">
      {running ? (
        <button type="button" className="jc-key jc-sleep" onClick={onSleep} aria-disabled={busy || undefined} aria-keyshortcuts="Control+Shift+Space">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2v6M4.6 4.2a5 5 0 1 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          {booting ? 'Waking' : 'Put to sleep'}
        </button>
      ) : (
        <button type="button" className="jc-wake" onClick={onWake} aria-disabled={busy || undefined} aria-keyshortcuts="Control+Shift+Space">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2v6M4.6 4.2a5 5 0 1 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <span>Wake JARVIS</span>
          <kbd aria-hidden="true">Ctrl Shift Space</kbd>
        </button>
      )}
      {!running && (
        <div className="jc-mode" role="radiogroup" aria-label="How to wake him" onKeyDown={onRadioKey}>
          {(['voice', 'text'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} data-mode={m} onClick={() => setMode(m)}>
              {m === 'voice' ? 'Voice' : 'Text only'}
            </button>
          ))}
        </div>
      )}
      <div className="jc-status">
        <Lamp reading={reading} subject="JARVIS" />
        <span className="jc-status-line">
          {up && <span className="jc-up">up {up} · </span>}
          {hint}
        </span>
      </div>
      <button type="button" className="jc-key jc-anat-key" onClick={onAnatomy} aria-keyshortcuts="Alt+I">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        Anatomy
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ the stage */
function Stage({ signal, coreView, running, simulated, motion }: { signal: VoiceSignal; coreView: CoreView; running: boolean; simulated: boolean; motion: 'auto' | 'none' }) {
  return (
    <div className="jc-stage" data-running={running ? 'true' : 'false'}>
      <VoiceHill signal={signal} core={coreView} motion={motion} className="jc-vh" />
      {/* over the stage only (the top 720 x 360 of the hill): the art, the sigil ring, the HUD and the asleep scene */}
      <div className="jc-over" data-scene="immersive">
        <div className="jc-art" aria-hidden="true"><ArtSlot id={CORE_ART_ID} fit="cover" ratio={2} /></div>
        <div className="jc-sigil-at"><LiveSigil signal={signal} core={coreView} simulated={simulated} /></div>
        <span className="jc-hud" data-c="tl" aria-hidden="true">VOICE STAGE</span>
        <span className="jc-hud" data-c="tr">{simulated ? 'FIXTURE · SIMULATED' : <span aria-hidden="true">MIC · SPEAKER</span>}</span>
        {!running && (
          <div className="jc-asleep">
            <span className="jc-asleep-word">ASLEEP</span>
            <span className="jc-asleep-line">Wake JARVIS, or type</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the composer */
function Composer({ running, onSay }: { running: boolean; onSay: (t: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || !running || sending) return
    setSending(true)
    try {
      await onSay(t)
      setText('')
    } catch {
      /* the toast says why; the text stays so nothing typed is lost */
    } finally {
      setSending(false)
    }
  }
  return (
    <form className="jc-composer" onSubmit={submit} aria-label="Type to JARVIS">
      <label className="jc-composer-ps" htmlFor="jc-say">you&gt;</label>
      <input
        id="jc-say" className="jc-composer-field" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
        placeholder={running ? 'Type to JARVIS' : 'Wake JARVIS first, then type'} aria-disabled={!running || undefined} readOnly={!running}
      />
      <button type="submit" className="jc-key jc-send" aria-disabled={!running || sending || !text.trim() || undefined}>Send</button>
    </form>
  )
}

/* ------------------------------------------------------------------ the view */
export function CoreTalkView(p: CoreTalkViewProps) {
  const { core, coreView, turns, organs, stages, last, medians, signal, now, actions, simulated = false, notifyPresent = true, onHandoff, motion = 'auto' } = p
  const running = !!core?.running
  const narrow = useNarrow()
  const [mode, setMode] = useState<'voice' | 'text'>('voice')
  const [busy, setBusy] = useState(false)
  const [anat, setAnat] = useState<{ open: boolean; focus: OrganId | null }>({ open: false, focus: null })
  const [earlier, setEarlier] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await fn() } catch { /* toasted by the action */ } finally { setBusy(false) }
  }, [busy])
  const wake = useCallback(() => void run(() => actions.wake(mode)), [run, actions, mode])
  const sleep = useCallback(() => void run(() => actions.sleep()), [run, actions])
  const openAnat = useCallback((focus: OrganId | null = null) => setAnat({ open: true, focus }), [])

  // Ctrl+Shift+Space anywhere while the view is mounted; Alt+I anywhere; I only with focus inside the view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault()
        if (running) sleep()
        else wake()
        return
      }
      if (e.altKey && !e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        openAnat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, sleep, wake, openAnat])
  const onRootKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    const t = e.target as HTMLElement
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      openAnat()
    }
  }

  const ribbon = useMemo(() => stages.map((s) => ({ ...s, state: simState(s.state, simulated) })), [stages, simulated])
  const organsShown = useMemo(() => organs.map((o) => ({ ...o, reading: { ...o.reading, state: simState(o.reading.state, simulated) } })), [organs, simulated])
  const fit = fitTurns(turns, narrow ? FIT_TURNS_PHONE : FIT_TURNS)
  const count: LampReading = turns.length
    ? { state: simState('live', simulated), since: null, reason: 'turns of this run, from the core' }
    : { state: 'waiting', since: null, reason: running ? 'no turn yet' : 'asleep' }

  return (
    <div className="jc" ref={root} data-core={running ? 'awake' : 'asleep'} data-narrow={narrow ? 'true' : undefined} data-simulated={simulated ? 'true' : undefined} onKeyDown={onRootKey}>
      <section className="jc-left" aria-label="Voice">
        <Controls core={core} busy={busy} onWake={wake} onSleep={sleep} mode={mode} setMode={setMode} onAnatomy={() => openAnat()} simulated={simulated} />
        <Stage signal={signal} coreView={coreView} running={running} simulated={simulated} motion={motion} />
        <PipelineRibbon stages={ribbon} orientation={narrow ? 'column' : 'row'} />
        <OrganStrip organs={organsShown} onOpen={(id) => openAnat(id)} compact={narrow} />
      </section>

      <section className="jc-right" aria-label="Conversation">
        <header className="jc-convo-head">
          <h2><span className="jc-tag">[JRV]</span> Conversation</h2>
          <span className="jc-count">
            <Lamp reading={count} showLabel={false} subject="Turns" />
            {showsNumber(count.state) ? <span>{fit.shown.length} of {turns.length} turns</span> : <span className="jc-dim">{count.reason}</span>}
          </span>
          <button type="button" className="jc-key jc-key-sm" onClick={() => { if (fit.earlier.length) setEarlier(true) }} aria-disabled={!fit.earlier.length || undefined}>
            Earlier{fit.earlier.length > 0 && showsNumber(count.state) ? ` ${fit.earlier.length}` : ''}
          </button>
        </header>
        <Transcript turns={fit.shown} all={turns} running={running} simulated={simulated} notifyPresent={notifyPresent} onFlag={actions.flag} onHandoff={onHandoff} />
        <Composer running={running} onSay={actions.say} />
      </section>

      <CoreDrawer open={anat.open} onClose={() => setAnat({ open: false, focus: null })} title="Anatomy" tag="SYS">
        <Anatomy organs={organsShown} last={last} medians={medians} focus={anat.focus} now={now} simulated={simulated} />
      </CoreDrawer>
      <CoreDrawer open={earlier} onClose={() => setEarlier(false)} title="Earlier turns" tag="JRV">
        <ol className="jc-turns jc-earlier">
          {fit.earlier.map((t) => <TurnRow key={t.id} turn={t} simulated={simulated} notifyPresent={notifyPresent} onHandoff={onHandoff} />)}
        </ol>
      </CoreDrawer>
    </div>
  )
}

/** The registered view (shell/views/core.view.ts): the live data, the ports and the shell's navigation. */
export default function CoreTalk() {
  const live = useCoreLive()
  const notifyPresent = useNotifyPresent()
  const onHandoff = useCallback((place: { product: 'ww'; section: string; view: string }) => useShell.getState().go(place), [])
  return <CoreTalkView {...live} notifyPresent={notifyPresent} onHandoff={onHandoff} />
}
