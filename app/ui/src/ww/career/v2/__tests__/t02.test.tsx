// T02 Career under shell v2: the pure rules (a figure needs its stamp, the flight board, the constellation and its gap order, the rack,
// the ledger and the bridge), the cell-lamp rule on the five drawn views, the wording over every file of the package, and the five
// registrations.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buttons, cleanup, click, flush, keyDown, render } from '../../../../shared/almanac/__tests__/dom'
import { buildDeadlines } from '../../model'
import { collectViews } from '../../../../shell/views/index'
import { AbroadView } from '../Abroad'
import { CertificatesView } from '../Certificates'
import { LadderView } from '../Ladder'
import { MoneyView } from '../Money'
import { RunwayView } from '../Runway'
import {
  FIXTURE_APPS, FIXTURE_CELLS, FIXTURE_CERTS, FIXTURE_COST_CELLS, FIXTURE_COST_ITEMS, FIXTURE_EVIDENCED, FIXTURE_FUNDING, FIXTURE_GOALS, FIXTURE_LADDER, FIXTURE_NODES,
  FIXTURE_ROLES, FIXTURE_TAGNODE, FIXTURE_TODAY, FIXTURE_UNIS,
} from '../fixtures'
import {
  HORIZON, MATCH_NOTE, RACK_ITEMS, appCellKey, bridge, compareColumns, costRows, flightNotches, flightTicks, gapList, matchJd, nodePoints, orderColumns, rackState,
  rateRead, readRoles, stageCounts, starPoints, stepNotch, totals, treeNodes,
} from '../model'
import { VERIFIED_FACT, cellRead, cellReadFor, stampText } from '../store'

afterEach(cleanup)
const noop = () => undefined

describe('a figure needs its stamp (cellRead)', () => {
  it('is LIVE only with a value and the day it was checked', () => {
    expect(cellRead({ k: { value: '120', on: '2026-11-16' } }, 'k').state).toBe('live')
    expect(cellRead({ k: { value: '120', on: '' } }, 'k').state).toBe('waiting')
    expect(cellRead({ k: { value: '  ', on: '2026-11-16' } }, 'k').state).toBe('waiting')
    expect(cellRead({}, 'k')).toEqual({ state: 'waiting', value: '', on: null })
  })
  it('quotes the one verified figure with its source and the day it was read', () => {
    expect(VERIFIED_FACT.amountEur).toBe(10332)
    expect(VERIFIED_FACT.checkedOn).toBe('2026-11-13')
    expect(VERIFIED_FACT.source).toBe('https://www.study-in-germany.com/en/plan-your-studies/requirements/')
    expect(stampText('2026-11-13')).toBe('13 Nov 2026')
  })
})

describe('the flight board', () => {
  const apps = FIXTURE_APPS
  it('puts a notch at each closing date within 120 days, soonest first, dashed until the date is confirmed', () => {
    const n = flightNotches(apps, FIXTURE_TODAY, FIXTURE_CELLS)
    expect(n.map((x) => x.id)).toEqual(['northgate-intern', 'harbour-grad', 'lumen-research', 'ashford-design', 'vale-intern', 'orchard-offer'])
    expect(n.every((x) => x.x >= 0 && x.x <= 1)).toBe(true)
    expect(n.find((x) => x.id === 'northgate-intern')!.confirmed).toBe(true)
    expect(n.find((x) => x.id === 'harbour-grad')!.confirmed).toBe(false)
    // a date far out, a ruled-out row and a row with no date have no notch
    expect(n.some((x) => x.id === 'quay-late' || x.id === 'fen-out')).toBe(false)
    expect(HORIZON).toBe(120)
  })
  it('the bank flag alone never confirms a date', () => {
    const verified = apps.map((a) => ({ ...a, verified: true }))
    expect(flightNotches(verified, FIXTURE_TODAY, {}).every((x) => !x.confirmed)).toBe(true)
    expect(appCellKey('x')).toBe('app:x')
  })
  it('ticks every 7 days over the horizon and marks the month starts', () => {
    const t = flightTicks(FIXTURE_TODAY)
    expect(t.filter((x) => x.day % 7 === 0).length).toBe(Math.floor(HORIZON / 7) + 1)
    expect(t.filter((x) => x.month).map((x) => x.month).slice(0, 2)).toEqual(['Dec', 'Jan'])
  })
  it('counts the five stages and steps along the axis without wrapping', () => {
    expect(stageCounts(apps)).toEqual([3, 1, 1, 1, 1])
    expect(stepNotch(0, -1, 4)).toBe(0)
    expect(stepNotch(3, 1, 4)).toBe(3)
    expect(stepNotch(1, 1, 4)).toBe(2)
  })
})

