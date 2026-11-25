// The orb (v3 look): one large circle in the middle of the stage, a pillowy raised rim around a sunk well, and four wave lines
// running through it from left to right, as in the owner's sketch of 25 Nov (yellow, orange, red, violet). Under it the state
// word, one plain line, and the level as a machine value.
//
// Motion, and what drives it:
//   - the MODE (asleep, waking, ready, listening, writing, thinking, speaking, stopped) is the core's own state word (orb.ts);
//   - the wave HEIGHT follows a level only while voiceState says a real frame is fresh; otherwise it is the mode's fixed loop
//     height, so a quiet room never looks like a meter reading. The dB text sits beside it ("no level" when there is none);
//   - asleep is a 5 s CSS breath and nothing else (no frame callback runs while he is off).
// One requestAnimationFrame loop (jarvis/voice VoiceLoop, capped at 60 fps) writes the eight path `d` values and one custom
// property per frame: no React render and no layout per frame. It stops when the tab is hidden, when the stage is off screen
// (IntersectionObserver), on Pause, in reduced motion and under the app's calm setting; each mode then holds a still pose that
// still differs by shape and colour (STILL_AMP and the CSS of data-mode).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { VoiceLoop, browserLoopDeps, type CoreView, type VoiceSignal } from '../voice'
import { Glint } from '../../shell/v3'
import { LampGlyph } from '../../shared/lamp'
import {
  ORB_WORD, STILL_AMP, WAVES, WAVE_H, WAVE_MODE, WAVE_W, loops, orbLevel, wavePath, waveTarget,
  type OrbLevel, type OrbMode,
} from './orb'

