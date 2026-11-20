// Modes (A.J02, parity R02): create, edit and delete, MOVED from pages/Limbs.tsx `Modes` and `ModeEditor` with the same routes and
// bodies (PUT /api/limbs/modes/{id}, POST /api/limbs/modes/new, DELETE) and the same decisions (lib/limbs draftFrom, draftProblem,
// describeSet). Two things differ: the delete asks with a second press on the key itself instead of window.confirm, and the editor
// opens in place of the list. Applying a mode is not here: that is the dial and the chips on Switches.
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, post } from '../../lib/api'
import { describeSet, draftFrom, draftProblem, type LimbsDevice, type Mode } from '../../lib/limbs'
import { useStore } from '../../lib/store'
import { modeStrip } from './model'
import { Button, Chip, Field, IconButton } from '../../shared/kit'
import './room.css'

export interface ModesPanelProps {
  modes: Mode[]
  devices: LimbsDevice[]
  lastMode: string | null
  /** The eight channel ids of the faceplate (null: a free slot), for each mode's strip. */
  ids?: (string | null)[]
  reload: () => void
  /** Test hook: the requests. The defaults are the classic page's routes. */
  save?: (mode: Mode | null, name: string, set: Record<string, boolean>) => Promise<void>
  remove?: (mode: Mode) => Promise<void>
}

const defaultSave = async (mode: Mode | null, name: string, set: Record<string, boolean>) => {
  if (mode) await api(`/api/limbs/modes/${encodeURIComponent(mode.id)}`, { method: 'PUT', body: { name, set } })
  else await post('/api/limbs/modes/new', { name, set })
}
const defaultRemove = async (m: Mode) => { await api(`/api/limbs/modes/${encodeURIComponent(m.id)}`, { method: 'DELETE' }) }

export function ModesPanel({ modes, devices, lastMode, ids, reload, save = defaultSave, remove = defaultRemove }: ModesPanelProps) {
  const toast = useStore((s) => s.toast)
  const [editing, setEditing] = useState<Mode | 'new' | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const del = async (m: Mode) => {
    if (armed !== m.id) {
      setArmed(m.id)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setArmed(null), 5000)
      return
    }
    setArmed(null)
    try { await remove(m); toast(`Deleted ${m.name}`, 'info'); reload() } catch (e) { toast((e as Error).message, 'fault') }
  }

  return (
    <section className="jr-modes-panel" aria-label="Modes">
      <header className="jr-panel-head">
        <span className="jr-tag">[ROM] MODES</span>
        <span className="jr-note">On and off sets. Say "Jarvis, mode name".</span>
        <Button size="sm" grouped onClick={() => setEditing('new')}><Plus size={14} aria-hidden="true" /> New mode</Button>
      </header>
      {!editing && ids && modes.length > 0 && <p className="jr-note jr-legend"># on, . off, ? no report, - free</p>}
      {editing ? (
        <ModeEditor key={editing === 'new' ? 'new' : editing.id} mode={editing === 'new' ? null : editing} modes={modes} devices={devices} save={save}
          close={() => setEditing(null)} saved={(n) => { setEditing(null); toast(`Saved ${n}`, 'live'); reload() }} />
      ) : (
        <ul className="jr-mode-list" data-many={modes.length > 4 ? 'true' : undefined}>
          {modes.length === 0 && <li className="jr-note">No modes reported yet.</li>}
          {modes.map((m) => (
            <li key={m.id} className="jr-mode-row" data-last={lastMode === m.id ? 'true' : undefined}>
              <span className="jr-mode-name"><b>{m.name}</b><span className="jr-mode-detail">{m.detail}{lastMode === m.id ? ' · last chosen' : ''}</span></span>
              {ids && <span className="jr-mode-strip" aria-label="Channels this mode sets: on, off, not named, free">{modeStrip(m, ids)}</span>}
              <IconButton label={`Edit ${m.name}`} grouped onClick={() => setEditing(m)}><Pencil size={14} aria-hidden="true" /></IconButton>
              <IconButton label={armed === m.id ? `Press again to delete ${m.name}` : `Delete ${m.name}`} grouped className="jr-del" data-armed={armed === m.id ? 'true' : undefined}
                onBlur={() => setArmed((a) => (a === m.id ? null : a))} onClick={() => void del(m)}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {armed && <p className="jr-note" role="status">Press the bin again to delete {modes.find((m) => m.id === armed)?.name}.</p>}
    </section>
  )
}

function ModeEditor({ mode, modes, devices, save, close, saved }: {
  mode: Mode | null; modes: Mode[]; devices: LimbsDevice[]
  save: (mode: Mode | null, name: string, set: Record<string, boolean>) => Promise<void>
  close: () => void; saved: (name: string) => void
}) {
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(mode?.name ?? '')
  const [set, setSet] = useState<Record<string, boolean>>(() => draftFrom(mode, devices))
  const problem = draftProblem(name, set, modes.filter((m) => m.id !== mode?.id))
  const go = async () => {
    try { await save(mode, name, set); saved(name.trim()) } catch (e) { toast((e as Error).message, 'fault') }
  }
  return (
    <div className="jr-editor">
      <div className="jr-editor-head">
        <b>{mode ? `Edit ${mode.name}` : 'New mode'}</b>
        <IconButton label="Close the editor" grouped onClick={close}><X size={14} aria-hidden="true" /></IconButton>
      </div>
      <Field label="Name (what you say)" value={name} maxLength={32} placeholder="Reading" onChange={(e) => setName(e.target.value)} />
      <div className="jr-editor-devices" role="group" aria-label="Channels in this mode">
        {devices.map((d) => (
          <Chip key={d.id} grouped selected={!!set[d.id]} onClick={() => setSet((s) => ({ ...s, [d.id]: !s[d.id] }))}>{d.name}: {set[d.id] ? 'on' : 'off'}</Chip>
        ))}
      </div>
      <p className="jr-note">{describeSet(set, devices)}</p>
      {problem && name && <p className="jr-note" role="status">{problem}</p>}
      <div><Button tone="primary" grouped disabledReason={problem ?? undefined} onClick={() => void go()}>Save</Button></div>
    </div>
  )
}
