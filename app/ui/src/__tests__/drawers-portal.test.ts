/**
 * The Reader and the Settings drawer render on document.body (a portal), not inside the scrolling
 * mission page: inside it, a transformed ancestor made `position: fixed` relative to the page and the
 * Reader opened off screen once the page was scrolled (audit STUDY-01, 9 Nov).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderDrawer, useReader } from '../germoney/Reader'
import { SettingsDrawer } from '../germoney/pages/Settings'
import { useDrawer } from '../germoney/ui'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  host.className = 'page mission'
  host.setAttribute('data-glass', 'blur')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useReader.getState().close()
  useDrawer.getState().toggle(false)
  vi.unstubAllGlobals()
})

describe('drawers render outside the scrolling page', () => {
  it('the Reader with text opens on document.body, inside a token-carrying portal, with the page glass tier', async () => {
    await act(async () => { root.render(createElement(ReaderDrawer)) })
    await act(async () => { useReader.getState().openText('A paper', '# Hello\n\nWorld') })
    const reader = document.body.querySelector('.ww-portal .reader')
    expect(reader).not.toBeNull()
    expect(host.contains(reader)).toBe(false)                      // not a child of the page
    expect(reader!.closest('.ww-portal')!.getAttribute('data-glass')).toBe('blur')
    expect(reader!.textContent).toContain('Hello')
    await act(async () => { useReader.getState().close() })
    expect(document.body.querySelector('.ww-portal .reader')).toBeNull()
  })

  it('the Settings drawer opens on document.body too', async () => {
    await act(async () => { root.render(createElement(SettingsDrawer)) })
    await act(async () => { useDrawer.getState().toggle(true) })
    const scrim = document.body.querySelector('.ww-portal .drawer-scrim')
    expect(scrim).not.toBeNull()
    expect(host.contains(scrim)).toBe(false)
  })
})
