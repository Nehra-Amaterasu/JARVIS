// Chunk 10: the Tree workspace (plan 8.1 "Tree"), Sharpen and De-master on the page, and the glide loop.
// Fictional data for life trees; the real skill bank for skill nodes (ids are read from it, never typed).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { WW_DIR, parseCss, read } from './_css'
import { loadBank } from '../../germoney/data/bank'
import { usePlan } from '../../germoney/game/plan'
import { allStatuses, layoutTree } from '../../germoney/game/tree'
import { checkLayout } from '../../germoney/tree/geometry'
import { toBank, type LifeNode, type LifeTree } from '../../germoney/tree/lifeTrees'
import { useStudyNode } from '../../germoney/pages/Study'
import { resetFrameStore, useFrame } from '../../ww/frame/frameStore'
import { BackChip } from '../../ww/frame/BackChip'
import { workspaceMemory } from '../../ww/frame/workspaceMemory'
import { COUNTED, Segmented, PrimaryOwner, clearCoachMemory, Meter } from '../../ww/kit'
import { SkillInspector, studyNode } from '../../ww/tree/Inspector'
import { TreeCanvas, branchChips, nextNode } from '../../ww/tree/TreeCanvas'
import { WwTreePage } from '../../ww/tree/TreeWorkspace'
import { decodeView, encodeView } from '../../ww/tree/scene'
import type { Mastery } from '../../ww/tree/mastery'

const bank = loadBank()
const statuses = allStatuses(bank, {})
const FIRST = bank.order[0]
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

const masteryOf = (id: string, over: Partial<Mastery['sharpen']> = {}, dm: Partial<Mastery['demaster']> = {}): Mastery => ({
  node: id, name: id, status: 'mastered', gate_bank: 0,
  sharpen: { allowed: false, blocker: 'Sharpen needs one GATE-tier question solved on this node. No GATE bank yet: the question harvester has fetched none.',
    round: 0, active: false, check: null, next: null, solved: [], spare: 0, reproved: 0, candidates: [], ...over },
  demaster: { allowed: true, blocker: null, blockers: [], first: [], xp_back: 50, ...dm },
})