describe('the constellation and the gap list', () => {
  const reads = readRoles(FIXTURE_ROLES, FIXTURE_TAGNODE, FIXTURE_EVIDENCED)
  it('brightness is the share of a role\'s skills that stand on an evidenced node', () => {
    const by = Object.fromEntries(reads.map((r) => [r.id, r]))
    expect(by.embedded.share).toBeCloseTo(0.5)
    expect(by.dsp.share).toBeCloseTo(1 / 3)
    expect(by.verif.evidencedN).toBe(1)
  })
  it('a skill with no node can never be evidenced', () => {
    const r = readRoles([{ id: 'x', title: 'X', tags: ['unlinked skill'] }], {}, new Set(['anything']))[0]
    expect(r.share).toBe(0)
    expect(gapList([r], (id) => id)[0]).toMatchObject({ key: 'tag:unlinked skill', node: null })
  })
  it('ranks the gaps by the roles each one unlocks, then by name', () => {
    const g = gapList(reads, (id) => FIXTURE_NODES.find((n) => n.id === id)?.name ?? id)
    expect(g.map((x) => [x.label, x.unlocks])).toEqual([['Board design', 2], ['Hardware description', 2], ['Real-time operating systems', 1], ['Signal processing', 1]])
  })
  it('lays 8 to 12 stars inside the sky with no two on one point', () => {
    for (const n of [8, 10, 12]) {
      const p = starPoints(n, 100, 100)
      expect(p.every((q) => q.x > 5 && q.x < 95 && q.y > 5 && q.y < 95)).toBe(true)
      const d = p.flatMap((a, i) => p.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)))
      expect(Math.min(...d)).toBeGreaterThan(5)
    }
    expect(Object.keys(nodePoints(['a', 'b', 'c'], 100, 100))).toEqual(['a', 'b', 'c'])
  })
  it('matches a pasted description to node names by keyword, in a table the student edits', () => {
    const m = matchJd('We want embedded c and signal processing, plus version control.', FIXTURE_NODES)
    expect(m.map((x) => x.node).sort()).toEqual(['n-c', 'n-dsp', 'n-git'])
    expect(matchJd('nothing relevant here', FIXTURE_NODES)).toEqual([])
  })
})

