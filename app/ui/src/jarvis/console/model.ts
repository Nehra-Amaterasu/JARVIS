// The Console's pure logic (A.J05, spec 20.9.5): every reading the five views draw, as data with a lamp, and the two small
// grammars (the closed command verbs and the events filter). No React, no network, no clock of its own: `now` is a
// parameter, so each rule is a test. The routes and stores these read already exist (lib/settings, lib/crew, lib/board,
// lib/store); nothing here is a new source and nothing here invents a value. A reading with no source is WAITING with the
// words "no report"; a failure is FAULT with its reason (amber, never red).
import type { Agent, CrewLoad } from '../../lib/crew'
import { sinceTick } from '../../lib/crew'
import type { BusEvent, Vitals } from '../../lib/api'
import { fmtUptime, liveStatus, resetLine, rssiWord, type BoardView, type JobView } from '../../lib/board'
import { verdictLabel, type BoardsView } from '../../lib/boards'
import type { LatencyView, Stat } from '../../lib/settings'
import type { PlannedEntry } from '../../shared/planned/types'
import { NO_REPORT, type LampReading, type LampState } from '../../shared/lamp'

export const waiting = (reason: string = NO_REPORT): LampReading => ({ state: 'waiting', since: null, reason })
export const live = (reason: string, since: number | null = null): LampReading => ({ state: 'live', since, reason })
export const fault = (reason: string): LampReading => ({ state: 'fault', since: null, reason: reason.trim() || 'no reason given' })

/* ------------------------------------------------------------------ the health rows */
export type RowTag = 'HEA' | 'WAK' | 'TIM' | 'BRN' | 'GPU' | 'STW' | 'APP' | 'LNK' | 'FWR' | 'UPT' | 'RST' | 'RSI' | 'CSI' | 'USB'

export interface ConsoleRowData {
  tag: RowTag
  /** The thing said, in the terminal's own plain words (`can he hear "Hey Jarvis": yes`). */
  text: string
  reading: LampReading
}

export interface HealthInput {
  /** true: the server answered; false: it did not (after the first ask); null: not asked yet. */
  online: boolean | null
  lat: LatencyView | null
  crew: CrewLoad | null
  vitals: Vitals | null
  /** Epoch seconds. */
  now: number
  /** A fixture: every LIVE is drawn SIMULATED (gallery, jury bench). */
  simulated?: boolean
}

const s1 = (n: number) => `${n.toFixed(1)} s`
const statWords = (label: string, st: Stat | null | undefined): string | null => (st ? `${label} ${s1(st.median)}` : null)

/** `can he hear "Hey Jarvis": yes`, as a reading. Off is WAITING (asleep on purpose); a stored error is FAULT. */
export function hearingRow(lat: LatencyView | null): ConsoleRowData {
  if (!lat) return { tag: 'HEA', text: 'can he hear "Hey Jarvis": not tested', reading: waiting('not tested') }
  const c = lat.core
  if (!c.running) {
    if (c.last_error) return { tag: 'HEA', text: 'can he hear "Hey Jarvis": no', reading: fault(c.last_error) }
    return { tag: 'HEA', text: 'can he hear "Hey Jarvis": no', reading: waiting('asleep, nothing is listening') }
  }
  if (c.mode === 'text') return { tag: 'HEA', text: 'can he hear "Hey Jarvis": no', reading: waiting('text mode: he reads what you type') }
  if (c.state === 'booting') return { tag: 'HEA', text: 'can he hear "Hey Jarvis": not yet', reading: waiting('booting') }
  if (c.last_error) return { tag: 'HEA', text: 'can he hear "Hey Jarvis": unclear', reading: fault(c.last_error) }
  return { tag: 'HEA', text: 'can he hear "Hey Jarvis": yes', reading: live(c.state === 'sleeping' ? 'listening for the wake word' : `awake, ${c.state}`) }
}