const calls: { url: string; method: string }[] = []
function stubFetch(mastery: (id: string) => Mastery = (id) => masteryOf(id), extra: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    const u = String(url)
    let body: unknown = {}
    const m = /\/api\/mission\/mastery\/([^/]+)(?:\/(.+))?$/.exec(u)
    if (m && !m[2]) body = mastery(decodeURIComponent(m[1]))
    else if (m) body = { ok: true, say: `${m[2]} done` }
    else if (u.includes('/api/mission/trees')) body = { status: 'ok', trees: [] }
    for (const [k, v] of Object.entries(extra)) if (u.includes(k)) body = v
    return { ok: true, status: 200, statusText: 'OK', json: async () => body }
  }))
}

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  workspaceMemory.clear()
  resetFrameStore()
  clearCoachMemory()
  try { localStorage.clear() } catch { /* none */ }
  usePlan.setState({ state: { statuses: { ...statuses }, nodes: {}, contracts: {}, rotation: {}, wip_cap: 3, certs: {} } as never })
})
afterEach(() => {
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

const node = (id: string, tier: number, prereqs: string[] = [], over: Partial<LifeNode> = {}): LifeNode => ({
  id, name: `Node ${id}`, tier, prereqs, outcomes: [], status: 'available',
  proof: { kind: 'github_days', need: 5, have: 2, unit: 'days', text: '', measured: true }, evidence: [], links: [], ...over,
})
/** The largest tree: 12 branches of 5 nodes in 3 tiers, long names on purpose. */
const BIG: LifeTree = {
  id: 'big', name: 'BIG', about: '', progress: { mastered: 0, total: 60 },
  nodes: Array.from({ length: 12 }, (_, b) => [
    node(`b${b}.a`, 0, [], { name: `Branch ${b} opening node with a rather long name` }),
    node(`b${b}.b`, 0), node(`b${b}.c`, 1, [`b${b}.a`]), node(`b${b}.d`, 1, [`b${b}.b`]), node(`b${b}.e`, 2, [`b${b}.c`, `b${b}.d`]),
  ]).flat().map((n, i) => ({ ...n, branch: `branch_${Math.floor(i / 5)}` })) as LifeNode[],
}
const bigBank = () => {
  const b = toBank(BIG)
  b.order.forEach((id, i) => { b.nodes[id] = { ...b.nodes[id], branch: `branch_${Math.floor(i / 5)}` } })
  return b
}

const canvas = (over: Partial<Parameters<typeof TreeCanvas>[0]> = {}) => (
  <PrimaryOwner>
    <TreeCanvas treeId="skills" bank={bank} status={statuses} career={null} docked={false} skills stats="x nodes"
      switcher={<Segmented label="Which tree" value="skills" onChange={() => {}} options={[{ id: 'skills', label: 'Skills 0/4' }, { id: 'money', label: 'Money 1/5' }]} />}
      panel={(p) => <SkillInspector id={p.id} statuses={statuses} onPick={p.pick} onFocus={p.focus} onClose={p.close} />} {...over} />
  </PrimaryOwner>
)
const clickNode = (id: string) => act(() => void document.querySelector(`.tree-node[data-id="${id}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))

describe('the toolbar', () => {
  it('every control has a name and is a kit control of at least 36 px by class; the switcher shows tree names with counts', () => {
    stubFetch()
    m = mount(canvas())
    const bar = document.querySelector('[role="toolbar"]')!
    const controls = [...bar.querySelectorAll('button')]
    expect(controls.length).toBeGreaterThanOrEqual(7)
    for (const b of controls) {
      const name = b.getAttribute('aria-label') ?? b.textContent?.trim()
      expect(name, b.outerHTML).toBeTruthy()
      const sized = b.classList.contains('ww-btn') || b.classList.contains('ww-seg-opt') || b.classList.contains('ww-chip') || b.classList.contains('ww-tree-result')
      expect(sized, `${name} is not on a kit class`).toBe(true)
      if (b.classList.contains('ww-btn')) expect(['sm', 'md', 'lg']).toContain(b.getAttribute('data-size'))
    }
    const opts = [...bar.querySelectorAll('[role="radio"]')].map((o) => o.textContent)
    expect(opts).toEqual(['Skills 0/4', 'Money 1/5'])
  })
  it('the switcher offers Whole me as a disabled option with the reason, and the sentence is the roadmap one', () => {
    stubFetch()
    const trees: LifeTree[] = []
    m = mount(<PrimaryOwner><WwTreePage /></PrimaryOwner>)
    expect(trees).toHaveLength(0)
    const whole = [...document.querySelectorAll('[role="radio"]')].find((o) => o.textContent === 'Whole me')!
    expect(whole.getAttribute('aria-disabled')).toBe('true')
    expect(whole.getAttribute('title')).toContain('One canvas for all six trees is not built. Each tree opens on its own for now.')
  })
})

describe('the inspector and the primary', () => {
  it('selecting a node opens the inspector with Study this node as the one primary; with none selected the primary is in the toolbar and targets NEXT', async () => {
    stubFetch()
    m = mount(canvas())
    const tool = document.querySelector('[role="toolbar"] [data-primary="true"]')
    expect(tool?.textContent).toBe('Study this node')
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1)
    const next = nextNode(layoutTree(bank), statuses)!
    act(() => void (tool as HTMLElement).click())
    expect(useStudyNode.getState().id).toBe(next)
    const open = bank.order.find((id) => statuses[id] !== 'locked')!
    await clickNode(open)
    await flush()
    const insp = document.querySelector('.ww-insp')!
    expect(insp.getAttribute('data-node')).toBe(open)
    expect(insp.querySelector('[data-primary="true"]')?.textContent).toBe('Study this node')
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1)
    expect(document.querySelector('[role="toolbar"] [data-primary="true"]')).toBeNull()
  })
  it('Study this node switches to Study and leaves the Back chip (Back to Tree)', async () => {
    stubFetch()
    useFrame.getState().select('tree')
    m = mount(<><BackChip />{canvas()}</>)
    const open = bank.order.find((id) => statuses[id] !== 'locked')!
    await clickNode(open)
    await flush()
    act(() => void (document.querySelector('.ww-insp [data-primary="true"]') as HTMLElement).click())
    await flush()
    const f = useFrame.getState()
    expect(f.ws).toBe('study')
    expect(f.back?.ws).toBe('tree')
    expect(useStudyNode.getState().id).toBe(open)
    expect(document.querySelector('.ww-back')?.textContent).toContain('Back to Tree')
    act(() => studyNode(FIRST))
    expect(useStudyNode.getState().id).toBe(FIRST)
  })
})

describe('Sharpen and De-master', () => {
  it('Sharpen is aria-disabled and prints the SERVER sentence while there is no GATE bank', async () => {
    stubFetch()
    m = mount(<PrimaryOwner><SkillInspector id={FIRST} statuses={{ ...statuses, [FIRST]: 'mastered' }} onPick={() => {}} onFocus={() => {}} onClose={() => {}} /></PrimaryOwner>)
    await flush()
    const sharpen = [...document.querySelectorAll('.ww-mastery button')].find((b) => b.textContent?.includes('Sharpen'))!
    expect(sharpen.getAttribute('aria-disabled')).toBe('true')
    const reason = document.getElementById(sharpen.getAttribute('aria-describedby')!)!
    expect(reason.textContent).toBe('Sharpen needs one GATE-tier question solved on this node. No GATE bank yet: the question harvester has fetched none.')
    expect(calls.filter((c) => c.url.includes('/mastery/') && c.method === 'POST')).toEqual([])
    act(() => void (sharpen as HTMLElement).click())
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])   // a refused press sends nothing
  })
  it('De-master is a press-and-hold and prints the nodes the server says block it', async () => {
    stubFetch((id) => masteryOf(id, {}, {
      allowed: false, blocker: 'Child node is above it and is mastered or in progress. De-master Child node first.',
      blockers: [{ id: 'kid', name: 'Child node', status: 'mastered', distance: 1, now: true }], first: ['kid'],
    }))
    m = mount(<PrimaryOwner><SkillInspector id={FIRST} statuses={{ ...statuses, [FIRST]: 'mastered' }} onPick={() => {}} onFocus={() => {}} onClose={() => {}} /></PrimaryOwner>)
    await flush()
    const hold = document.querySelector('.ww-mastery .ww-hold')!
    expect(hold.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelector('.ww-mastery')!.textContent).toContain('De-master Child node first.')
    expect([...document.querySelectorAll('.ww-mastery .ww-chip')].map((c) => c.textContent)).toContain('Child node')
  })
  it('an allowed round asks the server, and an open round lists the harder check', async () => {
    const sent: string[] = []
    stubFetch((id) => masteryOf(id, {
      allowed: false, blocker: 'A sharpen round is already open on this node. Finish it first.', active: true, round: 1,
      check: { round: 1, rule: '', items: [{ contract: 'c1', title: 'Redo the contract', minutes: 40, cap_minutes: 30, success_check: 'x', harder: 'Cold: ...' }] },
    }))
    m = mount(<PrimaryOwner><SkillInspector id={FIRST} statuses={{ ...statuses, [FIRST]: 'mastered' }} onPick={() => {}} onFocus={() => {}} onClose={() => {}} /></PrimaryOwner>)
    await flush()
    expect(document.querySelector('.ww-sharpen')!.textContent).toContain('Redo the contract: 30 min, cold (first time 40)')
    const done = [...document.querySelectorAll('.ww-sharpen button')].find((b) => b.textContent === 'Mark re-proved') as HTMLElement
    act(() => void done.click())
    await flush()
    sent.push(...calls.filter((c) => c.method === 'POST').map((c) => c.url))
    expect(sent.some((u) => u.endsWith('/sharpen-done'))).toBe(true)
  })
  it('if the server cannot be asked the page offers nothing and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    m = mount(<PrimaryOwner><SkillInspector id={FIRST} statuses={statuses} onPick={() => {}} onFocus={() => {}} onClose={() => {}} /></PrimaryOwner>)
    await flush()
    expect(document.querySelector('[data-mastery="offline"]')!.textContent).toContain('The server could not be asked')
  })
})

describe('glass and opacity', () => {
  const css = read(join(WW_DIR, 'tree/tree.css'))
  const rules = parseCss(css).rules
  const decl = (sel: string, k: string) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.decls[k]).find(Boolean)
  it('the inspector body is an opaque surface token with a 1 px edge; the toolbar is flat; nothing blurs', () => {
    expect(decl('.ww-insp', 'background')).toBe('var(--surface-2)')
    expect(decl('.ww-insp', 'border')).toMatch(/^1px solid/)
    expect(decl('.ww-tree-bar', 'background')).toBe('transparent')
    expect(css).not.toMatch(/backdrop-filter|rgba?\(|opacity\s*:/)
  })
  it('the tab strip and the toolbar never carry the glass attribute', () => {
    stubFetch()
    m = mount(canvas())
    expect(document.querySelector('[data-glass]')).toBeNull()
  })
})

describe('first visit, branch chips, memory', () => {
  it('the coach mark shows once, dismisses in one tap and does not come back', () => {
    stubFetch()
    m = mount(canvas())
    expect(document.querySelectorAll('[data-coach="tree-first-visit"]')).toHaveLength(1)
    act(() => void (document.querySelector('[data-coach="tree-first-visit"] button') as HTMLElement).click())
    expect(document.querySelector('[data-coach="tree-first-visit"]')).toBeNull()
    m.unmount()
    m = mount(canvas())
    expect(document.querySelector('[data-coach="tree-first-visit"]')).toBeNull()
  })
  it('labelled branch chips exist, one per branch with its count, and a chip is a control', () => {
    stubFetch()
    m = mount(canvas())
    const chips = [...document.querySelectorAll('[aria-label="Branches"] .ww-chip')]
    const expected = branchChips(layoutTree(bank), statuses)
    expect(chips.map((c) => c.textContent)).toEqual(expected.map((c) => `${c.label} ${c.mastered}/${c.total}`))
    expect(chips.every((c) => c.tagName === 'BUTTON')).toBe(true)
  })
  it('Fit on the largest tree renders a chip for every branch and no label overlaps (TREE-08)', () => {
    stubFetch()
    const b = bigBank()
    const st = Object.fromEntries(b.order.map((id) => [id, 'available'])) as typeof statuses
    expect(checkLayout(layoutTree(b))).toEqual([])
    m = mount(canvas({ treeId: 'big', bank: b, status: st, skills: false }))
    const chips = document.querySelectorAll('[aria-label="Branches"] .ww-chip')
    expect(chips).toHaveLength(12)
    // the SVG captions hide when the labels do (CSS), so at Fit the chips are the only branch names
    expect(read(join(WW_DIR, 'tree/tree.css'))).toMatch(/lod-far \.tree-branch\s*\{\s*display:\s*none/)
  })
  it('switching trees and back restores each tree\'s selection and view (TREE-06)', async () => {
    stubFetch()
    const open = bank.order.find((id) => statuses[id] !== 'locked')!
    m = mount(canvas({ treeId: 'one' }))
    await clickNode(open)
    expect(workspaceMemory.tree('one').selection).toBe(open)
    m.unmount()
    m = mount(canvas({ treeId: 'two' }))
    expect(document.querySelector('.ww-insp')).toBeNull()      // another tree: nothing remembered
    m.unmount()
    workspaceMemory.setTree('one', { view: encodeView({ x: 120, y: -340, k: 1.25 }) })
    m = mount(canvas({ treeId: 'one' }))
    await flush()
    expect(document.querySelector('.ww-insp')?.getAttribute('data-node')).toBe(open)
    expect(decodeView(workspaceMemory.tree('one').view)).toEqual({ x: 120, y: -340, k: 1.25 })
  })
  it('the view string round-trips and rejects garbage', () => {
    expect(decodeView(encodeView({ x: -5.4, y: 7.6, k: 0.5 }))).toEqual({ x: -5, y: 8, k: 0.5 })
    expect(decodeView('nope')).toBeNull()
    expect(decodeView('1,2,0')).toBeNull()
    expect(decodeView(undefined)).toBeNull()
  })
})

describe('the Meter', () => {
  it('at 0 paints a non-zero track and a zero tick (TREE-03)', () => {
    m = mount(<Meter value={0} label="0 of 3 contracts" reading={COUNTED} />)
    const el = document.querySelector('.ww-meter')!
    expect(el.getAttribute('data-known')).toBe('true')
    expect(el.getAttribute('aria-valuenow')).toBe('0')
    const data = read(join(WW_DIR, 'kit/data.css'))
    expect(data).toMatch(/\.ww-meter\s*\{[^}]*background:\s*var\(--surface-2\)/)
    expect(data).toMatch(/\.ww-meter::before\s*\{[^}]*inline-size:\s*2px/)
  })
})

const clock = { t: 1000 }
describe('the glide loop', () => {
  /** A rAF the test drives by hand, so "stops at rest" is a count, not a timing. */
  function fakeRaf() {
    const q = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { q.set(++id, cb); return id })
    vi.stubGlobal('cancelAnimationFrame', (i: number) => void q.delete(i))
    let ran = 0
    return {
      pending: () => q.size,
      ran: () => ran,
      step(ms = 16) {
        clock.t += ms                                  // the same clock performance.now() reads, as in a browser
        const batch = [...q.entries()]
        q.clear()
        for (const [, cb] of batch) { ran++; cb(clock.t) }
      },
    }
  }
  it('a throw glides for a few frames, then the loop is gone: 0 callbacks at rest', async () => {
    stubFetch()
    const raf = fakeRaf()
    const now = vi.spyOn(performance, 'now')
    clock.t = 1000
    now.mockImplementation(() => clock.t)
    m = mount(canvas({ treeId: 'glide' }))
    const stage = document.querySelector('.ww-tree-stage') as HTMLElement
    Object.defineProperty(stage, 'clientWidth', { value: 900, configurable: true })
    Object.defineProperty(stage, 'clientHeight', { value: 500, configurable: true })
    const svg = document.querySelector('.tree-svg') as SVGSVGElement
    svg.setPointerCapture = () => {}
    const ev = (type: string, x: number, y: number) => new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }) as MouseEvent & { pointerId?: number }
    const fire = (type: string, x: number, y: number) => {
      const e = ev(type, x, y)
      Object.defineProperty(e, 'pointerId', { value: 1 })
      svg.dispatchEvent(e)
    }
    // a fast drag: 4 px/ms for 80 ms, released inside the 80 ms window
    act(() => fire('pointerdown', 100, 100))
    for (let i = 1; i <= 5; i++) { clock.t += 16; act(() => fire('pointermove', 100 + i * 64, 100)) }
    expect(stage.getAttribute('data-moving')).toBe('true')
    act(() => fire('pointerup', 420, 100))
    let frames = 0
    while (raf.pending() > 0 && frames < 200) { act(() => raf.step()); frames++ }
    expect(frames).toBeGreaterThan(3)
    // inertia is 450 ms worst case (28 frames at 16 ms); this throw also leaves the bounds, so the 400 ms rubber-band return follows (25 more)
    expect(frames).toBeLessThanOrEqual(56)
    expect(stage.getAttribute('data-moving')).toBe('false')
    expect(Number(stage.getAttribute('data-frames'))).toBeGreaterThan(0)
    const settled = raf.ran()
    for (let i = 0; i < 20; i++) act(() => raf.step())
    expect(raf.ran()).toBe(settled)                            // nothing ran after rest
    now.mockRestore()
  })
  it('under reduced motion a release does not glide at all', () => {
    stubFetch()
    document.documentElement.setAttribute('data-motion', 'calm')
    const raf = fakeRaf()
    m = mount(canvas({ treeId: 'calm' }))
    const svg = document.querySelector('.tree-svg') as SVGSVGElement
    svg.setPointerCapture = () => {}
    const fire = (type: string, x: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, button: 0 })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      svg.dispatchEvent(e)
    }
    act(() => fire('pointerdown', 0))
    act(() => fire('pointermove', 200))
    act(() => fire('pointerup', 200))
    let frames = 0
    while (raf.pending() > 0 && frames < 20) { act(() => raf.step()); frames++ }
    expect(frames).toBeLessThanOrEqual(2)                      // the one paint of the drag itself
  })
})

describe('the existing tree stays', () => {
  it('the real bank still lays out clean', () => {
    if (bank.order.length) expect(checkLayout(layoutTree(bank))).toEqual([])
  })
  it('the workspace holds no h1 (the frame draws the one) and no scroll container of its own', () => {
    stubFetch()
    m = mount(<PrimaryOwner><WwTreePage /></PrimaryOwner>)
    expect(document.querySelector('h1')).toBeNull()
    const src = readFileSync(join(WW_DIR, 'tree/tree.css'), 'utf8')
    expect(src).not.toMatch(/\.ww-tree-page\s*\{[^}]*overflow:\s*(auto|scroll)/)
  })
})
