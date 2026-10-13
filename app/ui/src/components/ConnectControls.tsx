/**
 * Connect's controls: the brain, the voice and how he says words, heavy modules for a
 * moment, and the data exports that keep Yaadash fresh. Every control calls the real
 * backend (lib/settings.ts -> app/jarvis_app/routes_settings.py) and shows what it said
 * back; nothing here is decoration.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, FolderOpen, Play, RotateCcw, Upload, X } from 'lucide-react'
import { usePoll, useNow } from '../lib/format'
import { useStore } from '../lib/store'
import {
  VOICE_GROUPS, ago, chooseBrain, chooseVoice, costLine, exportState, fmtBytes, freeGpu, groupOf, importPath,
  loadBrain, loadExports, loadModules, loadPronunciations, loadVoice, moduleOff, moduleOn, openImports,
  pronunciationProblem, readLine, removePronunciation, requestExport, restartBrain, setPronunciation, STATUS_TEXT,
  testVoice, timeLeft, uploadExport, voiceLabel, voicesIn,
  type BrainView, type ExportSource, type Module, type VoiceGroup, type VoiceView,
} from '../lib/settings'
import '../styles/connect.css'

/** Run an action with a busy flag; its error becomes a red toast, never a silent no-op. */
function useAction() {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try {
      await fn()
      if (ok) toast(ok, 'info')
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function CopyCmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="cx-cmd">
      <code>{cmd}</code>
      <button className="btn ghost sm icon" aria-label="Copy command" onClick={() => {
        void navigator.clipboard.writeText(cmd)
        setDone(true)
        window.setTimeout(() => setDone(false), 1400)
      }}>{done ? <Check size={13} /> : <Copy size={13} />}</button>
    </span>
  )
}

/* ================================================================== brain */
export function BrainCard() {
  const [view, , reload] = usePoll(loadBrain, 10000)
  const [local, setLocal] = useState<BrainView | null>(null)
  const v = local ?? view
  const { busy, run } = useAction()
  useEffect(() => setLocal(null), [view])
  const using = v?.running ?? null
  return (
    <section className="card cx-card">
      <div className="card-head">
        <span className="card-title"><span className="track">B1</span>Brain</span>
        <span className="mono muted cx-small">
          {v?.core_running ? <>thinking with <b className="live">{using}</b></> : <>JARVIS is off · starts with {v?.chosen ?? '—'}</>}
        </span>
      </div>
      {v && !v.ollama && <div className="empty">Ollama is not answering on :11434. Start the Ollama app.</div>}
      {v?.pending_restart && (
        <div className="cx-banner">
          <span>Chosen <b>{v.chosen}</b>; JARVIS is still thinking with {v.running}. It applies when he restarts.</span>
          <button className="btn sm primary" disabled={busy === 'restart'} onClick={() => run('restart', async () => {
            await restartBrain()
            reload()
          }, 'Restarting JARVIS with the new brain…')}><RotateCcw size={13} />Restart brain now</button>
        </div>
      )}
      <div className="cx-models" role="radiogroup" aria-label="Brain model">
        {v?.models.map((m) => (
          <button key={m.name} role="radio" aria-checked={m.chosen} disabled={!!m.why_not || busy !== null}
            className={`cx-model${m.chosen ? ' on' : ''}${m.why_not ? ' off' : ''}`}
            onClick={() => !m.chosen && run('choose', async () => setLocal(await chooseBrain(m.name)),
              v.core_running ? `Brain set to ${m.name}: restart JARVIS to use it.` : `Brain set to ${m.name}.`)}>
            <i className="cx-radio" />
            <span className="cx-model-body">
              <span className="cx-model-name">{m.name}
                {m.running && <span className="pill live cx-pill"><i className="led" />in use</span>}
                {m.loaded_gb != null && <span className="pill cx-pill">{m.loaded_gb} GB in VRAM</span>}
              </span>
              <span className="cx-model-meta">{m.params ?? '?'} · {m.gb.toFixed(1)} GB file · {m.capabilities.join(', ') || 'capabilities unknown'}</span>
              {m.why_not && <span className="cx-why">{m.why_not}</span>}
              {!m.why_not && m.warn && <span className="cx-warn">{m.warn}</span>}
              {!m.why_not && m.note && <span className="cx-note">{m.note}</span>}
            </span>
          </button>
        ))}
      </div>
      {v?.core_running && !v.pending_restart && (
        <div className="cx-foot">
          <button className="btn sm" disabled={busy === 'restart'} onClick={() => run('restart', async () => {
            await restartBrain()
            reload()
          }, 'Restarting JARVIS…')}><RotateCcw size={13} />Restart brain now</button>
          <span className="muted cx-small">Stops JARVIS and starts him again in the same mode (about 20 s).</span>
        </div>
      )}
    </section>
  )
}

