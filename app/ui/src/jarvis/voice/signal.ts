// The voice signal channel (spec 9.3): a plain mutable ring, not React state and not the store. The shell or Core wires
// events in with `attachVoiceFeed`; the picture reads it from its own tick. Everything here is a display transform of
// real frames: smoothing on ingest, one-frame interpolation at read time, never extrapolation, never a canned value.
import { ATTACK_MS, FRAME_MS, HILL_HISTORY_TOLERANCE_MS, N_BANDS, RELEASE_MS, RING_CAP, SMOOTH_DT_MAX_MS, STALE_MS, smoothCoef } from './constants'
import type { Channel } from './bands'

/** One real frame, after validation. Fields a source did not send are null, never defaulted to a number. */
export interface VoiceFrame {
  channel: Channel
  /** Epoch seconds at which the audio was captured or written to the device; null for the legacy scalar `level`. */
  t: number | null
  seq: number | null
  sr: number | null
  rmsDb: number | null
  peakDb: number | null
  /** 24 ints 0..255, or null for the legacy scalar (Tier 0). */
  bands: number[] | null
  /** Legacy unbounded scalar (`level`), Tier 0 only. */
  level: number | null
  /** Device latency in ms as the stream reported it; null when unknown. Never a constant. */
  latMs: number | null
  final: boolean
  thrDb: number | null
  speechProb: number | null
  vadThreshold: number | null
  speaking: boolean | null
  /** Epoch ms at which this frame reached the window (the caller's clock). */
  arrival: number
}

export interface StoredFrame extends VoiceFrame {
  /** Smoothed bands (24, 0..255), or null for scalar frames. All zeros on a `final` frame. */
  smooth: Float32Array | null
  /** When the frame may be shown: max(arrival, t + lat_ms) (9.8). */
  audibleAt: number
}

/** What the state machine needs to know about one channel, with no arrays in it. */
export interface ChannelView {
  hasFrame: boolean
  lastArrival: number | null
  final: boolean
  /** True when a non-final frame younger than 400 ms exists: the only condition under which solid points may be drawn. */
  fresh: boolean
  /** VAD says speech (speaking, or speech_prob at or above the VAD threshold); null when the source gave no VAD at all. */
  speech: boolean | null
  /** The last two frames were both above the silence threshold; used only when `speech` is null. */
  aboveThreshold: boolean
  hasBands: boolean
  rmsDb: number | null
  thrDb: number | null
  latMs: number | null
  /** Frames seen on this channel since the last `final` (0 when no stream is open). */
  streamFrames: number
  /** Epoch ms of the first frame of the current stream, or null. */
  streamStart: number | null
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const numOrNull = (x: unknown): number | null => (finite(x) ? x : null)

/** Validate one bus event into a frame, or null. `kind` "out_level" is the output channel, "level" the input one. */
export function parseFrame(ev: unknown, arrival: number): VoiceFrame | null {
  if (!ev || typeof ev !== 'object') return null
  const e = ev as Record<string, unknown>
  const channel: Channel | null = e.kind === 'out_level' ? 'out' : e.kind === 'level' ? 'in' : null
  if (!channel) return null
  let bands: number[] | null = null
  if (Array.isArray(e.bands)) {
    if (e.bands.length !== N_BANDS || !e.bands.every(finite)) return null
    bands = (e.bands as number[]).map((b) => Math.min(255, Math.max(0, Math.round(b))))
  }
  const level = numOrNull(e.level)
  if (!bands && level === null && channel === 'in') return null
  if (!bands && channel === 'out') return null
  const lat = numOrNull(e.lat_ms)
  return {
    channel,
    t: numOrNull(e.t),
    seq: numOrNull(e.seq),
    sr: numOrNull(e.sr),
    rmsDb: numOrNull(e.rms_db),
    peakDb: numOrNull(e.peak_db),
    bands,
    level: bands ? level : level === null ? null : Math.max(0, level),
    latMs: lat !== null && lat >= 0 ? lat : null,
    final: e.final === true,
    thrDb: numOrNull(e.thr_db),
    speechProb: numOrNull(e.speech_prob),
    vadThreshold: numOrNull(e.vad_threshold),
    speaking: typeof e.speaking === 'boolean' ? e.speaking : null,
    arrival,
  }
}

class Ring {
  private buf: StoredFrame[] = []
  private head = 0
  push(f: StoredFrame): void {
    if (this.buf.length < RING_CAP) this.buf.push(f)
    else {
      this.buf[this.head] = f
      this.head = (this.head + 1) % RING_CAP
    }
  }
  get length(): number {
    return this.buf.length
  }
  /** Oldest first. */
  at(i: number): StoredFrame {
    return this.buf[(this.head + i) % this.buf.length]
  }
  clear(): void {
    this.buf = []
    this.head = 0
  }
}

interface ChannelState {
  ring: Ring
  smooth: Float32Array
  lastSeq: number | null
  lastArrival: number | null
  /** Capture time (epoch s) of the previous frame, so the smoother steps by the audio's own spacing, not by bus jitter. */
  lastT: number | null
  streamOpen: boolean
}

const newChannel = (): ChannelState => ({ ring: new Ring(), smooth: new Float32Array(N_BANDS), lastSeq: null, lastArrival: null, lastT: null, streamOpen: false })

export class VoiceSignal {
  private ch: Record<Channel, ChannelState> = { in: newChannel(), out: newChannel() }
  private subs = new Set<() => void>()
  /** Frames lost to `seq` gaps, for the Console health line "voice frames: rate, dropped, age p95". */
  dropped = 0
  received = 0

