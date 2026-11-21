// The Now plate (spec 20.9.1 `core.sound`): what is playing, the transport, the source choice and the receipt of the last
// action, drawn as one slab with the sigil dial as its centrepiece. The play key sits inside the dial and is the one warm
// fill of the view: it plays or pauses what Windows (or this window) holds; the field's key FINDS a new song and plays it,
// and is named so (jury round 2: two keys both called Play read as one action twice).
//
// One status per thing (jury round 2): the player's lamp is one row above the title, read as PLAYER <state> · <word>; the
// volume keeps its own WAITING lamp inside the dial, under the readout VOL --; the plate's head carries no third lamp.
//
// Honesty: the title, status and lamp are what Windows (or the window's own player) reported; "playing" is never said on the
// view's own authority. The receipt is the server's sentence, word for word, in its provenance. The ring shows the state only
// (the app reports no output level and no position); its inner gauge is the volume track and stays empty under a WAITING
// lamp, because the app can send volume up and down but cannot read the level back. A route that does not answer is
// WAITING with the reason, and the keys say so instead of sending a press into nothing.
//
// Keys: Space on the plate (when the plate itself has focus) plays or pauses; the arrow keys step to the previous or next
// track; Space or Enter on a key presses that key. All presses go through one busy guard, so a double press sends one.
import { FolderOpen, Pause, Play, Search, SkipBack, SkipForward, SlidersHorizontal, Volume1, Volume2 } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Lamp } from '../../shared/lamp'
import { Ring } from './Ring'
import { isSpotify, nowView, receiptView, restLine, SOURCES, type RouteStatus, type Source, type MediaState, type MediaReceipt } from './model'
import './sound.css'

export interface NowPlateProps {
  state: MediaState | null
  route: RouteStatus
  receipt: MediaReceipt | null
  busy: boolean
  source: Source
  simulated?: boolean
  now?: number
  control: (action: string, value?: string) => void
  play: (query: string) => Promise<boolean>
  choose: (s: Source) => void
  onFolder: () => void
  /** Opens the drawer of the rest (pronunciation and the study library); the key is drawn only when it is given. */
  onTools?: () => void
  /** v3 draws the plate in two trays: `play` is the stage, the transport and the title; `where` is the last action and the sources. Default: the whole plate. */
  part?: 'all' | 'play' | 'where'
}

