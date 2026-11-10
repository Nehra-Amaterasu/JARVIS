// Chunk 5: the Roadmap overlay (plan 4.12, 8.1 "Overlays and roadmap").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { mount, resetHtml } from './_stubs'
import { OverlayHost } from '../../ww/frame/OverlayHost'
import { closeOverlay, openOverlay, registeredOverlay, useOverlay } from '../../ww/frame/overlayRegistry'
import { RoadmapBody } from '../../ww/overlays/Roadmap'
import { GROUPS, PLANNED, groupOf } from '../../ww/plannedFeatures'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  closeOverlay()
  useOverlay.setState({ open: null, props: {} })
  m?.unmount()
  m = null
  vi.unstubAllGlobals()
  resetHtml()
  document.body.innerHTML = ''
})

describe('Roadmap', () => {
  it('registers itself under the roadmap id when the module is imported', () => {
    expect(registeredOverlay('roadmap')).toBe(RoadmapBody)
  })
  it('lists every registry entry once, with its line and what it needs', () => {
    m = mount(<RoadmapBody />)
    const rows = [...document.querySelectorAll('[data-roadmap-row]')]
    expect(rows.map((r) => r.getAttribute('data-roadmap-row')).sort()).toEqual(PLANNED.map((p) => p.id).sort())
    for (const p of PLANNED) {
      const row = document.querySelector(`[data-roadmap-row="${p.id}"]`)!
      expect(row.textContent).toContain(p.line)
      expect(row.textContent).toContain(`Needs: ${p.needs}`)
      if (p.when) expect(row.textContent).toContain(`When: ${p.when}`)
    }
  })
  it('groups rows by workspace, in tab order, and never shows an empty group', () => {
    m = mount(<RoadmapBody />)
    const shown = [...document.querySelectorAll('[data-roadmap-group]')].map((g) => g.getAttribute('data-roadmap-group'))
    const expected = GROUPS.filter((g) => PLANNED.some((p) => groupOf(p) === g))
    expect(shown).toEqual(expected)
    expect(document.querySelector('[data-roadmap-group="Study"] [data-roadmap-row="sharpen"]')).toBeNull() // Sharpen is on the Tree
    expect(document.querySelector('[data-roadmap-group="Tree"] [data-roadmap-row="sharpen"]')).not.toBeNull()
  })
  it('a feature that ships leaves the Roadmap with its entry', () => {
    m = mount(<RoadmapBody entries={PLANNED.filter((p) => p.id !== 'sharpen')} />)
    expect(document.querySelector('[data-roadmap-row="sharpen"]')).toBeNull()
    expect(document.querySelectorAll('[data-roadmap-row]')).toHaveLength(PLANNED.length - 1)
  })
  it('has nothing to press: no button, link or input inside the body, and no primary mark', () => {
    m = mount(<RoadmapBody />)
    const body = document.querySelector('[data-overlay="roadmap"]')!
    expect(body.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(body.querySelector('[data-primary], .primary')).toBeNull()
    expect(body.getAttribute('data-primary-none')).toBe('')
  })
  it('opens in the real Drawer through openOverlay, replacing the stub, and Esc closes it', () => {
    m = mount(<OverlayHost />)
    act(() => void openOverlay('roadmap'))
    expect(document.querySelector('[data-overlay-stub]')).toBeNull()
    expect(document.querySelector('[role=dialog] h2')!.textContent).toBe('Roadmap')
    expect(document.querySelectorAll('[data-roadmap-row]')).toHaveLength(PLANNED.length)
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(useOverlay.getState().open).toBeNull()
  })
})
