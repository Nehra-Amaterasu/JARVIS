/**
 * Tree v2: no-overlap layout for the real skills bank and five fictional life trees,
 * spatial arrow keys, the life-node panel (proof meter, evidence, URL form for link
 * nodes only), the switcher, and in-app links. Fictional content only.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../lib/store'
import { loadBank } from '../germoney/data/bank'
import { layoutTree } from '../germoney/game/tree'
import { LifePanel } from '../germoney/tree/LifePanel'
import { checkLayout, LABEL_W, MAX_LINES, textWidth, wrapLines } from '../germoney/tree/geometry'
import { followLink, parseTrees, toBank, type LifeNode, type LifeTree } from '../germoney/tree/lifeTrees'
import { spatialNeighbour } from '../germoney/tree/nav'
import { TreeSwitcher } from '../germoney/tree/TreeSwitcher'
import { useStudyNode } from '../germoney/pages/Study'

const node = (id: string, tier: number, prereqs: string[] = [], over: Partial<LifeNode> = {}): LifeNode => ({
  id, name: `Node ${id}`, tier, prereqs, outcomes: ['Do the thing'], status: 'available',
  proof: { kind: 'github_days', need: 5, have: 2, unit: 'days', text: 'Counted from commits.', measured: true }, evidence: [], links: [], ...over,
})
const tree = (id: string, nodes: LifeNode[]): LifeTree => ({ id, name: id.toUpperCase(), about: 'about', progress: { mastered: 0, total: nodes.length }, nodes })

/** Five fictional trees, wide rows and long names on purpose. */
const FICTIONAL: LifeTree[] = ['money', 'career', 'insta', 'linkedin', 'github'].map((t) => tree(t, [
  node(`${t}.a`, 0, [], { name: 'Open a savings account and automate a monthly transfer' }),
  node(`${t}.b`, 0, [], { name: 'Supercalifragilisticexpialidocious-profile-readme' }),
  node(`${t}.c`, 0), node(`${t}.d`, 0), node(`${t}.e`, 0), node(`${t}.f`, 0),
  node(`${t}.g`, 1, [`${t}.a`, `${t}.b`]), node(`${t}.h`, 1, [`${t}.c`]), node(`${t}.i`, 1, [`${t}.d`, `${t}.e`, `${t}.f`]),
  node(`${t}.j`, 2, [`${t}.g`, `${t}.h`, `${t}.i`], { name: 'Ship a pinned project with a README, a demo and a write-up' }),
]))

describe('layout: no overlap, labels fit', () => {
  it('the real skills bank is clean', () => {
    const bank = loadBank()
    if (!bank.order.length) return
    expect(checkLayout(layoutTree(bank))).toEqual([])
  })
  it('five fictional life trees are clean', () => {
    for (const t of FICTIONAL) expect(checkLayout(layoutTree(toBank(t))), t.id).toEqual([])
  })
  it('wrapLines: at most 3 lines, each within the label box, long words broken, overflow ellipsised', () => {
    for (const name of ['Short', 'A fairly long node name that goes on and on and on and on and on', 'Supercalifragilisticexpialidocious-extraordinarily-long', '']) {
      const ls = wrapLines(name)
      expect(ls.length).toBeGreaterThan(0)
      expect(ls.length).toBeLessThanOrEqual(MAX_LINES)
      for (const l of ls) expect(textWidth(l)).toBeLessThanOrEqual(LABEL_W)
    }
    expect(wrapLines('A fairly long node name that goes on and on and on and on and on').at(-1)).toMatch(/…$/)
  })
  it('the checker does catch an overlap', () => {
    const L = layoutTree(toBank(FICTIONAL[0]))
    L.nodes[1].x = L.nodes[0].x + 20
    L.nodes[1].y = L.nodes[0].y
    expect(checkLayout(L).some((p) => p.startsWith('overlap'))).toBe(true)
  })
})