describe('the rack and the columns', () => {
  it('the visa slot is blocked until the two proofs it asks for are done', () => {
    expect(RACK_ITEMS.length).toBe(8)
    expect(rackState('visa', {}, 'u')).toBe('blocked')
    expect(rackState('visa', { 'u:blocked': 'd' }, 'u')).toBe('blocked')
    expect(rackState('visa', { 'u:blocked': 'd', 'u:insurance': 'd' }, 'u')).toBe('off')
    expect(rackState('visa', { 'u:visa': 'd' }, 'u')).toBe('on')
    expect(rackState('language', {}, 'u')).toBe('off')
  })
  it('a pinned column moves first and compare keeps two', () => {
    expect(orderColumns(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(compareColumns(['a', 'b', 'c', 'd'], 'c')).toEqual(['c', 'a'])
    expect(compareColumns(['a', 'b', 'c'], null)).toEqual(['a', 'b'])
    expect(compareColumns(['a'], null)).toEqual(['a'])
  })
})

describe('the ledger and the bridge', () => {
  it('a euro fee becomes rupees only with a confirmed fee and a typed, dated rate', () => {
    const noRate = rateRead(100, null)
    expect(noRate.live).toBe(false)
    const rows0 = costRows(FIXTURE_COST_ITEMS, FIXTURE_COST_CELLS, noRate)
    expect(rows0.find((r) => r.id === 'lang')!.inr).toBeNull()
    const rate = rateRead(100, '2026-11-17')
    const rows = costRows(FIXTURE_COST_ITEMS, FIXTURE_COST_CELLS, rate)
    expect(rows.find((r) => r.id === 'lang')!.inr).toBe(15000)
    expect(rows.find((r) => r.id === 'cert')!.inr).toBe(1000)
    // an unconfirmed fee is not in the total, and is counted
    const t = totals(rows)
    expect(t.inr).toBe(15000 + 12000 + 1000)
    expect(t.eur).toBe(270)
    expect(t.unconfirmed).toBe(3)
    expect(totals(rows0)).toMatchObject({ inr: 1000, needsRate: 2 })
  })
  it('the bridge says unknown with no confirmed cost, a gap with its amount, covered when the spans reach the far bank', () => {
    const spans = [{ id: 'a', label: 'a', inr: 10000, on: '2026-11-15', kind: 'family' as const }]
    expect(bridge(spans, null)).toMatchObject({ state: 'unknown', gap: null, cost: null })
    expect(bridge([], 0).state).toBe('unknown')
    expect(bridge(spans, 25000)).toMatchObject({ state: 'gap', gap: 15000 })
    expect(bridge(spans, 10000)).toMatchObject({ state: 'covered', gap: 0 })
  })
})

// ---------------------------------------------------------------------------------------------- the five views, drawn

const due = buildDeadlines({ applications: FIXTURE_APPS, pipeline: {}, due_soon: [], tasks: [], goals: [] }, [], FIXTURE_TODAY)
const views = (simulated: boolean) => ({
  pipeline: <RunwayView width={1302} simulated={simulated} data={{ apps: FIXTURE_APPS, due, today: FIXTURE_TODAY, cells: FIXTURE_CELLS }} actions={{ setStatus: noop, confirm: noop, unconfirm: noop, add: noop, next: noop, nextFor: noop, confirmDue: noop }} campaigns={null} />,
  certs: <CertificatesView width={1302} simulated={simulated} certs={FIXTURE_CERTS} today={FIXTURE_TODAY} cells={{}} local={{}} onConfirm={noop} onClear={noop} onEarn={noop} onLocal={noop} />,
  abroad: <AbroadView width={1302} simulated={simulated} unis={FIXTURE_UNIS} today={FIXTURE_TODAY} cells={FIXTURE_CELLS} shortlist={FIXTURE_UNIS.map((u) => u.key)} pinned={null} done={{}} trialState={{}} onShortlist={noop} onPin={noop} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop} />,
  money: <MoneyView width={1302} simulated={simulated} items={FIXTURE_COST_ITEMS} today={FIXTURE_TODAY} cells={FIXTURE_COST_CELLS} rate={{ ...rateRead(100, '2026-11-17'), source: 'x' }} saved={{ inr: 5000, on: '2026-11-15' }} custom={[]} funding={FIXTURE_FUNDING} onConfirmCost={noop} onClearCost={noop} onRate={noop} onLog={noop} onAddCost={noop} onRemoveCost={noop} onAddFunding={noop} onRemoveFunding={noop} />,
  ladder: <LadderView width={1302} simulated={simulated} ladder={FIXTURE_LADDER} goals={FIXTURE_GOALS} roles={FIXTURE_ROLES} tagNode={FIXTURE_TAGNODE} evidenced={FIXTURE_EVIDENCED} nodes={FIXTURE_NODES} parking={null} rewards={null} review={null} onAddRole={noop} onRemoveRole={noop} onOpenGap={noop} onGoals={noop} initialFace="path" />,
})

describe('the cell-lamp rule on the drawn views', () => {
  for (const simulated of [false, true]) {
    for (const [name, ui] of Object.entries(views(simulated))) {
      it(`${name}${simulated ? ' (simulated)' : ''}: every readout is LIVE or SIMULATED with its stamp, and WAITING prints no figure`, () => {
        const { container } = render(ui)
        const outs = [...container.querySelectorAll<HTMLElement>('.k-readout')]
        if (name === 'abroad' || name === 'pipeline' || name === 'money') expect(outs.length).toBeGreaterThan(4)
        for (const r of outs) {
          const state = r.getAttribute('data-state')!
          const val = r.querySelector('.k-readout-value')!.textContent!.trim()
          const stamp = r.closest('.t2-stamped')?.querySelector('.t2-stamp')?.textContent ?? ''
          if (state === 'live' || state === 'simulated') {
            expect(state, 'a drawn-from-fixtures page never says LIVE').toBe(simulated ? 'simulated' : 'live')
            expect(stamp).toMatch(/(LIVE|SIMULATED) \d+ \w{3} \d{4}/)
          } else {
            expect(state).toBe('waiting')
            expect(val).toBe('--')
            expect(r.textContent).toContain('WAITING')
          }
        }
      })
    }
  }
  it('the Ladder note sits with the Ladder and with the Path', () => {
    const a = render(<LadderView width={1302} ladder={FIXTURE_LADDER} goals={FIXTURE_GOALS} roles={[]} tagNode={{}} evidenced={null} nodes={[]} parking={null} rewards={null} review={null} onAddRole={noop} onRemoveRole={noop} onOpenGap={noop} onGoals={noop} />)
    expect(a.container.textContent).toContain(MATCH_NOTE)
    cleanup()
    const b = render(views(false).ladder)
    expect(b.container.textContent).toContain(MATCH_NOTE)
  })
  it('a star is bright only while the plan has answered, and says WAITING otherwise', () => {
    const { container } = render(<LadderView width={1302} ladder={FIXTURE_LADDER} goals={FIXTURE_GOALS} roles={FIXTURE_ROLES} tagNode={FIXTURE_TAGNODE} evidenced={null} nodes={FIXTURE_NODES} parking={null} rewards={null} review={null} onAddRole={noop} onRemoveRole={noop} onOpenGap={noop} onGoals={noop} initialFace="path" />)
    const stars = [...container.querySelectorAll<HTMLElement>('.t2-star')]
    expect(stars.length).toBe(4)
    for (const s of stars) { expect(s.getAttribute('aria-label')).toContain('WAITING'); expect(s.textContent).not.toMatch(/\d+ %/) }
  })
})

describe('keys and one accent', () => {
  it('Abroad: C toggles compare and a column header pins', async () => {
    const pins: (string | null)[] = []
    const { container } = render(<AbroadView width={1302} simulated unis={FIXTURE_UNIS} today={FIXTURE_TODAY} cells={{}} shortlist={FIXTURE_UNIS.map((u) => u.key)} pinned={null} done={{}} trialState={{}} onShortlist={noop} onPin={(k) => pins.push(k)} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop} />)
    expect(container.querySelectorAll('.t2-colhead').length).toBe(4)
    keyDown(window, 'c')
    await flush(2)
    expect(container.querySelectorAll('.t2-colhead').length).toBe(2)
    click(container.querySelector('.t2-colhead button'))
    expect(pins.length).toBe(1)
  })
  it('Runway: a stage key sets the stage, and there is at most one accent key', () => {
    const set: string[] = []
    const { container } = render(<RunwayView width={1302} simulated data={{ apps: FIXTURE_APPS, due, today: FIXTURE_TODAY, cells: {} }} actions={{ setStatus: (id, s) => set.push(`${id}:${s}`), confirm: noop, unconfirm: noop, add: noop, next: noop, nextFor: noop, confirmDue: noop }} campaigns={null} />)
    click(buttons(container, 'Northgate Labs: Applied')[0])
    expect(set).toEqual(['northgate-intern:applied'])
    expect(container.querySelectorAll('[data-primary="true"]').length).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------------------------- the wording and the registrations

const folder = join(__dirname, '..')
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : files(join(dir, e.name))) : /\.(tsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []))
const ours = [...files(folder), join(__dirname, '../../../../shell/views/career-pipeline.view.ts'), join(__dirname, '../../../../gallery/entries/T02.tsx')]

describe('wording', () => {
  const OUTCOME = /guarantee|you will (get|be hired|be admitted|receive)|will be admitted|certain to|sure to|chances of|likelihood|probability of|get the job|predict|get in\b|you will pass/i
  it('no outcome promise anywhere in the package, outside the one sentence the spec gives', () => {
    expect(ours.length).toBeGreaterThan(10)
    for (const f of ours) {
      const text = readFileSync(f, 'utf8').split(MATCH_NOTE).join('')
      const hit = OUTCOME.exec(text)
      expect(hit, `${f}: "${hit?.[0]}"`).toBeNull()
    }
  })
  it('no network address in the package\'s own files', () => {
    for (const f of ours) {
      const text = readFileSync(f, 'utf8')
      expect(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text), `${f} holds an address`).toBe(false)
    }
  })
  it('none of the pressure, ranking or exam-result words the product rules forbid', () => {
    // streaks and bunk talk are pressure; "important", "likely" and "expected" rank or predict; "pass" and "fail" read as exam results
    const FORBIDDEN = /streak|bunk|days clean|important|likely|expected|\bpass(ed|es)?\b|\bfail(ed|s|ure)?\b/i
    for (const f of ours) {
      const hit = FORBIDDEN.exec(readFileSync(f, 'utf8').split(MATCH_NOTE).join(''))
      expect(hit, `${f}: "${hit?.[0]}"`).toBeNull()
    }
  })
  it('no hairline outline on a labelled control: no 1 px border on a button or a plate in the package CSS', () => {
    for (const f of ours.filter((x) => x.endsWith('.css'))) {
      // forced-colours mode is the one place a border is drawn: the system asks for edges there
      const text = readFileSync(f, 'utf8').split('@media (forced-colors: active)')[0]
      expect(/border:\s*1px\s+solid/.test(text), `${f} draws a 1 px border`).toBe(false)
    }
  })
})

describe('the five registrations', () => {
  it('each file registers its own career view, lazily, behind the product test', () => {
    const mods: Record<string, unknown> = {}
    for (const v of ['pipeline', 'certs', 'abroad', 'money', 'ladder']) {
      const path = join(__dirname, `../../../../shell/views/career-${v}.view.ts`)
      const src = readFileSync(path, 'utf8')
      expect(src).toContain("import.meta.env.VITE_PRODUCT !== 'jarvis'")
      expect(src).toContain(`id: 'career.${v}'`)
      expect(src).toContain("product: 'ww'")
    }
    const mod = import.meta.glob('../../../../shell/views/career-*.view.ts', { eager: true }) as Record<string, unknown>
    Object.assign(mods, mod)
    const got = collectViews(mods)
    expect(got.errors).toEqual([])
    expect([...got.byId.keys()].sort()).toEqual(['career.abroad', 'career.certs', 'career.ladder', 'career.money', 'career.pipeline'])
  })
})


// ---------------------------------------------------------------------------------------------- the review's three faults

describe('a stamp vouches only for the figure that was checked', () => {
  it('cellReadFor is WAITING and stale when the list now says a different value', () => {
    const cells = { k: { value: '2026-12-01', on: '2026-11-16' } }
    expect(cellReadFor(cells, 'k', '2026-12-01')).toMatchObject({ state: 'live', value: '2026-12-01', stale: false })
    expect(cellReadFor(cells, 'k', '2026-12-05')).toMatchObject({ state: 'waiting', stale: true })
    expect(cellReadFor({}, 'k', '2026-12-05')).toMatchObject({ state: 'waiting', stale: false })
  })
  it('the flight board does not call a changed date confirmed', () => {
    const changed = FIXTURE_APPS.map((a) => (a.id === 'northgate-intern' ? { ...a, closes: '2026-12-20', days_left: 32 } : a))
    expect(flightNotches(changed, FIXTURE_TODAY, FIXTURE_CELLS).find((n) => n.id === 'northgate-intern')?.confirmed).toBe(false)
    expect(flightNotches(FIXTURE_APPS, FIXTURE_TODAY, FIXTURE_CELLS).find((n) => n.id === 'northgate-intern')?.confirmed).toBe(true)
  })
  it('a Runway row prints the checked value when it still matches, and WAITING with its reason when the bank changed', () => {
    const actions = { setStatus: noop, confirm: noop, unconfirm: noop, add: noop, next: noop, nextFor: noop, confirmDue: noop }
    const row = (apps: typeof FIXTURE_APPS) => render(<RunwayView width={1302} data={{ apps, due: [], today: FIXTURE_TODAY, cells: FIXTURE_CELLS }} actions={actions} campaigns={null} />).container.querySelector('[data-row="northgate-intern"] .t2-closing')!
    const same = row(FIXTURE_APPS)
    expect(same.getAttribute('data-state')).toBe('live')
    expect(same.textContent).toContain(stampText(FIXTURE_CELLS['app:northgate-intern'].value))
    cleanup()
    const moved = row(FIXTURE_APPS.map((a) => (a.id === 'northgate-intern' ? { ...a, closes: '2026-12-20', days_left: 32 } : a)))
    expect(moved.getAttribute('data-state')).toBe('waiting')
    expect(moved.textContent).toContain('date changed since you checked it')
    expect(moved.textContent).not.toContain('20 Dec 2026')
    expect(moved.querySelector('.t2-stamp')).toBeNull()
  })
})

describe('the Abroad grid keeps one tab stop', () => {
  it('after Compare shrinks the columns from the last one, exactly one gridcell has tabindex 0', async () => {
    const { container } = render(<AbroadView width={1302} simulated unis={FIXTURE_UNIS} today={FIXTURE_TODAY} cells={{}} shortlist={FIXTURE_UNIS.map((u) => u.key)} pinned={null} done={{}} trialState={{}} onShortlist={noop} onPin={noop} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop} />)
    const cellAt = (r: number, c: number) => container.querySelectorAll<HTMLElement>('[role="gridcell"]')[r * 4 + c]
    keyDown(cellAt(1, 3), 'ArrowDown')
    await flush(2)
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]').length).toBe(1)
    keyDown(window, 'c')
    await flush(2)
    expect(container.querySelectorAll('.t2-colhead').length).toBe(2)
    expect(container.querySelectorAll('[role="gridcell"][tabindex="0"]').length).toBe(1)
  })
  it('the phone cards use no gridcell role outside a grid', () => {
    const { container } = render(<AbroadView width={390} simulated unis={FIXTURE_UNIS} today={FIXTURE_TODAY} cells={{}} shortlist={FIXTURE_UNIS.map((u) => u.key)} pinned={null} done={{}} trialState={{}} onShortlist={noop} onPin={noop} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop} />)
    expect(container.querySelectorAll('[role="gridcell"]').length).toBe(0)
    expect(container.querySelectorAll('.t2-ucard [role="button"]').length).toBeGreaterThan(0)
  })
  it('with nothing shortlisted the page says the four shown are not a choice, and the plate lamp follows the cells it shows', () => {
    const { container } = render(<AbroadView width={1302} unis={FIXTURE_UNIS} today={FIXTURE_TODAY} cells={{ 'app:x': { value: '2026-12-01', on: '2026-11-16' } }} shortlist={[]} pinned={null} done={{}} trialState={{}} onShortlist={noop} onPin={noop} onConfirm={noop} onClear={noop} onRack={noop} onOpenPage={noop} onStage={noop} onTrialDate={noop} />)
    expect(container.textContent).toContain('none chosen yet')
    expect(container.querySelector('[data-plate="spec"]')?.getAttribute('data-lamp')).toBe('waiting')
  })
})

