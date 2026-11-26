// R6 (25 Nov): what the Tree's click fix rests on, without a browser. The browser half is e2e/tree-click.spec.ts.
import { afterEach, describe, expect, it } from 'vitest'
import { createRef } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { deriveTree } from '../ledger'
import { TREES, buildTree } from '../model'
import { TreeKey, TreeStage, hubName, type StageApi } from '../TreeStage'

const NOW = Date.UTC(2026, 10, 25)
let m: ReturnType<typeof mount> | null = null
afterEach(() => { m?.unmount(); m = null })

describe('branch plates always have a name', () => {
  it('every branch of every authored tree has a non-empty name (the data is not what left two plates empty)', () => {
    for (const t of TREES()) for (const b of t.branches) expect(b.name.trim().length, `${t.id}/${b.id}`).toBeGreaterThan(0)
  })
  it('a branch with no authored name shows the last part of its id, plain', () => {
    expect(hubName({ id: 'craft/making-things', name: '  ' })).toBe('making-things')
    expect(hubName({ id: 'craft/making-things', name: 'Making things' })).toBe('Making things')
  })
  it('the stage draws a plate name for every hub in its drawn set, also one the stage edge would cut', () => {
    const tree = buildTree({ id: 'tmp', name: 'Tmp', about: 'x', refreshDays: 90, branches: Array.from({ length: 9 }, (_, b) => ({ name: b === 7 ? '' : `Branch ${b + 1}`, nodes: ['a', 'b', 'c'] })) })
    const apiRef = createRef<StageApi | null>() as { current: StageApi | null }
    // a short stage: the rows below the fold are cut by the edge, and their plates must still say their names
    m = mount(<TreeStage tree={tree} derived={deriveTree(tree, [], NOW)} ledgerState="waiting" openId={null} onOpen={() => {}} occluded={false} apiRef={apiRef} initialView={{ x: 20, y: 60, k: 1.2 }} initialSize={{ w: 519, h: 300 }} />)
    const plates = [...m.container.querySelectorAll('.tree-hub')]
    expect(plates.length).toBeGreaterThan(3)
    for (const p of plates) expect((p.querySelector('.hub-name')?.textContent ?? '').trim().length).toBeGreaterThan(0)
  })
})

describe('the key row', () => {
  it('the stage draws no legend over itself when the page draws the key above it (chrome off)', () => {
    const tree = TREES()[5]
    const apiRef = createRef<StageApi | null>() as { current: StageApi | null }
    m = mount(<TreeStage tree={tree} derived={deriveTree(tree, [], NOW)} ledgerState="waiting" openId={null} onOpen={() => {}} occluded={false} apiRef={apiRef} chrome={false} />)
    expect(m.container.querySelector('.tg-legend')).toBeNull()
    expect(m.container.querySelector('.tg-count')).toBeNull()
  })
  it('the classic page still gets its legend over the stage by default', () => {
    const tree = TREES()[5]
    const apiRef = createRef<StageApi | null>() as { current: StageApi | null }
    m = mount(<TreeStage tree={tree} derived={deriveTree(tree, [], NOW)} ledgerState="waiting" openId={null} onOpen={() => {}} occluded={false} apiRef={apiRef} />)
    expect(m.container.querySelectorAll('.tg-legend li')).toHaveLength(6)
  })
  it('TreeKey names the six states and says the count is not counted while there is no evidence store', () => {
    m = mount(<TreeKey earned={0} branches={9} counted={false} />)
    expect([...m.container.querySelectorAll('.tg-legend li')].map((l) => l.textContent)).toHaveLength(6)
    expect(m.container.querySelector('.tg-count')?.textContent).toContain('– –')
  })
})

describe('a chosen node', () => {
  it('draws a tint and a halo, and only the chosen node does', () => {
    const tree = TREES()[5]
    const apiRef = createRef<StageApi | null>() as { current: StageApi | null }
    const id = tree.nodes[0].id
    m = mount(<TreeStage tree={tree} derived={deriveTree(tree, [], NOW)} ledgerState="waiting" openId={id} onOpen={() => {}} occluded={false} apiRef={apiRef} initialView={{ x: 80, y: 60, k: 1.3 }} initialSize={{ w: 846, h: 464 }} />)
    expect(m.container.querySelectorAll('.sn-tint')).toHaveLength(1)
    expect(m.container.querySelectorAll('.sn-halo')).toHaveLength(1)
    expect(m.container.querySelector('[data-selected="true"]')?.getAttribute('data-id')).toBe(id)
  })
})
