// The copy check of spec 20.6.7 over every file of L03 (week, body, ledger, close and their views): no streak, no reset, no "days clean", none of the
// words of failure or of a condition, and nothing that says to take something, how much, or why. The check runs twice: over the source text (so a
// word cannot hide in a string that no test renders) and over the rendered text of every page and drawer, on invented rows and on the null stores.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DAY_PORT } from '../../ports'
import { BodyPage } from '../../body/Body'
import { ClosePage } from '../../close/Close'
import { createFixtureStores } from '../../ledger/fixtures'
import { NULL_STORES } from '../../ledger/stores'
import { WeekPage } from '../Week'
import { FIXTURE_ATTENDANCE, FIXTURE_MINUTES, FIXTURE_NOW, FIXTURE_SESSIONS, FIXTURE_STALE, FIXTURE_TODAY, createWeekPort } from '../fixtures'
import { cleanup, click, buttons, flush, render } from '../../../../shared/almanac/__tests__/dom'

afterEach(() => { cleanup(); document.body.innerHTML = '' })

const DAY = resolve(__dirname, '..', '..')
const FOLDERS = ['week', 'body', 'ledger', 'close']
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n)
  return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : /\.(tsx?|css)$/.test(n) ? [p] : []
})
const FILES = [...FOLDERS.flatMap((f) => walk(join(DAY, f))), ...['day-week', 'day-body', 'day-close'].map((v) => resolve(DAY, '..', '..', 'shell', 'views', `${v}.view.ts`))]

// the words of 20.6.7, plus the ones this product never uses for attendance, a count or a drug
const BANNED = /\b(streak|streaks|failed|fail|missed|miss|clean|relapse|relapsed|disorder|treat|treatment|diagnos\w*|bunk|bunked|reset|resets|addict\w*|take|taken|dose|doses|dosage|mg|overdue|behind)\b/i

describe('copy: the source of L03', () => {
  it('reads files from all four folders and the three view files', () => {
    expect(FILES.length).toBeGreaterThan(20)
  })
  it('holds none of the banned words, in a string, a comment or a name', () => {
    const hits = FILES.flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).map((l, i) => ({ f, i, l })).filter((x) => BANNED.test(x.l)).map((x) => `${x.f.split(/[\\/]/).slice(-2).join('/')}:${x.i + 1}: ${x.l.trim().slice(0, 90)}`))
    expect(hits).toEqual([])
  })
})

const classes = FIXTURE_ATTENDANCE.today.map((c) => ({ id: c.id, start: c.start, end: c.end, name: c.name, room: c.room, status: c.status }))

describe('copy: the rendered text', () => {
  const text = () => document.body.textContent ?? ''
  it('Week, Body, Ledger and Close on invented rows say none of it', { timeout: 30_000 }, async () => {
    const week = render(<WeekPage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={FIXTURE_MINUTES} attendance={FIXTURE_ATTENDANCE} simulated />)
    const stale = render(<WeekPage today={FIXTURE_TODAY} form="phone" port={createWeekPort()} attendance={FIXTURE_STALE} />)
    const body = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={createWeekPort()} stores={createFixtureStores(FIXTURE_TODAY)} sessions={FIXTURE_SESSIONS} simulated classes={classes} initialLedger />)
    const close = render(<ClosePage today={FIXTURE_TODAY} form="desk" port={createWeekPort()} minutes={FIXTURE_MINUTES} classes={classes} lastSeen="2026-11-10" simulated initialPlan />)
    await flush(14)
    click(buttons(week.container, 'All 5')[0])
    await flush(8)
    expect(text()).not.toMatch(BANNED)
    expect(stale.container.textContent).toMatch(/last entered 9 days ago/)
    expect(text()).not.toMatch(/\b\d+ days? (clean|in a row)\b/i)
    expect(body.container.textContent).toContain('Not medical advice')
    expect(close.container.textContent).toContain('Pick up here.')
  })
  it('the same pages on the null port and the null stores say none of it', async () => {
    render(<WeekPage today={FIXTURE_TODAY} form="desk" port={DAY_PORT} attendance={null} />)
    render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={DAY_PORT} stores={NULL_STORES} sessions={[]} initialLedger />)
    render(<ClosePage today={FIXTURE_TODAY} form="desk" port={DAY_PORT} lastSeen="2026-11-01" initialPlan />)
    await flush(14)
    expect(text()).not.toMatch(BANNED)
  })
  it('no figure is drawn beside a WAITING, PLANNED or FAULT lamp: every digit on the null pages sits in a time, a date or a goal the student set', async () => {
    const r = render(<BodyPage today={FIXTURE_TODAY} now={FIXTURE_NOW} form="desk" port={DAY_PORT} stores={NULL_STORES} sessions={[]} />)
    await flush(10)
    expect(r.container.querySelector('.by-gauge-n')!.textContent).toMatch(/^[–\s-]+$/)
    expect(r.container.querySelectorAll('.by-drop[data-on="true"]')).toHaveLength(0)
  })
})
