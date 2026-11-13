// The specimen plate: one gallery entry at a deliberate size. Its name and id on top, the one-line note under them, then the
// states side by side, each on its own small plate with its label, and the "merged in" line at the foot. The same states are
// drawn by the bench page (gallery/bench.tsx) with different markup, so this file never carries a bench attribute.
import { useId } from 'react'
import type { LegacyStyles } from './legacy'
import { GROUPS, type GalleryEntryX } from './types'

export function Specimen({ entry, only, scale = 1, legacy = 'ready' }: { entry: GalleryEntryX; only: number | null; scale?: number; legacy?: LegacyStyles }) {
  const hid = useId()
  const group = GROUPS.find((g) => g.id === entry.group)
  const shown = entry.states.map((s, i) => ({ s, i })).filter(({ i }) => only === null || i === only)
  const body = (
    <div className="gl-states" style={scale === 1 ? undefined : { zoom: scale }}>
      {shown.map(({ s, i }) => (
        <figure className="gl-state" key={i} data-state-index={i}>
          <figcaption className="gl-state-cap">{s.label}</figcaption>
          <div className="gl-state-body">{s.node}</div>
        </figure>
      ))}
    </div>
  )
  return (
    <article className="gl-specimen" aria-labelledby={hid} data-entry={entry.id} data-group={entry.group}>
      <header className="gl-specimen-head">
        <p className="gl-kicker">{group?.label ?? entry.group}</p>
        <h3 className="gl-specimen-title" id={hid}>{entry.title}</h3>
        <code className="gl-specimen-id">{entry.id}</code>
      </header>
      {entry.note && <p className="gl-specimen-note">{entry.note}</p>}
      {entry.legacy && legacy === 'missing' && <p className="gl-specimen-warn" role="note">The Well Wisher stylesheet is not loaded in this build, so these controls are drawn without their own styling. The bench page and the Well Wisher frame draw them fully.</p>}
      {entry.legacy ? <div className="ww gl-legacy" data-section="wellwisher" data-density="regular">{body}</div> : body}
      {entry.merged && <p className="gl-specimen-merged"><span>Merged in</span> {entry.merged}</p>}
    </article>
  )
}