export function wakeRow(lat: LatencyView | null, now: number): ConsoleRowData {
  const w = lat?.live.wakes[0]
  if (!lat) return { tag: 'WAK', text: 'last wake: not tested', reading: waiting('not tested') }
  if (!w) return { tag: 'WAK', text: `last wake: none, it fires at ${lat.live.threshold}`, reading: waiting('no wake since the app opened') }
  const score = w.score == null ? 'no score' : `score ${w.score.toFixed(2)}`
  const age = Math.max(0, Math.round(now - w.t))
  return {
    tag: 'WAK',
    text: `last wake ${score}, fires at ${lat.live.threshold}, ${age} s ago`,
    reading: w.outcome === 'error' ? fault(w.error || 'the wake ended in an error') : live(w.outcome === 'heard_nothing' ? 'heard nothing after it' : w.outcome),
  }
}

export function timingRow(lat: LatencyView | null): ConsoleRowData {
  const s = lat?.summary
  if (!lat) return { tag: 'TIM', text: 'median: not read', reading: waiting('reading transcripts') }
  const parts = [statWords('heard', s?.heard), statWords('first word', s?.first_word), statWords('full', s?.full)].filter(Boolean)
  if (!parts.length) return { tag: 'TIM', text: 'median: none yet', reading: waiting('no spoken reply in 7 days') }
  const p90 = s?.first_word ? `, p90 ${s1(s.first_word.p90)}` : ''
  return { tag: 'TIM', text: `median ${parts.join(', ')}${p90}`, reading: live(`${s!.spoken} spoken repl${s!.spoken === 1 ? 'y' : 'ies'}, 7 days`) }
}

export function brainRow(lat: LatencyView | null): ConsoleRowData {
  const c = lat?.core
  if (!c) return { tag: 'BRN', text: 'brain: not tested', reading: waiting('not tested') }
  const name = c.brain ?? c.chosen_brain
  if (c.last_error && !c.running) return { tag: 'BRN', text: `brain ${name}`, reading: fault(c.last_error) }
  return c.running
    ? { tag: 'BRN', text: `brain ${name}`, reading: live(`running, ${c.state}`) }
    : { tag: 'BRN', text: `brain ${name}`, reading: waiting('chosen, not loaded') }
}

/** The GPU as a model for the dial and the row. Hollow (no total) when nothing can be read: no 6 GB default here. */
export interface GpuModel {
  reading: LampReading
  name: string | null
  usedMb: number | null
  totalMb: number | null
  llmMb: number
  otherMb: number
  /** 0..1, or null when hollow. */
  fraction: number | null
  tempC: number | null
  models: { name: string; mb: number }[]
}

export function gpuModel(v: Vitals | null): GpuModel {
  const g = v?.gpu
  const models = (v?.ollama ?? []).map((m) => ({ name: m.name, mb: m.vram_mb }))
  if (!g || !(g.mem_total_mb > 0)) {
    return { reading: waiting(v ? 'no GPU readable' : NO_REPORT), name: g?.name ?? null, usedMb: null, totalMb: null, llmMb: 0, otherMb: 0, fraction: null, tempC: null, models }
  }
  const llm = Math.min(g.mem_used_mb, models.reduce((a, m) => a + m.mb, 0))
  return {
    reading: live('nvidia-smi, now'),
    name: g.name, usedMb: g.mem_used_mb, totalMb: g.mem_total_mb, llmMb: llm, otherMb: Math.max(0, g.mem_used_mb - llm),
    fraction: Math.max(0, Math.min(1, g.mem_used_mb / g.mem_total_mb)), tempC: g.temp_c, models,
  }
}

export const gb = (mb: number | null | undefined, d = 1) => (mb == null || !Number.isFinite(mb) ? '--' : (mb / 1024).toFixed(d))

export function gpuRow(v: Vitals | null): ConsoleRowData {
  const m = gpuModel(v)
  if (m.fraction === null) return { tag: 'GPU', text: 'gpu memory: not readable', reading: m.reading }
  const t = m.tempC == null ? '' : `, ${Math.round(m.tempC)} C`
  return { tag: 'GPU', text: `${m.name ?? 'gpu'} ${gb(m.usedMb)} of ${gb(m.totalMb)} GB${t}`, reading: m.reading }
}

export function stewardOf(crew: CrewLoad | null): Agent | undefined {
  return crew?.status === 'ok' ? crew.view.agents.find((a) => a.id === 'steward') : undefined
}

