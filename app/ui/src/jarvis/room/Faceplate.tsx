// The wall box faceplate (A.J02, spec 20.9.2): a chamfered label plate "WALL BOX, 8 CH" with the heavy-load Trim, the mode dial,
// and eight keys. Every key is a GuardKey, so the lamp, the cover and the two acts are one component's job. The plate is the
// centrepiece of Room: the art id `art.room.faceplate` is drawn under it when the private track has one, and nothing otherwise.
//
// The keys never read the saved state for a lamp (model.keySlots). The dial previews a mode as dashed outlines on the keys it
// would change; Enter applies, and a mode that would turn ON a flagged channel asks for a second Enter first.
import { Power } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ArtSlot } from '../../art/ArtSlot'
import type { LimbsView, Mode } from '../../lib/limbs'
import { channelRows, isWallBox, lcdRow1, lcdRow2 } from '../../lib/wallbox'
import { Chip, Key, LampGlyph, Plate, Switch } from '../../shared/kit'
import { Sigil } from '../../shared/grammar'
import { Trim } from '../../shared/trim'
import type { SettingDef } from '../../shared/trim/types'
import { GuardKey, type GuardState } from './GuardKey'
import { COVER_MS, heavySummary, onCount, onNames, sceneGuarded, scenePreview, type HeavyFlags, type KeySlot } from './model'
import './room.css'

export const FACEPLATE_ART = 'art.room.faceplate'

/* ------------------------------------------------------------------------------------------------ the heavy-load Trim */

/** The setting this Trim carries. It is passed to Trim as `def`: no `*.settings.ts` registers it, because that glob would put a
 *  JARVIS module into a Well Wisher only build (the integrator can move it there). */
export function heavySetting(read: () => HeavyFlags, reset: () => void): SettingDef {
  return {
    id: 'room.heavy', label: 'Heavy loads', section: 'room', view: 'switches', risk: 'hardware',
    read: () => Object.keys(read()).length,
    reset,
    format: (v) => (v ? `${v} flagged` : 'none flagged'),
    defaultText: 'none flagged',
    isDefault: () => Object.keys(read()).length === 0,
  }
}

function HeavyTrim({ slots, heavy, setHeavy }: { slots: KeySlot[]; heavy: HeavyFlags; setHeavy: (n: HeavyFlags) => void }) {
  const def = heavySetting(() => heavy, () => setHeavy({}))
  return (
    <Trim settingId="room.heavy" label="Heavy loads" def={def} readsBy="each key reads it: a flagged channel needs the cover lifted before it turns ON; OFF is always one press">
      <div className="jr-heavy-list">
        {slots.filter((s) => s.present && s.id).map((s) => (
          <Switch key={s.id} label={`${s.name}: heavy load`} checked={!!heavy[s.id!]}
            onChange={(on) => { const n = { ...heavy }; if (on) n[s.id!] = true; else delete n[s.id!]; setHeavy(n) }} />
        ))}
        {!slots.some((s) => s.present) && <p className="jr-note">No channel is on the board yet.</p>}
      </div>
    </Trim>
  )
}

/* ------------------------------------------------------------------------------------------------ the mode dial */

export interface ModeDialProps {
  modes: Mode[]
  /** 0 is "now" (no preview); 1 to n are the modes in order. */
  stop: number
  onStop: (n: number) => void
  onApply: () => void
  lastMode: string | null
  /** Set while a scene that would turn on a flagged channel waits for its second Enter. */
  armed?: string | null
}

const SWEEP = 270
const dialAngle = (i: number, n: number) => -SWEEP / 2 + (n === 0 ? 0 : (SWEEP * i) / n)

