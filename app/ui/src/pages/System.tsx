/**
 * System: the numbers that decide whether JARVIS works on this laptop.
 * The VRAM bar is split by who holds the memory (the LLM vs everything else) and
 * marked at the 6 GB ceiling. Models on disk flag the ones JARVIS doesn't use —
 * disk was a real problem on this machine. Logs and the engineering log close it out.
 */
import { useEffect, useRef } from 'react'
import { api, post } from '../lib/api'
import { clock, fmt, fmtGb, fmtInt, usePoll } from '../lib/format'
import { useStore } from '../lib/store'
import { PageHeader } from '../components/Shell'

interface Models { huggingface: { name: string; size_mb: number }[]; ollama: { name: string; size_mb: number; params: string; quant: string }[] | null }

// Models the current JARVIS stack actually loads (agent.py, jarvis.py, yaadash_v2.py).
const IN_USE = ['qwen3:4b-instruct-2507', 'BAAI/bge-small-en-v1.5', 'mobiuslabsgmbh/faster-whisper-large-v3-turbo']

export function SystemPage() {
  const vitals = useStore((s) => s.vitals)
  const refresh = useStore((s) => s.refreshVitals)
  const toast = useStore((s) => s.toast)
  const [models] = usePoll(() => api<Models>('/api/system/models'), 60000)
  const [logs] = usePoll(() => api<{ t: number; line: string }[]>('/api/core/logs?n=250'), 2500)
  const [decisions] = usePoll(() => api<{ title: string; summary: string }[]>('/api/decisions?limit=8'), 0)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [logs])

  const gpu = vitals?.gpu
  const total = gpu?.mem_total_mb ?? 6144
  const llm = (vitals?.ollama ?? []).reduce((s, m) => s + m.vram_mb, 0)
  const used = gpu?.mem_used_mb ?? 0
  const other = Math.max(0, used - llm)
  const timings = vitals?.core?.timings ?? {}

  return (
    <div className="page fade-in">
      <PageHeader tab="system" />
      <div className="sys-grid">
        <section className="card span-8">
          <div className="card-head">
            <span className="card-title"><span className="track">D1</span>GPU memory · {gpu?.name ?? 'GPU not readable'}</span>
            <span className="mono">{fmtGb(used, 2)} / {fmtGb(total, 1)} GB</span>
          </div>
          <div className="vram-big">
            <div className="vram-seg llm" style={{ width: `${(llm / total) * 100}%` }}>{llm > 300 ? `LLM ${fmtGb(llm)} GB` : ''}</div>
            <div className="vram-seg other" style={{ width: `${(other / total) * 100}%` }}>{other > 500 ? `other ${fmtGb(other)} GB` : ''}</div>
          </div>
          <div className="vram-legend">
            <span><i style={{ background: 'var(--ink)' }} />Qwen3-4B via Ollama</span>
            <span><i style={{ background: 'rgba(255,255,255,0.35)' }} />Whisper, desktop, everything else</span>
            <span><i style={{ background: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 0 0 1px var(--hair-2)' }} />free</span>
          </div>
          <div className="gauge-row" style={{ marginTop: 20 }}>
            <Gauge label="GPU load" value={gpu?.util != null ? `${gpu.util}%` : '—'} pct={gpu?.util ?? 0} />
            <Gauge label="GPU temp" value={gpu?.temp_c != null ? `${gpu.temp_c}°` : '—'} pct={(gpu?.temp_c ?? 0) / 95 * 100} />
            <Gauge label="CPU" value={vitals ? `${fmt(vitals.cpu_pct, 0)}%` : '—'} pct={vitals?.cpu_pct ?? 0} />
            <Gauge label="RAM" value={vitals ? `${fmtGb(vitals.ram_used_mb)}/${fmtGb(vitals.ram_total_mb, 0)}G` : '—'} pct={vitals ? vitals.ram_used_mb / vitals.ram_total_mb * 100 : 0} />
          </div>
        </section>

        <section className="card span-4">
          <div className="card-head"><span className="card-title"><span className="track">D2</span>Loaded in VRAM now</span></div>
          {vitals?.ollama === null && <div className="empty">Ollama isn’t reachable.</div>}
          {vitals?.ollama?.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nothing loaded. The LLM loads on JARVIS’s first question and stays 30 min.</div>}
          {vitals?.ollama?.map((m) => (
            <div key={m.name} className="model-row">
              <span>{m.name}</span><span className="mono">{fmtGb(m.vram_mb)} GB</span>
              <button className="btn sm" onClick={async () => {
                await post('/api/system/unload', { model: m.name })
                toast(`Unloaded ${m.name}`, 'info')
                void refresh()
              }}>Unload</button>
            </div>
          ))}
          <div className="kv" style={{ marginTop: 18 }}>
            <span>Disk free</span><span className="mono">{vitals ? `${vitals.disk_free_gb} / ${vitals.disk_total_gb} GB` : '—'}</span>
            <span>Hearing (STT)</span><span className="mono">{timings.stt !== undefined ? `${fmt(timings.stt, 2)} s` : '—'}</span>
            <span>First word</span><span className="mono">{timings.first_token !== undefined ? `${fmt(timings.first_token, 2)} s` : '—'}</span>
            <span>Full reply</span><span className="mono">{timings.reply !== undefined ? `${fmt(timings.reply, 2)} s` : '—'}</span>
          </div>
        </section>

        <section className="card span-6">
          <div className="card-head"><span className="card-title"><span className="track">D3</span>Models on disk</span>
            <span className="mono muted">amber = not used by JARVIS</span></div>
          {[...(models?.ollama ?? []).map((m) => ({ name: m.name, size_mb: m.size_mb, kind: 'ollama' })),
            ...(models?.huggingface ?? []).map((m) => ({ ...m, kind: 'hf' }))]
            .sort((a, b) => b.size_mb - a.size_mb)
            .map((m) => {
              const used = IN_USE.some((u) => m.name.startsWith(u))
              return (
                <div key={m.kind + m.name} className="model-row">
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.name}{!used && <span className="unused">UNUSED</span>}
                  </span>
                  <span className="mono">{fmtGb(m.size_mb)} GB</span>
                  <span className="mono muted">{m.kind}</span>
                </div>
              )
            })}
          {!models && <div className="empty">Measuring caches…</div>}
        </section>

        <section className="card span-6">
          <div className="card-head"><span className="card-title"><span className="track">D4</span>JARVIS process log</span>
            <span className="mono muted">{logs?.length ? `${fmtInt(logs.length)} lines` : 'empty'}</span></div>
          <div className="log" ref={logRef}>
            {!logs?.length && <span className="muted">JARVIS hasn’t run in this session.</span>}
            {logs?.map((l, i) => <div key={i} className="ln"><time>{clock(l.t)}</time>{l.line}</div>)}
          </div>
        </section>

        <section className="card span-12">
          <div className="card-head"><span className="card-title"><span className="track">D5</span>Engineering log</span>
            <span className="mono muted">docs/DECISIONS.md · every claim with its measurement</span></div>
          {decisions?.map((d) => (
            <div key={d.title} className="decision"><b>{d.title}</b><p>{d.summary.replace(/\*\*/g, '')}</p></div>
          ))}
        </section>
      </div>
    </div>
  )
}

function Gauge({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="gauge">
      <span className="eyebrow">{label}</span>
      <span className="dot">{value}</span>
      <div className={`bar ${pct > 90 ? '' : ''}`}><i style={{ width: `${Math.min(100, pct)}%`, background: pct > 90 ? 'var(--fault)' : undefined }} /></div>
    </div>
  )
}