export function stewardRow(crew: CrewLoad | null, now: number): ConsoleRowData {
  if (!crew) return { tag: 'STW', text: 'steward: not asked', reading: waiting('not asked yet') }
  if (crew.status === 'error') return { tag: 'STW', text: 'steward: unreachable', reading: fault(crew.message) }
  if (crew.status === 'absent') return { tag: 'STW', text: 'steward: not running', reading: waiting('the staff is not running yet') }
  const a = stewardOf(crew)
  if (!a) return { tag: 'STW', text: 'steward: not on the roster', reading: waiting('no steward in the staff') }
  const t = sinceTick(a.health, now)
  if (a.state === 'error') return { tag: 'STW', text: `steward: ${a.summary || 'a check failed'}`, reading: fault(a.health.last_error || 'a check failed') }
  if (t.stale) return { tag: 'STW', text: `steward: ${a.summary || a.state}`, reading: waiting(`last check ${t.text}`) }
  return { tag: 'STW', text: `steward: ${a.summary || a.state}`, reading: live(`checked ${t.text}`) }
}

export function appRow(online: boolean | null): ConsoleRowData {
  if (online === null) return { tag: 'APP', text: 'server: asking', reading: waiting('no answer yet') }
  return online
    ? { tag: 'APP', text: 'server answering', reading: live('the local server replied') }
    : { tag: 'APP', text: 'server not answering', reading: fault('the local server did not reply') }
}

const simState = (s: LampState, sim: boolean): LampState => (sim && s === 'live' ? 'simulated' : s)

/** The seven rows of the terminal frame, in reading order. A simulated input turns every LIVE into SIMULATED. */
export function healthRows(d: HealthInput): ConsoleRowData[] {
  const rows = [hearingRow(d.lat), wakeRow(d.lat, d.now), timingRow(d.lat), brainRow(d.lat), gpuRow(d.vitals), stewardRow(d.crew, d.now), appRow(d.online)]
  return d.simulated ? rows.map((r) => ({ ...r, reading: { ...r.reading, state: simState(r.reading.state, true) } })) : rows
}

/** The ASCII ridge of a series: the first-word and full-reply seconds of the last replies, oldest left. Gaps stay gaps. */
export function replySeries(lat: LatencyView | null, key: 'first_word' | 'full' | 'heard', n = 14): number[] {
  const r = (lat?.recent ?? []).slice(0, n).slice().reverse()
  return r.map((x) => (typeof x[key] === 'number' ? (x[key] as number) : NaN))
}

/* ------------------------------------------------------------------ jobs */
export type JobState = 'live' | 'hollow' | 'done' | 'fault'

export interface JobSpec {
  id: string
  tag: 'SYS' | 'BRD'
  label: string
  /** 0..1, only when the source reported one. Without it the bar is hollow and dashed. */
  fraction?: number
  state: JobState
  reason?: string
}

export const validFraction = (f: unknown): f is number => typeof f === 'number' && Number.isFinite(f) && f >= 0 && f <= 1

/** The board's compile or flash job as a row: it reports `pct` (or null), so the bar fills only for a number. */
export function boardJobSpec(j: JobView | null | undefined): JobSpec | null {
  if (!j) return null
  const label = `${j.kind} ${j.detail || ''}`.trim()
  if (j.state === 'failed') return { id: `board:${j.id}`, tag: 'BRD', label, state: 'fault', reason: j.result?.error || j.result?.errors?.[0] || 'the job failed' }
  if (j.state === 'ok') return { id: `board:${j.id}`, tag: 'BRD', label, fraction: 1, state: 'done', reason: j.result?.summary || 'finished' }
  const f = j.pct == null ? undefined : j.pct / 100
  return { id: `board:${j.id}`, tag: 'BRD', label, fraction: validFraction(f) ? f : undefined, state: validFraction(f) ? 'live' : 'hollow', reason: j.phase || 'running' }
}

