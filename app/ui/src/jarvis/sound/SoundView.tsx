// Core, Sound (A.S01, spec 20.9.1 `core.sound`): the view. One canvas, no scroll at 1366 x 768 (the numbers are in sound.css):
// the Now plate on the left; on the right Sound's own ledger (Recent plays), the whole column. Pronunciation and the study
// library are not sound, so they live behind ONE key in the plate's head (jury round 2: a second card of equal weight in the
// rail made three regions compete); that key opens the drawer on a list of the two, each opening its own body, with Back.
// The music folder opens in the same drawer. Spotify's PLANNED state is drawn on its source chip, not on a card of its own.
//
//   SoundView      presentational: the hooks' data in, nothing fetched (the gallery, the jury page and the tests drive it)
//   default export the live view the shell registers: the hooks over LIVE_SOUND, refreshed on every media event of the bus
//
// Imports no Well Wisher module (the product seam: this chunk is read only where the build holds JARVIS).
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { lastMediaEvent } from '../../lib/media'
import { useStore } from '../../lib/store'
import { Chip } from '../../shared/kit/v3'
import { Zones, lookV3Enabled, useViewChrome, type ViewChromeSpec } from '../../shell/v3'
import { LibraryBody, LibraryCard } from './Library'
import { NowPlate } from './NowPlate'
import { nowView } from './model'
import { LIVE_SOUND, type SoundPort } from './port'
import { RecentPlays } from './Recent'
import { SoundDrawer } from './SoundDrawer'
import { useLibrary, useMedia, useWords, type LibraryLive, type MediaLive, type WordsLive } from './useSound'
import { WordsBody, WordsCard } from './Words'
import './sound.css'
import './sound-v3.css'

export type SoundDrawerId = 'tools' | 'library' | 'words' | 'folder'

export interface SoundViewProps {
  media: MediaLive
  library: LibraryLive
  words: WordsLive
  simulated?: boolean
  now?: number
  /** The drawer open at first (the gallery draws each state). */
  openAt?: SoundDrawerId | null
}

const TITLE: Record<SoundDrawerId, { title: string; tag: string }> = {
  tools: { title: 'Pronunciation and library', tag: 'SET' },
  library: { title: 'Study library', tag: 'LIB' },
  words: { title: 'Pronunciation', tag: 'SAY' },
  folder: { title: 'Music folder', tag: 'SND' },
}

export function FolderBody({ media }: { media: MediaLive }) {
  const lib = media.state?.library
  const [path, setPath] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!path.trim() || !media.state) return
    const ok = await media.saveFolder(path)
    setDone(ok ? 'Reading your music folder.' : null)
    if (ok) setPath('')
  }
  return (
    <>
      <p className="sd-note">
        {!media.state ? 'The media route did not answer, so the folder is not known.'
          : lib?.folder ? `${lib.tracks} song${lib.tracks === 1 ? '' : 's'} in the folder${lib.scanning ? ', still reading' : ''}${lib.truncated ? ', list cut at its limit' : ''}.`
            : 'No folder chosen. Songs from a folder play in this window.'}
      </p>
      {lib?.folder && <p className="sd-note" data-private="">Folder: {lib.folder}</p>}
      <form className="sd-field" onSubmit={submit}>
        <label htmlFor="sd-folder">Folder path</label>
        <div className="sd-row">
          <input id="sd-folder" className="sd-well" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} placeholder="C:\Users\you\Music" aria-disabled={!media.state || undefined} readOnly={!media.state} />
          <button type="submit" className="sd-key" aria-disabled={!media.state || !path.trim() || undefined}>Use</button>
        </div>
      </form>
      {done && <p className="sd-note" role="status">{done}</p>}
    </>
  )
}

