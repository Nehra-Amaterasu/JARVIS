// PipelineRibbon (spec 20.9.1): four 44 px nodes, HEAR, WRITE, THINK, SAY, joined by 2 px tracks. Each node shows its lamp,
// its word and its measured seconds ("THINK 3.2 s"); the track into a node fills left to right while that stage runs, as
// elapsed over the stage's own median, and only when a median exists. With no median the track is dashed: the ribbon
// never guesses how far along a stage is. Hollow states print no number (shared/lamp showsNumber).
//
// One tab stop: Left and Right (and Home, End) move between the nodes. The fill is a 160 ms step; reduced motion and
// forced colours drop the transition (core.css). No timer lives here: the caller re-renders it once a second while a
// stage runs, and not at all otherwise.
import { useRef, type KeyboardEvent } from 'react'
import { LAMP_SPECS, LampGlyph, showsNumber, type LampState } from '../../shared/lamp'
import { STAGE_MEANS, nodeText, ribbonFill, type RibbonStage, type StageId } from './model'
import './core.css'

export interface PipelineStage {
  id: StageId
  state: LampState
  sec?: number
  median?: number
  /** Optional (beyond the contract): this is the stage running now, so its track may fill. */
  running?: boolean
  /** Optional: why the node is hollow, or what its number is ("last turn"). */
  reason?: string
}

export interface PipelineRibbonProps {
  stages: PipelineStage[]
  /** Optional: the vertical four-row list of the phone Talk tab. */
  orientation?: 'row' | 'column'
}

function nodeName(s: RibbonStage): string {
  const t = nodeText(s)
  const spec = LAMP_SPECS[s.state].label
  const num = showsNumber(s.state) && s.sec !== undefined ? `, ${t.value}` : ''
  const med = s.median ? `, median ${s.median.toFixed(1)} s` : ', no median yet'
  return `${t.word}, ${spec}${num}${s.reason ? `, ${s.reason}` : ''}${med}. Measures ${STAGE_MEANS[s.id]}`
}

export function PipelineRibbon({ stages, orientation = 'row' }: PipelineRibbonProps) {
  const list = useRef<HTMLOListElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLOListElement>) => {
    const keys = orientation === 'row' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']
    if (![...keys, 'Home', 'End'].includes(e.key)) return
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-rib-node]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    const n = items.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === keys[0] ? Math.min(n - 1, i + 1) : Math.max(0, i - 1)
    items.forEach((el, j) => el.setAttribute('tabindex', j === next ? '0' : '-1'))
    items[next].focus()
  }
  const allOff = stages.every((s) => s.state === 'waiting' && s.reason === 'core off')
  return (
    <ol ref={list} className="jc-ribbon" data-orientation={orientation} data-off={allOff ? 'true' : undefined} aria-label="Pipeline of the last spoken turn: hear, write, think, say" onKeyDown={onKeyDown}>
      {stages.map((s, i) => {
        const fill = ribbonFill(s)
        const t = nodeText(s)
        return (
          <li key={s.id} className="jc-rib-step" data-stage={s.id} data-state={s.state} data-running={s.running ? 'true' : undefined}>
            <span className="jc-rib-track" aria-hidden="true" data-track={fill === null ? 'dashed' : 'fill'}>
              {fill !== null && <span className="jc-rib-fill" style={{ ['--f' as string]: fill.toFixed(3) }} />}
            </span>
            <span
              className="jc-rib-node" data-rib-node="" tabIndex={i === 0 ? 0 : -1} role="img" aria-label={nodeName(s)} title={nodeName(s)}
              style={{ ['--lamp-ink' as string]: `var(${LAMP_SPECS[s.state].token})` }}
            >
              <LampGlyph state={s.state} className="jc-rib-lamp" />
              <b className="jc-rib-word">{t.word}</b>
              <span className="jc-rib-val">{t.value}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