/* ================================================================== voice */
export function VoiceCard() {
  const [view] = usePoll(loadVoice, 0)
  const [v, setV] = useState<VoiceView | null>(null)
  useEffect(() => { if (view) setV(view) }, [view])
  const [group, setGroup] = useState<VoiceGroup | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const { busy, run } = useAction()
  const toast = useStore((s) => s.toast)
  const chosen = v ? [...v.edge, ...v.kokoro].find((x) => x.id === v.chosen) : undefined
  const g = group ?? (chosen ? groupOf(chosen) : 'British')
  const spd = speed ?? v?.speed ?? 1
  const test = (text?: string) => run('test', async () => {
    const via = await testVoice(text)
    toast(via === 'jarvis' ? 'JARVIS is saying it.' : 'Playing it here: JARVIS is not listening.', 'info')
  })
  return (
    <section className="card cx-card">
      <div className="card-head">
        <span className="card-title"><span className="track">B2</span>Voice</span>
        <span className="mono muted cx-small">{voiceLabel(v, v?.chosen)}</span>
      </div>
      <div className="seg sm cx-seg">
        {VOICE_GROUPS.map((k) => (
          <button key={k} className={g === k ? 'on' : ''} onClick={() => setGroup(k)}>{k}</button>
        ))}
      </div>
      {g === 'Offline' && v?.kokoro_missing && <p className="cx-why">Offline voice not installed: {v.kokoro_missing}.</p>}
      <div className="cx-voices">
        {voicesIn(v, g).map((x) => (
          <button key={x.id} className={`cx-voice${x.id === v?.chosen ? ' on' : ''}`} disabled={busy !== null}
            onClick={() => run('voice', async () => setV(await chooseVoice({ id: x.id })), `Voice: ${x.name}. He uses it from his next sentence.`)}>
            {x.name}<small>{x.gender ? x.gender[0] : ''}</small>
          </button>
        ))}
      </div>
      <p className="muted cx-small">
        {g === 'Offline' ? 'Kokoro on the CPU: no internet needed, nothing leaves the laptop.'
          : `Microsoft neural voices, online${v?.edge_source === 'built-in' ? ' (list from 2026-10-13: the live one could not be fetched)' : ''}. Accent tags still switch voices mid-reply.`}
      </p>
      <div className="cx-speed">
        <span className="eyebrow">Speed</span>
        <input type="range" className="slider" min={v?.speed_range[0] ?? 0.7} max={v?.speed_range[1] ?? 1.4} step={0.05}
          value={spd} aria-label="Speaking speed"
          style={{ ['--pct' as string]: `${((spd - 0.7) / 0.7) * 100}%` }}
          onChange={(e) => setSpeed(Number(e.target.value))}
          onPointerUp={() => speed != null && run('speed', async () => { setV(await chooseVoice({ speed })); setSpeed(null) })}
          onKeyUp={() => speed != null && run('speed', async () => { setV(await chooseVoice({ speed })); setSpeed(null) })} />
        <span className="mono cx-speed-val">{spd.toFixed(2)}×</span>
        <button className="btn sm" disabled={busy === 'test'} onClick={() => test()}><Play size={13} />Test voice</button>
      </div>
    </section>
  )
}

/* ================================================================== pronunciation */
export function PronunciationCard() {
  const [data, , reload] = usePoll(loadPronunciations, 0)
  const [table, setTable] = useState<Record<string, string> | null>(null)
  useEffect(() => { if (data) setTable(data.table) }, [data])
  const [word, setWord] = useState('')
  const [say, setSay] = useState('')
  const { busy, run } = useAction()
  const toast = useStore((s) => s.toast)
  const problem = word || say ? pronunciationProblem(word, say) : null
  const rows = Object.entries(table ?? {})
  return (
    <section className="card cx-card">
      <div className="card-head">
        <span className="card-title"><span className="track">B3</span>Pronunciation</span>
        <span className="mono muted cx-small">{rows.length} word{rows.length === 1 ? '' : 's'} · changes what he says, not what you read</span>
      </div>
      {rows.length === 0 && <p className="muted cx-small">No words yet. Write how a name should sound, e.g. Aankhen → Aan-khen.</p>}
      {rows.map(([w, s]) => (
        <div key={w} className="cx-pron">
          <span className="cx-pron-word">{w}</span><span className="muted">→</span><span className="mono">{s}</span>
          <button className="btn ghost sm icon" aria-label={`Hear ${w}`} disabled={busy !== null}
            onClick={() => run('hear', async () => {
              const via = await testVoice(`${w}. I said ${w}.`)
              if (via === 'jarvis') toast('JARVIS is saying it.', 'info')
            })}><Play size={13} /></button>
          <button className="btn ghost sm icon" aria-label={`Remove ${w}`} disabled={busy !== null}
            onClick={() => run('rm', async () => setTable((await removePronunciation(w)).table))}><X size={13} /></button>
        </div>
      ))}
      <form className="cx-pron-form" onSubmit={(e) => {
        e.preventDefault()
        if (problem) return
        void run('add', async () => {
          setTable((await setPronunciation(word.trim(), say.trim())).table)
          setWord('')
          setSay('')
          reload()
        }, `He now says “${word.trim()}” as “${say.trim()}”.`)
      }}>
        <input className="field" placeholder="Word (Aankhen)" value={word} onChange={(e) => setWord(e.target.value)} maxLength={40} />
        <input className="field" placeholder="Say it as (Aan-khen)" value={say} onChange={(e) => setSay(e.target.value)} maxLength={80} />
        <button className="btn sm primary" type="submit" disabled={!word.trim() || !say.trim() || !!problem || busy !== null}>Add</button>
      </form>
      {problem && <p className="cx-warn cx-small">{problem}</p>}
    </section>
  )
}

