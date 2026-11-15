// J05, 15 Nov 2026: the Console section (Health, Events, Connections, Hardware, Crew) on invented fixtures, then its parts
// (job rows, the route plates, the VRAM dial, the command line). The states live in jarvis/console/gallery.tsx and are loaded
// lazily, only where the build holds JARVIS (the same product gate as shell/views/core.view.ts, written in place so Vite folds
// it), so a Well Wisher only build carries none of it. Every state is stamped SIMULATED: nothing here was measured.
import { lazy, Suspense, type ComponentType } from 'react'
import type { GalleryEntryX } from '../types'

type Part = 'jobs' | 'route' | 'dial-live' | 'dial-hollow' | 'dial-full' | 'deck'
type Kind = 'health-running' | 'health-first' | 'health-fault' | 'events' | 'events-filtered' | 'events-empty' | 'connections' | 'connections-detail' | 'hardware-usb' | 'hardware-wifi' | 'crew' | 'crew-absent'

const State: ComponentType<{ kind: Kind }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/console/gallery').then((m) => ({ default: m.J05State })))
  : null
const PartView: ComponentType<{ part: Part }> | null = import.meta.env.VITE_PRODUCT !== 'ww'
  ? lazy(() => import('../../jarvis/console/gallery').then((m) => ({ default: m.J05Part as unknown as ComponentType<{ part: Part }> })))
  : null

const wait = <p role="status">Loading the JARVIS state…</p>
const absent = <p>JARVIS is not in this build.</p>
const view = (kind: Kind) => (State ? <Suspense fallback={wait}><State kind={kind} /></Suspense> : absent)
const part = (p: Part) => (PartView ? <Suspense fallback={wait}><PartView part={p} /></Suspense> : absent)

const merged = 'J05, 15 Nov 2026'

const entries: GalleryEntryX[] = [
  {
    id: 'J05',
    title: 'Console (shell v2)',
    group: 'section',
    merged,
    also: ['HealthView', 'EventsView', 'ConnectionsView', 'HardwareView', 'CrewView', 'ConsoleRow', 'ConsoleTabs', 'ConsoleKey', 'GuardKey', 'AsciiRuler', 'PartHead'],
    note: 'The machine as a terminal, in the same family as Core and Today: a charcoal terminal frame with bracket-tagged rows (a lamp and its reason each), the GPU dial as the centrepiece with callouts, clay keys, the job board and ASCII ridges. A failure is the amber triangle and the word FAULT with its reason; a reading with no source is a hollow form. Fixtures, stamped SIMULATED.',
    states: [
      { label: 'Health, JARVIS awake', node: view('health-running') },
      { label: 'Health, first run: every row WAITING, the dial hollow', node: view('health-first') },
      { label: 'Health, a failure: FAULT rows, the Wakes pane', node: view('health-fault') },
      { label: 'Events with the filter grammar field', node: view('events') },
      { label: 'Events filtered by "core !sim since:1h"', node: view('events-filtered') },
      { label: 'Events, stream closed and empty', node: view('events-empty') },
      { label: 'Connections: the brain (a model chosen, restart pending)', node: view('connections') },
      { label: 'Connections: one integration\'s detail', node: view('connections-detail') },
      { label: 'Hardware, USB link: flash is closed while the app holds the port', node: view('hardware-usb') },
      { label: 'Hardware, Wi-Fi link: the port is free', node: view('hardware-wifi') },
      { label: 'Crew: the staff, what they said and the route', node: view('crew') },
      { label: 'Crew: the staff is not running', node: view('crew-absent') },
    ],
  },
  {
    id: 'J05/parts',
    title: 'JobRow, RoutePlates, VramDial, CommandLine',
    group: 'section',
    merged,
    also: ['JobRow', 'JobBoard', 'RoutePlates', 'VramDial', 'CommandDeck'],
    note: 'A bar fills only to a reported fraction, else it is a hollow dashed track. The route is the planned registry on a dashed path: built solid, built-not-verified half, planned dashed. The dial is the real VRAM reading or a dashed ring. The command line is a Capture Line with a closed verb list: unknown verbs are refused, a verb that changes something asks once.',
    states: [
      { label: 'job rows: live, hollow, done, FAULT', node: part('jobs') },
      { label: 'route plates', node: part('route') },
      { label: 'VRAM dial, a reading', node: part('dial-live') },
      { label: 'VRAM dial, nearly full', node: part('dial-full') },
      { label: 'VRAM dial, no reading (hollow)', node: part('dial-hollow') },
      { label: 'command line with answers (export memory is PLANNED)', node: part('deck') },
    ],
  },
]

export default entries
