// The G02 gallery entry (spec 15.6 rule 3, D-V2-23): every grammar component in its states. N01 owns
// gallery/entries/*.tsx; this module holds the entry so the one-line file gallery/entries/G02.tsx can re-export it
// (`export { entry } from '../../shared/grammar/gallery'`). The object is written to N01's contract type
// GalleryEntry by shape, without importing it, so this branch builds before N01 merges.
//
// Every number here is a bench fixture and says so: each data form carries a SIMULATED lamp.
import type { ReactNode } from 'react'
import { Lamp, LAMP_STATES, type LampReading } from '../lamp'
import { AsciiBar, AsciiHeat, AsciiPlate, AsciiPortrait } from './ascii/Ascii'
import { RAMPS, sparkline } from './ascii/ramps'
import { fnv1a32, mulberry32 } from './sigil/hash'
import { GlyphRule, Seal, Sigil, SigilFrame } from './sigil/Sigil'
import { BootSequence, ScanFrame, TermLine, TermWell } from './term/Term'
import './gallery.css'

const SIM: LampReading = { state: 'simulated', since: null, reason: 'bench fixture' }
const WAIT: LampReading = { state: 'waiting', since: null, reason: 'no report' }

/** Seeds that name things, never people: view ids, days, tree nodes. */
export const SHEET_SEEDS = [
  'day.today', 'day.month', 'focus.drill', 'study.plan', 'tree.node.algebra', 'tree.node.optics', 'career.ladder', 'memory.beliefs',
  'core', 'room.rules', 'senses.teach', 'console.logs', 'proof.panel', 'day.2026-11-01', 'day.2026-11-02', 'unit.waves',
]