/* ================================================================== modules */
const MINUTES = [5, 15, 30, 60]

export function ModulesSection() {
  const [mods, , reload] = usePoll(loadModules, 5000)
  return (
    <div className="cx-mods">
      {mods?.map((m) => <ModuleCard key={m.id} m={m} reload={reload} />)}
      {!mods && <div className="empty">Reading Ollama and the voice engine…</div>}
    </div>
  )
}

function ModuleCard({ m, reload }: { m: Module; reload: () => void }) {
  const now = useNow(1000) / 1000
  const [minutes, setMinutes] = useState(15)
  const [model, setModel] = useState<string | null>(null)
  const { busy, run } = useAction()
  const left = timeLeft(m.until, now)
  const st = STATUS_TEXT[m.status]
  const pick = model ?? m.model ?? undefined
  const cand = m.candidates?.find((c) => c.name === pick)
  return (
    <section className={`card cx-mod ${m.status}`}>
      <div className="integ-top">
        <span className="integ-name">{m.name}</span>
        <span className={`pill ${left ? 'live' : st.tone}`}>{(left || m.status === 'loaded') && <i className="led" />}{left ? 'on' : st.label}</span>
      </div>
      <div className="integ-detail">{m.what}</div>
      <div className="cx-cost">{costLine(m.id === 'deep_think' && cand ? { ...m.cost, vram_gb: cand.vram_gb } : m.cost)}{m.cost.note ? ` · ${m.cost.note}` : ''}</div>
      <div className="cx-small muted">{m.detail}</div>
      {m.id === 'deep_think' && cand?.warn && !left && <div className="cx-warn cx-small">{cand.warn}</div>}
      {m.id === 'deep_think' && cand?.note && !left && <div className="cx-note cx-small">{cand.note}</div>}
      {m.always && <div className="cx-note cx-small">Your chosen voice is a Kokoro voice: he is always offline.</div>}

      {m.kind === 'timed' && m.status !== 'not_installed' && m.status !== 'unknown' && (
        left ? (
          <div className="cx-row">
            <span className="mono live">{left}{m.model ? ` · ${m.model}` : ''}</span>
            <button className="btn sm" disabled={busy !== null} onClick={() => run('off', async () => { await moduleOff(m.id); reload() }, `${m.name} off.`)}>Turn off</button>
          </div>
        ) : (
          <div className="cx-row">
            {m.candidates && m.candidates.length > 0 && (
              <select className="field cx-select" value={pick} aria-label="Deep think model" onChange={(e) => setModel(e.target.value)}>
                {m.candidates.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.params}{c.thinking ? ' · reasons' : ''}</option>)}
              </select>
            )}
            <div className="seg sm">
              {MINUTES.map((n) => <button key={n} className={minutes === n ? 'on' : ''} onClick={() => setMinutes(n)}>{n < 60 ? `${n} min` : '1 h'}</button>)}
            </div>
            <button className="btn sm primary" disabled={busy !== null}
              onClick={() => run('on', async () => { await moduleOn(m.id, minutes, m.id === 'deep_think' ? pick : undefined); reload() },
                `${m.name} on for ${minutes} min.`)}>Turn on</button>
          </div>
        )
      )}
      {m.kind === 'action' && (
        <div className="cx-row">
          {(m.loaded ?? []).map((x) => <span key={x.name} className="pill">{x.name} · {x.vram_gb} GB</span>)}
          <button className="btn sm" disabled={busy !== null || m.status !== 'loaded'}
            onClick={() => run('free', async () => {
              const r = await freeGpu()
              reload()
              useStore.getState().toast(`Freed ${r.freed_gb} GB: ${r.unloaded.join(', ') || 'nothing was loaded'}.`, 'info')
            })}>Free the GPU now</button>
        </div>
      )}
      {m.download && (
        <div className="cx-download">
          <span className="eyebrow">Available, needs download</span>
          <span className="cx-small">{m.download.why} {m.download.gb ? `(${m.download.gb} GB)` : ''}</span>
          {m.download.command && <CopyCmd cmd={m.download.command} />}
        </div>
      )}
    </section>
  )
}

