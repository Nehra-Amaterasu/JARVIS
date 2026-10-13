/**
 * Media: what is playing, the four buttons, a box to play a song by name, and where
 * "play" goes by default (Auto · Folder · YouTube · YT Music · Spotify).
 *
 * Honest by construction: the line under the controls is the server's receipt, word for
 * word, in its provenance colour: cyan when the window or Windows confirmed playback,
 * amber when something was opened or pressed but not confirmed ("Spotify needs one
 * click"), red when it failed. The card never says "playing" on its own authority.
 */
import { FolderOpen, Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, post } from '../lib/api'
import { usePoll } from '../lib/format'
import { lastMediaEvent, nowLines, receiptTone, SOURCES, type MediaReceipt, type MediaState, type Source } from '../lib/media'
import { useStore } from '../lib/store'
import '../styles/media.css'

export function MediaCard() {
  const toast = useStore((s) => s.toast)
  const events = useStore((s) => s.events)
  // Every 5 s while the card is on screen; at once after anything happens on the bus.
  const [st, , reload] = usePoll(() => api<MediaState>('/api/media/state'), 5000)
  const last = lastMediaEvent(events)
  useEffect(() => { if (last) reload() }, [last])           // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<MediaReceipt | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folder, setFolder] = useState('')

  const source: Source = st?.settings.default_source ?? 'auto'
  const lines = nowLines(st)
  const playing = st?.now?.status === 'Playing'
  const shown = receipt ?? (st?.last ? { ...st.last, action: 'play' } : null)

  const act = async (fn: () => Promise<MediaReceipt>) => {
    setBusy(true)
    try {
      setReceipt(await fn())
    } catch (e) {
      toast((e as Error).message, 'fault')
    } finally {
      setBusy(false)
      reload()
    }
  }
  const control = (action: string, value?: string) =>
    void act(() => post<MediaReceipt>('/api/media/control', value === undefined ? { action } : { action, value }))
  const play = (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim() || busy) return
    void act(() => post<MediaReceipt>('/api/media/play', { query: q.trim(), source }))
  }
  const choose = async (s: Source) => {
    try {
      await api('/api/media/settings', { method: 'PUT', body: { default_source: s } })
      reload()
    } catch (e) {
      toast((e as Error).message, 'fault')
    }
  }
  const saveFolder = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api('/api/media/settings', { method: 'PUT', body: { folder: folder.trim() } })
      toast('Reading your music folder…', 'info')
      setFolderOpen(false)
      reload()
    } catch (err) {
      toast((err as Error).message, 'fault')
    }
  }

  const lib = st?.library
  return (
    <section className="card media">
      <div className="card-head">
        <span className="card-title"><span className="track">A2</span>Media</span>
        {lines.status && (
          <span key={lines.status} className={`pill pop ${lines.tone === 'live' ? 'live' : ''}`}>
            {lines.tone === 'live' && <i className="led" />}{lines.status}
          </span>
        )}
      </div>

      <div className={`media-now ${lines.tone}`}>
        <div className="media-art"><Music2 size={18} strokeWidth={1.8} /></div>
        <div className="media-meta">
          <b title={lines.title}>{lines.title}</b>
          <span className="mono">{lines.sub}</span>
        </div>
      </div>

      <div className="media-ctl">
        <button className="btn icon ghost" disabled={busy} onClick={() => control('prev')} aria-label="Previous track"><SkipBack size={16} /></button>
        <button className="btn icon live media-pp" disabled={busy} onClick={() => control('toggle')} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="btn icon ghost" disabled={busy} onClick={() => control('next')} aria-label="Next track"><SkipForward size={16} /></button>
        <span className="media-gap" />
        <button className="btn icon ghost" disabled={busy} onClick={() => control('volume', 'down')} aria-label="Volume down"><Volume1 size={16} /></button>
        <button className="btn icon ghost" disabled={busy} onClick={() => control('volume', 'up')} aria-label="Volume up"><Volume2 size={16} /></button>
      </div>

      <form className="media-search" onSubmit={play}>
        <input className="field" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="Blinding Lights by The Weeknd" aria-label="Song to play" />
        <button className="btn icon live" type="submit" disabled={busy || !q.trim()} aria-label="Play it"><Play size={15} /></button>
      </form>

      <div className="media-chips" role="radiogroup" aria-label="Where play goes">
        {SOURCES.map((s) => (
          <button key={s.id} role="radio" aria-checked={source === s.id} aria-label={s.label} title={s.hint}
            className={`media-chip ${source === s.id ? 'on' : ''}`} onClick={() => void choose(s.id)}>{s.label}</button>
        ))}
        <button className={`btn icon ghost media-folder-btn ${folderOpen ? 'on' : ''}`} onClick={() => setFolderOpen((o) => !o)}
          aria-label="Music folder" title={lib?.folder ? `${lib.folder} · ${lib.tracks} songs` : 'Choose your music folder'}>
          <FolderOpen size={14} />
        </button>
      </div>

      {folderOpen && (
        <form className="media-folder fade-in" onSubmit={saveFolder}>
          <input className="field" autoFocus value={folder} onChange={(e) => setFolder(e.target.value)}
            placeholder={lib?.folder ?? 'C:\\Users\\you\\Music'} aria-label="Music folder path" />
          <button className="btn sm" type="submit" disabled={!folder.trim()}>Use</button>
        </form>
      )}

      {shown ? (
        <p className={`media-receipt mono ${receiptTone(shown)}`}>{shown.say}</p>
      ) : (
        <p className="media-receipt mono">
          {lib?.scanning ? 'Reading your music folder…'
            : lib?.folder ? `${lib.tracks} songs in your folder · say “play” and a song`
              : 'Say “play Blinding Lights” or “Kesariya chalao”.'}
        </p>
      )}
    </section>
  )
}