describe('arrow keys', () => {
  // tier 0:  a  b  c      tier 1:  d (x≈ a..b)   e (above c)
  const t = tree('x', [node('a', 0), node('b', 0), node('c', 0), node('d', 1, ['a', 'b']), node('e', 1, ['c'])])
  const L = layoutTree(toBank(t))
  it('left/right walk the same tier, and stop at the ends', () => {
    const row = L.nodes.filter((p) => p.y === L.byId.a.y).sort((p, q) => p.x - q.x).map((p) => p.id)
    expect(row).toHaveLength(3)
    expect(spatialNeighbour(L, row[0], 'right')).toBe(row[1])
    expect(spatialNeighbour(L, row[1], 'left')).toBe(row[0])
    expect(spatialNeighbour(L, row[2], 'right')).toBeNull()
  })
  it('up/down go to the next tier, nearest by x', () => {
    const up = spatialNeighbour(L, 'c', 'up')
    expect(L.byId[up!].y).toBeLessThan(L.byId.c.y)
    const best = ['d', 'e'].sort((p, q) => Math.abs(L.byId[p].x - L.byId.c.x) - Math.abs(L.byId[q].x - L.byId.c.x))[0]
    expect(up).toBe(best)
    expect(spatialNeighbour(L, 'd', 'down')).toBeTruthy()
    expect(L.byId[spatialNeighbour(L, 'd', 'down')!].y).toBeGreaterThan(L.byId.d.y)
    expect(spatialNeighbour(L, 'd', 'up')).toBeNull()
  })
})

let host: HTMLDivElement
let root: Root
let calls: { url: string; body: string }[]
const render = async (el: ReturnType<typeof createElement>) => { await act(async () => { root.render(el) }) }
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); calls = []
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

const linkNode = node('gh.readme', 0, [], {
  status: 'in_progress', proof: { kind: 'link', need: 2, have: 1, unit: 'links', text: 'Paste the link.', measured: false },
  evidence: [{ date: '2026-10-27', text: 'Profile README live', url: 'https://example.com/me' }],
  links: [{ kind: 'node', target: 'gh.pinned', label: 'Pinned repos' }, { kind: 'page', target: 'study', label: 'Study' }, { kind: 'url', target: 'https://example.com/docs', label: 'Docs' }],
})
const pinned = node('gh.pinned', 1, ['gh.readme'], { status: 'locked' })
const GH = tree('github', [linkNode, pinned])

describe('<LifePanel />', () => {
  const panel = (t: LifeTree, id: string, onTrees = vi.fn()) => createElement(LifePanel, { tree: t, id, onPick: vi.fn(), onFocus: vi.fn(), onClose: vi.fn(), onTrees })
  const tab = (name: string) => [...host.querySelectorAll('.tp-tab')].find((b) => b.textContent!.startsWith(name)) as HTMLButtonElement

  it('shows the proof meter and, on the Proof tab, the evidence and the URL form (link nodes only) that POSTs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ status: 'ok', trees: [{ ...GH, progress: { mastered: 1, total: 2 } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const onTrees = vi.fn()
    await render(panel(GH, 'gh.readme', onTrees))
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('1')
    expect(host.textContent).toContain('1 / 2 links')
    await act(async () => { tab('Proof').click() })
    expect(host.textContent).toContain('Profile README live')
    const form = host.querySelector('form')!
    expect(form).toBeTruthy()
    const set = (sel: string, v: string) => {
      const el = host.querySelector(sel) as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => { set('[aria-label="Proof URL"]', 'https://github.com/me/me'); set('[aria-label="Note"]', 'my readme') })
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(calls[0].url).toBe('/api/mission/trees/github/gh.readme/proof')
    expect(JSON.parse(calls[0].body)).toEqual({ url: 'https://github.com/me/me', note: 'my readme' })
    expect(onTrees).toHaveBeenCalledTimes(1)
  })
  it('a measured node shows what is counted and has no form and no mark-done button', async () => {
    const m = node('gh.days', 0, [], { proof: { kind: 'github_days', need: 5, have: 2, unit: 'days', text: 'Counted from commits.', measured: true } })
    await render(panel(tree('github', [m]), 'gh.days'))
    await act(async () => { tab('Proof').click() })
    expect(host.querySelector('form')).toBeNull()
    expect(host.textContent).toContain('2 / 5 days')
    expect(host.textContent).toContain('3 to go')
    expect(host.textContent).not.toMatch(/mark (done|mastered)/i)
  })
})

