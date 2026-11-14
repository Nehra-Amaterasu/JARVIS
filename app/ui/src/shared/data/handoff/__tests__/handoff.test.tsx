// HandoffKey: a 44 px key that opens a target with its context, runs nothing, and is inert and says why when not LIVE.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '../../../../__tests__/ww/_stubs'
import { HandoffKey, contextText, handoffLabel } from '..'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { m?.unmount(); m = null })
const btn = () => document.querySelector('button') as HTMLButtonElement

describe('HandoffKey', () => {
  it('opens its target with the context, once per press', () => {
    const onOpen = vi.fn()
    m = mount(<HandoffKey label="Open Exam Season" target="study.plan" context={{ subject: 'physics' }} onOpen={onOpen} />)
    act(() => btn().click())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith({ target: 'study.plan', context: { subject: 'physics' } })
  })
  it('says what it opens with and that nothing runs', () => {
    expect(contextText({ subject: 'physics', unit: '3' })).toBe('subject physics, unit 3')
    expect(handoffLabel('Ask JARVIS', undefined)).toBe('Ask JARVIS. Opens a page; nothing runs.')
    m = mount(<HandoffKey label="Ask JARVIS" target="deck" onOpen={() => undefined} />)
    expect(btn().getAttribute('aria-label')).toBe('Ask JARVIS. Opens a page; nothing runs.')
  })
  it('a non-LIVE key is dashed, aria-disabled, silent on press, with the reason beside it', () => {
    const onOpen = vi.fn()
    m = mount(<HandoffKey label="Open Exam Season" target="study.plan" state="planned" reason="needs an exam window" onOpen={onOpen} />)
    expect((document.querySelector('[data-component="handoff-key"]') as HTMLElement).dataset.form).toBe('hollow')
    expect(btn().getAttribute('aria-disabled')).toBe('true')
    act(() => btn().click())
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.querySelector('.dg-hk-why')?.textContent).toContain('needs an exam window')
  })
  it('is 44 px, mono, and has no animation, in the source', () => {
    const css = readFileSync(resolve(__dirname, '../handoff.css'), 'utf8')
    expect(css).toMatch(/min-height: 44px/)
    expect(css).toMatch(/--font-mono/)
    expect(css).toMatch(/forced-colors: active/)
    expect(css).not.toMatch(/@keyframes|animation\s*:|transition\s*:/)
  })
})
