/**
 * `glide` core (plan 5.7.3 #7, 5.7.2 #4): inertia after a drag.
 *
 * Release velocity is taken over the last 80 ms and capped at 3 px/ms. The glide decays as
 * v(t) = v0 e^(-t / tau), tau = 110 ms, and is at rest under 0.05 px/ms. From these the
 * worst case is tau ln(60) = 450 ms; a typical 2 px/ms throw is 406 ms and 214 px (the plan
 * rounded this to 220). Past a bound the drag is resisted (x 0.35) and returns on `heavy`.
 *
 * The rAF loop exists only while a glide runs; at rest it has stopped, so idle is 0
 * callbacks (5.7.6 rule 4). Nothing glides on a keyboard or reduced-motion path: the caller
 * simply does not call `start`.
 */
export const TAU_MS = 110
export const V_CAP = 3
export const V_REST = 0.05
export const SAMPLE_WINDOW_MS = 80
export const RESIST = 0.35

export interface Sample {
  t: number
  x: number
  y: number
}

/** px/ms over the last SAMPLE_WINDOW_MS before `now`, speed capped at V_CAP. */
export function releaseVelocity(samples: readonly Sample[], now: number): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= SAMPLE_WINDOW_MS)
  if (recent.length < 2) return { vx: 0, vy: 0 }
  const a = recent[0]
  const b = recent[recent.length - 1]
  const dt = b.t - a.t
  if (dt <= 0) return { vx: 0, vy: 0 }
  let vx = (b.x - a.x) / dt
  let vy = (b.y - a.y) / dt
  const speed = Math.hypot(vx, vy)
  if (speed > V_CAP) {
    vx *= V_CAP / speed
    vy *= V_CAP / speed
  }
  return { vx, vy }
}

/** Time until rest and the distance covered, for a release speed v0 (px/ms). */
export function glideBudget(v0: number): { durationMs: number; distancePx: number } {
  if (v0 <= V_REST) return { durationMs: 0, distancePx: 0 }
  return { durationMs: TAU_MS * Math.log(v0 / V_REST), distancePx: TAU_MS * (v0 - V_REST) }
}

/** Velocity after dt ms. */
export const decay = (v: number, dt: number) => v * Math.exp(-dt / TAU_MS)

/** Displacement past a bound is resisted. */
export const rubberBand = (overshoot: number) => overshoot * RESIST

export class Glide {
  private raf = 0
  private last = 0
  private vx = 0
  private vy = 0
  get active(): boolean {
    return this.raf !== 0
  }
  /** onFrame gets the displacement for this frame in px. Stops itself at rest. */
  start(vx: number, vy: number, onFrame: (dx: number, dy: number) => void, onRest?: () => void): void {
    this.stop()
    this.vx = vx
    this.vy = vy
    this.last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(now - this.last, 50)
      this.last = now
      onFrame(this.vx * dt, this.vy * dt)
      this.vx = decay(this.vx, dt)
      this.vy = decay(this.vy, dt)
      if (Math.hypot(this.vx, this.vy) < V_REST) {
        this.raf = 0
        onRest?.()
        return
      }
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
