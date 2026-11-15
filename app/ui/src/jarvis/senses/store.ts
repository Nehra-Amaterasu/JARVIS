// The live data of the three Senses views, moved out of pages/Aankhen.tsx and held once. The classic page opened its own
// socket, kept the HUD state in React and drew from it; here one store holds the same things (the /ws/aankhen frames,
// the status, the room, the motion history, readiness, zones and the model status) so presence, signal and teach share
// one connection and one history while any of them is open, and the socket closes a few seconds after the last one.
//
// Nothing here is drawn. Timers, all bounded: the socket's own reconnect, a 1 s clock while a view is open (the age of the
// last frame), readiness every 15 s and the model status every 20 s. Frames update the state at most every 200 ms (5 Hz,
// as the classic HUD did) and the terrain rows at most every 240 ms, so a 24-row terrain covers about six seconds.
import { useEffect, useSyncExternalStore } from 'react'
import { api as realApi, openSocket as realOpenSocket, post as realPost } from '../../lib/api'
import type { Readiness } from '../../lib/roomMeasure'
import { getTrain, type TrainView, type ZoneLite } from '../../lib/teachTrain'
import type { FrameMsg, RoomSpec } from '../../twin/SpatialTwin'
import { ROWS, TapeStore, sourceOf, type Frame, type Source } from './model'

export interface HubInfo { running: boolean; mode: string | null; kind: string | null; scenario: string | null; scenarios: string[]; baseline: string; error: string | null; layout?: string }
export interface StatusMsg {
  type: 'status'; source: string
  sensors: Record<string, { state: string; detail: string }>
  link: { frames_ok?: number; crc_errors?: number; loss_ratio?: number; port?: string | null }
  room_measured: boolean
  hub?: HubInfo
  belief?: unknown
}
export interface HistPoint { score: number; thr: number }

export interface SensesState {
  online: boolean
  frames: Frame[]
  latest: FrameMsg | null
  hist: HistPoint[]
  status: StatusMsg | null
  room: RoomSpec | null
  readiness: Readiness | null
  zones: ZoneLite[]
  train: TrainView | null
  /** Paused by the user in this window: frames are not read, the tape records "paused", the board keeps sending. */
  paused: boolean
  lastAt: number | null
  now: number
  /** Bumps when the tape changes, so a view redraws it. */
  tapeRev: number
}

export const EMPTY_STATE: SensesState = {
  online: false, frames: [], latest: null, hist: [], status: null, room: null, readiness: null, zones: [], train: null,
  paused: false, lastAt: null, now: 0, tapeRev: 0,
}

export interface Raw { type: string; [k: string]: unknown }
export interface Deps {
  openSocket: typeof realOpenSocket
  api: typeof realApi
  post: typeof realPost
  now: () => number
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
}

const TAPE_KEY = 'jarvis.senses.tape.v1'
export const HIST_MAX = 150
const UI_MS = 200
const ROW_MS = 240
const CLOSE_DELAY_MS = 3000

