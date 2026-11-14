// The voice visualiser (spec 9): a hill of point-cloud and a ring of bars, one canvas, drawn only from real frames.
// Standalone: it takes a VoiceSignal and the core's words as props and mounts nowhere by itself (B06 mounts it on Core).
//
// What it promises, and where each promise is enforced:
//  - no data, no reading: planScene grants solid points only while a frame under 400 ms old exists (scene.ts, voiceState.ts);
//  - idle is zero: the loop (loop.ts) is requested only by a frame, a state change or a bounded animation, and one
//    setTimeout is armed only for the next moment the state can change by time alone (voiceState.nextChangeAt);
//  - hidden, paused and reduced motion draw nothing; the level bar and the text twin go on at 4 Hz;
//  - no number without a lamp: the dB text exists only when the lamp state is LIVE or SIMULATED (shared/lamp showsNumber).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Lamp, showsNumber } from '../../shared/lamp'
import { levelFill } from './bands'
import {
  METER_MAX_DB, METER_MIN_DB, METER_TEXT_MS, PH_BREATH_MS, QUALITY, READOUT_MS, RING_BARS, SETTLE_MS,
  STAGE_H, STAGE_W, TEST_PATTERN_MS, THINK_MARK_MS, SENSITIVITY_HIGH_DB, type Quality,
} from './constants'
import { peakShown, peakUpdate, ringBars, ringLengthsPlaceholder, type PeakHold } from './geometry'
import { VoiceLoop, browserLoopDeps, type LoopDeps } from './loop'
import { FALLBACK_PALETTE, drawScene, levelReading, planScene, testPatternView, type Ctx2D, type Palette } from './scene'
import type { VoiceSignal } from './signal'
import { liveLegend, nextChangeAt, voiceState, type CoreView, type Tier, type VoiceStateResult } from './voiceState'
import './voice.css'

export interface VoiceHillProps {
  signal: VoiceSignal
  core: CoreView
  /** 1: the output level exists in this build (the spectrum hill for the speaker). 0: it does not, and speaking says so (9.9). Default 1. */
  tier?: Tier
  /** `high` 3,072 points, `low` 1,280. The motion governor can force `low`. */
  quality?: Quality
  /** `auto` reads prefers-reduced-motion and html[data-motion]; `none` forces the static form (9.10). */
  motion?: 'auto' | 'full' | 'none'
  /** The Settings switch "Placeholder breath": off by default. */
  breath?: boolean
  /** "Hill sensitivity: High" shifts the dB window by +12 and the legend says so. Off by default. */
  sensitivity?: 'normal' | 'high'
  /**
   * `full` (default): the strip prints the thinking seconds itself and a dash when the level has no reading. `core`:
   * the Core view's strip, where the pipeline's THINK step owns the thinking clock (one clock per screen, with its
   * own LIVE or SIMULATED lamp), so the strip says THINKING with no number, and a level with no reading is a hollow
   * well plus the reason word instead of a bare dash (the jury of 14 Nov read "THINKING 2.4 S" beside a WAITING lamp
   * as a contradiction).
   */
  strip?: 'full' | 'core'
  /**
   * A fixture is feeding the signal (the gallery, the jury page): every LIVE lamp and word on the strip is drawn
   * SIMULATED, as the rest of the Core view already does, so generated frames are never labelled as measured.
   */
  simulated?: boolean
  /** True while the owner's "Show a 5 s test pattern" button runs it. The component never starts it by itself. */
  testPattern?: boolean
  onTestPatternEnd?: () => void
  className?: string
  /** Test seams: the clock, the rAF functions, and a context factory (happy-dom has no 2D context). */
  clock?: () => number
  loopDeps?: LoopDeps
  contextFactory?: (canvas: HTMLCanvasElement) => Ctx2D | null
}

