// The one draw loop of the voice picture (spec 9.11): requestAnimationFrame only while there is something to draw.
// It never runs idle, stops when the document is hidden or the owner pauses it, and a callback that returns false
// ends it. `pending` is 1 while a callback is queued and 0 otherwise, so a test can prove that nothing is left after
// unmount ("zero rAF callbacks", E-01) without reading a global registry.

export interface LoopDeps {
  raf: (cb: (t: number) => void) => number
  caf: (id: number) => void
  hidden: () => boolean
}

export const browserLoopDeps = (): LoopDeps => ({
  raf: (cb) => window.requestAnimationFrame(cb),
  caf: (id) => window.cancelAnimationFrame(id),
  hidden: () => typeof document !== 'undefined' && document.hidden,
})

export class VoiceLoop {
  private deps: LoopDeps
  private tick: (now: number) => boolean
  private now: () => number
  private fpsCap: number
  private id: number | null = null
  private hidden = false
  private paused = false
  private disposed = false
  private lastDraw = -Infinity
  /** Frames drawn since creation, for the budget line. */
  drawn = 0

  /**
   * @param tick draws one frame at `now` (ms) and returns true to keep going, false to stop (the next request restarts it).
   * @param fpsCap the tick rate cap while data flows (30 at `high`, 20 at `low`); frames closer together than that are skipped.
   */
  constructor(deps: LoopDeps, tick: (now: number) => boolean, now: () => number, fpsCap: number) {
    this.deps = deps
    this.tick = tick
    this.now = now
    this.fpsCap = fpsCap
    this.hidden = deps.hidden()
  }

  get pending(): number {
    return this.id === null ? 0 : 1
  }

  setFpsCap(n: number): void {
    this.fpsCap = n
  }

  /** Ask for a frame. No-op while a callback is queued, hidden, paused or disposed. */
  request(): void {
    if (this.id !== null || this.hidden || this.paused || this.disposed) return
    this.id = this.deps.raf(this.run)
  }

  setHidden(h: boolean): void {
    this.hidden = h
    if (h) this.cancel()
    else this.request()
  }

  setPaused(p: boolean): void {
    this.paused = p
    if (p) this.cancel()
  }

  cancel(): void {
    if (this.id !== null) {
      this.deps.caf(this.id)
      this.id = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
  }

  private run = (): void => {
    this.id = null
    if (this.disposed || this.hidden || this.paused) return
    const t = this.now()
    if (t - this.lastDraw < 1000 / this.fpsCap - 1) {
      this.id = this.deps.raf(this.run)
      return
    }
    this.lastDraw = t
    this.drawn++
    if (this.tick(t)) this.request()
  }
}
