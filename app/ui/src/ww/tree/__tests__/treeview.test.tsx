// T01: the page. The Grove on the null adapter and on fixture rows, opening a tree and a node, the self-mark that can only draw
// CLAIMED, a deleted record that lowers the growth, and the honest states of the writing keys.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../__tests__/ww/_stubs'
import { createFixturePort, FIXTURE_NOW } from '../fixtures'
import { nullPort, type EvidenceRecord, type TreePort } from '../ports'
import { resetGroveSession, TreeView } from '../TreeView'
import { TREES } from '../model'

let m: ReturnType<typeof mount> | null = null
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
const q = (sel: string) => m!.container.querySelector<HTMLElement>(sel)
const qa = (sel: string) => [...m!.container.querySelectorAll<HTMLElement>(sel)]
const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })

beforeEach(() => {
  resetGroveSession()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { m?.unmount(); m = null; vi.unstubAllGlobals(); document.body.innerHTML = '' })

const open = async (port: TreePort & { all?: () => EvidenceRecord[] } = createFixturePort(), initial?: { tree?: string; node?: string }) => {
  m = mount(<TreeView port={port} now={FIXTURE_NOW} form="desk" initial={initial} />)
  await flush()
  return port
}

describe('the Grove', () => {
  it('on the null adapter: ten dashed seeds, WAITING with its reason, no number anywhere', async () => {
    await open(nullPort)
    const seeds = qa('.gr-seed')
    expect(seeds).toHaveLength(10)
    expect(seeds.every((s) => s.hasAttribute('data-dashed'))).toBe(true)
    expect(q('.gr-total')!.getAttribute('data-hollow')).toBe('true')
    expect(q('.gr-total')!.textContent).toBe('– –')
    expect(q('.tg')!.getAttribute('data-lamp')).toBe('waiting')
    expect(q('.tg-ledger')!.textContent).toMatch(/WAITING/)
    expect(q('.tg-ledger')!.textContent).toMatch(/No evidence store is connected/)
    expect(seeds.every((s) => /evidence not counted/.test(s.getAttribute('aria-label')!))).toBe(true)
  })
  it('on fixture rows: the total is drawn, with the SIMULATED word beside it', async () => {
    await open()
    expect(q('.gr-total')!.hasAttribute('data-hollow')).toBe(false)
    expect(Number(q('.gr-total')!.textContent)).toBeGreaterThan(0)
    expect(q('.gr .lw')!.textContent).toMatch(/SIMULATED/)
    expect(qa('.gr-seed').every((s) => !s.hasAttribute('data-dashed'))).toBe(true)
  })
  it('the seeds are one composite: one tab stop, arrows move round the ring, Home and End jump, a letter jumps to a name', async () => {
    await open()
    const seeds = () => qa('.gr-seed')
    expect(seeds().filter((s) => s.tabIndex === 0)).toHaveLength(1)
    act(() => seeds()[0].focus())
    key(seeds()[0], 'ArrowRight')
    expect(document.activeElement).toBe(seeds()[1])
    key(seeds()[1], 'ArrowLeft')
    expect(document.activeElement).toBe(seeds()[0])
    key(seeds()[0], 'ArrowLeft')
    expect(document.activeElement).toBe(seeds()[9])
    key(seeds()[9], 'Home')
    expect(document.activeElement).toBe(seeds()[0])
    key(seeds()[0], 'End')
    expect(document.activeElement).toBe(seeds()[9])
    key(seeds()[9], 'm')
    expect(document.activeElement).toBe(seeds()[6])   // Money
    expect(seeds().filter((s) => s.tabIndex === 0)).toHaveLength(1)
  })
  it('Enter on a seed opens that tree', async () => {
    await open()
    const seeds = qa('.gr-seed')
    act(() => seeds[2].focus())
    click(seeds[2])
    expect(q('.tg')!.getAttribute('data-scale')).toBe('2')
    expect(q('.tg-title')!.textContent).toMatch(/Languages/)
    expect(q('.ww-tree-stage .tree-node')).not.toBeNull()
  })
  it('Next opens the open node that has waited longest, in its tree', async () => {
    await open(nullPort)
    const next = qa('.ww-tree-bar button').find((b) => /^Next/.test(b.textContent ?? ''))!
    click(next)
    await flush()
    expect(q('.tg')!.getAttribute('data-scale')).toBe('3')
    expect(q('.ww-insp')).not.toBeNull()
    expect(q('.nd-name')!.textContent).toBe(TREES()[0].branches[0].nodes[0].name)
  })
})

describe('the node drawer', () => {
  const academic = TREES().find((t) => t.id === 'academic')!
  it('on the null adapter every writing key stays and says why it is off; nothing is invented', async () => {
    await open(nullPort, { tree: 'academic', node: academic.branches[0].nodes[0].id })
    const d = q('.nd')!
    expect(d.textContent).toMatch(/WAITING/)
    const keys = [...d.querySelectorAll<HTMLButtonElement>('button.ww-btn')].filter((b) => /Add evidence|Self-mark|10-minute drill/.test(b.textContent ?? ''))
    expect(keys.length).toBe(3)
    expect(keys.every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true)
    expect(d.textContent).toMatch(/OPEN/)
    expect(d.textContent).toMatch(/Nothing cites this node yet/)
  })
  it('a self-mark draws CLAIMED and never EVIDENCED', async () => {
    const port = await open(createFixturePort({ mode: 'empty' }), { tree: 'academic', node: academic.branches[0].nodes[0].id })
    expect(q('.nd')!.getAttribute('data-state')).toBe('open')
    const mark = qa('.nd button.ww-btn').find((b) => /Self-mark/.test(b.textContent ?? ''))!
    click(mark)
    await flush()
    expect(q('.nd')!.getAttribute('data-state')).toBe('claimed')
    expect(q('.nd-state')!.textContent).toMatch(/CLAIMED/)
    expect(q('.nd-state')!.textContent).not.toMatch(/EVIDENCED/)
    expect(port.all!().filter((r) => r.kind === 'self')).toHaveLength(1)
    expect(qa('.tree-node[data-state="evidenced"]')).toHaveLength(0)
    expect(q('.sn[data-id="' + academic.branches[0].nodes[0].id + '"]')!.getAttribute('data-state')).toBe('claimed')
  })
  it('the drawer types only attestable kinds, and a typed record can never draw EVIDENCED by itself', async () => {
    const port = await open(createFixturePort({ mode: 'empty' }), { tree: 'academic', node: academic.branches[0].nodes[0].id })
    click(qa('.nd button.ww-btn').find((b) => /Add evidence/.test(b.textContent ?? ''))!)
    const kinds = qa('.nd-kind').map((b) => b.textContent)
    expect(kinds).toEqual(['artefact', 'timed practice', 'witness note (reported)'])
    expect(q('.nd-kinds')!.getAttribute('role')).toBe('group')
    expect(qa('.nd-kind').every((b) => b.hasAttribute('aria-pressed'))).toBe(true)
    click(qa('.nd button.ww-btn').find((b) => /^Add artefact/.test(b.textContent ?? ''))!)
    await flush()
    expect(port.all!().map((r) => r.kind)).toEqual(['artefact'])
    expect(q('.nd')!.getAttribute('data-state')).toBe('progress')
  })
  it('Do next on a hard kind says where the record comes from and types nothing', async () => {
    const port = await open(createFixturePort({ mode: 'empty' }), { tree: 'academic', node: academic.branches[0].nodes[0].id })
    click(qa('.nd button.ww-btn').find((b) => /10-minute drill/.test(b.textContent ?? ''))!)
    await flush()
    expect(q('.nd-add')).toBeNull()
    expect(q('.nd-msg')!.textContent).toMatch(/recorded from Study/)
    expect(port.all!()).toHaveLength(0)
  })
  it('an empty evidence area names the ledger lamp state, not a fixed word', async () => {
    const port = createFixturePort({ mode: 'empty' })
    const bad = { ...port, read: async () => ({ state: 'fault' as const, reason: 'The evidence ledger did not answer.', records: [] }) }
    await open(bad, { tree: 'academic', node: academic.branches[0].nodes[0].id })
    expect(q('.nd-empty')!.textContent).toMatch(/^FAULT:/)
  })
  it('deleting a record lowers the growth (the spine and the count) on the next read', async () => {
    const port = await open(createFixturePort(), { tree: 'academic', node: academic.branches[0].nodes[2].id })
    const label = () => q('.tg-spine')!.getAttribute('aria-label')!
    const before = Number(/(\d+) of \d+ nodes evidenced/.exec(label())![1])
    expect(before).toBeGreaterThan(0)
    const del = qa('.nd-rec button.ww-btn')[0]
    click(del)            // arms
    click(qa('.nd-rec button.ww-btn')[0])   // confirms
    await flush()
    const after = Number(/(\d+) of \d+ nodes evidenced/.exec(label())![1])
    expect(after).toBe(before - 1)
    expect(port.all!().some((r) => r.deletedAt)).toBe(true)
  })
  it('Esc closes the drawer', async () => {
    await open(createFixturePort(), { tree: 'academic', node: academic.branches[0].nodes[0].id })
    key(q('.nd')!, 'Escape')
    await flush()
    expect(q('.nd')).toBeNull()
    expect(q('.tg')!.getAttribute('data-scale')).toBe('2')
  })
})

describe('one tree', () => {
  it('the stage is one tab stop; Enter on a node opens the drawer; Esc then goes back to the Grove', async () => {
    await open(createFixturePort(), { tree: 'academic' })
    const nodes = () => qa('.tg-svg [data-id]')
    expect(nodes().filter((n) => n.getAttribute('tabindex') === '0')).toHaveLength(1)
    const first = nodes().find((n) => n.getAttribute('data-tier'))!
    act(() => first.focus())
    key(first, 'Enter')
    await flush()
    expect(q('.nd')).not.toBeNull()
    key(q('.nd')!, 'Escape')
    await flush()
    key(q('.tg')!, 'Escape')
    await flush()
    expect(q('.tg')!.getAttribute('data-scale')).toBe('1')
  })
  it('the controls are real buttons with names (no drag-only control)', async () => {
    await open(createFixturePort(), { tree: 'academic' })
    const names = qa('.tg-controls button').map((b) => b.getAttribute('aria-label'))
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/Pan left/), expect.stringMatching(/Pan right/), expect.stringMatching(/Pan up/), expect.stringMatching(/Pan down/), expect.stringMatching(/Zoom in/), expect.stringMatching(/Zoom out/), expect.stringMatching(/Fit/)]))
  })
})
