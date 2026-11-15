// The live ports (A.J04, rule 2 of the wave bulletin): the Memory views call only routes that exist, with the bodies the classic
// pages sent. The first test reads the server's own route table, so a route invented here fails by name; the rest drive the
// real functions against a stub fetch and read what was sent.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_BELIEFS, LIVE_PEOPLE, LIVE_RECALL, LIVE_REMINDERS, LIVE_SOURCES, GALAXY_MAX } from '../port'

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'jarvis_app')

function serverRoutes(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = []
  for (const f of readdirSync(SERVER).filter((n) => n.endsWith('.py'))) {
    const text = readFileSync(join(SERVER, f), 'utf8')
    for (const m of text.matchAll(/@app\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/g)) out.push({ method: m[1].toUpperCase(), path: m[2] })
  }
  return out
}
const matches = (route: string, called: string) => new RegExp(`^${route.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(called)

afterEach(() => vi.unstubAllGlobals())

function stubFetch(answer: unknown = {}) {
  const f = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', f)
  return f
}
const lastCall = (f: ReturnType<typeof vi.fn>) => {
  const [url, init] = f.mock.calls.at(-1) as unknown as [string, { method?: string; body?: string }]
  return { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined }
}

describe('every route the Memory ports call exists on the server', () => {
  it('reads the route table of app/jarvis_app and finds each call in it', async () => {
    const routes = serverRoutes()
    expect(routes.length).toBeGreaterThan(100)
    const f = stubFetch([])
    const calls: { url: string; method: string }[] = []
    const run = async (fn: () => Promise<unknown>) => { await fn().catch(() => undefined); calls.push(lastCall(f)) }
    await run(() => LIVE_RECALL.stats())
    await run(() => LIVE_RECALL.galaxy())
    await run(() => LIVE_RECALL.detail('m1'))
    await run(() => LIVE_RECALL.search('x'))
    await run(() => LIVE_RECALL.capture('x'))
    await run(() => LIVE_RECALL.fix('a', 'b'))
    await run(() => LIVE_RECALL.taste())
    await run(() => LIVE_BELIEFS.questions(3))
    await run(() => LIVE_BELIEFS.confirmed(5))
    await run(() => LIVE_BELIEFS.answer('b1', 'confirmed'))
    await run(() => LIVE_BELIEFS.learned(4))
    await run(() => LIVE_BELIEFS.review('l1', 'keep'))
    await run(() => LIVE_PEOPLE.people(60))
    await run(() => LIVE_REMINDERS.view())
    await run(() => LIVE_REMINDERS.add('tea in 10 min'))
    await run(() => LIVE_REMINDERS.cancel('r1'))
    await run(() => LIVE_SOURCES.list())
    await run(() => LIVE_SOURCES.request('instagram'))
    await run(() => LIVE_SOURCES.importPath('instagram', 'C:\\x.zip'))
    await run(() => LIVE_SOURCES.open('instagram'))
    const missing = calls.filter((c) => !routes.some((r) => r.method === c.method && matches(r.path, c.url.split('?')[0])))
    expect(missing).toEqual([])
    expect(calls).toHaveLength(20)
  })

  it('there is no route that deletes one stored item, so `remove` is null and the view draws Delete PLANNED', () => {
    expect(LIVE_RECALL.remove).toBeNull()
    const routes = serverRoutes().filter((r) => r.path.startsWith('/api/memory') || r.path.startsWith('/api/galaxy'))
    expect(routes.filter((r) => r.method === 'DELETE')).toEqual([])
  })
})

describe('the bodies are the classic ones', () => {
  it('the layout is asked for a bounded number of nodes, and the counts come with it', async () => {
    const f = stubFetch({ nodes: [] })
    await LIVE_RECALL.galaxy()
    expect(lastCall(f).url).toBe(`/api/galaxy?max_nodes=${GALAXY_MAX}`)
    expect(GALAXY_MAX).toBeLessThanOrEqual(1000)
  })
  it('a capture is the one write the store has: a correction with no question, and `added` comes from the route', async () => {
    const f = stubFetch({ ok: true, added: false })
    expect(await LIVE_RECALL.capture('the spare key is in the blue tin')).toEqual({ added: false })
    expect(lastCall(f)).toMatchObject({ url: '/api/memory/teach', method: 'POST', body: { answer: 'the spare key is in the blue tin', question: '' } })
  })
  it('a fix sends the old wording as the question and the new one as the answer', async () => {
    const f = stubFetch({ ok: true, added: true })
    await LIVE_RECALL.fix('old words', 'new words')
    expect(lastCall(f).body).toEqual({ answer: 'new words', question: 'old words' })
  })
  it('a belief verdict keeps the correction the way pages/Yaadash.tsx sent it', async () => {
    const f = stubFetch({ ok: true })
    await LIVE_BELIEFS.answer('b1', 'rejected', 'the blue folder')
    expect(lastCall(f)).toMatchObject({ url: '/api/memory/beliefs/b1', body: { verdict: 'rejected', correction: 'the blue folder' } })
    await LIVE_BELIEFS.answer('b2', 'confirmed')
    expect(lastCall(f).body).toEqual({ verdict: 'confirmed', correction: null })
  })
  it('a learned verdict, a reminder and a cancel use their own routes', async () => {
    const f = stubFetch({ ok: true })
    await LIVE_BELIEFS.review('l 1', 'wrong')
    expect(lastCall(f)).toMatchObject({ url: '/api/memory/learned/l%201', body: { verdict: 'wrong' } })
    await LIVE_REMINDERS.add('tea in 10 min')
    expect(lastCall(f)).toMatchObject({ url: '/api/reminders', body: { phrase: 'tea in 10 min', origin: 'app' } })
    await LIVE_REMINDERS.cancel('r1')
    expect(lastCall(f)).toMatchObject({ url: '/api/reminders/r1', method: 'DELETE' })
  })
  it('a route that fails is an error with the route\'s own words, never an empty success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Could not lay out the memory galaxy: locked' }), { status: 503 })))
    await expect(LIVE_RECALL.galaxy()).rejects.toThrow('Could not lay out the memory galaxy: locked')
  })
})
