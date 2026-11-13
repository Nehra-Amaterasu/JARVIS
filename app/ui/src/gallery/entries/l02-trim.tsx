// L02, 13 Nov 2026: Trim, the one key that holds a setting beside the thing it tunes, and the settings index that the
// palette mode ":" lists. The settings here are inline fixtures (neutral words); none is in the product registry.
import { useState } from 'react'
import { SettingsIndex, Trim, type SettingDef } from '../../shared/trim'
import type { GalleryEntryX } from '../types'

const merged = 'L02, 13 Nov 2026'

/** A small live setting: a value in a closure, a def over it, and a control that writes it. */
function Demo({ risk, plain }: { risk?: SettingDef['risk']; plain?: boolean }) {
  const [v, setV] = useState(plain ? 65 : 40)
  const def: SettingDef = {
    id: risk ? 'console.relay-hold' : 'core.ring-density',
    label: risk ? 'Relay hold time' : 'Ring density',
    section: risk ? 'console' : 'core',
    view: risk ? 'hardware' : 'talk',
    read: () => v,
    reset: () => setV(40),
    format: (x) => (risk ? `${String(x)} ms` : `${String(x)} segments`),
    defaultText: risk ? '40 ms' : '40 segments',
    isDefault: () => v === 40,
    risk,
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ font: '14px/1.4 var(--font-sans, system-ui)', color: 'var(--ink-1)' }}>{def.label}</span>
      <Trim settingId={def.id} def={def} label={def.label} readsBy={risk ? 'the relay driver holds a switch that long' : 'the Core ring draws that many segments'}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, font: '12px/1.4 var(--font-mono, monospace)', color: 'var(--ink-2)' }}>
          {risk ? 'Hold (ms)' : 'Segments'}
          <input type="range" min={10} max={100} step={5} value={v} onChange={(e) => setV(Number(e.target.value))} style={{ minHeight: 44 }} />
        </label>
      </Trim>
    </div>
  )
}

const INDEX_DEFS: SettingDef[] = [
  { id: 'core.ring-density', label: 'Ring density', section: 'core', view: 'talk', read: () => 40, reset: () => {}, format: (v) => `${String(v)} segments` },
  { id: 'core.chime', label: 'Wake chime', section: 'core', view: 'sound', read: () => true, reset: () => {} },
  { id: 'day.block-length', label: 'Block length', section: 'day', view: 'today', read: () => 10, reset: () => {}, format: (v) => `${String(v)} min` },
  { id: 'study.pace', label: 'Practice pace', section: 'study', view: 'practice', read: () => 'steady', reset: () => {} },
]

const entries: GalleryEntryX[] = [
  {
    id: 'kit/Trim',
    title: 'Trim',
    group: 'kit',
    merged,
    note: 'A 44 px key with a slider glyph. It opens a popover of at most 320 x 360: the control in a recessed well, the value now, the default, Reset and one line saying what reads it. Esc returns focus to the key. A hardware or brain setting asks twice before it resets.',
    states: [
      { label: 'at the default (press the key; Reset is inert)', node: <Demo /> },
      { label: 'value changed (press the key; Reset is live)', node: <Demo plain /> },
      { label: 'hardware setting (Reset asks twice)', node: <Demo risk="hardware" plain /> },
    ],
  },
  {
    id: 'kit/SettingsIndex',
    title: 'SettingsIndex',
    group: 'kit',
    merged,
    note: 'The list behind the palette mode ":". There is no settings page: choosing a row goes to the view where the setting\'s Trim sits.',
    states: [
      { label: 'four settings', node: <SettingsIndex defs={INDEX_DEFS} /> },
      { label: 'filtered', node: <SettingsIndex defs={INDEX_DEFS} initialQuery="ring" /> },
      { label: 'empty registry', node: <SettingsIndex defs={[]} /> },
    ],
  },
]

export default entries
