// The Sound states of the gallery entry S01 (A.S01): every state on invented fixtures, stamped SIMULATED. Loaded lazily by
// gallery/entries/S01.tsx, only where the build holds JARVIS. The box is the real canvas under the shell's view row, drawn at
// 0.66 to fit the pane. Static objects, no hooks, no network: a specimen never talks to the app.
import type { ReactNode } from 'react'
import { fixtureAnswer, fixtureLibrary, fixtureMedia, fixtureReceipt, fixtureWords, type SoundKind } from './fixtures'
import { ROUTE_IDLE, type RouteStatus } from './model'
import { LibraryBody } from './Library'
import { FolderBody, SoundView } from './SoundView'
import { WordsBody } from './Words'
import type { LibraryLive, MediaLive, WordsLive } from './useSound'
import './sound.css'

const NOW = 1_700_000_000_000
const up: RouteStatus = { ok: true, reason: null, at: NOW }
const down: RouteStatus = { ok: false, reason: 'Failed to fetch', at: null }
const noop = () => undefined
const nopromise = async () => false

export type S01State = 'playing' | 'paused' | 'rest' | 'opened' | 'failed' | 'waiting' | 'unreadable' | 'library' | 'words' | 'folder' | 'answer' | 'job' | 'phone'

function media(kind: SoundKind | 'down', receipt: MediaLive['receipt'] = null, source: MediaLive['source'] = 'auto'): MediaLive {
  return {
    state: kind === 'down' ? null : fixtureMedia(kind),
    route: kind === 'down' ? down : up,
    receipt: receipt ?? (kind === 'playing' || kind === 'paused' ? { ...fixtureMedia(kind).last!, action: 'play' } : null),
    busy: false,
    source,
    control: noop,
    play: nopromise,
    choose: noop,
    saveFolder: nopromise,
  }
}

function library(kind: 'notes' | 'empty' | 'running' | 'down'): LibraryLive {
  const view = kind === 'down' ? null : fixtureLibrary(kind)
  return {
    view, route: kind === 'down' ? down : up, running: kind === 'running', note: null, asking: false, error: null,
    add: nopromise, forget: async () => undefined, ask: async () => fixtureAnswer(),
  }
}

function words(down = false): WordsLive {
  return { table: down ? null : fixtureWords(), route: down ? { ...ROUTE_IDLE, reason: 'Failed to fetch' } : up, error: null, save: nopromise, remove: async () => undefined, hear: async () => 'Played in this window.' }
}

function Box({ children, w = 1286, h = 652, zoom = 0.66 }: { children: ReactNode; w?: number; h?: number; zoom?: number }) {
  return <div style={{ position: 'relative', width: w, height: h, zoom, overflow: 'hidden', background: 'var(--surface-ground)' }} data-scene="immersive">{children}</div>
}

export function S01State({ state }: { state: S01State }) {
  const view = (m: MediaLive, l: LibraryLive, w: WordsLive) => (
    <Box><SoundView media={m} library={l} words={w} simulated now={NOW} /></Box>
  )
  // A drawer is drawn in place (the real one is a modal dialog, and several modals cannot share one gallery page)
  const drawer = (title: string, tag: string, body: ReactNode) => (
    <div className="sd-drawer-in" data-scene="immersive" style={{ width: 560, height: 560, position: 'relative' }}>
      <header className="sd-drawer-head"><h2><span className="sd-tag">[{tag}]</span> {title}</h2></header>
      <div className="sd-drawer-body">{body}</div>
    </div>
  )
  switch (state) {
    case 'playing': return view(media('playing'), library('notes'), words())
    case 'paused': return view(media('paused'), library('notes'), words())
    case 'rest': return view(media('rest'), library('empty'), words())
    case 'opened': return view(media('rest', fixtureReceipt('opened'), 'spotify'), library('notes'), words())
    case 'failed': return view(media('rest', fixtureReceipt('failed')), library('notes'), words())
    case 'waiting': return view(media('down'), library('down'), words(true))
    case 'unreadable': return view(media('unreadable'), library('notes'), words())
    case 'library': return drawer('Study library', 'LIB', <LibraryBody lib={library('notes')} simulated />)
    case 'answer': return drawer('Study library', 'LIB', <LibraryBody lib={library('notes')} simulated initial={fixtureAnswer()} />)
    case 'job': return view(media('rest'), library('running'), words())
    case 'words': return drawer('Pronunciation', 'SAY', <WordsBody words={words()} simulated />)
    case 'folder': return drawer('Music folder', 'SND', <FolderBody media={media('folder')} />)
    case 'phone':
      return (
        <Box w={390} h={844} zoom={0.7}>
          <SoundView media={media('playing')} library={library('notes')} words={words()} simulated now={NOW} />
        </Box>
      )
  }
}