/** The Core strip's words for a level with no reading, by voice state: a reason, never a bare dash. */
const NO_LEVEL_WORD: Partial<Record<VoiceStateResult['state'], string>> = { thinking: 'no level: thinking', idle: 'no level', 'no-signal': 'no level yet', between: 'no level: between sentences', muted: 'no level: mic off', error: 'no level: fault' }
const CORE_THINKING_LEGEND = 'thinking: no sound level while he thinks; the THINK step below keeps the time'

/** The Core strip (prop `strip="core"`): THINKING carries no number, and its lamp says why the level waits. */
function coreStripView(vs: VoiceStateResult): VoiceStateResult {
  if (vs.state !== 'thinking') return vs
  return { ...vs, label: 'THINKING', legend: CORE_THINKING_LEGEND, lamp: { ...vs.lamp, reason: 'no sound level while thinking' } }
}

/** LIVE becomes SIMULATED, in the lamp and in the legend's words; nothing else changes. */
function simulatedView(vs: VoiceStateResult): VoiceStateResult {
  if (vs.lamp.state !== 'live') return vs
  return { ...vs, lamp: { ...vs.lamp, state: 'simulated', reason: `${vs.lamp.reason}, from a fixture` }, legend: vs.legend?.replace(/\bLIVE\b/g, 'SIMULATED') ?? null }
}

const CANVAS_LABEL = 'Voice picture: spectrum of the microphone or the speaker, drawn only from measured levels'
const VH_PROBES = ['ink', 'measured', 'quiet', 'simulated', 'fault'] as const

interface MotionFlags {
  none: boolean
  lowLoad: boolean
}

/** Calm and the OS flag win; the review-only data-motion="full" overrides the OS flag (plan 5.7.8). */
function readMotion(prop: 'auto' | 'full' | 'none'): MotionFlags {
  const html = typeof document !== 'undefined' ? document.documentElement : null
  const attr = html?.getAttribute('data-motion') ?? ''
  const lowLoad = html?.getAttribute('data-motion-load') === 'low'
  if (prop === 'none') return { none: true, lowLoad }
  if (prop === 'full') return { none: false, lowLoad }
  if (attr === 'calm') return { none: true, lowLoad }
  if (attr === 'full') return { none: false, lowLoad }
  let reduce = false
  try {
    reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    reduce = false
  }
  return { none: reduce, lowLoad }
}

function useMotion(prop: 'auto' | 'full' | 'none'): MotionFlags {
  const [m, setM] = useState<MotionFlags>(() => readMotion(prop))
  useEffect(() => {
    const update = () => setM((prev) => {
      const n = readMotion(prop)
      return prev.none === n.none && prev.lowLoad === n.lowLoad ? prev : n
    })
    update()
    let mq: MediaQueryList | null = null
    try {
      mq = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    } catch {
      mq = null
    }
    mq?.addEventListener?.('change', update)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-motion-load'] })
    return () => {
      mq?.removeEventListener?.('change', update)
      mo?.disconnect()
    }
  }, [prop])
  return m
}

const sameView = (a: VoiceStateResult, b: VoiceStateResult): boolean =>
  a.state === b.state && a.detail === b.detail && a.label === b.label && a.announce === b.announce && a.measured === b.measured && a.source === b.source && a.legend === b.legend && a.lamp.state === b.lamp.state && a.lamp.reason === b.lamp.reason

/** The reduced-motion picture (9.10): 96 bars at the minimum length, in the quiet ink, nothing moving. */
function StaticRing() {
  const bars = useMemo(() => ringBars(ringLengthsPlaceholder(0)), [])
  const d: string[] = []
  for (let k = 0; k < RING_BARS; k++) d.push(`M${bars.x0[k].toFixed(1)} ${bars.y0[k].toFixed(1)}L${bars.x1[k].toFixed(1)} ${bars.y1[k].toFixed(1)}`)
  return (
    <svg className="vh-static" viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} role="img" aria-label={`${CANVAS_LABEL} (static form: reduced motion)`} data-testid="vh-static">
      <path d={d.join('')} fill="none" stroke="var(--vh-quiet, currentColor)" strokeWidth="2" />
    </svg>
  )
}

