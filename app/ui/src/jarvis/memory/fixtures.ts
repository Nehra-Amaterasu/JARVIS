// Invented fixtures for the gallery, the jury page and the tests (never a real memory, name or chat). Every state drawn from
// them is stamped SIMULATED by the views (a port with `simulated: true`). Dates hang off one fixed clock so a picture is the
// same on every run. The fixture ports behave like the live ones where it matters: a search returns facts whose text starts
// with node labels of the layout (so the recall path has something to light), a capture adds a node, a fix returns `added`.
import type { LearnedQueue } from '../../lib/learned'
import type { RemindersView } from '../../lib/reminders'
import type { ExportSource } from '../../lib/settings'
import type { ReviewPort } from '../core/ShareReview'
import type { BeliefPort, PeoplePort, RecallPort, RemindersPort, SourcesPort } from './port'
import type { Belief, GalaxyNode, GalaxyPayload, NodeDetail, Person, SearchRes, Stats, TasteView } from './types'

/** 15 Nov 2026, noon UTC: the fixed clock of every fixture. */
export const NOW_MS = Date.UTC(2026, 10, 15, 12)
export const NOW_S = Math.floor(NOW_MS / 1000)

const SNIPPETS = [
  'The spare key lives in the blue tin by the door', 'Notes go in the green folder on the left shelf', 'Plan the market stall for the second Saturday',
  'The kettle descaler is under the sink', 'Library books are due on the twelfth', 'Try the long route past the canal on slow days',
  'The router sits behind the fern', 'Water the basil every second morning', 'Tea is better with the lid left on', 'The ladder is in the shed, top hook',
  'Order seeds before the first week of March', 'Notebook with the red cover holds the recipes', 'Walk to the post office before noon',
  'The bike lock code is on the card in the drawer', 'Replace the hallway bulb with the warm one', 'Draft the letter to the council on Sunday',
  'Songs for the long train ride are in the evening list', 'The garden gate sticks when it rains', 'Fix the shelf bracket with the longer screws',
  'Backup drive lives in the desk, left drawer', 'Keep the receipts in the box marked winter', 'The recipe for lentil soup needs more lemon',
]
const GROUPS = ['claude', 'note', 'voice', 'authored', 'instagram'] as const

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** `n` invented memory nodes (plus 6 people, 5 beliefs and 4 taste topics) over the 14 months before the fixed clock. */
export function fixtureNodes(n: number): GalaxyNode[] {
  const rnd = mulberry(7)
  const out: GalaxyNode[] = []
  for (let i = 0; i < n; i++) {
    const g = GROUPS[Math.floor(rnd() * GROUPS.length)]
    const daysAgo = Math.floor(Math.pow(rnd(), 1.6) * 420)
    out.push({
      id: `m${i}`, kind: 'memory', label: `${SNIPPETS[i % SNIPPETS.length]}${i >= SNIPPETS.length ? ` (${Math.floor(i / SNIPPETS.length) + 1})` : ''}`,
      source: g, time: new Date(NOW_MS - daysAgo * 86_400_000).toISOString(), importance: Math.round((0.18 + rnd() * 0.7) * 100) / 100, x: 0, y: 0, z: 0,
    })
  }
  const people = ['Alder Finch', 'Birch Moore', 'Cedar Vale', 'Dune Harker', 'Elm Rowan', 'Fern Calloway']
  people.forEach((p, i) => out.push({ id: `p${i}`, kind: 'person', label: p, source: 'people', time: new Date(NOW_MS - (i * 37 + 9) * 86_400_000).toISOString(), importance: 0.5, x: 0, y: 0, z: 0 }))
  for (let i = 0; i < 5; i++) out.push({ id: `b${i}`, kind: 'belief', label: `Fixture belief ${i + 1}: keeps a habit, unconfirmed`, source: 'claude', time: new Date(NOW_MS - (i * 60 + 20) * 86_400_000).toISOString(), importance: 0.6, status: i < 2 ? 'confirmed' : 'unconfirmed', x: 0, y: 0, z: 0 })
  for (let i = 0; i < 4; i++) out.push({ id: `t${i}`, kind: 'topic', label: ['Cooking', 'Trains', 'Gardens', 'Maps'][i], source: 'taste', time: new Date(NOW_MS - (i * 90 + 30) * 86_400_000).toISOString(), importance: 0.7, status: 'inferred', x: 0, y: 0, z: 0 })
  return out
}

