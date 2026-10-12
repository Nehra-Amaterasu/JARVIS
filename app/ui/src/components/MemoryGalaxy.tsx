/**
 * MemoryGalaxy — Yaadash as a 3D map you can watch grow (ROADMAP Y1 + Y2).
 *
 *   the galaxy     every memory, his closest people, the beliefs JARVIS holds and the
 *                  taste topics (GalaxyScene: one Points draw call). Near = similar in
 *                  meaning. Hover for a label, click to open where it came from.
 *   the scrubber   replays the store month by month; nodes pop in as their month passes.
 *   growth         per-source stacked counts, and when JARVIS really learned them.
 *
 * Self-contained: it fetches /api/galaxy itself, so it mounts anywhere (intended: the
 * Yaadash page, above the search grid). The server serves the last layout at once and
 * marks it "stale" while a newer one builds; this component asks again until it lands
 * and then glides every known node to its new place.
 */
import { Crosshair, Pause, Play, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { fmtInt } from '../lib/format'
import {
  birthsOf, countsAt, KIND_LABEL, legend, monthLabel, provenanceOf, PROVENANCE_COLORS, PROVENANCE_LABEL,
  type ColorMode, type GalaxyPayload, type NodeDetail, type NodeKind,
} from '../lib/galaxy'
import { Presence, Ticker } from '../lib/motion'
import { GalaxyScene } from '../galaxy/GalaxyScene'
import { GrowthChart } from './GrowthChart'
import '../styles/galaxy.css'

const STALE_RETRY_MS = 2500
const STALE_TRIES = 16
const REPLAY_S = 14               // a full replay lasts about this long, whatever the span

export function MemoryGalaxy({ maxNodes = 8000, height = 540 }: { maxNodes?: number; height?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<GalaxyScene | null>(null)
  const [data, setData] = useState<GalaxyPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [mode, setMode] = useState<ColorMode>('provenance')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [edgesOn, setEdgesOn] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [uiMonth, setUiMonth] = useState(0)
  const [selected, setSelected] = useState<number>(-1)
  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [detailErr, setDetailErr] = useState('')

  const M = data?.growth.months.length ?? 0
  const cur = useRef(0)            // the scene's month, fractional, in UI slots (-1 = before the first)
  const target = useRef(0)
  const playingRef = useRef(false)
  const raf = useRef(0)
  const lastT = useRef(0)
  const uiRef = useRef(0)

  /* ---------------------------------------------------------------- scene */
  useEffect(() => {
    const s = new GalaxyScene(host.current!)
    scene.current = s
    return () => { cancelAnimationFrame(raf.current); s.dispose(); scene.current = null }
  }, [])

  const selectedId = useRef<string | null>(null)
  const openNode = useCallback((i: number) => {
    setSelected(i)
    scene.current?.select(i >= 0 ? i : null)
  }, [])
  useEffect(() => { if (scene.current) scene.current.onPick = openNode }, [openNode])

  /* ---------------------------------------------------------------- data */
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let tries = 0
    const run = async (refresh: boolean) => {
      try {
        const p = await api<GalaxyPayload>(`/api/galaxy?max_nodes=${maxNodes}${refresh ? '&refresh=true' : ''}`)
        if (!alive) return
        setData(p)
        setError(null)
        if (p.stale && tries++ < STALE_TRIES) timer = window.setTimeout(() => void run(false), STALE_RETRY_MS)
      } catch (e) {
        if (alive) setError((e as Error).message || 'The galaxy could not be loaded.')
      } finally {
        if (alive) { setLoading(false); setRefreshing(false) }
      }
    }
    void run(reload > 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [maxNodes, reload])

  // push a new payload into the scene; stay on "now" if we were on "now"
  const prevM = useRef(0)
  useEffect(() => {
    const s = scene.current
    if (!s || !data) return
    const wasAtEnd = cur.current >= prevM.current - 1
    prevM.current = data.growth.months.length
    s.setData(data, mode)
    s.setPopMonths(Math.max(0.35, (data.growth.months.length / REPLAY_S) * 0.45))
    if (wasAtEnd || !playingRef.current) {
      const end = Math.max(0, data.growth.months.length - 1)
      if (wasAtEnd) { cur.current = end; target.current = end }
      s.setMonth(cur.current + 1)
      setUiMonth(Math.floor(cur.current))
    }
    // Node ids are stable across layouts, so an open card survives a refresh.
    const keep = selectedId.current ? data.nodes.findIndex((n) => n.id === selectedId.current) : -1
    setSelected(keep)
    if (keep < 0) { selectedId.current = null; setDetail(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  useEffect(() => { scene.current?.setColorMode(mode); setHidden(new Set()) }, [mode])
  useEffect(() => { scene.current?.setHidden(hidden) }, [hidden])
  useEffect(() => { scene.current?.setEdgesVisible(edgesOn) }, [edgesOn])

  /* ---------------------------------------------------------------- time */
  const drive = useCallback(() => {
    if (raf.current) return
    lastT.current = performance.now()
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - lastT.current) / 1000)
      lastT.current = t
      const end = Math.max(0, prevM.current - 1)
      if (playingRef.current) {
        target.current = Math.min(end, target.current + dt * Math.max(1.5, prevM.current / REPLAY_S))
        cur.current = target.current
        if (target.current >= end) { playingRef.current = false; setPlaying(false) }
      } else {
        cur.current += (target.current - cur.current) * (1 - Math.exp(-dt * 9))
        if (Math.abs(target.current - cur.current) < 0.002) cur.current = target.current
      }
      scene.current?.setMonth(cur.current + 1)
      const ui = Math.max(0, Math.floor(cur.current + 1e-6))
      if (ui !== uiRef.current) { uiRef.current = ui; setUiMonth(ui) }
      if (playingRef.current || cur.current !== target.current) raf.current = requestAnimationFrame(step)
      else raf.current = 0
    }
    raf.current = requestAnimationFrame(step)
  }, [])

  const scrubTo = useCallback((m: number) => {
    playingRef.current = false
    setPlaying(false)
    target.current = m
    drive()
  }, [drive])

  const togglePlay = () => {
    if (playingRef.current) { playingRef.current = false; setPlaying(false); return }
    if (cur.current >= M - 1) { cur.current = -1; target.current = -1 }   // from the beginning
    playingRef.current = true
    setPlaying(true)
    drive()
  }

  /* ---------------------------------------------------------------- detail */
  useEffect(() => {
    if (!data || selected < 0) { selectedId.current = null; setDetail(null); setDetailState('idle'); return }
    const node = data.nodes[selected]
    if (!node) return
    selectedId.current = node.id
    let alive = true
    setDetailState('loading')
    api<NodeDetail>(`/api/galaxy/node?id=${encodeURIComponent(node.id)}`)
      .then((d) => { if (alive) { setDetail(d); setDetailState('idle') } })
      .catch((e: unknown) => {
        if (!alive) return
        setDetailState('error')
        setDetailErr(e instanceof ApiError && e.status === 404 ? 'The layout changed since — reload the galaxy.' : (e as Error).message)
      })
    return () => { alive = false }
  }, [selected, data])

  const goTo = (id: string) => {
    if (!data) return
    const i = data.nodes.findIndex((n) => n.id === id)
    if (i < 0) return
    setSelected(i)
    scene.current?.select(i, true)
  }

  /* ---------------------------------------------------------------- derived */
  const births = useMemo(() => (data ? birthsOf(data) : new Float32Array(0)), [data])
  const counts = useMemo(() => (data ? countsAt(data, births, uiMonth) : null), [data, births, uiMonth])
  const legendRows = useMemo(() => (data ? legend(data, mode) : []), [data, mode])
  const atEnd = !data || uiMonth >= M - 1
  const empty = data !== null && data.nodes.length === 0
  const selNode = data && selected >= 0 ? data.nodes[selected] : null

  const toggleGroup = (k: string) => setHidden((h) => {
    const next = new Set(h)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })

  return (
    <section className="card galaxy-card rise" style={{ ['--gx-h' as string]: `${height}px` }}>
      <div className="gx-head">
        <span className="card-title"><span className="track">G</span>Memory galaxy</span>
        <div className="gx-pills">
          {data && (
            <span className="pill" title="Memories drawn / memories in the store">
              <Ticker value={data.counts.memories_shown} fmt={fmtInt} />&nbsp;of&nbsp;<Ticker value={data.counts.memories} fmt={fmtInt} />&nbsp;memories
            </span>
          )}
          {data?.sampled && (
            <span className="pill" title="Every confirmed fact is drawn; the rest is a stable sample of the store">sampled</span>
          )}
          {data?.stale && <span className="pill scan" title="Showing the previous layout while the new one is computed">updating layout…</span>}
          {data && !data.stale && data.cached === false && <span className="pill live pop" title={`Laid out in ${data.build_ms} ms`}><i className="led" />new layout</span>}
        </div>
        <div className="gx-actions">
          <div className="seg" aria-label="Colour by">
            <button className={mode === 'provenance' ? 'on' : ''} onClick={() => setMode('provenance')}>Provenance</button>
            <button className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')}>Source</button>
          </div>
          <button className={`chip press ${edgesOn ? 'on-soft' : ''}`} onClick={() => setEdgesOn((v) => !v)} aria-pressed={edgesOn}>links</button>
          <button className="btn icon sm ghost" title="Reset view" aria-label="Reset view" onClick={() => scene.current?.resetCamera()}><Crosshair size={14} /></button>
          <button className="btn icon sm ghost" title="Lay out again now" aria-label="Lay out again"
            disabled={refreshing} onClick={() => { setRefreshing(true); setReload((r) => r + 1) }}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="gx-stage">
        <div ref={host} className={`gx-host ${data?.stale ? 'stale' : ''}`} />

        {loading && !data && (
          <div className="gx-overlay scan">
            <div className="gx-msg">
              <span className="eyebrow">Yaadash</span>
              <b>Laying out the galaxy…</b>
              <span className="muted">The first open projects every memory into 3D; later opens come from the cache.</span>
            </div>
          </div>
        )}
        {error && !data && (
          <div className="gx-overlay">
            <div className="gx-msg pop">
              <X size={18} className="fault" />
              <b>The galaxy could not be loaded</b>
              <span className="muted">{error}</span>
              <button className="btn sm" onClick={() => { setLoading(true); setError(null); setReload((r) => r + 1) }}>Try again</button>
            </div>
          </div>
        )}
        {empty && (
          <div className="gx-overlay">
            <div className="gx-msg pop">
              <b>No memories yet</b>
              <span className="muted">The galaxy grows as JARVIS learns: imports, conversations and facts you confirm.</span>
            </div>
          </div>
        )}

        {data && !empty && (
          <div className="gx-legend rise" style={{ ['--i' as string]: 1 }}>
            {legendRows.map((r) => (
              <button key={r.key} className={`gx-leg press ${hidden.has(r.key) ? 'off' : ''}`} onClick={() => toggleGroup(r.key)}
                aria-pressed={!hidden.has(r.key)} title={hidden.has(r.key) ? 'Show' : 'Hide'}>
                {r.color ? <i className="gx-sw glow" style={{ background: r.color, color: r.color }} /> : <Glyph kind={r.key as NodeKind} />}
                <span>{r.label}</span>
                <span className="mono muted"><Ticker value={r.count} fmt={fmtInt} /></span>
              </button>
            ))}
            <div className="gx-shapes mono muted" aria-label="Shapes">
              <span><Glyph kind="memory" />memory</span><span><Glyph kind="person" />person</span>
              <span><Glyph kind="belief" />belief</span><span><Glyph kind="topic" />topic</span>
            </div>
          </div>
        )}

        <Presence show={selected >= 0 && !!selNode}>
          <aside className="gx-detail glass-thin">
            {selNode && (
              <>
                <div className="gx-detail-head">
                  <span className="pill" style={{ color: PROVENANCE_COLORS[provenanceOf(selNode)] }}>
                    <Glyph kind={selNode.kind} />{KIND_LABEL[selNode.kind]}
                  </span>
                  <span className={`pill ${provenanceOf(selNode) === 'confirmed' ? 'live' : provenanceOf(selNode) === 'inferred' ? 'sim' : ''}`}>
                    {PROVENANCE_LABEL[provenanceOf(selNode)]}
                  </span>
                  <button className="btn icon sm ghost" aria-label="Close" onClick={() => openNode(-1)}><X size={14} /></button>
                </div>
                {detailState === 'loading' && !detail && <div className="gx-skel"><i className="skeleton scan" /><i className="skeleton scan" /><i className="skeleton scan" /></div>}
                {detailState === 'error' && <div className="banner"><X size={14} className="fault" />{detailErr}</div>}
                {detail && detail.id === selNode.id && <DetailBody d={detail} onLink={goTo} />}
              </>
            )}
          </aside>
        </Presence>
      </div>

      {data && !empty && (
        <div className="gx-time">
          <button className="btn icon sm" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Replay the growth'}
            title={playing ? 'Pause' : 'Replay the growth month by month'}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <input type="range" className="slider" min={0} max={Math.max(0, M - 1)} step={1} value={Math.min(uiMonth, Math.max(0, M - 1))}
            aria-label="Month" style={{ ['--pct' as string]: `${M > 1 ? (uiMonth / (M - 1)) * 100 : 100}%` }}
            onChange={(e) => scrubTo(Number(e.target.value))} />
          <div className="gx-when">
            <b className="dot">{atEnd ? 'Now' : monthLabel(data.growth.months[uiMonth])}</b>
            <span className="mono muted">
              <Ticker value={counts?.memory} fmt={fmtInt} /> mem · <Ticker value={counts?.person} fmt={fmtInt} /> ppl ·{' '}
              <Ticker value={counts?.belief} fmt={fmtInt} /> beliefs
            </span>
          </div>
        </div>
      )}

      {data && !empty && <GrowthChart growth={data.growth} month={uiMonth} onScrub={scrubTo} />}
    </section>
  )
}

function Glyph({ kind }: { kind: NodeKind }) {
  return <i className={`gx-glyph gx-g-${kind}`} aria-hidden="true" />
}

function DetailBody({ d, onLink }: { d: NodeDetail; onLink: (id: string) => void }) {
  return (
    <div className="gx-detail-body fade-in">
      <div className="gx-detail-label">{d.kind === 'person' ? d.label : d.snippet ?? d.label}</div>
      <div className="kv gx-kv">
        {d.source && <><span>Source</span><span className="mono">{d.source}</span></>}
        {d.date && <><span>{d.kind === 'person' ? 'First message' : d.kind === 'belief' ? 'Updated' : 'Date'}</span><span className="mono">{d.date}</span></>}
        {d.last && <><span>Last message</span><span className="mono">{d.last}</span></>}
        {d.closeness !== undefined && d.closeness !== null && <><span>Closeness</span><span className="mono">{d.closeness.toFixed(0)} / 100{d.rank ? ` · #${d.rank}` : ''}</span></>}
        {d.n_msgs !== undefined && <><span>Messages</span><span className="mono">{fmtInt(d.n_msgs)}</span></>}
        {d.why && <><span>Why</span><span>{d.why}</span></>}
        {d.status && <><span>Status</span><span className="mono">{d.status}</span></>}
        {d.confidence !== undefined && d.confidence !== null && <><span>Confidence</span><span className="mono">{Math.round(d.confidence * 100)}%</span></>}
        {d.support !== undefined && <><span>Supported by</span><span className="mono">{d.support} message{d.support === 1 ? '' : 's'}</span></>}
        {d.words && <><span>Words</span><span>{d.words.slice(0, 8).join(' · ')}</span></>}
        {d.trend && <><span>Trend</span><span className="mono">{d.trend}</span></>}
      </div>
      {d.kind === 'memory' && d.family === 'voice' && (
        <div className="pill sim gx-note">JARVIS’s own words · never verified</div>
      )}
      {d.kind === 'topic' && <div className="pill sim gx-note">Name inferred by the local model</div>}
      {d.links.length > 0 && (
        <div className="gx-links">
          <span className="eyebrow">Linked</span>
          {d.links.map((l, i) => (
            <button key={l.id} className="gx-link press rise" style={{ ['--i' as string]: i }} onClick={() => onLink(l.id)}>
              <Glyph kind={l.kind} /><span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
