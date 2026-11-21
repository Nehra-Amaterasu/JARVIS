// The four Memory views under the v3 look: three named trays each, every state still stamped SIMULATED on the invented
// fixtures, the recall and capture lines gone from the canvas (they live in the dock), and no ellipsis rule left on a claim.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { mount } from '../../../__tests__/ww/_stubs'
import { BeliefsView } from '../Beliefs'
import { KeepView } from '../Keep'
import { PeopleView } from '../People'
import { RecallView } from '../Recall'
import { recallStore } from '../hooks'
import { NOW_MS, NOW_S, fixtureBeliefPort, fixturePeoplePort, fixtureRecallPort, fixtureRemindersPort, fixtureReviewPort, fixtureSourcesPort } from '../fixtures'

let m: ReturnType<typeof mount> | null = null
beforeEach(() => {
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  localStorage.clear()
  recallStore.set([])
})
afterEach(() => { m?.unmount(); m = null; document.body.innerHTML = '' })
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const jobs = () => [...document.querySelectorAll('.s3-tray .s3-job')].map((e) => (e.textContent ?? '').replace(/^Step \d: /, ''))

describe('Memory under the v3 look', () => {
  it('Recall: ASK / FOUND / HOLDS, no recall line and no capture line in the canvas, the picture is still there', async () => {
    m = mount(<RecallView v3 port={fixtureRecallPort()} reminders={fixtureRemindersPort} now={NOW_S} />)
    await flush()
    expect(jobs()).toEqual(['ASK', 'FOUND', 'HOLDS'])
    expect(document.querySelector('[role="search"]')).toBeNull()
    expect(document.querySelector('.jm-dock')).toBeNull()
    expect(document.querySelectorAll('.jm-node').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-testid="idle"]')).not.toBeNull()
    expect(document.querySelector('.jm')!.getAttribute('data-simulated')).toBe('true')
  })

  it('Beliefs: REVIEW / LEARNED / CONFIRMED, the questions and the stated facts both drawn', async () => {
    m = mount(<BeliefsView v3 port={fixtureBeliefPort()} now={NOW_S} />)
    await flush()
    expect(jobs()).toEqual(['REVIEW', 'LEARNED', 'CONFIRMED'])
    expect(document.querySelectorAll('[data-testid="belief-row"]').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-testid="confirmed-list"]')).not.toBeNull()
  })

  it('People: FIND / PERSON / BASIS, picking a name fills the person tray', async () => {
    m = mount(<PeopleView v3 port={fixturePeoplePort} now={NOW_MS} />)
    await flush()
    expect(jobs()).toEqual(['FIND', 'PERSON', 'BASIS'])
    const first = document.querySelector<HTMLButtonElement>('[data-testid="people-list"] button')!
    await act(async () => { first.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('[data-testid="person-card"] .jm-p-name')).not.toBeNull()
  })

  it('Keep: EXPORT / DELETE / RECORDS, the destructive plates stay PLANNED', async () => {
    m = mount(<KeepView v3 recall={fixtureRecallPort()} sources={fixtureSourcesPort} review={fixtureReviewPort} simulated now={NOW_S} />)
    await flush()
    expect(jobs()).toEqual(['EXPORT', 'DELETE', 'RECORDS'])
    expect(document.querySelector('[data-testid="share-review"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="holdings"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-planned="true"]').length).toBeGreaterThanOrEqual(3)
  })

  it('the stylesheet lets the lines that carry a claim or a name wrap, and keeps every rule under the look', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'memory-v3.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.jm-cf-t[\s\S]*white-space: normal/)
    for (const rule of css.split('}')) {
      const sel = rule.split('{')[0].replace(/@media[^{]*/, '').trim()
      if (sel) expect(sel.split(',').every((s) => s.trim().startsWith(":root[data-look='v3']")), sel).toBe(true)
    }
  })
})