  /** Ingest one validated frame. Smoothing happens here, once, on real values. */
  ingest(frame: VoiceFrame): void {
    const c = this.ch[frame.channel]
    this.received++
    if (frame.seq !== null && c.lastSeq !== null && frame.seq > c.lastSeq + 1) this.dropped += frame.seq - c.lastSeq - 1
    c.lastSeq = frame.seq
    const prev = c.lastArrival
    const gap = prev === null ? Infinity : frame.arrival - prev
    let smooth: Float32Array | null = null
    if (frame.bands) {
      smooth = new Float32Array(N_BANDS)
      if (frame.final) {
        c.smooth.fill(0) // the UI drops to the floor on the same tick; nothing decays through a fake silence
        c.streamOpen = false
      } else if (!c.streamOpen || gap > SMOOTH_DT_MAX_MS) {
        c.smooth.set(frame.bands) // a new stream starts at its first real value, not at a made-up rise from zero
        c.streamOpen = true
      } else {
        const dt = frame.t !== null && c.lastT !== null ? clampDt((frame.t - c.lastT) * 1000) : clampDt(gap)
        const up = smoothCoef(dt, ATTACK_MS)
        const down = smoothCoef(dt, RELEASE_MS)
        for (let i = 0; i < N_BANDS; i++) {
          const v = frame.bands[i]
          c.smooth[i] += (v - c.smooth[i]) * (v > c.smooth[i] ? up : down)
        }
      }
      smooth.set(c.smooth)
    } else {
      c.streamOpen = !frame.final
    }
    const audible = frame.latMs !== null && frame.t !== null ? Math.max(frame.arrival, frame.t * 1000 + frame.latMs) : frame.arrival
    c.ring.push({ ...frame, smooth, audibleAt: audible })
    c.lastArrival = frame.arrival
    c.lastT = frame.t
    for (const s of this.subs) s()
  }

  /** Called on every ingest. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.subs.add(fn)
    return () => void this.subs.delete(fn)
  }

  latest(ch: Channel): StoredFrame | null {
    const r = this.ch[ch].ring
    return r.length ? r.at(r.length - 1) : null
  }

  ageMs(ch: Channel, now: number): number | null {
    const a = this.ch[ch].lastArrival
    return a === null ? null : now - a
  }

  /** Frames since the last `final`, oldest first, that may already be shown at `now`. */
  private stream(ch: Channel, now: number): StoredFrame[] {
    const r = this.ch[ch].ring
    const out: StoredFrame[] = []
    for (let i = 0; i < r.length; i++) {
      const f = r.at(i)
      if (f.final) out.length = 0
      else if (f.audibleAt <= now) out.push(f)
    }
    return out
  }

  /** True when the newest displayable frame is a `final`: the picture drops to the floor and no stream is open. */
  private endedAt(ch: Channel, now: number): boolean {
    const r = this.ch[ch].ring
    for (let i = r.length - 1; i >= 0; i--) {
      const f = r.at(i)
      if (f.audibleAt <= now) return f.final
    }
    return false
  }

  view(ch: Channel, now: number): ChannelView {
    const c = this.ch[ch]
    const r = c.ring
    const last = r.length ? r.at(r.length - 1) : null
    const fresh = !!last && !last.final && now - last.arrival <= STALE_MS
    let speech: boolean | null = null
    if (last && !last.final) {
      if (last.speaking === true) speech = true
      else if (last.speechProb !== null && last.vadThreshold !== null) speech = last.speechProb >= last.vadThreshold
      else if (last.speaking === false) speech = false
    }
    let above = false
    if (r.length >= 2) {
      const a = r.at(r.length - 1)
      const b = r.at(r.length - 2)
      above = !a.final && !b.final && a.rmsDb !== null && a.thrDb !== null && b.rmsDb !== null && b.thrDb !== null && a.rmsDb > a.thrDb && b.rmsDb > b.thrDb
    }
    let n = 0
    let start: number | null = null
    for (let i = 0; i < r.length; i++) {
      const f = r.at(i)
      if (f.final) {
        n = 0
        start = null
      } else {
        if (n === 0) start = f.arrival
        n++
      }
    }
    return {
      hasFrame: !!last,
      lastArrival: c.lastArrival,
      final: !!last && last.final,
      fresh,
      speech,
      aboveThreshold: above,
      hasBands: !!last && last.bands !== null,
      rmsDb: last && !last.final ? last.rmsDb : null,
      thrDb: last && !last.final ? last.thrDb : null,
      latMs: last ? last.latMs : null,
      streamFrames: n,
      streamStart: start,
    }
  }

