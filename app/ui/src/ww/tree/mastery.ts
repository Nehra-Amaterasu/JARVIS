/**
 * The client of ww_mastery.py (/api/mission/mastery/...): Sharpen and De-master. The server decides and
 * words every refusal; the page prints `blocker` and invents nothing, so with no GATE bank the button says
 * what the server said ("No GATE bank yet: the question harvester has fetched none").
 */
import { useCallback, useEffect, useState } from 'react'
import { api, post } from '../../lib/api'

export interface GateSolve { q: string; ref: string; topic: string; at: string }
export interface Candidate { id: string; subject: string; topic: string; ref: string; source: string; matched: boolean }
export interface CheckItem { contract: string; title: string; minutes: number; cap_minutes: number; success_check: string; harder: string }
export interface Check { round: number; items: CheckItem[]; rule: string }
export interface Blocker { id: string; name: string; status: string; distance: number; now: boolean }
export interface Mastery {
  node: string
  name: string
  status: string
  gate_bank: number
  sharpen: {
    allowed: boolean
    blocker: string | null
    round: number
    active: boolean
    check: Check | null
    next: Check | null
    solved: GateSolve[]
    spare: number
    reproved: number
    candidates: Candidate[]
  }
  demaster: { allowed: boolean; blocker: string | null; blockers: Blocker[]; first: string[]; xp_back: number }
}
export interface MasteryResult { ok: boolean; say: string; blocker?: string; first?: string[]; blockers?: Blocker[] }

const path = (id: string) => `/api/mission/mastery/${encodeURIComponent(id)}`
export const getMastery = (id: string) => api<Mastery>(path(id))
export const masteryOp = (id: string, op: 'gate-solve' | 'sharpen' | 'sharpen-done' | 'demaster', body: object = {}) => post<MasteryResult>(`${path(id)}/${op}`, body)

/** The mastery state of one node. `null` while loading, `'offline'` when the server cannot be asked (nothing is guessed). */
export function useMastery(id: string | null, status: string | undefined): { m: Mastery | null | 'offline'; reload: () => Promise<void> } {
  const [m, setM] = useState<Mastery | null | 'offline'>(null)
  const reload = useCallback(async () => {
    if (!id) return
    try {
      setM(await getMastery(id))
    } catch {
      setM('offline')
    }
  }, [id])
  // asked for every selected node, not only mastered ones: the server words "only a mastered node can be sharpened"
  // itself, and re-asked when the status changes (mastering a node flips both buttons)
  useEffect(() => {
    setM(null)
    if (id) void reload()
  }, [id, status, reload])
  return { m, reload }
}