describe('<TreeSwitcher />', () => {
  it('lists Skills plus every fetched tree and reports the pick', async () => {
    const onPick = vi.fn()
    await render(createElement(TreeSwitcher, { trees: FICTIONAL, active: 'skills', onPick }))
    const tabs = [...host.querySelectorAll('[role="tab"]')]
    expect(tabs.map((b) => b.getAttribute('data-tree'))).toEqual(['skills', 'money', 'career', 'insta', 'linkedin', 'github'])
    expect(tabs[0].textContent).toBe('Skills')
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    await act(async () => { (tabs[5] as HTMLButtonElement).click() })
    expect(onPick).toHaveBeenCalledWith('github')
  })
  it('with no trees, just Skills', async () => {
    await render(createElement(TreeSwitcher, { trees: [], active: 'skills', onPick: vi.fn() }))
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
  })
})

describe('links stay in the app', () => {
  const win = window as unknown as { pywebview?: unknown }
  afterEach(() => { delete win.pywebview; vi.restoreAllMocks() })
  it('a node link selects that node', () => {
    const selectNode = vi.fn()
    followLink({ kind: 'node', target: 'gh.pinned', label: '' }, { selectNode })
    expect(selectNode).toHaveBeenCalledWith('gh.pinned')
  })
  it('a page link calls setTab with the right tab (and sets the study node)', () => {
    const setTab = vi.spyOn(useStore.getState(), 'setTab').mockImplementation(() => {})
    useStore.setState({ setTab })
    for (const [target, tab] of [['today', 'mission'], ['study', 'schedule'], ['career', 'campaign'], ['life', 'quests'], ['status', 'status']] as const) {
      followLink({ kind: 'page', target, label: '' }, { selectNode: vi.fn(), studyNode: 'n1' })
      expect(setTab).toHaveBeenLastCalledWith(tab)
    }
    expect(useStudyNode.getState().id).toBe('n1')
    followLink({ kind: 'page', target: 'nonsense', label: '' }, { selectNode: vi.fn() })
    expect(setTab).toHaveBeenCalledTimes(5)
  })
  it('a url link uses pywebview open_url when present, else window.open', () => {
    const open_url = vi.fn()
    win.pywebview = { api: { open_url } }
    followLink({ kind: 'url', target: 'https://example.com/a', label: '' }, { selectNode: vi.fn() })
    expect(open_url).toHaveBeenCalledWith('https://example.com/a')
    delete win.pywebview
    const wo = vi.spyOn(window, 'open').mockImplementation(() => null)
    followLink({ kind: 'url', target: 'https://example.com/b', label: '' }, { selectNode: vi.fn() })
    expect(wo).toHaveBeenCalledWith('https://example.com/b', '_blank', 'noopener')
    followLink({ kind: 'url', target: 'javascript:alert(1)', label: '' }, { selectNode: vi.fn() })
    expect(wo).toHaveBeenCalledTimes(1)
  })
})

describe('parseTrees', () => {
  it('survives garbage and keeps good trees', () => {
    expect(parseTrees(null)).toEqual([])
    expect(parseTrees({ trees: [{ nope: 1 }, { id: 't', nodes: [{ id: 'a', tier: 0, status: 'weird', proof: { kind: 'link', need: 1, have: 0 } }, null] }] })).toMatchObject([{ id: 't', nodes: [{ id: 'a', status: 'locked', proof: { measured: false } }] }])
  })
})