export function fixtureGalaxy(n = 40): GalaxyPayload {
  const nodes = fixtureNodes(n)
  const rnd = mulberry(11)
  const edges: [number, number][] = []
  // links join neighbours by age inside one source, the way a recall log would: short, local, never a hairball
  const byGroup = new Map<string, number[]>()
  nodes.forEach((nd, i) => { const g = nd.kind === 'memory' ? nd.source : nd.kind; byGroup.set(g, [...(byGroup.get(g) ?? []), i]) })
  for (const idx of byGroup.values()) {
    idx.sort((a, b) => Date.parse(nodes[b].time ?? '') - Date.parse(nodes[a].time ?? ''))
    for (let k = 0; k + 1 < idx.length; k++) if (rnd() < 0.5) edges.push([idx[k], idx[k + 1]])
  }
  const counts = { memories: n, memories_shown: n, people: 6, beliefs: 5, topics: 4, edges: edges.length }
  const sources: Record<string, number> = {}
  for (const nd of nodes) if (nd.kind === 'memory') sources[nd.source] = (sources[nd.source] ?? 0) + 1
  return { version: 1, built: new Date(NOW_MS).toISOString(), build_ms: 0, max_memories: 600, sampled: false, counts, sources, nodes, edges: edges.filter(([a, b]) => a !== b), growth: { months: [], families: [], by_source: {}, undated: {}, people_new: [], beliefs_updated: [], ingest: [], beliefs_ingest: [], totals: { memories: n, people: 6, beliefs: 5 } } }
}

export const fixtureStats = (n = 40): Stats => ({
  archive_messages: 18240, threads: 61, people: 6, people_scored: 6, memories: n, memory_sources: { claude: Math.round(n * 0.3), note: Math.round(n * 0.3), voice: Math.round(n * 0.2) },
  beliefs: { unconfirmed: 3, confirmed: 2 }, taste_topics: 4, taste_captions: 212,
})

export const fixtureTaste: TasteView = {
  n_captions: 212, recent_from: 2025,
  topics: [
    { label: 'Cooking', words: ['soup', 'lemon'], share: 0.3, trend: 'rising', by_year: { 2022: 4, 2023: 6, 2024: 9, 2025: 14 } },
    { label: 'Trains', words: ['route', 'canal'], share: 0.22, trend: 'steady', by_year: { 2022: 8, 2023: 8, 2024: 7, 2025: 8 } },
    { label: 'Gardens', words: ['basil', 'seeds'], share: 0.2, trend: 'rising', by_year: { 2022: 1, 2023: 3, 2024: 6, 2025: 12 } },
    { label: 'Maps', words: ['atlas'], share: 0.1, trend: 'faded', by_year: { 2022: 9, 2023: 6, 2024: 3, 2025: 1 } },
  ],
}

export interface FixtureOptions { count?: number; deletable?: boolean; failCapture?: boolean; empty?: boolean }

