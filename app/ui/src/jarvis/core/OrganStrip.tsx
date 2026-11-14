// OrganStrip (spec 20.9.1): five chips, BRAIN, VOICE, ROOM, SENSE, MEM, each a lamp plus one word (LIVE "ok", WAITING
// "not tested", FAULT "down"). The chips are 136 px wide and 44 px tall (the spec's 32 px chip grew to the 44 px target
// rule). One tab stop, Left and Right move, Enter opens the Anatomy drawer on that organ.
import { useRef, type KeyboardEvent } from 'react'
import { LAMP_SPECS, LampGlyph, lampName } from '../../shared/lamp'
import { ORGAN_WORD, type Organ, type OrganId } from './model'
import './core.css'

export interface OrganStripProps {
  organs: Organ[]
  onOpen: (id: OrganId) => void
  /** The phone form: five lamps in a row, the name under each, no word. */
  compact?: boolean
}

export function OrganStrip({ organs, onOpen, compact = false }: OrganStripProps) {
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-organ]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const n = items.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n
    items.forEach((el, j) => el.setAttribute('tabindex', j === next ? '0' : '-1'))
    items[next].focus()
  }
  return (
    <div ref={list} className="jc-organs" data-compact={compact ? 'true' : undefined} role="toolbar" aria-label="Organs: press Enter for the Anatomy drawer" onKeyDown={onKeyDown}>
      {organs.map((o, i) => {
        const spec = LAMP_SPECS[o.reading.state]
        const name = `${o.name}: ${lampName(o.reading)}. Source ${o.source}. Opens Anatomy`
        return (
          <button
            key={o.id} type="button" className="jc-organ" data-organ={o.id} data-state={o.reading.state} tabIndex={i === 0 ? 0 : -1}
            aria-label={name} title={name} onClick={() => onOpen(o.id)}
            style={{ ['--lamp-ink' as string]: `var(${spec.token})` }}
          >
            <LampGlyph state={o.reading.state} className="jc-organ-lamp" />
            <b className="jc-organ-name">{o.name}</b>
            {!compact && <span className="jc-organ-word">{ORGAN_WORD[o.reading.state]}</span>}
          </button>
        )
      })}
    </div>
  )
}
