/**
 * USB boards, as /api/boards reports them (app/jarvis_app/routes_boards.py).
 *
 * A port is an Aankhen board only after it has SENT a valid Aankhen frame
 * (aankhen/boards.py). Everything here turns those verdicts into words and colour,
 * and colour is provenance: cyan only for a board that has identified itself, amber
 * for "opened, not yet confirmed", red for a port that cannot be read.
 */

export type Verdict = 'aankhen' | 'claimed' | 'foreign' | 'silent' | 'busy' | 'error'

export interface PortView {
  device: string
  verdict: Verdict
  detail: string
  vid: string | null
  pid: string | null
  chip: string
  description: string
  bytes: number
  frame: string | null
  fw: string | null
  listened_s: number
  at: number
  in_use: boolean
}

export interface BoardsView {
  ports: PortView[]
  board: { source?: string | null; port?: string | null; handshake?: boolean; handshake_at?: number | null; fw?: string | null; note?: string | null }
  hub: { running: boolean; mode: string | null; kind: string | null; scenario: string | null; requested_mode: string | null; port: string | null }
  hotplug: { enabled: boolean; watching: boolean; interval_s: number; requested_mode: string | null; announced: string[]; last: { t: number; action: string; text: string } | null }
}

/** Pill tone (base.css .pill.live / .sim / .fault; '' is neutral). */
export function verdictTone(p: Pick<PortView, 'verdict'>): '' | 'live' | 'sim' | 'fault' {
  switch (p.verdict) {
    case 'aankhen': return 'live'
    case 'claimed': return 'sim'
    case 'error': return 'fault'
    default: return ''
  }
}

export function verdictLabel(p: Pick<PortView, 'verdict' | 'in_use'>): string {
  switch (p.verdict) {
    case 'aankhen': return p.in_use ? 'Aankhen · live' : 'Aankhen board'
    case 'claimed': return 'awaiting handshake'
    case 'foreign': return 'not Aankhen'
    case 'silent': return 'silent'
    case 'busy': return 'held elsewhere'
    default: return 'unreadable'
  }
}

export function portIds(p: Pick<PortView, 'vid' | 'pid'>): string {
  return p.vid ? `${p.vid}:${p.pid ?? '????'}` : 'no USB id'
}

/** One line: is there a board, and is Aankhen using it. */
export function boardsHeadline(v: BoardsView): string {
  const live = v.ports.find((p) => p.verdict === 'aankhen' && p.in_use)
  if (live) return `ESP32 live on ${live.device}`
  const found = v.ports.find((p) => p.verdict === 'aankhen')
  if (found) return `ESP32 answered on ${found.device}`
  const waiting = v.ports.find((p) => p.verdict === 'claimed')
  if (waiting) return `Waiting for ${waiting.device} to identify itself`
  if (!v.ports.length) return 'No USB serial devices'
  return 'No Aankhen board'
}

/** What the hot-plug watcher will do if a board answers now. */
export function hotplugLine(v: BoardsView): string {
  const h = v.hotplug
  const every = `every ${Math.round(h.interval_s)} s`
  if (!h.enabled) return 'Hot-plug is off'
  if (!v.hub.running) return 'Aankhen is stopped, so nothing is watching'
  if (v.hub.mode === 'hardware') return v.board.handshake ? 'On the board' : 'Set to the board; waiting for it to talk'
  if (v.hub.mode === 'replay') return 'Replaying a recording: a new board is left alone'
  if (v.hub.requested_mode === 'auto') return `Watching ${every}: a board that answers takes over from the simulation`
  return `Watching ${every}: a board that answers is announced; your simulation stays`
}
