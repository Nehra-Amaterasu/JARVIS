// The specimen of the design reset (28 Nov, docs/design/design-reset-1128.md): monochrome first, colour as signal, character
// art, and the chrome that gives room back. Four scenes, one per ground and accent scheme, each over the bright busy stand-in
// wallpaper (the worst case for the frosted ground), each showing: the palette with its contrast measured live from the
// computed colours, the type scale, the shell's chrome in both poses (spine open and as a rail, the top plate full and slim, the
// dock slim and open), a tray with a long body (it scrolls, with the soft edge where there is more), the kit in its poses, the
// five lamp states, and the character-art set.
//
// FIXTURES, NOT MEASUREMENTS. No number here was read from anything. Every value sits under a SIMULATED chip or a WAITING state
// with its reason, the clock is the specimen's fixed time, and the long tray's rows say they are filler. The shell pieces are
// the real components (Spine, TopPlate, Dock, Tray) given fixture props; nothing they draw claims a measured state.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Chip, Counter, Dial, DotLevel, DotMark, DotRing, EmptyPose, Gauge, Key, Ledger, LockedKey, StateFigure } from '../../shared/kit/v3'
import type { DotMarkKind } from '../../shared/kit/v3'
import { Wall } from '../../shared/kit/v3/Wall'
import { Lamp } from '../../shared/lamp'
import { LAMP_STATES, type LampState } from '../../shared/lamp/types'
import { Dock } from '../../shell/v3/Dock'
import { collectLamps } from '../../shell/v3/lamps'
import { Spine } from '../../shell/v3/Spine'
import { TopPlate } from '../../shell/v3/TopPlate'
import { Tray } from '../../shell/v3/Tray'
import type { Place } from '../../shell/ids'
import '../../shell/v3/shell-v3-tokens.css'
import '../../shell/v3/shell-v3.css'
import type { GalleryEntryX } from '../types'

type GroundId = 'dark' | 'light'
type Scheme = 'one' | 'project'

/** The specimen's fixed clock: 09:30 on 28 Nov 2026, so the spine's time never pretends to be now. */
const SPECIMEN_NOW = Date.UTC(2026, 10, 28, 4, 0)
const JARVIS_PLACE: Place = { product: 'jarvis', section: 'core', view: 'talk' }
const WW_PLACE: Place = { product: 'ww', section: 'day', view: 'today' }
/** The lamp table with no reading at all: every lamp WAITING with the words of what it waits for (the shell never invents a state). */
const NO_READINGS = collectLamps({})
const AANKHEN_PLACE: Place = { product: 'jarvis', section: 'senses', view: 'presence' }

const SCENE: CSSProperties = { position: 'relative', isolation: 'isolate', overflow: 'hidden', borderRadius: 18, width: 'min(84rem, calc(100vw - 6rem))', minWidth: 0 }
const BODY: CSSProperties = { position: 'relative', zIndex: 1, display: 'grid', gap: 28, padding: 28, color: 'var(--ink)', fontFamily: 'var(--f-ui)' }
const LAYER: CSSProperties = { position: 'absolute', inset: 0, zIndex: 0, backgroundColor: 'rgba(var(--ground-rgb), var(--ga))', backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)' }
const H: CSSProperties = { margin: 0, font: '600 11px/1.2 var(--f-ui)', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' }
const ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 17rem), 1fr))', gap: 18, alignItems: 'start' }
/** One tray surface for a specimen block: the real tray token at its alpha, the tray shadow. */
const TRAY: CSSProperties = { display: 'grid', gap: 14, padding: 18, borderRadius: 22, backgroundColor: 'rgba(var(--tray-rgb), var(--ta))', boxShadow: 'var(--sh-tray), var(--edge)', minWidth: 0 }