export function SoundView({ media, library, words, simulated = false, now, openAt = null }: SoundViewProps) {
  const [open, setOpen] = useState<SoundDrawerId | null>(openAt)
  // v3: the song field is the dock's (mode Find); the pronunciation and library key is a rare action, so it is under More
  const v3 = lookV3Enabled()
  const liveMedia = useRef(media)
  liveMedia.current = media
  const chrome = useMemo<ViewChromeSpec>(() => ({
    dock: {
      modes: [{ id: 'find', label: 'Find', prefix: 'play>', example: 'Song or artist', action: 'Find and play' }],
      onSubmit: async (_mode, text) => {
        const m = liveMedia.current
        if (!m.state || m.busy || !text.trim()) return false
        return (await m.play(text)) ? undefined : false
      },
    },
    more: [
      { id: 'tools', label: 'Pronunciation and library', onSelect: () => setOpen('tools') },
      { id: 'folder', label: 'Music folder', onSelect: () => setOpen('folder') },
    ],
  }), [])
  useViewChrome(v3 ? chrome : null)
  if (v3) {
    const view = nowView(media.state, media.route, simulated, now)
    const plate = { state: media.state, route: media.route, receipt: media.receipt, busy: media.busy, source: media.source, simulated, now, control: media.control, play: media.play, choose: media.choose, onFolder: () => setOpen('folder') }
    const plays = media.history?.length ?? 0
    return (
      <div className="sd sd3" data-scene="immersive" data-sound="">
        <Zones
          ratio={[1.55, 1.15, 0.9]}
          first={{
            job: 'PLAY', chip: <Chip state={view.reading.state} reason={view.reading.reason} />, flare: view.playing ? 1 : 0,
            children: <NowPlate {...plate} part="play" />,
          }}
          second={{
            job: 'SOURCE', peek: { name: 'Source', lamp: media.state ? 'live' : 'waiting', note: media.state ? undefined : 'player not answering' },
            children: <NowPlate {...plate} part="where" />,
          }}
          third={{
            job: 'RECENT', peek: { name: 'Recent', lamp: plays ? 'live' : 'waiting', note: plays ? undefined : 'no plays yet' },
            children: <RecentPlays history={media.history} simulated={simulated} now={now} />,
          }}
        />
        <SoundDrawer
          open={open !== null}
          onClose={() => setOpen(null)}
          onBack={open === 'library' || open === 'words' ? () => setOpen('tools') : undefined}
          title={open ? TITLE[open].title : ''}
          tag={open ? TITLE[open].tag : ''}
        >
          {open === 'tools' && (
            <div className="sd-tools" role="group" aria-label="Pronunciation and study library">
              <WordsCard words={words} simulated={simulated} onOpen={() => setOpen('words')} />
              <LibraryCard lib={library} simulated={simulated} onOpen={() => setOpen('library')} />
            </div>
          )}
          {open === 'library' && <LibraryBody lib={library} simulated={simulated} />}
          {open === 'words' && <WordsBody words={words} simulated={simulated} />}
          {open === 'folder' && <FolderBody media={media} />}
        </SoundDrawer>
      </div>
    )
  }
  return (
    <div className="sd" data-scene="immersive" data-sound="">
      <NowPlate
        state={media.state}
        route={media.route}
        receipt={media.receipt}
        busy={media.busy}
        source={media.source}
        simulated={simulated}
        now={now}
        control={media.control}
        play={media.play}
        choose={media.choose}
        onFolder={() => setOpen('folder')}
        onTools={() => setOpen('tools')}
      />
      <div className="sd-rail">
        <RecentPlays history={media.history} simulated={simulated} now={now} />
      </div>
      <SoundDrawer
        open={open !== null}
        onClose={() => setOpen(null)}
        onBack={open === 'library' || open === 'words' ? () => setOpen('tools') : undefined}
        title={open ? TITLE[open].title : ''}
        tag={open ? TITLE[open].tag : ''}
      >
        {open === 'tools' && (
          <div className="sd-tools" role="group" aria-label="Pronunciation and study library">
            <WordsCard words={words} simulated={simulated} onOpen={() => setOpen('words')} />
            <LibraryCard lib={library} simulated={simulated} onOpen={() => setOpen('library')} />
          </div>
        )}
        {open === 'library' && <LibraryBody lib={library} simulated={simulated} />}
        {open === 'words' && <WordsBody words={words} simulated={simulated} />}
        {open === 'folder' && <FolderBody media={media} />}
      </SoundDrawer>
    </div>
  )
}

/** The live view over a port (LIVE_SOUND in the app). */
export function SoundLive({ port = LIVE_SOUND }: { port?: SoundPort }) {
  const last = useStore((s) => lastMediaEvent(s.events))
  const media = useMedia(port, 5000, last)
  const library = useLibrary(port)
  const words = useWords(port)
  return <SoundView media={media} library={library} words={words} />
}

export default SoundLive
