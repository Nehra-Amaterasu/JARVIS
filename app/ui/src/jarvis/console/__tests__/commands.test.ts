// What each closed verb does (A.J05, spec 20.9.5): a read answers at once from what is on the screen, a heavy verb asks once
// and only then calls its route, an unwritten route answers PLANNED and never pretends, and a failing route answers FAULT with
// its reason. No verb outside the table exists (model.test.ts); this file pins what each one says and calls.
import { describe, expect, it, vi } from 'vitest'
import { JARVIS_PLANNED } from '../../planned'
import { askLine, readVerb, runHeavy, type CommandContext } from '../commands'
import { healthRows, type JobSpec } from '../model'
import { FIXED_NOW, LAT_ON, VITALS_ON } from '../fixtures'

const rows = healthRows({ online: true, lat: LAT_ON, crew: null, vitals: VITALS_ON, now: FIXED_NOW })
const jobs: JobSpec[] = [
  { id: 'a', tag: 'BRD', label: 'compile', fraction: 0.5, state: 'live' },
  { id: 'b', tag: 'SYS', label: 'wake', state: 'hollow' },
  { id: 'c', tag: 'SYS', label: 'flash', state: 'fault', reason: 'no port' },
]
const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  rows: () => rows, jobs: () => jobs, plan: () => JARVIS_PLANNED, restartBrain: vi.fn(async () => 'restarting'), freeGpu: vi.fn(async () => 'freed 1 GB'), exportMemory: null, ...over,
})

describe('the read verbs', () => {
  it('status prints the seven rows with their tags and lamp states', () => {
    const out = readVerb('status', ctx())
    expect(out.map((l) => l.tag)).toEqual(['HEA', 'WAK', 'TIM', 'BRN', 'GPU', 'STW', 'APP'])
    expect(out[0].text).toContain('can he hear "Hey Jarvis": yes')
  })
  it('test hearing reads the core and says plainly that it plays no sound', () => {
    const out = readVerb('test hearing', ctx())
    expect(out[0].tag).toBe('HEA')
    expect(out[1].text).toContain('plays no sound')
  })
  it('jobs draws a bar only for a reported fraction; a hollow job is dashes and a double dash; a failure keeps its state', () => {
    const out = readVerb('jobs', ctx())
    expect(out[0].text).toContain('[######------] 50 %')
    expect(out[1].text).toContain('[------------] --')
    expect(out[2].state).toBe('fault')
    expect(readVerb('jobs', ctx({ jobs: () => [] }))[0].text).toBe('no job is running')
  })
  it('plan opens the roadmap and lists what is planned', () => {
    const openPlan = vi.fn()
    const out = readVerb('plan', ctx({ openPlan }))
    expect(openPlan).toHaveBeenCalledTimes(1)
    expect(out[0].text).toMatch(/on the route; the roadmap is open/)
    expect(out.length).toBeGreaterThan(1)
  })
  it('help names every verb, the ones that ask once apart from the ones that only read, in four lines', () => {
    const out = readVerb('help', ctx())
    expect(out).toHaveLength(4)
    const all = out.map((l) => l.text).join(' | ')
    for (const v of ['status', 'test hearing', 'restart brain', 'free gpu', 'export memory', 'jobs', 'plan', 'help']) expect(all).toContain(v)
    expect(out[1].text).toContain('asks once')
    expect(all).toContain('there is no shell')
  })
  it('a word that is not a verb is refused with the spec words', () => {
    expect(readVerb('rm', ctx())).toEqual([{ tag: 'SYS', state: 'fault', kind: 'out', text: 'unknown verb; try help' }])
  })
})

describe('the heavy verbs', () => {
  it('ask once, with what they would do, and call nothing', () => {
    const c = ctx()
    for (const v of ['restart brain', 'free gpu', 'export memory']) {
      const q = askLine(v)
      expect(q.kind).toBe('ask')
      expect(q.text.startsWith(`${v}:`)).toBe(true)
      expect(q.text.endsWith('Run it?')).toBe(true)
    }
    expect(c.restartBrain).not.toHaveBeenCalled()
    expect(c.freeGpu).not.toHaveBeenCalled()
  })
  it('run their route after the yes and report its words', async () => {
    const c = ctx()
    expect((await runHeavy('restart brain', c))[0]).toMatchObject({ state: 'live', text: 'restarting' })
    expect((await runHeavy('free gpu', c))[0].text).toBe('freed 1 GB')
    expect(c.restartBrain).toHaveBeenCalledTimes(1)
    expect(c.freeGpu).toHaveBeenCalledTimes(1)
  })
  it('export memory with no route answers PLANNED, never LIVE', async () => {
    expect((await runHeavy('export memory', ctx()))[0]).toMatchObject({ state: 'planned', text: expect.stringContaining('not built') })
    expect((await runHeavy('export memory', ctx({ exportMemory: async () => 'written' })))[0]).toMatchObject({ state: 'live', text: 'written' })
  })
  it('a route that throws answers FAULT with its message', async () => {
    const out = await runHeavy('free gpu', ctx({ freeGpu: async () => { throw new Error('ollama is not answering') } }))
    expect(out[0]).toMatchObject({ state: 'fault', text: 'ollama is not answering' })
  })
  it('an unknown heavy verb is refused', async () => {
    expect((await runHeavy('format c', ctx()))[0].state).toBe('fault')
  })
})
