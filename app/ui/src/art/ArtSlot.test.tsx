// ArtSlot and the eleven centrepiece ids (A.G03). Synthetic files only: no private picture is read here.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount } from '../__tests__/ww/_stubs'
import { ART_MANIFEST } from './index'
import { createArtResolver, type ArtSources } from './resolve'
import { ArtSlot, ArtSlotView, type ArtLoaded } from './ArtSlot'
import { CENTREPIECE_IDS } from './centrepieces'

let m: ReturnType<typeof mount> | null = null
afterEach(() => {
  m?.unmount()
  m = null
})
// The first load of a lazy art file goes through the module loader, so settle in short act() steps until no
// slot is left in 'loading' (state updates inside one long act() are not flushed until it ends).
const flush = async () => {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
    if (!document.querySelector('[data-state="loading"]')) return
  }
}
const loaded = (over: Partial<ArtLoaded>): ArtLoaded => ({ state: 'absent', kind: null, url: null, text: null, resolvedId: 'x', ...over })
const WITH_CUSTOMER_FILE = ['art.memory.branch', 'art.study.island']

describe('the eleven centrepiece ids', () => {
  it('are all in the manifest, once each, and the two with a customer file keep it', () => {
    expect(new Set(CENTREPIECE_IDS).size).toBe(11)
    for (const id of CENTREPIECE_IDS) expect(ART_MANIFEST.art[id], id).toBeTruthy()
    for (const id of WITH_CUSTOMER_FILE) expect(ART_MANIFEST.art[id].files).toHaveLength(1)
    for (const id of CENTREPIECE_IDS.filter((i) => !WITH_CUSTOMER_FILE.includes(i))) {
      expect(ART_MANIFEST.art[id].track, id).toBe('private-only')
      expect(ART_MANIFEST.art[id].files, id).toEqual([])
    }
  })

  it('resolve to a staged file on the private track and, when private-only, to nothing on the customer track', async () => {
    const urls: ArtSources['urls'] = {}
    for (const id of CENTREPIECE_IDS) urls[`./private-local/${id}.webp`] = async () => `/p/${id}.webp`
    const empty: ArtSources = { urls: {}, texts: {} }
    const priv = createArtResolver(ART_MANIFEST, 'private', empty, () => ({ urls, texts: {} }))
    const cust = createArtResolver(ART_MANIFEST, 'customer', empty, () => ({ urls, texts: {} }))
    for (const id of CENTREPIECE_IDS) expect(await priv.url(id), id).toBe(`/p/${id}.webp`)
    for (const id of CENTREPIECE_IDS) {
      if (ART_MANIFEST.art[id].track === 'private-only') expect(cust.entry(id), id).toBeNull()
    }
  })

  it('appear in no tracked source by catalogue id (the product names art ids only)', () => {
    for (const f of ['ArtSlot.tsx', 'ArtSlot.css', 'centrepieces.ts', 'index.ts', 'resolve.ts']) {
      expect(readFileSync(join(resolve(__dirname), f), 'utf-8'), f).not.toMatch(/\bC0[1-4]-\d{2,3}\b/)
    }
  })
})

describe('ArtSlotView', () => {
  it('is aria-hidden around the picture and puts the caption outside it as real text', () => {
    m = mount(<ArtSlotView id="art.day.sun" art={loaded({ state: 'private', kind: 'image', url: '/x.webp' })} caption="each ray is one block logged today" />)
    const box = m.container.querySelector('.art-slot__box')!
    expect(box.getAttribute('aria-hidden')).toBe('true')
    const img = box.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('loading')).toBe('lazy')
    const cap = m.container.querySelector('figcaption')!
    expect(cap.textContent).toBe('each ray is one block logged today')
    expect(box.contains(cap)).toBe(false)
    expect(m.container.querySelector('[data-art-id="art.day.sun"]')!.getAttribute('data-state')).toBe('private')
  })

  it('draws text art in a pre and never injects it as html', () => {
    m = mount(<ArtSlotView id="art.memory.branch" art={loaded({ state: 'customer', kind: 'text', text: '<img src=x onerror=alert(1)>\n.:-=' })} />)
    expect(m.container.querySelector('pre')!.textContent).toContain('<img src=x')
    expect(m.container.querySelector('.art-slot__box img')).toBeNull()
  })

  it('shows a plain plate with the id and "private track off" on the customer track, and says so honestly on the private one', () => {
    m = mount(<ArtSlotView id="art.career.skyline" art={loaded({})} track="customer" />)
    const ph = m.container.querySelector('.art-slot__ph')!
    expect(ph.textContent).toContain('art.career.skyline')
    expect(ph.textContent).toContain('private track off')
    m.render(<ArtSlotView id="art.career.skyline" art={loaded({})} track="private" />)
    expect(m.container.querySelector('.art-slot__ph')!.textContent).toContain('private file not built')
  })

  it('sets a ratio only when it is a positive finite number, and keeps fit as data', () => {
    m = mount(<ArtSlotView id="a.b" art={loaded({})} ratio={2} fit="contain" />)
    const fig = m.container.querySelector<HTMLElement>('figure')!
    expect(fig.getAttribute('data-ratio')).toBe('set')
    expect(fig.style.getPropertyValue('--art-ratio')).toBe('2')
    expect(fig.getAttribute('data-fit')).toBe('contain')
    for (const bad of [0, -1, NaN, Infinity]) {
      m.render(<ArtSlotView id="a.b" art={loaded({})} ratio={bad} />)
      expect(m.container.querySelector('figure')!.getAttribute('data-ratio'), String(bad)).toBe('none')
    }
  })

  it('has no tab stop, no button and no role of its own', () => {
    m = mount(<ArtSlotView id="a.b" art={loaded({ kind: 'image', url: '/x.png', state: 'customer' })} caption="c" />)
    expect(m.container.querySelectorAll('[tabindex],button,a,[role]')).toHaveLength(0)
  })
})

describe('ArtSlot on the default (customer) track', () => {
  it('draws the customer text art of an id that has one, after a loading plate', async () => {
    m = mount(<ArtSlot id="art.memory.branch" />)
    expect(m.container.querySelector('.art-slot__ph')!.textContent).toContain('loading')
    await flush()
    expect(m.container.querySelector('figure')!.getAttribute('data-state')).toBe('customer')
    expect(m.container.querySelector('pre')!.textContent!.length).toBeGreaterThan(100)
  })

  it('falls back from a missing treatment file to the plain id', async () => {
    m = mount(<ArtSlot id="art.memory.branch" treatment="bayer" />)
    await flush()
    const fig = m.container.querySelector('figure')!
    expect(fig.getAttribute('data-treatment')).toBe('bayer')
    expect(fig.getAttribute('data-state')).toBe('customer')
  })

  it('shows "private track off" for each private-only centrepiece and never a picture', async () => {
    for (const id of CENTREPIECE_IDS.filter((i) => ART_MANIFEST.art[i].track === 'private-only')) {
      m = mount(<ArtSlot id={id} />)
      await flush()
      expect(m.container.querySelector('img'), id).toBeNull()
      expect(m.container.querySelector('.art-slot__ph')!.textContent, id).toContain('private track off')
      m.unmount()
      m = null
    }
  })

  it('does not set state after it unmounts', async () => {
    const m2 = mount(<ArtSlot id="art.memory.branch" />)
    m2.unmount()
    await flush()
    expect(document.body.querySelectorAll('figure')).toHaveLength(0)
  })
})
