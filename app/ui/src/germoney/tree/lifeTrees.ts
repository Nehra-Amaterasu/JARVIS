/**
 * The life trees (money, career, Insta, LinkedIn, GitHub, ...): the server's contract,
 * the fetch/POST calls, and an adapter that turns one tree into the Bank shape the
 * skill tree's layout engine (game/tree.ts) already draws, so every tree shares one
 * layout, one canvas and one set of tests.
 *
 * Contract (GET /api/mission/trees, POST /api/mission/trees/{tree}/{node}/proof):
 * the server owns status. A node is locked until every prereq is mastered, mastered
 * when have >= need, in progress when 0 < have < need, else available. Only proof
 * kind "link" (measured: false) takes a URL from the owner; the rest are measured.
 */
import { api } from '../../lib/api'
import { useStore, type Tab } from '../../lib/store'
import type { Bank, BankNode } from '../data/bank'
import type { NodeStatus } from '../game/tree'
import { useStudyNode } from '../pages/Study'

export type ProofKind = 'link' | 'github_days' | 'build_hours' | 'money_income' | 'money_entries' | 'skill_nodes' | 'life_points'
export interface Proof { kind: ProofKind | string; need: number; have: number; unit: string; text: string; measured?: boolean }
export interface Evidence { date: string; text: string; url?: string }
export interface TreeLink { kind: 'node' | 'page' | 'url'; target: string; label: string }
export interface LifeNode {
  id: string; name: string; tier: number; prereqs: string[]; outcomes: string[]
  status: NodeStatus; proof: Proof; evidence: Evidence[]; links: TreeLink[]
}
export interface LifeTree { id: string; name: string; about: string; progress: { mastered: number; total: number }; nodes: LifeNode[] }
export interface TreesAnswer { status: string; trees: LifeTree[] }

const STATUSES: NodeStatus[] = ['locked', 'available', 'in_progress', 'mastered']

/** Defensive parse: a malformed tree or node is dropped, never a crash. */
export function parseTrees(raw: unknown): LifeTree[] {
  const list = (raw as { trees?: unknown })?.trees
  if (!Array.isArray(list)) return []
  const out: LifeTree[] = []
  for (const t of list as Record<string, unknown>[]) {
    if (!t || typeof t.id !== 'string' || !Array.isArray(t.nodes)) continue
    const nodes: LifeNode[] = []
    for (const n of t.nodes as Record<string, unknown>[]) {
      if (!n || typeof n.id !== 'string') continue
      const p = (n.proof ?? {}) as Record<string, unknown>
      nodes.push({
        id: n.id, name: String(n.name ?? n.id), tier: Number(n.tier) || 0,
        prereqs: Array.isArray(n.prereqs) ? n.prereqs.filter((x): x is string => typeof x === 'string') : [],
        outcomes: Array.isArray(n.outcomes) ? n.outcomes.map(String) : [],
        status: STATUSES.includes(n.status as NodeStatus) ? n.status as NodeStatus : 'locked',
        proof: { kind: String(p.kind ?? 'link'), need: Number(p.need) || 0, have: Number(p.have) || 0, unit: String(p.unit ?? ''), text: String(p.text ?? ''),
          measured: typeof p.measured === 'boolean' ? p.measured : p.kind !== 'link' },
        evidence: Array.isArray(n.evidence) ? (n.evidence as Evidence[]).filter((e) => e && typeof e.text === 'string') : [],
        links: Array.isArray(n.links) ? (n.links as TreeLink[]).filter((l) => l && typeof l.target === 'string') : [],
      })
    }
    const pr = (t.progress ?? {}) as Record<string, unknown>
    out.push({ id: t.id, name: String(t.name ?? t.id), about: String(t.about ?? ''), nodes,
      progress: { mastered: Number(pr.mastered) || nodes.filter((n) => n.status === 'mastered').length, total: Number(pr.total) || nodes.length } })
  }
  return out
}

export async function fetchTrees(): Promise<LifeTree[]> {
  try { return parseTrees(await api('/api/mission/trees')) } catch { return [] }
}

export async function postProof(tree: string, node: string, url: string, note: string): Promise<LifeTree[]> {
  return parseTrees(await api(`/api/mission/trees/${encodeURIComponent(tree)}/${encodeURIComponent(node)}/proof`, { method: 'POST', body: { url, note } }))
}

/** One life tree as a Bank, so layoutTree() draws it. Unknown prereqs are dropped (the layout would ignore them anyway). */
export function toBank(tree: LifeTree): Bank {
  const ids = new Set(tree.nodes.map((n) => n.id))
  const nodes: Record<string, BankNode> = {}
  for (const n of tree.nodes) {
    nodes[n.id] = { id: n.id, name: n.name, branch: tree.name, tier: n.tier, prereqs: n.prereqs.filter((p) => ids.has(p) && p !== n.id),
      outcomes: n.outcomes, hours_est: 0, resources: [], certs: [], project: null, contracts: [], maths: {} }
  }
  return { version: null, careers: [], nodes, order: tree.nodes.map((n) => n.id), resources: {}, certs: {}, math: { diagnostic: [], practice_engine: {} },
    contractIndex: {}, warnings: [], errors: [], files: [] }
}

export const statusesOf = (tree: LifeTree): Record<string, NodeStatus> => Object.fromEntries(tree.nodes.map((n) => [n.id, n.status]))

/* ============================================================== links, in-app */
/** A page link's target → the app tab it opens. */
export const PAGE_TAB: Record<string, Tab> = { today: 'mission', study: 'schedule', tree: 'syllabus', life: 'quests', career: 'campaign', status: 'status' }

type Shell = { pywebview?: { api?: { open_url?: (url: string) => unknown } } }

/** External URLs open in the app's own browser window when the desktop shell offers one. Only http(s). */
export function openExternal(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  const shell = (window as unknown as Shell).pywebview?.api
  if (typeof shell?.open_url === 'function') void shell.open_url(url)
  else window.open(url, '_blank', 'noopener')
  return true
}

/** Follow a link inside the app: a node selects it on the canvas, a page switches tab, a URL opens in-app. */
export function followLink(link: TreeLink, ctx: { selectNode: (id: string) => void; studyNode?: string | null }): void {
  if (link.kind === 'node') ctx.selectNode(link.target)
  else if (link.kind === 'page') {
    const tab = PAGE_TAB[link.target]
    if (!tab) return
    if (tab === 'schedule' && ctx.studyNode) useStudyNode.getState().set(ctx.studyNode)
    useStore.getState().setTab(tab)
  } else openExternal(link.target)
}