export function fixtureRecallPort(o: FixtureOptions = {}): RecallPort {
  const count = o.count ?? 40
  let galaxy = fixtureGalaxy(count)
  if (o.empty) galaxy = { ...galaxy, nodes: [], edges: [], sources: {}, counts: { memories: 0, memories_shown: 0, people: 0, beliefs: 0, topics: 0, edges: 0 } }
  const detailOf = (id: string): NodeDetail => {
    const n = galaxy.nodes.find((x) => x.id === id)
    if (!n) throw new Error('no such node in the fixture')
    return { id, kind: n.kind, label: n.label, time: n.time, source: n.source, snippet: `${n.label}. A fixture line, invented for the picture; it stands for nothing JARVIS holds.`, date: n.time, status: n.status, links: galaxy.edges.filter(([a, b]) => galaxy.nodes[a]?.id === id || galaxy.nodes[b]?.id === id).slice(0, 3).map(([a, b]) => { const o2 = galaxy.nodes[galaxy.nodes[a].id === id ? b : a]; return { id: o2.id, kind: o2.kind, label: o2.label } }) }
  }
  return {
    simulated: true,
    stats: async () => fixtureStats(galaxy.counts.memories),
    galaxy: async () => galaxy,
    detail: async (id) => detailOf(id),
    search: async (q): Promise<SearchRes> => {
      const mem = galaxy.nodes.filter((n) => n.kind === 'memory')
      const hits = mem.slice(0, 4).filter((_, i) => q.trim().length > 0 && i < 3)
      return {
        query: q, took_ms: 41,
        excerpts: hits.length ? [{ date: '12 Mar 2026', who: 'Fixture thread', messages: [{ speaker: 'Fixture', text: `Did we settle ${q.split(/\s+/)[0] ?? 'it'}?`, me: false }, { speaker: 'You', text: hits[0].label, me: true }] }] : [],
        facts: hits.map((h, i) => ({ text: h.label, source: i === 2 ? 'voice_interaction' : 'note:fixture', distance: 0.18 + i * 0.12 })),
      }
    },
    capture: async (text) => {
      if (o.failCapture) throw new Error('the store did not answer')
      const i = galaxy.nodes.length
      galaxy = { ...galaxy, counts: { ...galaxy.counts, memories: galaxy.counts.memories + 1, memories_shown: galaxy.counts.memories_shown + 1 }, nodes: [...galaxy.nodes, { id: `m${i}x`, kind: 'memory', label: text, source: 'authored', time: new Date(NOW_MS).toISOString(), importance: 0.9, x: 0, y: 0, z: 0 }] }
      return { added: true }
    },
    fix: async () => ({ added: true }),
    taste: async () => fixtureTaste,
    remove: o.deletable ? async (ids) => { galaxy = { ...galaxy, counts: { ...galaxy.counts, memories: galaxy.counts.memories - ids.length, memories_shown: galaxy.counts.memories_shown - ids.length }, nodes: galaxy.nodes.filter((n) => !ids.includes(n.id)) } } : null,
  }
}

export const fixtureBeliefs: Belief[] = [
  { id: 'fb1', claim: 'you keep your notes in the green folder', category: 'habit', era: 'now', confidence: 0.82, support: 4, source: 'claude chats' },
  { id: 'fb2', claim: 'you water the basil every second morning', category: 'routine', era: 'recent', confidence: 0.64, support: 2, source: 'notes' },
  { id: 'fb3', claim: 'you prefer the long route on slow days', category: 'preference', era: 'now', confidence: 0.55, support: 1, source: 'voice' },
]
export const fixtureLearned: LearnedQueue = {
  pending: 2, kept: 5, wrong: 1,
  items: [
    { id: 'fl1', kind: 'preference', text: 'Tea is better with the lid left on', confidence: 0.7, support: 2, first_seen: NOW_S - 3 * 3600, last_seen: NOW_S - 3600, by: null, evidence: 2 },
    { id: 'fl2', kind: 'correction', text: 'The library books are due on the twelfth, not the fifteenth', confidence: 0.9, support: 1, first_seen: NOW_S - 26 * 3600, last_seen: NOW_S - 26 * 3600, by: 'owner', evidence: 1 },
  ],
}
export const fixtureConfirmed: Belief[] = [
  { id: 'fc1', claim: 'you take the long way home on Fridays', category: 'routine', era: 'now', confidence: 1, support: 6, source: 'confirmed by you' },
  { id: 'fc2', claim: 'you prefer tea without sugar', category: 'preference', era: 'now', confidence: 1, support: 3, source: 'confirmed by you' },
]
export function fixtureBeliefPort(): BeliefPort {
  return { simulated: true, questions: async () => fixtureBeliefs, confirmed: async () => fixtureConfirmed, answer: async () => undefined, learned: async () => fixtureLearned, review: async () => undefined }
}