export function ModeDial({ modes, stop, onStop, onApply, lastMode, armed }: ModeDialProps) {
  const n = modes.length
  const name = stop === 0 ? 'NOW' : modes[stop - 1]?.name ?? 'NOW'
  const id = useId()
  const onKey = (e: KeyboardEvent) => {
    const to = (v: number) => { e.preventDefault(); onStop(Math.max(0, Math.min(n, v))) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to(stop + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to(stop - 1)
    else if (e.key === 'Home') to(0)
    else if (e.key === 'End') to(n)
    else if (e.key === 'Escape' && stop !== 0) to(0)
    else if (e.key === 'Enter' && stop > 0) { e.preventDefault(); onApply() }
  }
  return (
    <div className="jr-dial" data-armed={armed ? 'true' : undefined}>
      <div className="jr-dial-body" role="slider" tabIndex={0} aria-labelledby={`${id}-l`} aria-valuemin={0} aria-valuemax={n} aria-valuenow={stop}
        aria-valuetext={stop === 0 ? 'now: no mode previewed' : `${name}: previewed, Enter applies`} onKeyDown={onKey}>
        <svg viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
          <circle className="jr-dial-face" r="62" />
          <circle className="jr-dial-lip" r="62" />
          {Array.from({ length: n + 1 }, (_, i) => {
            const a = (dialAngle(i, n) * Math.PI) / 180
            const r = 82
            return (
              <g key={i} data-on={i === stop ? 'true' : undefined} data-last={i > 0 && modes[i - 1]?.id === lastMode ? 'true' : undefined}
                onPointerDown={() => onStop(i)} style={{ cursor: 'pointer' }}>
                <circle className="jr-dial-hit" cx={Math.sin(a) * r} cy={-Math.cos(a) * r} r="14" />
                <circle className="jr-dial-det" cx={Math.sin(a) * r} cy={-Math.cos(a) * r} r={i === stop ? 5 : 3.2} />
              </g>
            )
          })}
          <line className="jr-dial-notch" x1="0" y1="-18" x2="0" y2="-50" transform={`rotate(${dialAngle(stop, n)})`} />
        </svg>
      </div>
      <div className="jr-dial-read" id={`${id}-l`}>
        <span className="jr-dial-name" data-preview={stop > 0 ? 'true' : undefined}>{name}</span>
        <span className="jr-dial-hint">{armed ? `${armed}. Enter again` : stop === 0 ? 'turn to preview a mode' : 'dashed keys: Enter applies'}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ the scene guard */

/**
 * A mode that would turn ON a channel the owner flagged as heavy cannot skip the cover: the first request only arms it (the
 * line says what it turns on), the second inside 5 s applies. A mode that touches no flagged channel applies at once.
 * Returns true when the mode was applied.
 */
export function useSceneGuard(modes: Mode[], slots: KeySlot[], heavy: HeavyFlags, apply: (modeId: string) => void) {
  const [armed, setArmed] = useState<{ id: string; text: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const request = useCallback((id: string): boolean => {
    const mode = modes.find((m) => m.id === id) ?? null
    const guarded = sceneGuarded(mode, slots, heavy)
    if (guarded.length && armed?.id !== id) {
      setArmed({ id, text: guarded.map((s) => heavySummary(s.name)).join('; ') })
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setArmed(null), COVER_MS)
      return false
    }
    if (timer.current) clearTimeout(timer.current)
    setArmed(null)
    apply(id)
    return true
  }, [modes, slots, heavy, apply, armed])
  return { armed, request, disarm: () => setArmed(null) }
}

/* ------------------------------------------------------------------------------------------------ the faceplate */

export interface FaceplateProps {
  slots: KeySlot[]
  heavy: HeavyFlags
  setHeavy: (next: HeavyFlags) => void
  modes: Mode[]
  lastMode: string | null
  onPress: (id: string, on: boolean) => void
  /** The guarded request of useSceneGuard: true when the mode was applied. */
  onScene: (modeId: string) => boolean
  /** The line of a scene waiting for its second act, or null. */
  armedText?: string | null
  /** Fixture and test hook: the dial's stop. */
  defaultStop?: number
  coverMs?: number
}

/** The state the GuardKey reads from the key's phase. */
const guardState = (s: KeySlot): GuardState => (s.phase === 'steady' || s.phase === 'absent' ? 'closed' : s.phase)

/** The modes as numbered keys beside the dial: 44 px chips, the number is the key that applies it while focus is in the wall box.
 *  `max` keeps the strip to one or two rows; the dial and the Rules view hold the rest. */
export function ModeKeys({ modes, lastMode, onScene, max = 6, className = '' }: { modes: Mode[]; lastMode: string | null; onScene: (modeId: string) => boolean; max?: number; className?: string }) {
  const shown = modes.slice(0, max)
  return (
    <div className={`jr-chips ${className}`.trim()} role="group" aria-label="Apply a mode">
      {modes.length === 0 && <span className="jr-note">No modes reported yet.</span>}
      {shown.map((m, i) => (
        <Chip key={m.id} grouped selected={lastMode === m.id} onClick={() => void onScene(m.id)}>
          <kbd className="jr-modeno" aria-hidden="true">{i + 1}</kbd>{m.name}
        </Chip>
      ))}
      {modes.length > max && <span className="jr-note">+{modes.length - max} more on the dial</span>}
    </div>
  )
}

/** A free or unwired slot is drawn with its number and a plain caption, never the raw channel id (the 19 Nov jury read "light2"). */
const slotName = (s: KeySlot) => (s.present ? s.name : 'Free slot')

export function Faceplate({ slots, heavy, setHeavy, modes, lastMode, onPress, onScene, armedText = null, defaultStop = 0, coverMs }: FaceplateProps) {
  const [stop, setStop] = useState(defaultStop)
  const mode = stop > 0 ? modes[stop - 1] ?? null : null
  const preview = scenePreview(mode, slots)
  const apply = () => {
    if (mode && onScene(mode.id)) setStop(0)
  }
  // 1 to 9 apply the mode of that number while focus is in the wall box; a field or a closed cover never sees them
  const onKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return
    // A held key sends auto-repeat keydowns: the first would arm a flagged mode and the first repeat would count as the second
    // act, so one held key would lift the two-act cover. Each act must be its own press.
    if (e.repeat) { e.preventDefault(); return }
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="spinbutton"], [role="combobox"], .tr-pop')) return
    // a slider other than the mode dial (which takes arrows, never digits) owns its own keys
    if (t.closest('[role="slider"]') && !t.closest('.jr-dial-body')) return
    const m = modes[Number(e.key) - 1]
    if (!m) return
    e.preventDefault()
    // the dial's preview outlines describe a mode not yet applied; once one is applied they would lie
    if (onScene(m.id)) setStop(0)
  }
  return (
    <section className="jr-face-plate" aria-label="Wall box, 8 channels" onKeyDown={onKeys}>
      <div className="jr-art" aria-hidden="true"><ArtSlot id={FACEPLATE_ART} fit="cover" ratio={3} /></div>
      <header className="jr-plate-head">
        <span className="jr-head-l"><span className="jr-mark" aria-hidden="true"><Sigil seed="jarvis.room.wallbox" size={24} fold={4} /></span><Plate serial="[ROM] 8 CH">WALL BOX, 8 CH</Plate></span>
        {armedText && <p className="jr-armed" role="status"><LampGlyph state="waiting" size={12} /> {armedText}. Press the mode again within 5 s.</p>}
        <HeavyTrim slots={slots} heavy={heavy} setHeavy={setHeavy} />
      </header>
      <div className="jr-plate-body">
        <ModeDial modes={modes} stop={stop} onStop={setStop} onApply={apply} lastMode={lastMode} armed={armedText} />
        <div className="jr-plate-right">
          <ModeKeys modes={modes} lastMode={lastMode} onScene={onScene} className="jr-modes-wide" />
          <div className="jr-keys" role="group" aria-label="Channels">
            {slots.map((s) => (
              <GuardKey key={s.slot} heavy={!!(s.id && heavy[s.id])} summary={heavySummary(s.name)} state={guardState(s)} slot={s.slot} name={slotName(s)} kind={s.kind}
                on={s.capOn} lamp={s.lamp} word={s.word} absent={!s.present} coverMs={coverMs}
                preview={s.id && s.id in preview ? preview[s.id] : null}
                onPress={() => s.id && onPress(s.id, !s.capOn)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------------ the board plate */

export interface BoardPlateProps {
  view: LimbsView | null
  slots: KeySlot[]
  onAllOff: () => void
  /** Below 900 px the dial is gone: the modes ride in the sticky bar beside All off, one row. */
  modes?: Mode[]
  lastMode?: string | null
  onScene?: (modeId: string) => boolean
  armedText?: string | null
}

export function BoardPlate({ view, slots, onAllOff, modes = [], lastMode = null, onScene, armedText = null }: BoardPlateProps) {
  const esp = view?.esp32 ?? null
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const on = onCount(slots)
  const names = onNames(slots)
  const virtual = !!view && !view.usb
  const link: { lamp: 'live' | 'waiting' | 'simulated' | 'fault'; word: string } = !view
    ? { lamp: 'waiting', word: 'no report yet' }
    : virtual ? { lamp: 'simulated', word: 'virtual room, no board' }
      : esp ? (esp.connected ? { lamp: 'live', word: `board linked${esp.link ? `, ${esp.link === 'wifi' ? 'Wi-Fi' : 'USB'}` : ''}` } : { lamp: 'waiting', word: 'board offline' })
        : view.usb ? { lamp: 'live', word: `relay board${view.links?.length ? `, ${view.links.map((l) => (l === 'wifi' ? 'Wi-Fi' : 'USB')).join(' and ')}` : ''}` } : { lamp: 'waiting', word: 'board offline' }
  const wall = isWallBox(view)
  const rows = view && wall ? channelRows(view.devices) : []
  const problems: string[] = []
  if (esp && !esp.connected && esp.text) problems.push(esp.text)
  if (esp?.missing_channels.length) problems.push(`not on the board: ${esp.missing_channels.join(', ')}`)
  for (const m of esp?.pin_mismatch ?? []) problems.push(`${m.device} is GPIO ${m.board} on the board, ${m.devices_json} in the settings`)
  for (const p of view?.problems ?? []) problems.push(p)
  const reporting = slots.filter((s) => s.present && s.reported !== null).length
  const present = slots.filter((s) => s.present).length
  return (
    <section className="jr-board" aria-label="Relay board">
      <header className="jr-plate-head">
        <span className="jr-head-l"><span className="jr-mark" aria-hidden="true"><Sigil seed="jarvis.room.board" size={24} fold={6} /></span><Plate serial="[ROM] ESP32" state={link.lamp}>BOARD</Plate></span>
      </header>
      <dl className="jr-board-list">
        <div><dt>LINK</dt><dd><LampGlyph state={link.lamp} size={12} /> {link.word}</dd></div>
        <div><dt>FIRMWARE</dt><dd>{esp?.fw ?? 'not reported'}</dd></div>
        <div><dt>SIGNAL</dt><dd>{esp?.rssi != null ? `${esp.rssi} dBm` : 'not reported'}</dd></div>
        <div><dt>REPORTING</dt><dd>{present ? `${reporting} of ${present} channels` : 'no channels'}</dd></div>
      </dl>
      {wall && rows.length > 0 && (
        <pre className="jr-lcd" aria-label="What the box's 16 by 2 display shows">{lcdRow1(rows)}{'\n'}{lcdRow2(esp)}</pre>
      )}
      {problems.length > 0 && (
        <ul className="jr-board-problems" aria-label="Board problems">
          {problems.slice(0, 1).map((p) => <li key={p}><LampGlyph state="fault" size={12} /> <span><b>FAULT</b> {p}</span></li>)}
          {problems.length > 1 && <li className="jr-note">and {problems.length - 1} more in Console, Hardware</li>}
        </ul>
      )}
      <div className="jr-alloff" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); anchor.current?.focus() } }}
        onBlur={(e) => { if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
        {onScene && (
          <div className="jr-modebar">
            {armedText && <p className="jr-armed" role="status"><LampGlyph state="waiting" size={12} /> {armedText}. Press the mode again within 5 s.</p>}
            <ModeKeys modes={modes} lastMode={lastMode} onScene={onScene} max={4} />
          </div>
        )}
        <button ref={anchor} type="button" className="jr-alloff-key k-key" aria-haspopup="dialog" aria-expanded={open} data-empty={on === 0 ? 'true' : undefined}
          aria-label={`All off, ${on} on. Opens the list of channels it will switch off`} onClick={() => setOpen((o) => !o)}>
          <Power size={18} aria-hidden="true" />
          <span className="jr-alloff-word">All off</span>
          <span className="jr-alloff-count">{on} on</span>
        </button>
        {open && (
          <div className="jr-pop" role="dialog" aria-label="All off: channels that will switch off">
            <p className="jr-pop-head">{on ? `Switches off ${on} channel${on === 1 ? '' : 's'}:` : "Nothing is on by the board's report."}</p>
            <ul className="jr-pop-list">{names.map((nm) => <li key={nm}>{nm}</li>)}</ul>
            <Key label="Switch them off" caption icon={<Power size={16} aria-hidden="true" />} disabledReason={on ? undefined : 'nothing reported on'}
              onPress={() => { setOpen(false); onAllOff() }} className="jr-pop-go" />
          </div>
        )}
      </div>
    </section>
  )
}
