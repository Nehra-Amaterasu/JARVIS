/**
 * Talking to the JARVIS server.
 *
 * The window is opened at http://127.0.0.1:<port>/#t=<token>. The fragment never
 * reaches any server, so the token is read here, kept in sessionStorage (dies
 * with the window), and the address bar is cleaned. Every API call and socket
 * presents it; the server refuses anything without it (app/jarvis_app/security.py).
 */
const KEY = 'jarvis.token'

function readToken(): string {
  const m = location.hash.match(/[#&]t=([^&]+)/)
  if (m) {
    sessionStorage.setItem(KEY, decodeURIComponent(m[1]))
    history.replaceState(null, '', location.pathname + location.search)
  }
  return sessionStorage.getItem(KEY) ?? ''
}

export const TOKEN = readToken()

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { 'X-Jarvis-Token': TOKEN, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const j = await res.json()
      msg = j.detail ?? j.error ?? msg
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body })

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}${path}?t=${encodeURIComponent(TOKEN)}`
}

/** A WebSocket that reconnects with jittered backoff and reports its state. */
export function openSocket(
  path: string,
  onMessage: (data: unknown) => void,
  onState?: (s: 'open' | 'closed') => void,
): { send: (o: unknown) => void; close: () => void } {
  let ws: WebSocket | null = null
  let backoff = 400
  let closed = false
  let timer: number | undefined
  const connect = () => {
    ws = new WebSocket(wsUrl(path))
    ws.onopen = () => {
      backoff = 400
      onState?.('open')
    }
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data))
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      onState?.('closed')
      ws = null
      if (!closed) {
        timer = window.setTimeout(connect, backoff * (0.6 + Math.random() * 0.6))
        backoff = Math.min(backoff * 2, 8000)
      }
    }
    ws.onerror = () => ws?.close()
  }
  connect()
  return {
    send: (o) => ws?.readyState === 1 && ws.send(JSON.stringify(o)),
    close: () => {
      closed = true
      window.clearTimeout(timer)
      ws?.close()
    },
  }
}

/* --------------------------------------------------------------- types */
export type CoreState =
  | 'offline' | 'booting' | 'sleeping' | 'idle' | 'listening' | 'transcribing'
  | 'thinking' | 'replying' | 'speaking' | 'followup'

export interface CoreInfo {
  running: boolean
  mode: 'voice' | 'text' | null
  state: CoreState
  boot_step: string | null
  pid: number | null
  started_at: number | null
  ready_at: number | null
  uptime_s: number | null
  last_error: string | null
  exit_code: number | null
  timings: Record<string, number>
  room: Record<string, { on: boolean }>
  mqtt: boolean | null
}

export interface Turn { id: number; role: 'you' | 'jarvis'; text: string; t: number; done: boolean; seconds?: number }

export interface BusEvent {
  id: number
  ts: number
  source: string
  kind: string
  text: string
  sim?: boolean
  [k: string]: unknown
}

export interface Vitals {
  t: number
  cpu_pct: number
  cpu_count: number
  ram_used_mb: number
  ram_total_mb: number
  disk_free_gb: number
  disk_total_gb: number
  gpu: null | {
    name: string; util: number | null; mem_used_mb: number; mem_total_mb: number
    temp_c: number | null; power_w: number | null
    processes: { pid: number; name: string; mem_mb: number | null }[]
  }
  ollama: null | { name: string; size_mb: number; vram_mb: number; expires_at: string }[]
  core: CoreInfo
  aankhen: AankhenInfo
}

export interface AankhenInfo {
  running: boolean
  mode: string | null
  kind: string | null
  scenario: string | null
  scenarios: string[]
  port: string | null
  room: string
  room_measured: boolean
  baseline: string
  error: string | null
}