/** Reduced motion (the OS) and calm (the app, html[data-motion='calm']) both stop the loop; data-motion='full' is the review override. */
function readStill(): boolean {
  if (typeof document === 'undefined') return true
  const attr = document.documentElement.getAttribute('data-motion') ?? ''
  if (attr === 'calm') return true
  if (attr === 'full') return false
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function useStillPreference(): boolean {
  const [still, setStill] = useState(readStill)
  useEffect(() => {
    const update = () => setStill(readStill())
    let mq: MediaQueryList | null = null
    try { mq = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null } catch { mq = null }
    mq?.addEventListener?.('change', update)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
    return () => {
      mq?.removeEventListener?.('change', update)
      mo?.disconnect()
    }
  }, [])
  return still
}

/** The level as React state, re-read on each frame that arrives (at most 4 times a second) and once when it goes stale. */
function useOrbLevel(signal: VoiceSignal, core: CoreView, mode: OrbMode): OrbLevel {
  const [lvl, setLvl] = useState<OrbLevel>(() => orbLevel(signal, core, Date.now(), mode))
  useEffect(() => {
    let last = 0
    let stale: ReturnType<typeof setTimeout> | null = null
    const read = () => setLvl((p) => {
      const n = orbLevel(signal, core, Date.now(), mode)
      return p.measured === n.measured && p.text === n.text && p.channel === n.channel ? p : n
    })
    read()
    const off = signal.subscribe(() => {
      const now = Date.now()
      if (now - last >= 250) {
        last = now
        read()
      }
      if (stale) clearTimeout(stale)
      stale = setTimeout(() => { stale = null; read() }, 450) // STALE_MS (400) and a margin: the "no level" words come back on their own
    })
    return () => {
      off()
      if (stale) clearTimeout(stale)
    }
  }, [signal, core, mode])
  return lvl
}

export interface CoreOrbProps {
  mode: OrbMode
  signal: VoiceSignal
  coreView: CoreView
  /** The plain line under the word and whether it is the engine's fault sentence. */
  line: { text: string; fault: boolean }
  simulated?: boolean
  /** `none` holds the still pose (the gallery). */
  motion?: 'auto' | 'none'
  paused: boolean
  onTogglePause: () => void
  /** Asleep or stopped: pressing the orb wakes him. Absent while awake (the orb is then a picture). */
  onWake?: () => void
  busy?: boolean
  /** Under the words: the wake row or the four lamps. */
  children?: ReactNode
  /** The two upper corners of the stage, beside the orb: the state at the left, the small keys at the right. At 1366 x 768 the
   *  bar row they replace cost the conversation 52 px of its 145 (a third of a turn short of three). */
  corners?: { left?: ReactNode; right?: ReactNode }
}

export function CoreOrb({ mode, signal, coreView, line, simulated = false, motion = 'auto', paused, onTogglePause, onWake, busy, children, corners }: CoreOrbProps) {
  const prefersStill = useStillPreference()
  const still = motion === 'none' || prefersStill || paused
  const level = useOrbLevel(signal, coreView, mode)
  const stage = useRef<HTMLDivElement>(null)
  const paths = useRef<(SVGPathElement | null)[]>([])
  const glow = useRef<HTMLSpanElement>(null)
  // the loop reads the latest props through a ref, so a new level or mode never re-creates it
  const live = useRef({ mode, signal, coreView })
  live.current = { mode, signal, coreView }

  // the still pose, or the loop's first frame: written once per mode change
  const stillPaths = useMemo(() => WAVES.map((_, i) => wavePath(i, 0, STILL_AMP[mode], WAVE_MODE[mode].centre, 0)), [mode])

  useEffect(() => {
    const el = stage.current
    if (!el || still || !loops(mode)) return
    const deps = browserLoopDeps()
    let amp = WAVE_MODE[mode].amp
    let lastT = performance.now()
    let t = 0
    const tick = (now: number): boolean => {
      const { mode: m, signal: s, coreView: c } = live.current
      const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000))
      lastT = now
      const spec = WAVE_MODE[m]
      t += dt * spec.speed
      const lv = orbLevel(s, c, Date.now(), m)
      // ease toward the target in about 120 ms: a display smoothing of the real value, never a held or invented one
      amp += (waveTarget(m, lv) - amp) * Math.min(1, dt / 0.12)
      for (let i = 0; i < WAVES.length; i++) {
        const d = wavePath(i, t, amp, spec.centre, 1)
        paths.current[i]?.setAttribute('d', d)
        paths.current[i + WAVES.length]?.setAttribute('d', d)
        paths.current[i + 2 * WAVES.length]?.setAttribute('d', d)
      }
      glow.current?.style.setProperty('--orb-l', (lv.measured ? lv.value : 0).toFixed(3))
      return true
    }
    const loop = new VoiceLoop(deps, tick, () => performance.now(), 60)
    let onScreen = true
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((es) => {
        onScreen = es.some((e) => e.isIntersecting)
        loop.setHidden(!onScreen || deps.hidden())
      })
      : null
    io?.observe(el)
    const onVis = () => loop.setHidden(!onScreen || deps.hidden())
    document.addEventListener('visibilitychange', onVis)
    loop.request()
    return () => {
      loop.dispose()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      glow.current?.style.removeProperty('--orb-l')
    }
  }, [still, mode])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // WCAG 2.1.4: the single-key shortcut works only while focus is inside the stage (VoiceHill's own rule)
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      onTogglePause()
    }
  }

  const word = ORB_WORD[mode]
  const levelWord = level.measured ? (simulated ? 'SIMULATED' : 'LIVE') : null
  const label = `${word}. ${line.text}`
  const face = (
    <>
      <span className="jc3-orb-rim" aria-hidden="true" />
      <span className="jc3-orb-well" aria-hidden="true">
        <span className="jc3-orb-glow" ref={glow} />
      </span>
      <svg className="jc3-orb-marks" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <circle className="jc3-orb-ring" cx="100" cy="100" r="78" pathLength="100" />
        <g className="jc3-orb-orbit" data-n="1"><path d="M100 14a86 86 0 0 1 74.5 43" pathLength="100" /></g>
        <g className="jc3-orb-orbit" data-n="2"><path d="M100 186a86 86 0 0 1-60.8-25.2" pathLength="100" /></g>
      </svg>
    </>
  )
  // the three copies of each line: a soft glow and the line behind the orb (faded at the field's edges), and the bright line
  // clipped to the well on top, so the lines read as passing THROUGH the circle and not over its rim
  const waves = (layer: number, cls: string) => (
    <svg className={cls} viewBox={`0 0 ${WAVE_W} ${WAVE_H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {WAVES.map((_, i) => (
        <path key={i} data-w={i} d={stillPaths[i]} ref={(p) => void (paths.current[i + layer * WAVES.length] = p)} />
      ))}
    </svg>
  )
  return (
    <div className="jc3-hero" data-mode={mode} data-measured={level.measured ? 'true' : 'false'} data-form={still ? 'still' : 'live'} data-paused={paused ? 'true' : undefined} onKeyDown={onKey}>
      <div className="jc3-stage" ref={stage}>
        {waves(0, 'jc3-waves jc3-waves-glow')}
        {waves(1, 'jc3-waves jc3-waves-back')}
        {onWake ? (
          <button type="button" className="jc3-orb" onClick={onWake} aria-disabled={busy || undefined} aria-label={`Wake JARVIS. ${line.text}`} aria-keyshortcuts="Control+Shift+Space" data-testid="orb">
            {face}
          </button>
        ) : (
          <div className="jc3-orb" role="img" aria-label={label} data-testid="orb">{face}</div>
        )}
        {waves(2, 'jc3-waves jc3-waves-front')}
        {corners?.left && <div className="jc3-corner" data-side="left">{corners.left}</div>}
        {corners?.right && <div className="jc3-corner" data-side="right">{corners.right}</div>}
        <Glint />
      </div>
      <div className="jc3-say">
        <p className="jc3-word" data-testid="orb-word">{word}</p>
        {/* a fault sentence is ink on the tray with the FAULT lamp before it: the fault red itself reads 3.1 to 1 on the
            dark tray, under the 4.5 a sentence needs, so the colour sits on the glyph and the word, not on the text */}
        <p className="jc3-line" data-fault={line.fault ? 'true' : undefined} data-testid="orb-line">
          {line.fault && <span className="jc3-fault"><LampGlyph state="fault" /> FAULT</span>}
          {line.text}
        </p>
        {level.text && (
          <p className="jc3-level" data-testid="orb-level" data-measured={level.measured ? 'true' : 'false'}>
            <span role="meter" aria-label="Voice level" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={level.measured ? Math.round(level.value * 100) : undefined}
              aria-valuetext={level.measured ? `${level.text}, ${levelWord}` : 'no reading'}>
              {level.text}
            </span>
            {levelWord && <b className="jc3-level-word">{levelWord}</b>}
          </p>
        )}
        <div className="jc-sr" role="status" aria-live="polite">{word}</div>
      </div>
      {children}
    </div>
  )
}