  /**
   * The smoothed bands to show now, interpolated one frame back (9.8 point 2): render time is `now - 50 ms`, the two
   * real frames around it are blended, and when no later frame exists the newer one is shown as it is. Never
   * extrapolates. null when no frame may be shown yet, or the stream has ended (`final`: the floor, handled by the caller).
   */
  sampleBands(ch: Channel, now: number): Float32Array | null {
    if (this.endedAt(ch, now)) return null
    const s = this.stream(ch, now).filter((f) => f.smooth)
    if (!s.length) return null
    const r = now - FRAME_MS
    let a = -1
    for (let i = 0; i < s.length; i++) if (s[i].audibleAt <= r) a = i
    if (a < 0) return s[0].smooth
    const A = s[a]
    const B = s[a + 1]
    if (!B || B.audibleAt <= A.audibleAt) return A.smooth
    const u = Math.min(1, Math.max(0, (r - A.audibleAt) / (B.audibleAt - A.audibleAt)))
    const out = new Float32Array(N_BANDS)
    for (let i = 0; i < N_BANDS; i++) out[i] = A.smooth![i] + (B.smooth![i] - A.smooth![i]) * u
    return out
  }

  /**
   * `count` rows of smoothed bands, row j nearest to `now - spacingMs * j` (row 0 is `sampleBands`). A row with no
   * real frame within 75 ms of its time is null: it is not drawn, so history never fills in with invented energy.
   */
  historyBands(ch: Channel, now: number, spacingMs: number, count: number): (Float32Array | null)[] {
    const rows: (Float32Array | null)[] = []
    const s = this.stream(ch, now).filter((f) => f.smooth)
    const ended = this.endedAt(ch, now)
    for (let j = 0; j < count; j++) {
      if (ended) {
        rows.push(null)
        continue
      }
      if (j === 0) {
        rows.push(this.sampleBands(ch, now))
        continue
      }
      const target = now - spacingMs * j
      let best: StoredFrame | null = null
      let bd = Infinity
      for (const f of s) {
        const d = Math.abs(f.audibleAt - target)
        if (d < bd) {
          bd = d
          best = f
        }
      }
      rows.push(best && bd <= HILL_HISTORY_TOLERANCE_MS ? best.smooth : null)
    }
    return rows
  }

  /** Legacy scalar samples (Tier 0) of the current stream, oldest first, as [arrival ms, level]. */
  scalarHistory(ch: Channel, now: number): [number, number][] {
    const r = this.ch[ch].ring
    const out: [number, number][] = []
    for (let i = 0; i < r.length; i++) {
      const f = r.at(i)
      if (f.final) out.length = 0
      else if (f.level !== null && !f.bands && f.arrival <= now) out.push([f.arrival, f.level])
    }
    return out
  }

  /** Frames per second over the last few arrivals, rounded; null before two frames exist. */
  rateHz(ch: Channel): number | null {
    const r = this.ch[ch].ring
    if (r.length < 2) return null
    const n = Math.min(r.length, 8)
    const first = r.at(r.length - n)
    const last = r.at(r.length - 1)
    const span = last.arrival - first.arrival
    return span > 0 ? Math.round(((n - 1) * 1000) / span) : null
  }

  /** Forget everything (a core restart, or a test). Does not notify. */
  reset(): void {
    this.ch = { in: newChannel(), out: newChannel() }
    this.dropped = 0
    this.received = 0
  }
}

const clampDt = (gapMs: number): number => Math.min(SMOOTH_DT_MAX_MS, Math.max(10, Math.round(gapMs)))

/** The small subscription function the shell or Core calls once: `subscribe` is whatever hands over raw bus events. */
export function attachVoiceFeed(
  signal: VoiceSignal,
  subscribe: (handler: (ev: unknown) => void) => () => void,
  clock: () => number = Date.now,
): () => void {
  return subscribe((ev) => {
    const f = parseFrame(ev, clock())
    if (f) signal.ingest(f)
  })
}