/** Everything the job board shows: the core waking, the board's job and the jobs this view started. */
export function jobBoard(opts: { bootStep: string | null | undefined; booting: boolean; board: BoardView | null; local: JobSpec[] }): JobSpec[] {
  const out: JobSpec[] = []
  // JARVIS reports a boot step, never a fraction: the bar is hollow while it wakes
  if (opts.booting) out.push({ id: 'core:boot', tag: 'SYS', label: 'wake JARVIS', state: 'hollow', reason: opts.bootStep || 'starting' })
  const b = boardJobSpec(opts.board?.job)
  if (b) out.push(b)
  for (const l of opts.local) out.push(l)
  return out
}

/* ------------------------------------------------------------------ the command grammar */
export interface VerbDef {
  verb: string
  /** A verb that changes something asks once before it runs. */
  heavy: boolean
  /** One line for `help`. */
  help: string
}

/** The closed list (spec 20.9.5). Nothing else is a verb: there is no shell, no eval and no passthrough. */
export const VERBS: readonly VerbDef[] = [
  { verb: 'status', heavy: false, help: 'the seven health rows' },
  { verb: 'test hearing', heavy: false, help: 'ask the core whether he can hear the wake word now' },
  { verb: 'restart brain', heavy: true, help: 'stop and start the brain (asks once)' },
  { verb: 'free gpu', heavy: true, help: 'unload every model from the GPU (asks once)' },
  { verb: 'export memory', heavy: true, help: 'write the memory export (asks once)' },
  { verb: 'jobs', heavy: false, help: 'what is running, with a bar only where a fraction is reported' },
  { verb: 'plan', heavy: false, help: 'what is planned and not built' },
  { verb: 'help', heavy: false, help: 'this list' },
]
export const VERB_NAMES: string[] = VERBS.map((v) => v.verb)
export const verbDef = (verb: string): VerbDef | undefined => VERBS.find((v) => v.verb === verb)

/**
 * Tab completion: the typed prefix completed to the longest shared start of the verbs it begins. Returns the text
 * unchanged when nothing begins with it, and never invents a verb.
 */
export function completeVerb(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!t) return text
  const hits = VERB_NAMES.filter((v) => v.startsWith(t))
  if (!hits.length) return text
  let p = hits[0]
  for (const h of hits) while (!h.startsWith(p)) p = p.slice(0, -1)
  return p.length > t.length ? p : hits.length === 1 ? hits[0] : text
}

/* ------------------------------------------------------------------ the events filter */
export interface EventFilter {
  include: string[]
  exclude: string[]
  /** Seconds back from now; null for no limit. */
  sinceS: number | null
  /** Words the grammar refused (a bad `since:`), shown under the field. */
  problems: string[]
}

const SINCE = /^since:(\d{1,4})([smhd])$/i
const UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/** `core !sim since:1h`: a bare word includes a tag, `!word` excludes it, `since:` limits the age. All lower case. */
export function parseFilter(text: string): EventFilter {
  const f: EventFilter = { include: [], exclude: [], sinceS: null, problems: [] }
  for (const raw of text.trim().split(/\s+/).filter(Boolean)) {
    const w = raw.toLowerCase()
    if (w.startsWith('since:')) {
      const m = SINCE.exec(w)
      if (m) f.sinceS = Number(m[1]) * UNIT_S[m[2].toLowerCase()]
      else f.problems.push(`${raw}: try since:30m, since:1h or since:2d`)
    } else if (w.startsWith('!')) {
      if (w.length > 1) f.exclude.push(w.slice(1))
    } else f.include.push(w)
  }
  return f
}

/** The tags of an event: its source, its kind, `sim` when simulated and `fault` for an error. */
export function tagsOf(e: Pick<BusEvent, 'source' | 'kind' | 'sim'>): string[] {
  const t = [String(e.source).toLowerCase(), String(e.kind).toLowerCase()]
  if (e.sim) t.push('sim')
  if (String(e.kind).toLowerCase() === 'error') t.push('fault')
  return t
}

export function applyFilter(events: readonly BusEvent[], f: EventFilter, nowS: number): BusEvent[] {
  return events.filter((e) => {
    const tags = tagsOf(e)
    if (f.include.length && !f.include.every((w) => tags.includes(w))) return false
    if (f.exclude.some((w) => tags.includes(w))) return false
    if (f.sinceS !== null && nowS - e.ts > f.sinceS) return false
    return true
  })
}