export function VoiceHill(props: VoiceHillProps) {
  const { signal, core, tier = 1, quality: qProp = 'high', breath = false, sensitivity = 'normal', testPattern = false, strip = 'full' } = props
  const clock = props.clock ?? Date.now
  const coreStrip = strip === 'core'
  const sim = props.simulated === true
  const shape = useCallback((vs: VoiceStateResult): VoiceStateResult => {
    const a = coreStrip ? coreStripView(vs) : vs
    return sim ? simulatedView(a) : a
  }, [coreStrip, sim])
  const motion = useMotion(props.motion ?? 'auto')
  const quality: Quality = motion.lowLoad ? 'low' : qProp
  const shiftDb = sensitivity === 'high' ? SENSITIVITY_HIGH_DB : 0

  const [paused, setPaused] = useState(false)
  const [testSince, setTestSince] = useState<number | null>(null)
  const staticForm = motion.none || paused

  const shapeRef = useRef(shape)
  shapeRef.current = shape
  const computeView = useCallback((now: number): VoiceStateResult => shape(voiceState(core, { input: signal.view('in', now), output: signal.view('out', now) }, now, tier)), [core, signal, tier, shape])
  const [view, setView] = useState<VoiceStateResult>(() => computeView(clock()))
  const [dbScale, setDbScale] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const thrRef = useRef<HTMLSpanElement>(null)
  const peakRef = useRef<HTMLSpanElement>(null)
  const numRef = useRef<HTMLSpanElement>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const probeRefs = useRef<Record<string, HTMLSpanElement | null>>({})

  // Everything a callback outside React needs, read through one ref so the loop never closes over stale props.
  const live = useRef({ core, tier, quality, breath, shiftDb, testSince, staticForm, onTestPatternEnd: props.onTestPatternEnd, contextFactory: props.contextFactory })
  useLayoutEffect(() => {
    live.current = { core, tier, quality, breath, shiftDb, testSince, staticForm, onTestPatternEnd: props.onTestPatternEnd, contextFactory: props.contextFactory }
  })

  const loopRef = useRef<VoiceLoop | null>(null)
  const ctxRef = useRef<Ctx2D | null>(null)
  const paletteRef = useRef<Palette>(FALLBACK_PALETTE)
  const lastNonFloor = useRef(-Infinity)
  const dirty = useRef(true)
  const peak = useRef<PeakHold | null>(null)
  const lastReadout = useRef(-Infinity)
  const lastMeterText = useRef(-Infinity)
  const deadline = useRef<{ id: ReturnType<typeof setTimeout>; at: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // --- the readout (level bar, number, meter text): written straight to the DOM, never through React state ---
  const paintLevel = useCallback((vs: VoiceStateResult, now: number, force: boolean) => {
    const l = live.current
    const r = levelReading(vs, signal, now, l.shiftDb)
    const fillEl = fillRef.current
    if (fillEl) fillEl.style.width = `${Math.round((r.fill ?? 0) * 1000) / 10}%`
    if (thrRef.current) {
      thrRef.current.hidden = r.thrFill === null
      if (r.thrFill !== null) thrRef.current.style.left = `${r.thrFill * 100}%`
    }
    if (r.db !== null && vs.channel) peak.current = peakUpdate(peak.current, r.db, now)
    else if (r.fill === null) peak.current = null
    const pk = peakShown(peak.current, now)
    if (peakRef.current) {
      const show = pk !== null && vs.channel !== null && r.db !== null
      peakRef.current.hidden = !show
      if (show && pk !== null && vs.channel) peakRef.current.style.left = `${levelFill(pk, vs.channel, l.shiftDb) * 100}%`
    }
    if (!force && now - lastReadout.current < READOUT_MS) return
    lastReadout.current = now
    const has = showsNumber(vs.lamp.state) && r.fill !== null
    const none = coreStrip ? NO_LEVEL_WORD[vs.state] ?? 'no level' : '—'
    if (numRef.current) {
      numRef.current.textContent = !has ? none : r.db !== null ? `${Math.round(r.db)} dB` : `relative ${Math.round((r.fill ?? 0) * 100)}`
      numRef.current.dataset.hollow = has ? 'false' : 'true'
    }
    if (barRef.current) barRef.current.dataset.hollow = has ? 'false' : 'true'
    if (meterRef.current && (force || now - lastMeterText.current >= METER_TEXT_MS)) {
      lastMeterText.current = now
      const m = meterRef.current
      const who = vs.channel === 'out' ? 'speaker' : 'microphone'
      if (has && r.db !== null) {
        m.setAttribute('aria-valuemin', String(METER_MIN_DB))
        m.setAttribute('aria-valuemax', String(METER_MAX_DB))
        m.setAttribute('aria-valuenow', String(Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, Math.round(r.db)))))
        m.setAttribute('aria-valuetext', `${who}, ${Math.round(r.db)} dB, ${vs.lamp.state === 'simulated' ? 'simulated' : 'measured'}`)
      } else if (has) {
        m.setAttribute('aria-valuemin', '0')
        m.setAttribute('aria-valuemax', '100')
        m.setAttribute('aria-valuenow', String(Math.round((r.fill ?? 0) * 100)))
        m.setAttribute('aria-valuetext', `${who}, relative level ${Math.round((r.fill ?? 0) * 100)}, uncalibrated, measured`)
      } else {
        m.removeAttribute('aria-valuenow')
        m.setAttribute('aria-valuetext', 'no reading')
      }
    }
  }, [signal, coreStrip])

  // --- the state shown in the DOM (changes a few times per utterance) and the one timeout for the next time-based change ---
  const armDeadline = useCallback((now: number) => {
    const l = live.current
    if (l.testSince !== null) return
    const at = nextChangeAt(l.core, { input: signal.view('in', now), output: signal.view('out', now) }, now, l.tier)
    const cur = deadline.current
    if (at === null) return
    if (cur && cur.at <= at) return // a pending one will fire first and re-arm
    if (cur) clearTimeout(cur.id)
    const id = setTimeout(() => {
      deadline.current = null
      refreshRef.current()
    }, Math.max(0, at - now))
    deadline.current = { id, at }
  }, [signal])

  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => {
    const now = clock()
    const l = live.current
    const vs = l.testSince !== null ? testPatternView(l.testSince) : shape(voiceState(l.core, { input: signal.view('in', now), output: signal.view('out', now) }, now, l.tier))
    const changed = !sameView(viewRef.current, vs)
    if (changed) {
      dirty.current = true
      setView(vs)
    }
    setDbScale((p) => {
      const n = l.tier === 1 && !!(signal.latest('in')?.bands || signal.latest('out')?.bands)
      return p === n ? p : n
    })
    armDeadline(now)
    if (changed || l.staticForm) paintLevel(vs, now, changed)
    if (changed) loopRef.current?.request()
  }, [armDeadline, clock, paintLevel, signal, shape])
  refreshRef.current = refresh

  // Props that change the picture (core, tier, breath, test pattern) are a state change: recompute and redraw once.
  useEffect(() => {
    dirty.current = true
    refresh()
    loopRef.current?.request()
  }, [core, tier, breath, quality, testSince, refresh])

  // --- the test pattern: starts only when the prop says so (the owner's button), ends itself after 5 s ---
  useEffect(() => {
    setTestSince((cur) => (testPattern ? (cur === null ? clock() : cur) : null))
  }, [testPattern, clock])

  // --- the draw loop ---
  const draw = useCallback((now: number): boolean => {
    const l = live.current
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return false
    let since = l.testSince
    if (since !== null && now - since >= TEST_PATTERN_MS) {
      l.onTestPatternEnd?.()
      since = null
    }
    const scene = planScene({ core: l.core, signal, now, tier: l.tier, quality: l.quality, breath: l.breath, sensitivityDb: l.shiftDb, testPatternSince: since })
    drawScene(ctx, scene, paletteRef.current, { contrastMore: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-contrast: more)').matches })
    dirty.current = false
    paintLevel(shapeRef.current(scene.vs), now, false)
    const sinceState = l.core.stateSince === null ? 0 : now - l.core.stateSince
    if (since !== null) return true
    if (scene.vs.measured) return now - lastNonFloor.current <= SETTLE_MS
    if (scene.vs.state === 'thinking') return sinceState < THINK_MARK_MS
    if (scene.vs.state === 'no-signal' && l.breath) return sinceState < PH_BREATH_MS
    return false
  }, [paintLevel, signal])

  const readPalette = useCallback(() => {
    const px = (k: string) => {
      const el = probeRefs.current[k]
      const c = el && typeof getComputedStyle === 'function' ? getComputedStyle(el).color : ''
      return c || FALLBACK_PALETTE[k as keyof Palette]
    }
    // a fixture's points take the SIMULATED ink, never the measured one
    paletteRef.current = { ink: px('ink'), measured: px(sim ? 'simulated' : 'measured'), quiet: px('quiet'), simulated: px('simulated'), fault: px('fault') }
  }, [sim])

  // Mount: the context, the loop, the palette, the visibility listener, the signal subscription. Unmount undoes all of it.
  useEffect(() => {
    const canvas = canvasRef.current
    if (staticForm || !canvas) {
      loopRef.current = null
      return
    }
    let ctx: Ctx2D | null = null
    try {
      ctx = live.current.contextFactory ? live.current.contextFactory(canvas) : (canvas.getContext('2d') as unknown as Ctx2D | null)
    } catch {
      ctx = null
    }
    ctxRef.current = ctx
    if (ctx) {
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, QUALITY[live.current.quality].dpr)
      canvas.width = Math.round(STAGE_W * dpr)
      canvas.height = Math.round(STAGE_H * dpr)
      const c2 = ctx as unknown as CanvasRenderingContext2D
      c2.setTransform?.(dpr, 0, 0, dpr, 0, 0)
    }
    readPalette()
    const deps = props.loopDeps ?? browserLoopDeps()
    const loop = new VoiceLoop(deps, draw, clock, QUALITY[live.current.quality].fpsCap)
    loopRef.current = loop
    const onVis = () => loop.setHidden(deps.hidden())
    document.addEventListener('visibilitychange', onVis)
    let mqForced: MediaQueryList | null = null
    try {
      mqForced = window.matchMedia?.('(forced-colors: active)') ?? null
    } catch {
      mqForced = null
    }
    const onForced = () => {
      readPalette()
      dirty.current = true
      loop.request()
    }
    mqForced?.addEventListener?.('change', onForced)
    const unsub = signal.subscribe(() => {
      const now = clock()
      const f = signal.latest('in')
      const g = signal.latest('out')
      for (const x of [f, g]) {
        if (x && x.arrival >= now - 1 && !x.final && (x.bands ? x.bands.some((b) => b > 0) : (x.level ?? 0) > 0)) lastNonFloor.current = now
      }
      refresh()
      if (dirty.current || now - lastNonFloor.current <= 1) loop.request()
    })
    loop.request()
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVis)
      mqForced?.removeEventListener?.('change', onForced)
      loop.dispose()
      loopRef.current = null
      ctxRef.current = null
    }
    // quality changes re-create the loop and the backing store; clock, deps and factories are test seams fixed at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticForm, quality, signal, draw, readPalette])

  // In the static form (reduced motion or paused) there is no loop: the level bar follows the signal at 4 Hz, by subscription.
  useEffect(() => {
    if (!staticForm) return
    const unsub = signal.subscribe(() => refresh())
    refresh()
    return unsub
  }, [staticForm, signal, refresh])

  useEffect(() => {
    loopRef.current?.setPaused(paused)
  }, [paused])

  // Thinking shows elapsed seconds: one 1 s tick, only while the state is thinking (none on the Core strip, where
  // the label carries no number and the pipeline's THINK step owns the clock).
  useEffect(() => {
    if (view.state !== 'thinking' || coreStrip) return
    const id = setInterval(() => refreshRef.current(), 1000)
    return () => clearInterval(id)
  }, [view.state, coreStrip])

  // Nothing may outlive the component: the one deadline timeout is cleared with it.
  useEffect(
    () => () => {
      if (deadline.current) clearTimeout(deadline.current.id)
      deadline.current = null
    },
    [],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // WCAG 2.1.4: a single-key shortcut works only while focus is inside the stage.
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      setPaused((p) => !p)
    }
  }

  const legendLive = useMemo(() => {
    if (!view.measured || !view.channel) return null
    const f = signal.latest(view.channel)
    const hasBands = !!f?.bands
    const line = liveLegend(view.channel, hasBands ? 1 : 0, f?.rmsDb ?? null, signal.rateHz(view.channel), shiftDb)
    return sim ? line.replace(/\bLIVE\b/g, 'SIMULATED') : line
    // The legend is rebuilt when the state changes, not per frame: the number itself is the live readout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shiftDb, signal, sim])
  const legend = paused ? 'Paused' : (view.legend ?? legendLive ?? '')

  return (
    <section
      className={`vh${props.className ? ` ${props.className}` : ''}`}
      aria-label="Voice"
      data-scene="immersive"
      data-state={view.state}
      data-detail={view.detail}
      data-measured={view.measured ? 'true' : 'false'}
      data-form={staticForm ? 'static' : 'live'}
      data-paused={paused ? 'true' : 'false'}
      onKeyDown={onKeyDown}
    >
      <div className="vh-stage" ref={stageRef}>
        <span className="vh-bezel" aria-hidden="true" />
        {staticForm ? <StaticRing /> : <canvas ref={canvasRef} className="vh-canvas" width={STAGE_W} height={STAGE_H} role="img" aria-label={CANVAS_LABEL} />}
        <span className="vh-probes" aria-hidden="true">
          {VH_PROBES.map((k) => (
            <span key={k} className={`vh-probe vh-probe-${k}`} ref={(el) => void (probeRefs.current[k] = el)} />
          ))}
        </span>
      </div>

      <div className="vh-strip">
        <div className="vh-row">
          <span className="vh-state" data-testid="vh-state">{view.label}</span>
          <Lamp reading={view.lamp} subject="Voice" />
          {view.source && <span className="vh-source" data-testid="vh-source">{view.source}</span>}
          {view.measured && view.channel === 'out' && signal.latest('out')?.latMs != null && <span className="vh-chip" data-testid="vh-lat">{`device latency ${Math.round(signal.latest('out')!.latMs!)} ms`}</span>}
        </div>
        <div className="vh-row">
          <div className="vh-bar" ref={barRef} aria-hidden="true" data-db-scale={dbScale ? 'true' : 'false'} data-hollow="true">
            <div className="vh-bar-well">
              <div className="vh-bar-fill" ref={fillRef} />
              <span className="vh-tick vh-tick-thr" ref={thrRef} hidden />
              <span className="vh-tick vh-tick-peak" ref={peakRef} hidden />
              {dbScale && [-60, -40, -20, 0].map((db) => <span key={db} className="vh-scale" style={{ left: `${((db + 60) / 60) * 100}%` }} data-db={db} />)}
            </div>
            {dbScale && (
              <div className="vh-scale-text">
                {[-60, -40, -20, 0].map((db) => <span key={db}>{db}</span>)}
              </div>
            )}
          </div>
          <span className="vh-number" data-testid="vh-number" ref={numRef} data-hollow="true">{coreStrip ? 'no level' : '—'}</span>
          <button type="button" className="vh-pause" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume voice picture' : 'Pause voice picture'}
          </button>
        </div>
        <p className="vh-legend" data-testid="vh-legend">{legend}</p>
        <div className="vh-meter" ref={meterRef} role="meter" aria-label="Voice level" aria-valuemin={METER_MIN_DB} aria-valuemax={METER_MAX_DB} aria-valuetext="no reading" />
        <div className="vh-sr" role="status" aria-live="polite" data-testid="vh-announce">{view.announce}</div>
      </div>
    </section>
  )
}

