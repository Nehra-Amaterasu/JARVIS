// Shared test helpers for the voice picture: frame builders and a fake requestAnimationFrame with a live-callback count.
import { N_BANDS } from '../../jarvis/voice/constants'
import type { VoiceFrame } from '../../jarvis/voice/signal'
import type { LoopDeps } from '../../jarvis/voice/loop'
import type { Ctx2D } from '../../jarvis/voice/scene'

export const bandsOf = (fn: (i: number) => number): number[] => Array.from({ length: N_BANDS }, (_, i) => Math.round(fn(i)))
export const flat = (v: number): number[] => bandsOf(() => v)
/** A speech-like row: a mound over the low-mid bands. */
export const speechRow = (gain = 1): number[] => bandsOf((i) => gain * (40 + 170 * Math.exp(-((i - 7) ** 2) / 30)))

export function frame(channel: 'in' | 'out', arrival: number, bands: number[] | null, extra: Partial<VoiceFrame> = {}): VoiceFrame {
  return {
    channel, t: arrival / 1000, seq: null, sr: 24000, rmsDb: bands ? -20 : null, peakDb: null, bands, level: bands ? null : 0.5, latMs: null, final: false,
    thrDb: null, speechProb: null, vadThreshold: null, speaking: null, arrival, ...extra,
  }
}

export interface FakeRaf extends LoopDeps {
  /** Callbacks currently queued (what E-01 reads as the loop registry). */
  readonly live: number
  /** Total callbacks ever requested. */
  readonly requested: number
  /** Run every queued callback once. */
  flush(): number
  setHidden(h: boolean): void
}

export function fakeRaf(): FakeRaf {
  let next = 1
  let requested = 0
  let hidden = false
  const q = new Map<number, (t: number) => void>()
  return {
    raf: (cb) => {
      const id = next++
      requested++
      q.set(id, cb)
      return id
    },
    caf: (id) => void q.delete(id),
    hidden: () => hidden,
    get live() {
      return q.size
    },
    get requested() {
      return requested
    },
    flush() {
      const cbs = [...q.values()]
      q.clear()
      for (const cb of cbs) cb(0)
      return cbs.length
    },
    setHidden(h: boolean) {
      hidden = h
    },
  }
}

export interface Recorder extends Ctx2D {
  /** Number of fill() calls (solid) and stroke() calls (hollow or ring) since the last reset. */
  fills: number
  strokes: number
  texts: string[]
  /** fillStyle values at each fill(), in order. */
  fillStyles: string[]
  reset(): void
}

export function recorder(): Recorder {
  const r = {
    fills: 0, strokes: 0, texts: [] as string[], fillStyles: [] as string[],
    fillStyle: '' as string, strokeStyle: '' as string, lineWidth: 1, globalAlpha: 1, font: '', textBaseline: 'alphabetic' as CanvasTextBaseline, textAlign: 'left' as CanvasTextAlign,
    clearRect() {}, beginPath() {}, closePath() {}, rect() {}, moveTo() {}, lineTo() {}, arc() {},
    fill() {
      r.fills++
      r.fillStyles.push(String(r.fillStyle))
    },
    stroke() {
      r.strokes++
    },
    fillText(t: string) {
      r.texts.push(t)
    },
    setTransform() {},
    reset() {
      r.fills = 0
      r.strokes = 0
      r.texts = []
      r.fillStyles = []
    },
  }
  return r as unknown as Recorder
}