export function NowPlate({ state, route, receipt, busy, source, simulated = false, now, control, play, choose, onFolder, onTools, part = 'all' }: NowPlateProps) {
  const all = part === 'all'
  const view = nowView(state, route, simulated, now)
  const shown = receiptView(receipt, simulated)
  const answered = !!state
  const [q, setQ] = useState('')
  const qid = useId()
  const off = !answered || busy
  const why = answered ? undefined : view.sub

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (off || !q.trim()) return
    if (await play(q)) setQ('')
  }
  // the last volume step lights the gauge track for one beat; 600 ms is long enough to see and shorter than a second press
  const [nudge, setNudge] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (!nudge) return
    const t = window.setTimeout(() => setNudge(null), 600)
    return () => window.clearTimeout(t)
  }, [nudge])
  const press = (action: string, value?: string) => () => {
    if (off) return
    if (value === undefined) control(action)
    else control(action, value)
    if (action === 'volume' && (value === 'up' || value === 'down')) setNudge(value)
  }
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === ' ') { e.preventDefault(); press('toggle')() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); press('next')() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); press('prev')() }
  }
  const onRadio = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return
    e.preventDefault()
    const i = SOURCES.findIndex((s) => s.id === source)
    const n = k === 'Home' ? 0 : k === 'End' ? SOURCES.length - 1 : (i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1) + SOURCES.length) % SOURCES.length
    choose(SOURCES[n].id)
    const group = e.currentTarget
    requestAnimationFrame(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus())
  }
  const PlayIcon = view.playing ? Pause : Play

  return (
    <section
      className="sd-now"
      data-part={all ? undefined : part}
      tabIndex={part === 'where' ? undefined : 0}
      role="group"
      aria-label={part === 'where' ? 'Where play goes' : 'Now playing'}
      aria-keyshortcuts="Space ArrowLeft ArrowRight"
      data-ring={view.ring}
      onKeyDown={onKey}
    >
      {all && <header className="sd-now-head">
        <h2><span className="sd-tag">[SND]</span>Sound</h2>
        <span className="sd-row">
          {simulated && <span className="sd-stamp">SIMULATED fixture</span>}
          {onTools && (
            <button type="button" className="sd-key sd-tools-key" data-open="tools" aria-label="Pronunciation and study library" title="Pronunciation and study library" onClick={onTools}>
              <SlidersHorizontal size={16} aria-hidden="true" /><span className="sd-tools-word" aria-hidden="true">Pronunciation and library</span>
            </button>
          )}
        </span>
      </header>}

      <div className="sd-body">
      {part !== 'where' && <div className="sd-left">
        <div className="sd-stage">
          <Ring state={view.ring} nudge={nudge} />
          <div className="sd-vol" data-vol="">
            <span className="sd-vol-read" aria-label="Volume not reported">VOL --</span>
            <Lamp reading={{ state: 'waiting', since: null, reason: 'the app can step the volume but cannot read it back' }} subject="Volume" now={now} />
          </div>
          <button
            type="button"
            className="sd-play"
            aria-label={view.playing ? 'Pause' : 'Play'}
            title={view.playing ? 'Pause what is playing' : 'Play or resume what Windows holds'}
            aria-disabled={off || undefined}
            aria-busy={busy || undefined}
            data-sound-toggle=""
            onClick={press('toggle')}
          >
            <PlayIcon className="sd-play-icon" size={34} strokeWidth={2} fill="currentColor" aria-hidden="true" />
            <span aria-hidden="true">{view.playing ? 'PAUSE' : 'PLAY'}</span>
          </button>
        </div>
        <div className="sd-transport" role="group" aria-label="Transport and volume">
          <button type="button" className="sd-key sd-key-col" data-pair="track" aria-label="Previous track" aria-disabled={off || undefined} onClick={press('prev')}>
            <SkipBack size={20} aria-hidden="true" /><span aria-hidden="true">Prev</span>
          </button>
          <button type="button" className="sd-key sd-key-col" data-pair="track" aria-label="Next track" aria-disabled={off || undefined} onClick={press('next')}>
            <SkipForward size={20} aria-hidden="true" /><span aria-hidden="true">Next</span>
          </button>
          <button type="button" className="sd-key sd-key-col" data-pair="vol" aria-label="Volume down" aria-disabled={off || undefined} onClick={press('volume', 'down')}>
            <Volume1 size={20} aria-hidden="true" /><span aria-hidden="true">Vol &minus;</span>
          </button>
          <button type="button" className="sd-key sd-key-col" data-pair="vol" aria-label="Volume up" aria-disabled={off || undefined} onClick={press('volume', 'up')}>
            <Volume2 size={20} aria-hidden="true" /><span aria-hidden="true">Vol +</span>
          </button>
        </div>
      </div>}

      <div className="sd-right">
        {part !== 'where' && <div className="sd-title-block" aria-live="polite">
          <p className="sd-status" data-status="">
            <span className="sd-status-name">Player</span>
            <Lamp reading={view.reading} subject="Player" now={now} />
            <span className="sd-status-dot" aria-hidden="true">&middot;</span>
            <span className="sd-word">{view.word}</span>
          </p>
          <h3 className="sd-title">{view.title}</h3>
          <p className="sd-sub">{answered && view.ring === 'rest' && !shown ? restLine(state) : view.sub}</p>
          {part === 'play' && why && <p className="sd-hint">The keys are off until the player answers.</p>}
        </div>}

        {part !== 'play' && <div className="sd-receipt" role="status">
          <p className="sd-cap">Last action</p>
          {shown ? (
            <>
              <div className="sd-receipt-line">
                <Lamp reading={{ state: shown.state, since: receipt ? receipt.at * 1000 : null, reason: shown.why }} showLabel={false} subject="Receipt" now={now} />
                <p className="sd-receipt-text">{shown.text}</p>
              </div>
              <p className="sd-receipt-why">{shown.why}</p>
            </>
          ) : (
            <p className="sd-receipt-text">Nothing asked yet.</p>
          )}
        </div>}

        {all && <form className="sd-field sd-song" onSubmit={submit}>
          <label htmlFor={qid}>Play a song</label>
          <div className="sd-row">
            <input
              id={qid}
              className="sd-well"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Song or artist"
              autoComplete="off"
              aria-disabled={!answered || undefined}
              readOnly={!answered}
            />
            <button type="submit" className="sd-key sd-go" data-ready={!!q.trim() || undefined} aria-disabled={off || undefined} aria-busy={busy || undefined}>
              <Search size={16} aria-hidden="true" />Find and play
            </button>
          </div>
          {why && <p className="sd-hint">The keys are off until the player answers.</p>}
        </form>}

        {part !== 'play' && <div className="sd-sources">
          <div className="sd-src-head">
            <p className="sd-cap" id={`${qid}-src`}>Where play goes</p>
            <button type="button" className="sd-key" data-quiet="true" onClick={onFolder}>
              <FolderOpen size={16} aria-hidden="true" />Music folder
            </button>
          </div>
          <div className="sd-chips" role="radiogroup" aria-labelledby={`${qid}-src`} onKeyDown={onRadio}>
            {SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={source === s.id}
                tabIndex={source === s.id ? 0 : -1}
                className="sd-chip"
                title={s.hint}
                onClick={() => choose(s.id)}
              >
                {s.label}
                {isSpotify(s.id) && (
                  <>
                    <Lamp reading={{ state: 'planned', since: null, reason: 'starting a track by name in Spotify is not built' }} subject="Spotify" />
                    <span className="sd-sr"> (start by name is PLANNED)</span>
                  </>
                )}
              </button>
            ))}
          </div>
          {isSpotify(source) ? (
            <p className="sd-hint sd-planned"><Lamp reading={{ state: 'planned', since: null, reason: 'starting a track by name in Spotify is not built' }} subject="Spotify" /> Opens a search; you press play on the top result.</p>
          ) : (
            <p className="sd-hint">{SOURCES.find((s) => s.id === source)?.hint}</p>
          )}
        </div>}
      </div>
      </div>
    </section>
  )
}