/** The tag counts of a list, most frequent first (the events rail). */
export function sourceCounts(events: readonly BusEvent[]): { source: string; n: number }[] {
  const m = new Map<string, number>()
  for (const e of events) m.set(String(e.source).toLowerCase(), (m.get(String(e.source).toLowerCase()) ?? 0) + 1)
  return [...m.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n || (a.source < b.source ? -1 : 1))
}

/** The bracket tag of an event row: three letters, upper case (`CORE` stays four, as the ticker had it). */
export const tagWord = (source: string): string => String(source).toUpperCase().slice(0, 5)

/** The lamp of an event line: simulated is SIMULATED, an error is FAULT, anything else is LIVE. */
export function eventLamp(e: Pick<BusEvent, 'kind' | 'sim'>): LampState {
  if (e.sim) return 'simulated'
  if (String(e.kind).toLowerCase() === 'error') return 'fault'
  return 'live'
}

/* ------------------------------------------------------------------ the route (planned registry) */
export type PlateState = 'passed' | 'waiting' | 'planned'

export interface RoutePlate {
  id: string
  label: string
  line: string
  needs: string
  state: PlateState
  home: string
}

/** A built row is passed (solid); built-not-verified is WAITING, never PLANNED; the rest is PLANNED. */
export function routePlates(registry: readonly PlannedEntry[], max = 14): RoutePlate[] {
  return registry.slice(0, max).map((e) => ({
    id: e.id, label: e.label, line: e.line, needs: e.needs, home: e.home,
    state: e.built ? 'passed' : e.state === 'unverified' ? 'waiting' : 'planned',
  }))
}

export const PLATE_WORD: Record<PlateState, string> = { passed: 'BUILT', waiting: 'BUILT, NOT VERIFIED', planned: 'PLANNED' }

/* ------------------------------------------------------------------ the integrations list */
export interface Integration { id: string; group: string; name: string; status: 'connected' | 'installed' | 'available' | 'missing' | 'planned'; detail: string; next: string | null }

/** The lamp of a detected integration. "installed" is on disk but not loaded now: WAITING, one meaning each. */
export function integrationReading(i: Integration): LampReading {
  switch (i.status) {
    case 'connected': return live(i.detail || 'connected')
    case 'installed': return waiting(i.detail || 'on disk, not loaded now')
    case 'available': return waiting(i.detail || 'available, not installed')
    case 'missing': return fault(i.detail || 'not found')
    default: return { state: 'planned', since: null, reason: i.detail || 'not built' }
  }
}

export const STATUS_WORD: Record<Integration['status'], string> = { connected: 'connected', installed: 'installed', available: 'available', missing: 'missing', planned: 'planned' }

export function integrationCounts(items: readonly Integration[] | null): Record<Integration['status'], number> {
  const c = { connected: 0, installed: 0, available: 0, missing: 0, planned: 0 }
  for (const i of items ?? []) c[i.status] += 1
  return c
}

/* ------------------------------------------------------------------ the board (hardware view) */
export type FlashGate = { allowed: boolean; reason: string }

/**
 * Firmware never offers a flash while the application holds the board's port (project rule: the running app holds the
 * ESP32's serial port; flashing means closing it first). The USB link, a hub in hardware mode or a named hold each close it.
 */
export function flashGate(b: BoardView | null): FlashGate {
  if (!b) return { allowed: false, reason: 'the board has not answered' }
  const held = b.link === 'usb' || (b.hub.running && b.hub.mode === 'hardware' && !!b.hub.port) || !!b.hub.hold
  if (held) return { allowed: false, reason: `the app holds the board's port${b.usb?.port ? ` (${b.usb.port})` : b.hub.port ? ` (${b.hub.port})` : ''}: close the app to flash` }
  return { allowed: true, reason: '' }
}

const unreported = (tag: RowTag, text: string): ConsoleRowData => ({ tag, text, reading: waiting('the board has not reported') })