/** A caret field (C04-113 family) as plate text: two flowing ribbons of carets, deterministic, digit-free, ~1.5 KB. */
export function caretField(cols = 72, rows = 16, seed = 'plate.caret'): string {
  const rnd = mulberry32(fnv1a32(seed))
  const g = RAMPS.caret
  const out: string[] = []
  for (let y = 0; y < rows; y++) {
    let ln = ''
    for (let x = 0; x < cols; x++) {
      const u = x / cols
      const a = rows * (0.32 + 0.2 * Math.sin(u * 5.2 + 0.6))
      const b = rows * (0.7 + 0.16 * Math.sin(u * 3.1 + 2.4))
      const da = Math.abs(y - a) / (2.2 + 1.4 * Math.sin(u * 7)), db = Math.abs(y - b) / 1.8
      const t = Math.max(Math.exp(-da * da), 0.85 * Math.exp(-db * db)) + (rnd() - 0.5) * 0.22
      ln += g[Math.max(0, Math.min(g.length - 1, Math.floor(t * g.length)))]
    }
    out.push(ln.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

const MONTH = [0, 2, 3, 1, 0, 5, 7, 4, 2, NaN, 0, 3, 6, 8, 2, 1, 0, 0, 4, 5, 3, 2, 9, 6, 1, 0, 2, 3, 4, 1]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gs-row">
      <span className="gs-label">{label}</span>
      <div className="gs-items">{children}</div>
    </div>
  )
}

export function SigilSheet() {
  return (
    <div className="gs-block">
      <div className="gs-hero">{SHEET_SEEDS.slice(0, 8).map((s) => <Sigil key={s} seed={s} size={48} />)}</div>
      <Row label="48 px, seed glyph">{SHEET_SEEDS.map((s) => <Sigil key={s} seed={s} size={48} />)}</Row>
      <Row label="24 px, tree node">{SHEET_SEEDS.map((s) => <Sigil key={s} seed={s} size={24} />)}</Row>
      <Row label="16 px, day cell">{SHEET_SEEDS.map((s) => <Sigil key={s} seed={s} size={16} />)}</Row>
      <Row label="fold 4, 6, 8">{[4, 6, 8].map((f) => <Sigil key={f} seed="unit.waves" fold={f} size={48} />)}{[4, 6, 8].map((f) => <Sigil key={`c${f}`} seed="core" fold={f} size={48} />)}</Row>
      <Row label="growth 0 to 1">{[0, 0.25, 0.5, 0.75, 1].map((g) => <Sigil key={g} seed="tree.node.optics" mode="growth" stage={g} size={48} />)}</Row>
      <Row label="drawn-in, accent">
        <Sigil seed="day.today" size={48} drawn />
        <Sigil seed="focus.drill" size={48} tone="accent" />
      </Row>
    </div>
  )
}

export function SealSheet() {
  return (
    <div className="gs-block">
      <Row label="earned, hollow, simulated">
        <Seal id="unit.waves" earned label="Unit finished" />
        <Seal id="unit.waves" earned={false} label="Unit finished" />
        <Seal id="paper.set.a" earned simulated label="Paper reviewed" />
        <Seal id="block.focus" earned label="Block kept" />
        <Seal id="tree.branch.science" earned label="Branch evidenced" />
        <Seal id="tree.branch.craft" earned={false} label="Branch evidenced" />
      </Row>
    </div>
  )
}

export function FrameSheet() {
  return (
    <div className="gs-block gs-frames">
      <SigilFrame><p className="gs-copy">Frame: four brackets, one ruler on the left.</p></SigilFrame>
      <SigilFrame sides={['b']}><p className="gs-copy">Ruler on the bottom.</p></SigilFrame>
      <SigilFrame planned><p className="gs-copy"><Lamp reading={{ state: 'planned', since: null, reason: 'not built' }} /> dashed: planned.</p></SigilFrame>
      <div className="gs-rules">
        <GlyphRule density={0} length={3} />
        <GlyphRule density={0.5} />
        <GlyphRule density={1} length={7} />
      </div>
    </div>
  )
}

export function AsciiSheet() {
  const plate = caretField()
  return (
    <div className="gs-block gs-ascii">
      <div className="gs-plates">
        <AsciiPlate text={plate} ramp="caret" />
        <AsciiPlate text={plate} ramp="caret" state="frozen" />
        <AsciiPlate text={plate} ramp="caret" state="scattered" />
      </div>
      <div className="gs-data">
        <AsciiHeat cells={MONTH} offset={3} unit="actions" label="November, actions per day" reading={<Lamp reading={SIM} subject="Actions" />} />
        <AsciiHeat cells={MONTH.slice(0, 14)} state="waiting" label="Waiting grid" reading={<Lamp reading={WAIT} subject="Actions" />} />
        <div className="gs-bars">
          <AsciiBar value={7} max={10} label="Unit 3" reading={<Lamp reading={SIM} />} />
          <AsciiBar value={1250} max={2000} width={16} head=">" label="Water" reading={<Lamp reading={SIM} />} />
          <AsciiBar value={46} max={60} width={16} head="car" label="Runway" reading={<Lamp reading={SIM} />} />
          <AsciiBar value={3} max={10} width={16} head="chopper" label="Papers" reading={<Lamp reading={SIM} />} />
          <AsciiBar value={4} max={10} state="waiting" label="Spend" reading={<Lamp reading={WAIT} />} />
          <div className="gs-spark"><code>{sparkline([12, 18, 15, 22, NaN, 30, 41, 38, 26, 33, 45, 40])}</code> <Lamp reading={SIM} subject="Minutes" /></div>
        </div>
        <div className="gs-portraits">
          {['AN', 'KR', 'MS', 'TJ'].map((i) => <AsciiPortrait key={i} initials={i} />)}
        </div>
      </div>
    </div>
  )
}

export function TermSheet() {
  return (
    <div className="gs-block gs-term">
      <TermWell prompt="jarvis console.logs $" label="Console log">
        {LAMP_STATES.map((s) => <TermLine key={s} tag={s}>{`${s === 'live' ? 'voice level 0.42' : s === 'simulated' ? 'senses fixture replay' : s === 'waiting' ? 'board report' : s === 'planned' ? 'calendar link' : 'relay 3 did not answer'}`}</TermLine>)}
        <TermLine kind="err">relay-timeout: the board did not answer in 2 s</TermLine>
        <TermLine>try: reconnect the board</TermLine>
      </TermWell>
      <TermWell prompt="ww day.today $" label="Boot">
        <BootSequence rows={['heard', 'working: reading syllabus index', 'done']} onDone={() => {}} />
      </TermWell>
      <div className="gs-scans">
        <ScanFrame label="Board" state="scanning" />
        <ScanFrame label="Phone link" state="waiting" />
      </div>
    </div>
  )
}

/** N01's GalleryEntry, by shape. */
export const entry = {
  id: 'G02',
  title: 'Grammars: sigil, ASCII, terminal',
  group: 'grammar' as const,
  states: [
    { label: 'Sigils', node: <SigilSheet /> },
    { label: 'Seals', node: <SealSheet /> },
    { label: 'Frames and dividers', node: <FrameSheet /> },
    { label: 'ASCII', node: <AsciiSheet /> },
    { label: 'Terminal', node: <TermSheet /> },
  ],
  note: 'Every number on this entry is a bench fixture and carries the SIMULATED lamp.',
}