const person = (name: string, monthsBack: number | null, msgs: number): Person => ({
  name, closeness: 50, rank: 1, span_days: 900 + msgs, n_msgs: msgs, reciprocity: 0.5, calls: msgs % 7, share_ratio: 0.1, why: '',
  last_iso: monthsBack === null ? null : new Date(NOW_MS - monthsBack * 30 * 86_400_000).toISOString(),
})
export const fixturePeople: Person[] = [
  person('Fern Calloway', 14, 410), person('Alder Finch', 1, 3120), person('Elm Rowan', 5, 120), person('Birch Moore', 0, 1802), person('Dune Harker', null, 66), person('Cedar Vale', 20, 905),
  person('Hazel Orme', 2, 77), person('Ivy Thorne', 9, 244), person('Juniper Wells', 3, 531), person('Kestrel Dunn', 28, 38),
]
export const fixturePeoplePort: PeoplePort = { simulated: true, people: async () => fixturePeople }

export const fixtureReminders: RemindersView = {
  now: NOW_S, say: '', voice: false, recent: [],
  items: [
    { id: 'r1', kind: 'reminder', text: 'call the council about the gate', due: NOW_S + 18 * 60, repeat: null, interval_min: null, action: null, status: 'pending', fired: [], last_fired: null, acked: null },
    { id: 'r2', kind: 'timer', text: 'tea', due: NOW_S + 95 * 60, repeat: null, interval_min: null, action: null, status: 'pending', fired: [], last_fired: null, acked: null },
  ],
}
export const fixtureRemindersPort: RemindersPort = { simulated: true, view: async () => fixtureReminders, add: async (p) => ({ say: `Fixture: would remember "${p}"` }), cancel: async () => undefined }

const src = (id: ExportSource['id'], name: string, state: ExportSource['state'], extra: Partial<ExportSource> = {}): ExportSource => ({
  id, name, url: '', ask: id === 'instagram' ? 'your messages as JSON' : id === 'chatgpt' ? 'the data export of your account' : 'your streaming history', wait: 'it can take a day', memory: 'read into memory when imported',
  files: [], downloads: [], job: null, state, ...extra,
})
export const fixtureSources: ExportSource[] = [
  src('instagram', 'Messages archive', 'imported', { files: [{ name: 'fixture-messages.zip', size: 48_000_000, mtime: NOW_S - 86400 * 6, folder: false, read: { ok: true, threads: 61 } as never }] }),
  src('chatgpt', 'Chat export', 'arrived', { downloads: [{ path: 'C:\\fixture\\chat.zip', name: 'fixture-chat.zip', size: 12_000_000, mtime: NOW_S - 3600 }] }),
  src('spotify', 'Listening history', 'not_requested'),
  src('ytmusic', 'Music library', 'not_requested'),
]
export const fixtureSourcesPort: SourcesPort = {
  simulated: true, list: async () => fixtureSources, request: async () => undefined, importPath: async () => undefined, upload: async () => undefined, open: async () => undefined,
}
export const fixtureReviewPort: ReviewPort = {
  summary: async () => ({ turns: 12, flags: { wrong: 2, slow: 1, good: 6 } }),
  exportReview: async () => ({ name: 'review-fixture.md', summary: { turns: 12, flags: { wrong: 2, slow: 1, good: 6 } } }),
  openFolder: async () => undefined,
}