function realStorage(): Deps['storage'] {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export class SensesStore {
  private s: SensesState = { ...EMPTY_STATE }
  private listeners = new Set<() => void>()
  private raws = new Set<(m: Raw) => void>()
  private refs = 0
  private sock: { send: (o: unknown) => void; close: () => void } | null = null
  private timers: number[] = []
  private closeTimer: number | undefined
  private lastUi = 0
  private lastRow = 0
  private lastSave = 0
  private histRef: HistPoint[] = []
  private lastSource: Source = 'none'
  readonly tapeLive = new TapeStore()
  readonly tapeSim = new TapeStore()
  private readonly d: Deps

  constructor(deps?: Partial<Deps>) {
    this.d = { openSocket: realOpenSocket, api: realApi, post: realPost, now: () => Date.now(), storage: realStorage(), ...deps }
    try { const raw = this.d.storage?.getItem(TAPE_KEY); if (raw) this.tapeLive.load(JSON.parse(raw)) } catch { /* no stored tape: it starts blank */ }
    this.s = { ...EMPTY_STATE, now: this.d.now() }
  }

  /* ---- subscription (useSyncExternalStore) */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getState = (): SensesState => this.s
  private set(patch: Partial<SensesState>): void {
    this.s = { ...this.s, ...patch }
    for (const l of this.listeners) l()
  }

  /** A specimen starts from a given picture instead of a connection (the gallery and the jury bench). */
  seed(state: SensesState): void { this.set(state) }

  /** The raw messages, for the 3D twin, which feeds on exactly what the classic page fed it. */
  onRaw(fn: (m: Raw) => void): () => void { this.raws.add(fn); return () => this.raws.delete(fn) }
  send(o: unknown): void { this.sock?.send(o) }

  /* ---- life: the first view opens the connection, the last one (after a pause) closes it */
  retain(): () => void {
    this.refs++
    window.clearTimeout(this.closeTimer)
    if (this.refs === 1 && !this.sock) this.open()
    let done = false
    return () => {
      if (done) return
      done = true
      this.refs = Math.max(0, this.refs - 1)
      if (this.refs === 0) this.closeTimer = window.setTimeout(() => this.close(), CLOSE_DELAY_MS)
    }
  }

  private open(): void {
    this.sock = this.d.openSocket('/ws/aankhen', (raw) => this.onMessage(raw as Raw), (st) => {
      this.set({ online: st === 'open' })
      if (st === 'open') this.sock?.send({ type: 'hello', want: 'snapshot', layer: 'live' })
    })
    this.timers.push(window.setInterval(() => this.set({ now: this.d.now() }), 1000))
    void this.loadReadiness()
    void this.loadTrain()
    void this.loadZones()
    this.timers.push(window.setInterval(() => void this.loadReadiness(), 15000), window.setInterval(() => void this.loadTrain(), 20000))
  }

  private close(): void {
    this.sock?.close()
    this.sock = null
    for (const t of this.timers) window.clearInterval(t)
    this.timers = []
    this.set({ online: false })
  }

  /* ---- messages */
  private onMessage(m: Raw): void {
    if (m.type === 'room') {
      this.set({ room: (m as unknown as { room: RoomSpec }).room })
    } else if (m.type === 'frame') {
      this.onFrame(m as unknown as FrameMsg)
    } else if (m.type === 'status') {
      this.set({ status: m as unknown as StatusMsg })
    }
    if (m.type !== 'frame' || !this.s.paused) for (const r of this.raws) r(m)
  }

  private onFrame(f: FrameMsg): void {
    const now = this.d.now()
    const src = sourceOf(f.source)
    this.lastSource = src
    if (this.s.paused) {
      this.tapeFor(src).record(now, 'paused')
      this.flushTape(now)
      return
    }
    if (f.motion_detail?.state === 'motion') this.tapeFor(src).record(now, 'seen')
    const sc = f.motion_detail?.score
    if (sc != null) this.histRef.push({ score: sc, thr: f.motion_detail.threshold ?? 0 })
    if (this.histRef.length > HIST_MAX * 2) this.histRef = this.histRef.slice(-HIST_MAX * 2)
    let frames = this.s.frames
    if (now - this.lastRow >= ROW_MS && Array.isArray(f.csi?.amplitudes)) {
      this.lastRow = now
      frames = [...frames.slice(-(ROWS - 1)), { t: f.t, amps: f.csi.amplitudes }]
    }
    if (now - this.lastUi >= UI_MS) {
      this.lastUi = now
      // sample the motion history to 5 Hz: the trace covers about 30 s, as the classic card did
      const step = Math.max(1, Math.round(this.histRef.length / HIST_MAX))
      const hist = this.histRef.filter((_, i, a) => (a.length - 1 - i) % step === 0).slice(-HIST_MAX)
      this.set({ latest: f, frames, hist, lastAt: now, now, tapeRev: this.s.tapeRev + 1 })
      this.flushTape(now)
    }
  }

  private tapeFor(src: Source): TapeStore { return src === 'simulated' ? this.tapeSim : this.tapeLive }

  /** The simulated tape is never written to storage: generated frames are not a record of the room. */
  private flushTape(now: number): void {
    if (now - this.lastSave < 30000 || !this.d.storage) return
    this.lastSave = now
    try { this.d.storage.setItem(TAPE_KEY, JSON.stringify(this.tapeLive.toJSON(now))) } catch { /* private window: not remembered */ }
  }

  /* ---- actions */
  setPaused(paused: boolean): void {
    if (paused === this.s.paused) return
    this.set({ paused })
    if (paused) this.tapeFor(this.lastSource).record(this.d.now(), 'paused')
  }

  async start(body: Record<string, unknown>): Promise<void> {
    await this.d.post('/api/aankhen/start', body)
    this.histRef = []
    this.set({ hist: [], frames: [] })
  }

  /** The heat layer of the twin (live or learned) is asked of the hub like any other stream. */
  askHeat(layer: 'live' | 'learned'): void { this.send({ type: 'hello', want: 'heatmap', layer }) }

  async loadReadiness(): Promise<void> {
    try { this.set({ readiness: await this.d.api<Readiness>('/api/aankhen/readiness') }) } catch { /* keep the last */ }
  }
  async loadTrain(): Promise<void> {
    try { this.set({ train: await getTrain() }) } catch { /* keep the last */ }
  }
  async loadZones(): Promise<void> {
    try {
      const z = await this.d.api<{ zones: ZoneLite[] }>('/api/aankhen/zones')
      this.set({ zones: Array.isArray(z.zones) ? z.zones : [] })
    } catch { /* no zones: the buttons stay empty and say so */ }
  }
  setTrain(train: TrainView): void { this.set({ train }) }
}

let shared: SensesStore | null = null
export function sensesStore(): SensesStore { return (shared ??= new SensesStore()) }

/** The hook of the three views: opens the connection while mounted and returns the store and its state. */
export function useSenses(): { store: SensesStore; state: SensesState } {
  const store = sensesStore()
  const state = useSyncExternalStore(store.subscribe, store.getState)
  useEffect(() => store.retain(), [store])
  return { store, state }
}