/* ================================================================== data exports */
export function ExportsSection() {
  const [sources, , reload] = usePoll(loadExports, 3000)
  return (
    <div className="cx-exports">
      {sources?.map((s) => <ExportCard key={s.id} s={s} reload={reload} />)}
      {!sources && <div className="empty">Looking in Downloads and the imports folder…</div>}
    </div>
  )
}

function ExportCard({ s, reload }: { s: ExportSource; reload: () => void }) {
  const { busy, run } = useAction()
  const [over, setOver] = useState(false)
  const [path, setPath] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const now = useNow(30000) / 1000
  const st = exportState(s)
  const send = (f: File) => run('upload', async () => { await uploadExport(s.id, f, f.name); reload() },
    `${s.name}: ${f.name} saved. Reading it now.`)
  return (
    <section className="card cx-export">
      <div className="integ-top">
        <span className="integ-name">{s.name}</span>
        <span className={`pill ${st.tone}`}>{st.tone === 'live' && <i className="led" />}{st.label}</span>
      </div>
      <div className="integ-detail"><b className="cx-ask">Ask for:</b> {s.ask}</div>
      <div className="cx-row">
        <button className="btn sm" disabled={busy !== null}
          onClick={() => run('req', () => requestExport(s.id), `${s.name}'s export page is open in your browser: request it there.`)}>
          Request export<ArrowUpRight size={13} />
        </button>
        <span className="muted cx-small">{s.wait}</span>
      </div>

      {s.downloads.map((d) => (
        <div key={d.path} className="cx-found">
          <span>In Downloads: <b>{d.name}</b> · {fmtBytes(d.size)} · {ago(d.mtime, now)}</span>
          <button className="btn sm primary" disabled={busy !== null}
            onClick={() => run('copy', async () => { await importPath(s.id, d.path); reload() }, 'Copying it in.')}>Import</button>
        </div>
      ))}

      <div className={`cx-drop${over ? ' over' : ''}`} role="button" tabIndex={0}
        onClick={() => input.current?.click()} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void send(f) }}>
        <Upload size={14} />{busy === 'upload' ? 'Saving…' : 'Drop the .zip here, or click to pick it'}
        <input ref={input} type="file" accept=".zip,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = '' }} />
      </div>
      <form className="cx-pron-form" onSubmit={(e) => {
        e.preventDefault()
        if (path.trim()) void run('path', async () => { await importPath(s.id, path.trim()); setPath(''); reload() }, 'Copying it in.')
      }}>
        <input className="field" placeholder="or a path: C:\Users\…\Downloads\export.zip" value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="btn sm" type="submit" disabled={!path.trim() || busy !== null}>Import</button>
      </form>

      {s.job && <div className={`cx-small ${s.job.state === 'failed' ? 'fault' : 'sim'}`}>{s.job.state} {s.job.file}{s.job.error ? `: ${s.job.error}` : '…'}</div>}
      {s.files.map((f) => (
        <div key={f.name} className="cx-file">
          <span className="cx-file-name">{f.name}<span className="mono muted"> · {fmtBytes(f.size)} · {ago(f.mtime, now)}</span></span>
          <span className={f.read && !f.read.ok ? 'fault' : ''}>{f.folder ? 'A folder: kept as it is.' : readLine(s.id, f.read)}</span>
          {f.read?.warning && <span className="cx-warn">{f.read.warning}</span>}
        </div>
      ))}
      {s.files.length > 0 && <div className="cx-small muted">{s.memory}</div>}
      {s.id === 'instagram' && (
        <div className="cx-small">
          <span className={s.archive_stale ? 'sim' : 'muted'}>
            Memory archive built {ago(s.archive_built ?? null, now)}.{s.archive_stale ? ' This export is newer: rebuild memory to read it.' : ''}
          </span>
          {s.archive_stale && <CopyCmd cmd=".venv\Scripts\python.exe yaadash\refresh_memory.py" />}
        </div>
      )}
      {s.files.length > 0 && (
        <button className="btn ghost sm cx-open" onClick={() => run('open', () => openImports(s.id))}><FolderOpen size={13} />Open folder</button>
      )}
    </section>
  )
}