/** The board's own report as rows. Every value is what the board said (its STATUS or GET /status); nothing is filled in
 *  from the app's own state, and a board that has not reported draws WAITING rows, not zeros. */
export function boardRows(b: BoardView | null): ConsoleRowData[] {
  if (!b) return (['LNK', 'FWR', 'UPT', 'RST', 'RSI', 'CSI'] as const).map((t) => ({ tag: t, text: `${t === 'LNK' ? 'link' : t === 'FWR' ? 'firmware' : t === 'UPT' ? 'uptime' : t === 'RST' ? 'last reset' : t === 'RSI' ? 'signal' : 'csi'}: not read`, reading: waiting('the board view has not answered') }))
  const st = liveStatus(b)
  const link: ConsoleRowData = b.link === 'usb'
    ? { tag: 'LNK', text: `link USB ${b.usb?.port ?? ''}`.trim(), reading: live(b.usb?.handshake ? 'the board identified itself' : 'port open, no handshake yet') }
    : b.link === 'wifi'
      ? { tag: 'LNK', text: `link Wi-Fi ${b.session?.address ?? b.ip ?? ''}`.trim(), reading: b.session && !b.session.handshake ? waiting('session open, no handshake yet') : live('the board answered over Wi-Fi') }
      : { tag: 'LNK', text: b.ip ? `link none, last address ${b.ip}` : 'link none', reading: waiting(b.ip ? 'a remembered address, not answering' : 'no board') }
  const fw = b.firmware
  const firmware: ConsoleRowData = {
    tag: 'FWR',
    text: `firmware ${fw.running ?? 'unknown'}, repo ${fw.repo ?? '--'}`,
    reading: !st ? waiting('no board report') : fw.differs ? waiting('the running firmware differs from the repo') : live('matches the repo'),
  }
  if (!st) return [link, firmware, unreported('UPT', 'uptime: not reported'), unreported('RST', 'last reset: not reported'), unreported('RSI', 'signal: not reported'), unreported('CSI', 'csi: not reported')]
  const reset = resetLine(st.reset)
  return [
    link, firmware,
    { tag: 'UPT', text: `uptime ${fmtUptime(st.uptime_s)}`, reading: live('the board reported it') },
    { tag: 'RST', text: `last reset: ${reset.text}`, reading: reset.tone === 'fault' ? fault(reset.text) : st.reset ? live('the board reported it') : waiting('no reset reason reported') },
    { tag: 'RSI', text: `signal ${rssiWord(st.rssi)}`, reading: st.rssi == null ? waiting('no signal reading') : live('the board reported it') },
    { tag: 'CSI', text: st.csi_hz == null ? 'csi: not reported' : `csi ${st.csi_hz} Hz, ${st.csi_dropped ?? 0} dropped`, reading: st.csi_hz == null ? waiting('no csi reading') : live('the board reported it') },
  ]
}

/** One row per USB port the scan found: the verdict in words, with FAULT only for a port that cannot be read. */
export function portRows(v: BoardsView | null): ConsoleRowData[] {
  if (!v) return []
  return v.ports.map((p) => ({
    tag: 'USB' as const,
    text: `${p.device} ${p.chip || p.description || ''} ${verdictLabel(p)}`.replace(/\s+/g, ' ').trim(),
    reading: p.verdict === 'aankhen' ? live(p.in_use ? 'in use by the app' : 'identified itself')
      : p.verdict === 'error' ? fault(p.detail || 'the port cannot be read')
        : waiting(p.detail || verdictLabel(p)),
  }))
}

/** Events per time bucket from the oldest event to now, oldest first: a real density trace, or null when fewer than two
 *  events (or a zero span) leave nothing honest to draw. */
export function densityBuckets(events: readonly Pick<BusEvent, 'ts'>[], nowS: number, buckets = 48): number[] | null {
  if (events.length < 2) return null
  const t0 = Math.min(...events.map((e) => e.ts))
  const span = nowS - t0
  if (!(span > 0)) return null
  const out = new Array<number>(buckets).fill(0)
  for (const e of events) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor(((e.ts - t0) / span) * buckets)))
    out[i] += 1
  }
  return out
}
