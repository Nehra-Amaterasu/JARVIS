/**
 * Dev-only preview of the MemoryGalaxy card (galaxy-demo.html, never built) with the
 * API answered in the page by SYNTHETIC data, so the component can be looked at and
 * timed without a server or anyone's memory. The first answer is marked stale and the
 * second adds 300 nodes, which exercises the refresh glide and the pop-ins.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/pages.css'
import '../styles/motion.css'
import { MemoryGalaxy } from '../components/MemoryGalaxy'
import { synthPayload, type GalaxyPayload, type NodeDetail } from '../lib/galaxy'

const n = Number(new URLSearchParams(location.search).get('n') ?? 6000)
const first = synthPayload(n, 5)
const grown = synthPayload(n + 300, 5)            // same seed: the first n nodes are the same
let calls = 0
let current: GalaxyPayload = first

const realFetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('/api/galaxy/node')) {
    const id = new URL(url, location.href).searchParams.get('id')
    const node = current.nodes.find((x) => x.id === id)
    if (!node) return json({ detail: 'No such node' }, 404)
    const d: NodeDetail = {
      id: node.id, kind: node.kind, label: node.label, time: node.time, source: `synthetic:${node.source}`,
      family: node.source, date: node.time, snippet: `${node.label} — synthetic text for the preview page, not a memory.`,
      status: node.status, confidence: node.kind === 'belief' ? 0.62 : undefined,
      links: current.edges.filter(([a, b]) => current.nodes[a]?.id === id || current.nodes[b]?.id === id).slice(0, 6)
        .map(([a, b]) => current.nodes[current.nodes[a].id === id ? b : a])
        .map((x) => ({ id: x.id, kind: x.kind, label: x.label })),
    }
    await new Promise((r) => setTimeout(r, 250))
    return json(d)
  }
  if (url.includes('/api/galaxy')) {
    calls++
    await new Promise((r) => setTimeout(r, calls === 1 ? 600 : 300))
    current = calls === 1 ? first : grown
    return json({ ...current, stale: calls === 1, cached: calls !== 1 ? false : true, build_ms: 1234 })
  }
  return realFetch(input, init)
}

document.body.style.overflow = 'auto'
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div className="banner sim">Preview with SYNTHETIC nodes — not memory data.</div>
      <MemoryGalaxy />
    </div>
  </StrictMode>,
)