describe('a PLANNED feature is not drawn as a working control', () => {
  it('Plan this gap is an inert key with the PLANNED word and its reason, and P does nothing', () => {
    const { container } = render(views(false).ladder)
    expect(buttons(container, 'Plan this gap (P)').length).toBe(0)
    const key = buttons(container, /^Plan this gap/)[0]
    expect(key).toBeTruthy()
    expect(key.getAttribute('aria-disabled')).toBe('true')
    expect(container.querySelector('.t2-planned')?.textContent).toContain('PLANNED')
    expect(() => keyDown(window, 'p')).not.toThrow()
  })
})

describe('the Tree nodes a job description is matched against', () => {
  it('come from the plan state and the bank, so they exist with no campaign and no application', () => {
    const names = { 'n-c': 'Embedded C', 'n-dsp': 'Signal processing', 'n-git': 'Version control' }
    const list = treeNodes(['n-git'], names, [])
    expect(list.map((n) => n.id)).toEqual(['n-git', 'n-c', 'n-dsp'])
    expect(matchJd('We need embedded c and signal processing.', list).map((m) => m.node).sort()).toEqual(['n-c', 'n-dsp'])
    // campaign and application nodes only fill in what the Tree does not name
    expect(treeNodes([], names, [{ id: 'x', name: 'Extra' }, { id: 'n-c', name: 'Other' }]).find((n) => n.id === 'n-c')?.name).toBe('Embedded C')
    expect(treeNodes([], names, [{ id: 'x', name: 'Extra' }]).some((n) => n.id === 'x')).toBe(true)
  })
})
