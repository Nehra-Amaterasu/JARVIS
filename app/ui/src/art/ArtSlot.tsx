// ArtSlot (A.G03): the one way a section shows a centrepiece by art id. The caller names an id, never a file
// or a catalogue id. On the private track (VITE_ART_TRACK=private) a staged file is drawn; on the default
// track an id with a customer file draws that file, and an id with none draws a plain plate that says so
// ("private track off"), so a missing picture is never passed off as the art (resolve.ts, 8.2).
//
// The picture box is aria-hidden: art carries no data (20.4.1: a sigil never replaces a lamp). A caption, when
// given, sits outside the box as real text. Static by default: no timer, no loop, no layout read; the only
// motion is a one-shot 160 ms opacity step in ArtSlot.css that reduced motion removes.
//
// `treatment` picks a sibling file when the pipeline built one: `art.day.sun` with treatment 'bayer' tries
// `art.day.sun.bayer` first and falls back to the plain id, so a treatment is a manifest addition, not code.
import { useEffect, useState, type CSSProperties } from 'react'
import { ART_TRACK, artEntry, artText, artUrl } from './index'
import './ArtSlot.css'

export type ArtTreatment = 'duotone' | 'bayer' | 'atkinson' | 'contour'
export type ArtSlotState = 'loading' | 'private' | 'customer' | 'absent'

export interface ArtSlotProps {
  id: string
  fit?: 'cover' | 'contain'
  treatment?: ArtTreatment
  /** Width over height of the box, for example 2 for a 2:1 band. Without it the picture sets its own height. */
  ratio?: number
  caption?: string
}

export interface ArtLoaded {
  state: ArtSlotState
  kind: 'image' | 'text' | null
  url: string | null
  text: string | null
  resolvedId: string
}

const NONE: ArtLoaded = { state: 'loading', kind: null, url: null, text: null, resolvedId: '' }

async function load(id: string, treatment?: ArtTreatment): Promise<ArtLoaded> {
  const candidates = treatment ? [`${id}.${treatment}`, id] : [id]
  for (const cand of candidates) {
    const url = await artUrl(cand)
    const text = url ? null : await artText(cand)
    const source = artEntry(cand)?.source // read after the awaits: the private sources are ready by then
    const state: ArtSlotState = source === 'private' ? 'private' : 'customer'
    if (url) return { state, kind: 'image', url, text: null, resolvedId: cand }
    if (text !== null) return { state, kind: 'text', url: null, text, resolvedId: cand }
  }
  return { state: 'absent', kind: null, url: null, text: null, resolvedId: id }
}

/** The loader as a hook: one fetch per (id, treatment); a failed chunk resolves to 'absent', never throws. */
export function useArt(id: string, treatment?: ArtTreatment): ArtLoaded {
  const [got, setGot] = useState<{ key: string; art: ArtLoaded }>({ key: '', art: NONE })
  const key = `${id}|${treatment ?? ''}`
  useEffect(() => {
    let live = true
    load(id, treatment).then(
      (art) => { if (live) setGot({ key, art }) },
      () => { if (live) setGot({ key, art: { ...NONE, state: 'absent', resolvedId: id } }) },
    )
    return () => { live = false }
  }, [id, treatment, key])
  return got.key === key ? got.art : NONE
}

export interface ArtSlotViewProps extends ArtSlotProps {
  art: ArtLoaded
  track?: 'customer' | 'private'
  fileKind?: string
}

/** The pure drawing of a loaded (or absent) art id: what tests and the gallery render directly. */
export function ArtSlotView({ id, fit = 'cover', treatment, ratio, caption, art, track = ART_TRACK, fileKind }: ArtSlotViewProps) {
  const ok = typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0
  const style = ok ? ({ ['--art-ratio' as string]: String(ratio) } as CSSProperties) : undefined
  const why = track === 'private' ? 'private file not built' : 'private track off'
  return (
    <figure
      className="art-slot"
      data-component="art-slot"
      data-art-id={id}
      data-state={art.state}
      data-fit={fit}
      data-kind={fileKind}
      data-treatment={treatment}
      data-ratio={ok ? 'set' : 'none'}
      data-grammar="art"
      style={style}
    >
      <div className="art-slot__box" aria-hidden="true">
        {art.kind === 'image' && art.url ? (
          <img className="art-slot__img" src={art.url} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : art.kind === 'text' && art.text !== null ? (
          <pre className="art-slot__pre">{art.text}</pre>
        ) : (
          <div className="art-slot__ph" data-placeholder={art.state === 'loading' ? 'loading' : 'absent'}>
            <span className="art-slot__ph-id">{id}</span>
            <span className="art-slot__ph-why">{art.state === 'loading' ? 'loading' : why}</span>
          </div>
        )}
      </div>
      {caption ? <figcaption className="art-slot__cap">{caption}</figcaption> : null}
    </figure>
  )
}

export function ArtSlot(p: ArtSlotProps) {
  const art = useArt(p.id, p.treatment)
  const fileKind = artEntry(art.resolvedId || p.id)?.file.split('.').pop()
  return <ArtSlotView {...p} art={art} fileKind={fileKind} />
}
