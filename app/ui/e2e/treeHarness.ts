// The Tree and Focus workspaces inside the REAL frame, in a real Chromium (chunk 10).
//
// Built in memory by Vite from a virtual entry, the same way keyboard.spec.ts builds the bare frame:
// the frame, the Tree page, the Focus page and the bank are the real modules; the other four workspaces are
// stubs and the server is a table of canned answers (page.route on a fake origin), so nothing here can reach
// port 8777 or 8778 or any data dir. The legacy stylesheets (tokens, base, mission, game) are included so the
// old SVG node styles resolve their variables as they do in the app. The frame sits where Shell puts it: 96 px
// from the left (dock + gutter), 52 px below the top (title bar), 34 px above the bottom (ticker), so the
// workspace has the room it really has at 1366x768 (about 1270 x 682 for the frame) and not the whole window.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { build } from 'vite'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const posix = (p: string) => p.split(String.fromCharCode(92)).join('/')
const src = (p: string) => posix(resolve(ROOT, 'src', p))
export const ORIGIN = 'http://ww-tree.test/'

const ENTRY = `
import React from 'react'
import { createRoot } from 'react-dom/client'
import '${src('styles/tokens.css')}'
import '${src('styles/base.css')}'
import '${src('styles/shell.css')}'
import '${src('styles/pages.css')}'
import '${src('styles/mission.css')}'
import '${src('styles/game.css')}'
import '${src('germoney/theme.css')}'
import { Frame } from '${src('ww/frame/Frame.tsx')}'
import { WwTreePage } from '${src('ww/tree/index.ts')}'
import { WwFocusPage } from '${src('ww/focus/index.ts')}'
import { useFrame } from '${src('ww/frame/frameStore.ts')}'
import { switchWorkspace } from '${src('ww/frame/navigate.ts')}'
import { usePlan } from '${src('germoney/game/plan.ts')}'
import { loadBank } from '${src('germoney/data/bank.ts')}'
import { allStatuses } from '${src('germoney/game/tree.ts')}'
const h = React.createElement
const stub = (id) => () => h('div', { 'data-page': id }, h('p', null, 'Stub ' + id))
const pages = { study: stub('study'), tree: WwTreePage, life: stub('life'), career: stub('career'), focus: WwFocusPage, setup: stub('setup') }
window.WW = {
  bank: () => { const b = loadBank(); return { n: b.order.length, branches: new Set(b.order.map((i) => b.nodes[i].branch)).size, order: b.order } },
  setPlan(mastered, inProgress) {
    const b = loadBank()
    const nodes = {}
    for (const id of mastered) nodes[id] = { status: 'mastered', mastered: '2026-11-01' }
    for (const id of inProgress) nodes[id] = { status: 'in_progress', started: '2026-11-08' }
    const rotation = { '1': { track: 'digital', label: 'Digital logic', match: [] }, '2': { track: 'math', label: 'Maths', match: [] }, '3': { track: 'ml', label: 'ML', match: [] }, '4': { track: 'academics', label: 'Academics', match: [] }, '5': { track: 'arch', label: 'Comp-arch', match: [] } }
    usePlan.setState({ state: { statuses: allStatuses(b, nodes), nodes, contracts: {}, rotation, wip_cap: 3, certs: {}, career: null }, refresh: async () => {} })
  },
  mount(el, o) { createRoot(el).render(h(Frame, { loaded: true, pages, glass: 'flat', ...o })) },
  switchWorkspace, useFrame,
}
`
let bundle: Promise<{ js: string; css: string }> | null = null
function buildHarness() {
  bundle ??= (async () => {
    const dir = resolve(ROOT, 'dist-e2e')
    mkdirSync(dir, { recursive: true })
    const entry = resolve(dir, '_tree-entry.jsx')
    writeFileSync(entry, ENTRY)
    const out = await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { write: false, minify: false, target: 'es2022', cssCodeSplit: false, lib: { entry, formats: ['iife'], name: 'WWTreeBundle', fileName: 'tree' } },
    })
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []))
    let js = ''
    let css = ''
    for (const o of outputs) {
      if (o.type === 'chunk') js += o.code
      else if (o.fileName.endsWith('.css')) css += typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
    }
    if (!js) throw new Error('the Tree harness build produced no script')
    return { js, css }
  })()
  return bundle
}

