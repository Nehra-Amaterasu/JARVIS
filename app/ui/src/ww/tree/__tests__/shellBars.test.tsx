// CP2: the Tree's two lists behind one key each under the new shell, and the page's own popover (Panel).
// The shell branch is chosen by [data-shell="v2"] in the document (inShell), read once per mount.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { loadBank } from '../../../germoney/data/bank'
import { allStatuses } from '../../../germoney/game/tree'
import { clearCoachMemory, PrimaryOwner } from '../../kit'
import { workspaceMemory } from '../../frame/workspaceMemory'
import { TreeCanvas } from '../TreeCanvas'
import { BranchMenu, Panel, TreePicker } from '../ShellBars'
import { inShell } from '../inShell'

const bank = loadBank()
const statuses = allStatuses(bank, {})
let m: ReturnType<typeof mount> | null = null
let flag: HTMLElement | null = null

const shellOn = () => { flag = document.createElement('div'); flag.setAttribute('data-shell', 'v2'); document.body.appendChild(flag) }

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
  workspaceMemory.clear()
  clearCoachMemory()
})
afterEach(() => {
  m?.unmount()
  m = null
  flag?.remove()
  flag = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const OPTS = [
  { id: 'skills', label: 'Skills', count: '0/90' },
  { id: 'money', label: 'Money', count: '1/5' },
  { id: 'whole', label: 'Whole me', disabledReason: 'Not built yet.' },
]

describe('inShell', () => {
  it('is false without the shell root and true with it', () => {
    expect(inShell()).toBe(false)
    shellOn()
    expect(inShell()).toBe(true)
  })
})

describe('TreePicker', () => {
  it('names the open tree on one key; the list is closed until the key is pressed', () => {
    m = mount(<TreePicker value="money" options={OPTS} onChange={() => {}} />)
    const key = m.container.querySelector('.ww-tree-key')!
    expect(key.textContent).toContain('Money 1/5')
    expect(key.getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
  })
  it('opens an opaque list in place (not portaled to body), picks a tree and closes', () => {
    const picked: string[] = []
    m = mount(<TreePicker value="skills" options={OPTS} onChange={(id) => picked.push(id)} />)
    act(() => void m!.container.querySelector<HTMLElement>('.ww-tree-key')!.click())
    const panel = m.container.querySelector('.ww-tree-panel')!
    expect(panel, 'the panel is inside the page tree, so it reads the shell tokens').not.toBeNull()
    expect(panel.getAttribute('role')).toBe('dialog')
    const radios = [...panel.querySelectorAll('[role="radio"]')]
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    act(() => void (radios[1] as HTMLElement).click())
    expect(picked).toEqual(['money'])
    expect(m.container.querySelector('.ww-tree-panel')).toBeNull()
  })
  it('an option with a reason is aria-disabled, says why in words, and picks nothing', () => {
    const picked: string[] = []
    m = mount(<TreePicker value="skills" options={OPTS} onChange={(id) => picked.push(id)} />)
    act(() => void m!.container.querySelector<HTMLElement>('.ww-tree-key')!.click())
    const whole = [...m.container.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes('Whole me')) as HTMLElement
    expect(whole.getAttribute('aria-disabled')).toBe('true')
    expect(whole.textContent).toContain('Not built yet.')
    act(() => void whole.click())
    expect(picked).toEqual([])
  })
  it('Escape closes it and hands focus back to the key; a press outside closes it too', () => {
    m = mount(<TreePicker value="skills" options={OPTS} onChange={() => {}} />)
    const key = m.container.querySelector<HTMLElement>('.ww-tree-key')!
    act(() => void key.click())
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(m.container.querySelector('.ww-tree-panel')).toBeNull()
    expect(document.activeElement).toBe(key)
    act(() => void key.click())
    expect(m.container.querySelector('.ww-tree-panel')).not.toBeNull()
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(m.container.querySelector('.ww-tree-panel')).toBeNull()
  })
})

describe('BranchMenu', () => {
  it('lists every branch with its count behind one key, carries the counts line, and picks by id', () => {
    const picked: string[] = []
    m = mount(<BranchMenu options={[{ id: 'a', label: 'math', count: '1/16' }, { id: 'b', label: 'hdl', count: '0/3' }]} stats="19 nodes · 1 mastered" onPick={(id) => picked.push(id)} />)
    expect(m.container.querySelector('.ww-tree-key')!.textContent).toContain('Branches')
    act(() => void m!.container.querySelector<HTMLElement>('.ww-tree-key')!.click())
    const rows = [...m.container.querySelectorAll('.ww-tree-opt')]
    expect(rows.map((r) => r.textContent)).toEqual(['math1/16', 'hdl0/3'])
    expect(m.container.querySelector('.ww-tree-panel')!.textContent).toContain('19 nodes · 1 mastered')
    act(() => void (rows[1] as HTMLElement).click())
    expect(picked).toEqual(['b'])
  })
})

describe('Panel', () => {
  it('renders nothing while closed', () => {
    const anchor = { current: document.createElement('button') }
    m = mount(<Panel open={false} onClose={() => {}} anchor={anchor} label="x">content</Panel>)
    expect(m.container.querySelector('.ww-tree-panel')).toBeNull()
  })
})

describe('the Tree canvas under the shell', () => {
  const canvas = () => (
    <PrimaryOwner>
      <TreeCanvas treeId="skills" bank={bank} status={statuses} career={null} docked={false} skills stats="x nodes" switcher={<span>switch</span>}
        panel={() => <span>panel</span>} />
    </PrimaryOwner>
  )
  it('with the shell: no sideways chip row, Branches is one key, Fit is an icon key, and the one warm action rides the stage', () => {
    shellOn()
    m = mount(canvas())
    expect(m.container.querySelector('.ww-tree-chips')).toBeNull()
    expect(m.container.querySelector('[aria-label="Branches"] .ww-chip')).toBeNull()
    expect([...m.container.querySelectorAll('.ww-tree-key')].some((k) => k.textContent?.includes('Branches'))).toBe(true)
    expect(m.container.querySelector('.ww-tree-bar [aria-label^="Fit the whole tree"]')).not.toBeNull()
    expect(m.container.querySelector('.ww-tree-stage .ww-tree-cta')).not.toBeNull()
    expect(m.container.querySelector('.ww-tree-bar .ww-btn.primary')).toBeNull()
  })
  it('without the shell the classic chip row and toolbar are unchanged', () => {
    m = mount(canvas())
    expect(m.container.querySelector('.ww-tree-chips')).not.toBeNull()
    expect(m.container.querySelector('.ww-tree-cta')).toBeNull()
    expect([...m.container.querySelectorAll('.ww-tree-key')]).toHaveLength(0)
  })
})
