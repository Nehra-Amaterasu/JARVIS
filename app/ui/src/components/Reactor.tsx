/**
 * The reactor: JARVIS's state as one instrument — part arc reactor, part vinyl.
 *
 * Every moving part is wired to a signal; nothing animates for decoration.
 *   outer ticks (96)   listening: the MICROPHONE LEVEL, lit clockwise on a log
 *                      scale against the voice-activity threshold (the notch
 *                      marks where speech is detected). booting: boot progress.
 *   compute arc        exists only while computing — transcribing or thinking —
 *                      and turns faster for thinking than for transcribing.
 *   grooves            the record: ripple outward only while JARVIS is SPEAKING;
 *                      a single slow shimmer while replying in text.
 *   label marker       rotates like a record label while audio plays.
 *   breathing          asleep/ready: one slow breath every 4 s = "standing by".
 *   colour             cyan = live and working, white = ready, grey = offline,
 *                      red = the last thing that happened was an error.
 * Canvas 2D, ~1 ms a frame, and it stops drawing entirely when offline and idle.
 */
import { useEffect, useRef } from 'react'
import type { CoreState } from '../lib/api'

const BOOT_PROGRESS: Record<string, number> = {
  starting: 0.08, whisper: 0.25, audio: 0.45, wakeword: 0.6, memory: 0.82,
}

interface Props {
  state: CoreState
  running: boolean
  bootStep: string | null
  level: number
  threshold: number
  error: boolean
  size?: number
}

export function Reactor({ state, running, bootStep, level, threshold, error, size = 440 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const props = useRef({ state, running, bootStep, level, threshold, error })
  props.current = { state, running, bootStep, level, threshold, error }

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = size * dpr
    c.height = size * dpr
    ctx.scale(dpr, dpr)
    let raf = 0
    let litSmooth = 0
    let spin = 0
    let label = 0
    let last = performance.now()
    let lastDrawnStatic = ''

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const p = props.current
      const live = p.running && !['sleeping', 'idle', 'booting', 'offline'].includes(p.state)
      const computing = p.state === 'thinking' || p.state === 'transcribing'
      const speaking = p.state === 'speaking'
      const animated = p.running

      // Skip frames entirely when nothing can change (offline): zero GPU/CPU cost.
      const staticKey = `${p.running}|${p.state}|${p.error}`
      if (!animated && staticKey === lastDrawnStatic) {
        raf = requestAnimationFrame(draw)
        return
      }
      lastDrawnStatic = animated ? '' : staticKey

      const W = size, cx = W / 2, cy = W / 2
      ctx.clearRect(0, 0, W, W)
      const accent = p.error ? '255,69,58' : live ? '92,225,255' : p.running ? '245,246,248' : '120,124,132'

      // ---- outer ticks
      let target = 0
      if (p.state === 'listening' || p.state === 'followup') {
        const ratio = p.level / Math.max(p.threshold, 1e-6)
        target = Math.min(1, Math.log10(1 + ratio) / Math.log10(21))
      } else if (p.state === 'booting') {
        target = BOOT_PROGRESS[p.bootStep ?? 'starting'] ?? 0.1
      }
      litSmooth += (target - litSmooth) * Math.min(1, dt * (p.state === 'booting' ? 3 : 14))
      const N = 96, R1 = W * 0.47, R0 = W * 0.435
      const lit = Math.round(litSmooth * N)
      const thrTick = Math.round((Math.log10(2) / Math.log10(21)) * N)   // ratio = 1 -> speech threshold
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + (i / N) * Math.PI * 2
        const long = i % 8 === 0
        const r0 = long ? R0 - 6 : R0
        const on = i < lit
        ctx.strokeStyle = on ? `rgba(${accent},${0.55 + 0.45 * (i / N)})` : 'rgba(255,255,255,0.09)'
        ctx.lineWidth = on ? 2.2 : 1.4
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * R1, cy + Math.sin(a) * R1)
        ctx.stroke()
        if ((p.state === 'listening' || p.state === 'followup') && i === thrTick) {
          ctx.fillStyle = 'rgba(255,176,32,0.9)'
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * (R1 + 7), cy + Math.sin(a) * (R1 + 7), 2.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ---- structural ring with four notches
      const R2 = W * 0.39
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, R2, 0, Math.PI * 2)
      ctx.stroke()
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * (R2 - 5), cy + Math.sin(a) * (R2 - 5))
        ctx.lineTo(cx + Math.cos(a) * (R2 + 5), cy + Math.sin(a) * (R2 + 5))
        ctx.stroke()
      }

      // ---- compute arc: exists only while computing
      if (computing) {
        spin += dt * (p.state === 'thinking' ? 2.4 : 1.5)
        const R3 = W * 0.355
        ctx.lineCap = 'round'
        for (let k = 0; k < 3; k++) {
          const a0 = spin + (k * Math.PI * 2) / 3
          ctx.strokeStyle = `rgba(${accent},${0.9 - k * 0.2})`
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(cx, cy, R3, a0, a0 + 0.9)
          ctx.stroke()
        }
        ctx.lineCap = 'butt'
      }

      // ---- grooves (the record)
      const G0 = W * 0.13, G1 = W * 0.31, grooves = 22
      const t = now / 1000
      const breath = p.running && (p.state === 'sleeping' || p.state === 'idle') ? 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 4) : 0
      for (let g = 0; g < grooves; g++) {
        const f = g / (grooves - 1)
        const r = G0 + (G1 - G0) * f
        let a = 0.05 + 0.05 * (g % 2)
        if (speaking) a += 0.5 * Math.max(0, Math.sin(f * 9 - t * 7)) ** 3
        else if (p.state === 'replying') a += 0.18 * Math.max(0, Math.sin(f * 5 - t * 2.4)) ** 4
        a += breath * 0.06 * (1 - f)
        ctx.strokeStyle = `rgba(${speaking || p.state === 'replying' ? accent : '255,255,255'},${a})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      // ---- label
      const L = W * 0.115
      const grad = ctx.createRadialGradient(cx, cy - L * 0.4, L * 0.1, cx, cy, L)
      grad.addColorStop(0, 'rgba(34,36,41,1)')
      grad.addColorStop(1, 'rgba(12,13,15,1)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, L, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${accent},${p.running ? 0.75 : 0.3})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(cx, cy, L, 0, Math.PI * 2)
      ctx.stroke()
      if (speaking) label += dt * Math.PI * 2 * 0.55          // 33 rpm
      ctx.fillStyle = `rgba(${accent},0.95)`
      ctx.beginPath()
      ctx.arc(cx + Math.cos(label - Math.PI / 2) * L * 0.72, cy + Math.sin(label - Math.PI / 2) * L * 0.72, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#050506'
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, Math.PI * 2)
      ctx.fill()

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas ref={canvas} style={{ width: size, height: size, display: 'block' }} aria-hidden />
}