export interface Ww {
  bank(): { n: number; branches: number; order: string[] }
  setPlan(mastered: string[], inProgress: string[]): void
  mount(el: HTMLElement, o: object): void
  switchWorkspace(ws: string, view?: string | null): Promise<void>
  useFrame: { getState(): { focus: boolean; ws: string; view: string | null; back: unknown } }
}
export const W = (): Ww => (window as unknown as { WW: Ww }).WW

/** What the fake server answers. Mastery answers are per node id; anything unknown is an empty object. */
export interface Canned {
  mastery?: (id: string) => unknown
}
export const NO_GATE = 'Sharpen needs one GATE-tier question solved on this node. No GATE bank yet: the question harvester has fetched none.'
export const masteryAnswer = (id: string, status = 'mastered') => ({
  node: id, name: id, status, gate_bank: 0,
  sharpen: { allowed: false, blocker: status === 'mastered' ? NO_GATE : `Only a mastered node can be sharpened; this one is ${status.replace('_', ' ')}.`, round: 0, active: false, check: null, next: null, solved: [], spare: 0, reproved: 0, candidates: [] },
  demaster: { allowed: status === 'mastered', blocker: null, blockers: [], first: [], xp_back: 50 },
})

/** Open the real frame on `ws` at the page's current viewport. Returns the bank facts the specs need. */
export async function openTreeFrame(page: Page, opts: { ws?: string; mastered?: number; inProgress?: number; canned?: Canned } = {}) {
  const { js, css } = await buildHarness()
  const canned = opts.canned ?? {}
  const statusOf = new Map<string, string>()   // filled once the bank is known; the route reads it at request time
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number; __gaps: number[]; __sample: boolean }
    w.__raf = 0
    w.__gaps = []
    const orig = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      w.__raf++
      return orig(cb)
    }
  })
  const font = `html{--f-ui:system-ui,'Segoe UI',sans-serif;--f-mono:ui-monospace,Consolas,monospace;--f-dot:ui-monospace,Consolas,monospace}`
  const safe = js.replace(/<\/script/gi, '<' + String.fromCharCode(92) + '/script')
  const doc = `<!doctype html><html data-motion="auto"><head><meta charset="utf-8"><style>${font}</style><style>${css}</style></head><body style="margin:0"><main class="main" style="position:fixed;left:calc(var(--dock) + 20px);top:var(--titlebar);right:0;bottom:var(--ticker)"><div id="root" style="position:absolute;inset:0"></div></main><script>${safe}</script></body></html>`
  await page.route(`${ORIGIN}**`, (route) => {
    const u = new URL(route.request().url())
    const json = (b: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) })
    if (!u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: doc })
    const m = /^\/api\/mission\/mastery\/([^/]+)$/.exec(u.pathname)
    if (m) return json((canned.mastery ?? ((id: string) => masteryAnswer(id, statusOf.get(id) ?? 'available')))(decodeURIComponent(m[1])))
    if (u.pathname.startsWith('/api/kv/')) return json({ value: null })
    if (u.pathname === '/api/mission/trees') return json({ status: 'ok', trees: [] })
    if (u.pathname === '/api/aankhen/snapshot') return json({ source: null, presence: null })
    return json({})
  })
  await page.goto(ORIGIN)
  const facts = await page.evaluate(() => (window as unknown as { WW: Ww }).WW.bank())
  const mastered = facts.order.slice(0, opts.mastered ?? 3)
  const prog = facts.order.slice(opts.mastered ?? 3, (opts.mastered ?? 3) + (opts.inProgress ?? 1))
  for (const id of facts.order) statusOf.set(id, mastered.includes(id) ? 'mastered' : prog.includes(id) ? 'in_progress' : 'available')
  await page.evaluate(([m, p]) => (window as unknown as { WW: Ww }).WW.setPlan(m, p), [mastered, prog] as [string[], string[]])
  await page.evaluate(() => (window as unknown as { WW: Ww }).WW.mount(document.getElementById('root')!, {}))
  await page.waitForSelector('.ww-frame [role="tab"]')
  if (opts.ws) await page.evaluate((id) => (window as unknown as { WW: Ww }).WW.switchWorkspace(id), opts.ws)
  return { ...facts, mastered, inProgress: prog }
}