function Block({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ ...TRAY, ...style }} aria-label={title}>
      <h3 style={H}>{title}</h3>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------- palette, measured live

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
function rgbOf(css: string): number[] | null {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(css)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const SWATCHES: { name: string; token: string; role: string }[] = [
  { name: 'Ground', token: 'rgb(var(--ground-rgb))', role: 'the one ground' },
  { name: 'Tray', token: 'rgb(var(--tray-rgb))', role: 'the one surface' },
  { name: 'Raised', token: 'var(--raised)', role: 'every key' },
  { name: 'Well', token: 'rgb(var(--well-rgb))', role: 'inputs, tracks' },
  { name: 'Ink', token: 'var(--ink)', role: 'text' },
  { name: 'Ink 2', token: 'var(--ink2)', role: 'secondary text' },
  { name: 'Ink 3', token: 'var(--ink3)', role: 'labels on a tray' },
  { name: 'Accent', token: 'var(--accent)', role: 'the signal' },
  { name: 'Fault', token: 'var(--fault)', role: 'the only state colour' },
]

/** Each swatch, and the measured contrast of the three inks and the accent on the tray, read from the computed colours. */
function Palette() {
  const host = useRef<HTMLDivElement>(null)
  const [read, setRead] = useState<Record<string, string>>({})
  useEffect(() => {
    const el = host.current
    if (!el) return
    const probe = (tok: string) => {
      const s = document.createElement('span')
      s.style.color = tok
      el.appendChild(s)
      const c = getComputedStyle(s).color
      s.remove()
      return rgbOf(c)
    }
    const tray = probe('rgb(var(--tray-rgb))')
    const out: Record<string, string> = {}
    if (tray) for (const t of ['var(--ink)', 'var(--ink2)', 'var(--ink3)', 'var(--accent)', 'var(--fault)']) {
      const c = probe(t)
      if (c) out[t] = ratio(c, tray).toFixed(1)
    }
    setRead(out)
  }, [])
  return (
    <div ref={host} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(8.5rem, 1fr))', gap: 12 }}>
      {SWATCHES.map((s) => (
        <figure key={s.name} style={{ margin: 0, display: 'grid', gap: 6 }}>
          <span style={{ height: 44, borderRadius: 12, background: s.token, boxShadow: 'var(--sh-later)' }} />
          <figcaption style={{ display: 'grid', gap: 2 }}>
            <b style={{ font: '600 13px/1.2 var(--f-ui)' }}>{s.name}</b>
            <span style={{ font: '400 12px/1.3 var(--f-ui)', color: 'var(--ink2)' }}>{s.role}</span>
            {read[s.token] && <span style={{ font: '500 12px/1.3 var(--f-mono)', color: 'var(--ink2)' }} data-contrast={read[s.token]}>{read[s.token]} : 1 on the tray</span>}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

const SCALE: { px: number; use: string; weight: number }[] = [
  { px: 28, use: 'Display: a view title of a hero state', weight: 600 },
  { px: 20, use: 'Title: the section in the top plate', weight: 600 },
  { px: 16, use: 'Lead: a tray headline, an empty pose', weight: 600 },
  { px: 14, use: 'Body: rows, keys, sentences', weight: 400 },
  { px: 13, use: 'Small: the third tray, reasons', weight: 400 },
  { px: 12, use: 'Meta: times, counts, captions', weight: 500 },
  { px: 11, use: 'LABEL: TRAY JOBS, STATE WORDS', weight: 600 },
]

function TypeScale() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {SCALE.map((t) => (
        <div key={t.px} style={{ display: 'grid', gridTemplateColumns: '3.25rem minmax(0, 1fr)', alignItems: 'baseline', gap: 12 }}>
          <span style={{ font: '500 12px/1 var(--f-mono)', color: 'var(--ink2)' }}>{t.px} px</span>
          <span style={{ font: `${t.weight} ${t.px}px/1.3 var(--f-ui)`, letterSpacing: t.px >= 20 ? '-0.015em' : t.px === 11 ? '0.1em' : 0, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden' }}>{t.use}</span>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '3.25rem minmax(0, 1fr)', gap: 12 }}>
        <span style={{ font: '500 12px/1 var(--f-mono)', color: 'var(--ink2)' }}>mono</span>
        <span style={{ font: '450 14px/1.3 var(--f-mono)', color: 'var(--ink)' }}>you&gt; machine values: 09:30, 0.42, 3 of 7</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- the chrome, both poses

const FILLER = Array.from({ length: 22 }, (_, i) => `Filler row ${i + 1} of 22: a long tray body, so the scroll and its soft edge can be seen`)

function Frame({ place, ground, rail, slim, dockOpen }: { place: Place; ground: GroundId; rail: boolean; slim: boolean; dockOpen: boolean }) {
  return (
    <div className="s3" data-ground={ground} data-glass="on" data-spine={rail ? 'rail' : 'full'} data-plate={slim ? 'slim' : 'full'} data-spine-pin="auto" data-window="translucent"
      data-reset-frame={`${rail ? 'rail' : 'full'}-${slim ? 'slim' : 'full'}`}
      style={{ position: 'relative', display: 'grid', gridTemplateColumns: `${rail ? 64 : 184}px minmax(0, 1fr)`, height: 640, borderRadius: 20, overflow: 'clip', boxShadow: 'var(--sh-tray)' }}>
      <div className="s3-ground" aria-hidden="true" style={{ inset: 0, backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)' }} />
      <Spine place={place} rows={NO_READINGS} now={SPECIMEN_NOW} onGoSection={() => undefined} folded={rail} onFold={() => undefined} />
      <div className="s3-main">
        <TopPlate place={place} rows={NO_READINGS} more={[]} glass onGlass={() => undefined} slim={slim} onGoSection={() => undefined} onSetView={() => undefined} onShortcuts={() => undefined} windowKeys={false} />
        <div className="s3-stage">
          <div className="s3-zones" style={{ gridTemplateColumns: '1.6fr 1fr', padding: '6px 8px 8px' }}>
            <Tray step={1} job="FIRST ACT" chip={<Chip state="simulated" />}>
              {FILLER.map((t) => <p key={t} style={{ margin: 0, color: 'var(--ink2)' }}>{t}</p>)}
            </Tray>
            <Tray step={2} job="WHAT FOLLOWS" chip={<Chip state="waiting" />}>
              <EmptyPose compact state="waiting" title="Nothing to follow yet" reason="a fixture: nothing has reported" />
            </Tray>
          </div>
        </div>
        <Dock spec={{ modes: [{ id: 'type', label: 'Type', prefix: 'you>', example: 'type a line for JARVIS', action: 'Send' }] }} onAsk={() => undefined} open={dockOpen} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- the kit, the lamps, the art

const MARKS: DotMarkKind[] = ['system', 'jarvis', 'aankhen', 'yadaash', 'wellwisher']
const MARK_NAME: Record<DotMarkKind, string> = { system: 'The System', jarvis: 'JARVIS', aankhen: 'Aankhen', yadaash: 'Yadaash', wellwisher: 'Well Wisher' }
const READING: Record<LampState, string> = {
  live: 'a fixture standing for a source that reports',
  waiting: 'no report',
  simulated: 'generated sample, preview only',
  planned: 'not built yet',
  fault: 'the fixture source returned an error',
}

function Kit({ hue }: { hue: string }) {
  return (
    <div style={GRID}>
      <Block title="Keys, in their poses">
        <div style={ROW}>
          <Key>Rest</Key>
          <Key pose="hover">Hover</Key>
          <Key pose="pressed">Pressed</Key>
          <Key pose="focus">Focus</Key>
        </div>
        <div style={ROW}>
          <Key accent>The one primary key</Key>
          <Key lit toggle>Lit</Key>
          <LockedKey reason="locked in the specimen">Locked</LockedKey>
        </div>
      </Block>
      <Block title="State chips and the ledger">
        <div style={ROW}>{LAMP_STATES.map((s) => <Chip key={s} state={s} />)}</div>
        <Ledger label="Specimen rows" rows={[
          { id: 'a', label: 'Voice core', reason: 'core not started', state: 'waiting' },
          { id: 'b', label: 'Sample reading', reason: 'generated sample, preview only', state: 'simulated', value: '0.2' },
          { id: 'c', label: 'Reminder engine', reason: 'next: the reminder engine', state: 'planned' },
          { id: 'd', label: 'Fixture source', reason: 'the fixture reported an error', state: 'fault' },
        ]} />
      </Block>
      <Block title="Counters, dial and gauge (simulated)">
        <div style={ROW}>
          <Counter name="Specimen tap" state="simulated" count={3} onTap={() => undefined} />
          <Counter name="Waiting source" state="waiting" count={null} onTap={() => undefined} />
        </div>
        <div style={ROW}>
          <Dial name="Sample" state="simulated" value={42} max={100} unit="%" reason="generated sample" />
          <Gauge name="Sample" state="simulated" value={0.6} max={1} reason="generated sample" />
        </div>
      </Block>
      <Block title="The lamp: five shapes, five words">
        <div style={{ display: 'grid', gap: 10 }}>
          {LAMP_STATES.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <StateFigure state={s} pitch={4} />
              <Lamp reading={{ state: s, since: null, reason: READING[s] }} now={SPECIMEN_NOW} />
              <span style={{ font: '400 13px/1.3 var(--f-ui)', color: 'var(--ink2)' }}>{READING[s]}</span>
            </div>
          ))}
        </div>
      </Block>
      <Block title="Character art: the marks">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
          {MARKS.map((k) => (
            <figure key={k} style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 8, color: k === hue ? 'var(--accent)' : 'var(--ink)' }}>
              <DotMark kind={k} pitch={5} title={MARK_NAME[k]} />
              <figcaption style={{ font: '500 12px/1.2 var(--f-ui)', color: 'var(--ink2)', textAlign: 'center' }}>{MARK_NAME[k]}</figcaption>
            </figure>
          ))}
        </div>
        <p style={{ margin: 0, font: '400 13px/1.45 var(--f-ui)', color: 'var(--ink2)' }}>Every mark is ink; the open project's mark takes the accent.</p>
      </Block>
      <Block title="Character art: empty poses">
        <EmptyPose state="waiting" title="No follow-ups" reason="nothing is dated for today" />
        <EmptyPose state="planned" title="Agents" reason="not built yet: the plan lists it" compact />
        <EmptyPose state="fault" title="The board is not answering" reason="the fixture source returned an error" compact action={<Key>Retry</Key>} />
      </Block>
      <Block title="Character art: readers of real values">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={ROW}><DotLevel label="Waiting level" value={null} max={1} state="waiting" /> <Chip state="waiting" /></div>
          <div style={ROW}><DotLevel label="Sample level" value={0.6} max={1} state="simulated" /> <Chip state="simulated" /></div>
          <div style={ROW}><DotLevel label="A value given under PLANNED" value={0.9} max={1} state="planned" /> <Chip state="planned" /></div>
        </div>
        <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
          <DotRing state="waiting" size={130} title="Ring, waiting: no level" />
          <DotRing state="simulated" level={0.4} size={130} title="Ring, simulated level" />
        </div>
      </Block>
    </div>
  )
}

function Scene({ ground, scheme }: { ground: GroundId; scheme: Scheme }) {
  // scheme B on the dark ground opens Aankhen, so the picture shows a project accent that is not the System's amber
  const hue = ground === 'light' ? 'wellwisher' : scheme === 'project' ? 'aankhen' : 'jarvis'
  const place = ground === 'light' ? WW_PLACE : scheme === 'project' ? AANKHEN_PLACE : JARVIS_PLACE
  return (
    <div style={SCENE} data-reset-scene={`${ground}-${scheme}`} data-look="v3" data-ground={ground} data-accent={scheme} data-hue={hue} data-glass="on">
      <Wall dark={ground === 'dark'} />
      <div style={LAYER} aria-hidden="true" />
      <div style={BODY}>
        <header style={{ display: 'grid', gap: 6 }}>
          <h2 style={{ margin: 0, font: '600 28px/1.15 var(--f-ui)', letterSpacing: '-0.02em' }}>The reset, {ground} ground, {scheme === 'one' ? 'one accent' : 'an accent per project'}</h2>
          <p style={{ margin: 0, font: '400 14px/1.5 var(--f-ui)', color: 'var(--ink2)', maxWidth: '62ch' }}>
            Monochrome first: one ground, one tray surface, one raised step. Colour is a signal. Behind it, a bright stand-in wallpaper:
            the frosted ground lets it through without hurting the text. Every value here is a fixture.
          </p>
        </header>
        <div style={GRID}>
          <Block title="Palette, measured on this page"><Palette /></Block>
          <Block title="Type scale: Inter, Geist Mono"><TypeScale /></Block>
        </div>
        <div style={{ display: 'grid', gap: 18 }}>
          <h3 style={H}>Chrome: spine open, plate full, dock slim</h3>
          <Frame place={place} ground={ground} rail={false} slim={false} dockOpen={false} />
          <h3 style={H}>Chrome: spine as a rail, plate slim, dock open</h3>
          <Frame place={place} ground={ground} rail slim dockOpen />
        </div>
        {scheme === 'project' && ground === 'dark' && <ProjectAccents />}
        <Kit hue={hue} />
      </div>
    </div>
  )
}

/** Scheme B on the dark ground: the three dark projects' accents side by side, each on its own primary key and lamp. */
function ProjectAccents() {
  return (
    <Block title="Scheme B: one signal accent per project">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 14 }}>
        {(['jarvis', 'aankhen', 'yadaash'] as const).map((p) => (
          <div key={p} data-look="v3" data-ground="dark" data-accent="project" data-hue={p} style={{ display: 'grid', gap: 10, justifyItems: 'start', color: 'var(--ink)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--accent)' }}><DotMark kind={p} pitch={4} /><b style={{ color: 'var(--ink)', font: '600 14px var(--f-ui)' }}>{MARK_NAME[p]}</b></span>
            <Key accent>Primary key</Key>
            <Lamp reading={{ state: 'live', since: null, reason: READING.live }} now={SPECIMEN_NOW} />
          </div>
        ))}
      </div>
    </Block>
  )
}

const entries: GalleryEntryX[] = [
  {
    id: 'v3/Reset',
    title: 'Design reset: monochrome first, colour as signal',
    group: 'kit',
    note: 'The specimen of the 28 Nov reset: both grounds and both accent schemes, the chrome in both poses, the kit, the lamps and the character art. Fixtures only.',
    merged: 'Z, 28 Nov 2026',
    states: [
      { label: 'dark ground, one accent', node: <Scene ground="dark" scheme="one" /> },
      { label: 'dark ground, an accent per project', node: <Scene ground="dark" scheme="project" /> },
      { label: 'light ground, one accent', node: <Scene ground="light" scheme="one" /> },
      { label: 'light ground, an accent per project', node: <Scene ground="light" scheme="project" /> },
    ],
  },
]
export default entries
