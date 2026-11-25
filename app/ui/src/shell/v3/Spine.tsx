/**
 * The spine (design-language-v3.md 3.2), slimmed on 25 Nov: 168 px on the left (it was 208), folding to a 64 px icon rail. The
 * owner called the nav "too fat": the four two-line plates with a state word each were 56 px tall and the word repeated a table
 * the lamp pill already holds. Now every row is ONE line of 44 px: a project row is icon, name and a small state lamp (the word
 * is the lamp's title and the row's accessible name, and is printed as text only under the open project); the open project's
 * sections sit under it, indented, one line each. 44 + 3 x 44 for JARVIS (or 44 + 5 x 44 for Well Wisher) plus the three other
 * rows leave the whole spine under 460 px at 768 px of window height, so it does not scroll on the desktop.
 *
 * The four relate (owner's model): JARVIS is the voice and the room, AANKHEN is sensing, YADAASH is memory and the agents that
 * work on it, WELL WISHER is his day. The order shows it and one small gap separates the groups (no boxes). The open project's
 * mark and its active row's dot take that project's hue; the others carry their own hue at lower strength.
 *
 * One lit pill (`.s3-ind`) slides between the active rows instead of each row lighting itself, so a move reads as a move.
 *
 * On the phone the spine is a sheet, and TabBar (below) holds the open project's sections with a first key, "Projects".
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clock } from '../../lib/format'
import { sectionById, type Place } from '../ids'
import { hintFor, slotBindingOf } from '../keymap'
import { BrandMark, FoldGlyph, ProjectMark, SectionIcon, StateGlyph } from './Glyphs'
import { projectState, type LampRow } from './lamps'
import { availableSubProjects, subProjectOfSection, type SpineExtra, type SubProject } from './subprojects'
import type { LampState } from '../../shared/lamp/types'

export interface TileModel {
  project: SubProject
  open: boolean
  /** One section and no planned row: the row is a link, there is no slot. */
  single: boolean
  current: boolean
  state: LampState
  /** The state word alone ("WAITING"): the lamp's title and, under the open project, a line of text. */
  word: string
  /** Word and reason ("WAITING · no sensor"): the row's title and accessible name. */
  stateText: string
  /** True on the first project of a new group: the spine leaves a small gap above it. */
  gapBefore: boolean
  sections: { id: string; label: string; current: boolean; hint?: string }[]
  extras: readonly SpineExtra[]
}

/** The spine's model, pure: every section reachable, the open project, the state lines. Tested without a DOM. */
export function spineModel(place: Place, rows: readonly LampRow[], projects: readonly SubProject[] = availableSubProjects()): TileModel[] {
  const open = subProjectOfSection(place.section)?.id
  return projects.map((project, i) => {
    const st = projectState(project.id, rows)
    const extras = project.extras ?? []
    const single = project.sections.length === 1 && extras.length === 0
    return {
      project,
      open: project.id === open,
      single,
      current: project.id === open && single,
      state: st.state,
      word: st.word,
      stateText: st.text,
      gapBefore: i > 0 && projects[i - 1].group !== project.group,
      extras,
      sections: project.sections.map((id) => {
        const hintId = slotBindingOf(project.product, id)
        const hint = hintId ? hintFor(hintId) : undefined
        return { id, label: sectionById(id)?.label ?? id, current: id === place.section, hint }
      }),
    }
  })
}

export interface SpineProps {
  place: Place
  rows: readonly LampRow[]
  now: number
  onGoSection: (section: string) => void
  /** A planned row (Agents) was pressed: open its pose. */
  onPlanned?: (plannedId: string) => void
  /** Folded to the 64 px icon rail (desktop only; the phone's sheet ignores it). */
  folded?: boolean
  onFold?: (folded: boolean) => void
  /** Phone: a choice closes the sheet. */
  onChoose?: () => void
}

/** Up and Down walk the buttons of the spine (3.5); Alt with the arrows is the global section step and is left alone. */
function walk(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.altKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLElement>('button')]
  const i = buttons.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus()
}

/** The lit pill's place: where the active row is inside the nav, measured, so it slides rather than jumps. */
interface Ind {
  x: number
  y: number
  w: number
  h: number
  show: boolean
}

export function Spine({ place, rows, now, onGoSection, onPlanned, folded = false, onFold, onChoose }: SpineProps) {
  const tiles = spineModel(place, rows)
  const nav = useRef<HTMLElement>(null)
  const [ind, setInd] = useState<Ind>({ x: 0, y: 0, w: 0, h: 0, show: false })
  const [ready, setReady] = useState(false)
  const go = (id: string) => {
    onGoSection(id)
    onChoose?.()
  }
  // measure the active row after every layout change: a place change, a fold, a project opening its rows, a resize
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    const measure = () => {
      const cur = el.querySelector<HTMLElement>('[aria-current="page"]')
      // x and width too: a section row is indented under its project, and the pill must sit exactly under the row it lights
      // measured against the nav itself, not offsetTop: each group is positioned, so offsetTop would be relative to its group
      const r = cur?.getBoundingClientRect()
      const n = el.getBoundingClientRect()
      const next: Ind = r && r.height > 0
        ? { x: Math.round(r.left - n.left + el.scrollLeft), y: Math.round(r.top - n.top + el.scrollTop), w: Math.round(r.width), h: Math.round(r.height), show: true }
        : { x: 0, y: 0, w: 0, h: 0, show: false }
      setInd((o) => (o.x === next.x && o.y === next.y && o.w === next.w && o.h === next.h && o.show === next.show ? o : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [place.section, folded])
  // the first measurement must not animate from the top: transitions are switched on one frame later
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <aside className="s3-spine" id="s3-spine" data-folded={folded ? '1' : '0'} aria-label="Projects and their sections">
      <div className="s3-brand">
        <BrandMark />
        <b>THE SYSTEM</b>
        <time dateTime={new Date(now).toISOString()}>{clock(now / 1000).slice(0, 5)}</time>
      </div>
      <nav className="s3-nav" ref={nav} aria-label="Sections" onKeyDown={walk}>
        <span className="s3-ind" aria-hidden="true" data-ready={ready ? '1' : '0'}
          style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h, opacity: ind.show ? 1 : 0 }} />
        {tiles.map((t) => {
          const head = (
            <>
              <span className="s3-pi" aria-hidden="true"><ProjectMark id={t.project.id} /></span>
              <span className="s3-pn">{t.project.name}</span>
              <span className="s3-lamp" data-state={t.state} title={t.stateText}><StateGlyph state={t.state} size={11} /></span>
            </>
          )
          return (
            <div key={t.project.id} className="s3-grp" data-p={t.project.id} data-open={t.open} data-single={t.single ? '1' : '0'} data-gap={t.gapBefore ? '1' : '0'}>
              {t.open && !t.single ? (
                <div className="s3-head">{head}</div>
              ) : (
                <button type="button" className="s3-head" data-project={t.project.id} aria-current={t.current ? 'page' : undefined}
                  aria-label={`${t.project.name}, ${t.stateText}`} title={folded ? `${t.project.name}, ${t.stateText}` : t.stateText} onClick={() => go(t.project.sections[0])}>{head}</button>
              )}
              {t.open && !t.single && (
                <>
                  <p className="s3-pw" data-state={t.state} title={t.stateText}><StateGlyph state={t.state} size={11} /><small>{t.word}</small></p>
                  <ul className="s3-slot">
                    {t.sections.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="s3-item" data-section={s.id} aria-current={s.current ? 'page' : undefined}
                          aria-keyshortcuts={s.hint?.replace(' ', '+')} aria-label={s.label} title={s.hint ? `${s.label} (${s.hint})` : s.label} onClick={() => go(s.id)}>
                          <SectionIcon id={s.id} />
                          <span>{s.label}</span>
                          <i aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                    {t.extras.map((x) => (
                      <li key={x.id}>
                        <button type="button" className="s3-item s3-extra" data-extra={x.id} data-state="planned" aria-haspopup="dialog"
                          aria-label={`${x.label}, planned. ${x.sentence}`} title={`${x.label}: ${x.sentence}`}
                          onClick={() => {
                            onPlanned?.(x.plannedId)
                            onChoose?.()
                          }}>
                          <SectionIcon id={x.id} />
                          <span>{x.label}</span>
                          <b className="s3-extralamp" aria-hidden="true"><StateGlyph state="planned" size={11} /></b>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )
        })}
      </nav>
      <button type="button" className="s3-key s3-fold" aria-pressed={folded} aria-label={folded ? 'Unfold the sidebar' : 'Fold the sidebar to icons'}
        title={folded ? 'Unfold the sidebar' : 'Fold the sidebar to icons'} onClick={() => onFold?.(!folded)}>
        <FoldGlyph folded={folded} />
        <span>Fold</span>
      </button>
    </aside>
  )
}

/** The phone's bottom bar: "Projects" first (it opens the spine sheet), then the open project's sections, 52 px keys. */
export function TabBar({ place, deckOpen, onDeck, onGoSection }: { place: Place; deckOpen: boolean; onDeck: (open: boolean) => void; onGoSection: (s: string) => void }) {
  const project = subProjectOfSection(place.section)
  const ids = project?.sections ?? []
  return (
    <nav className="s3-tabbar" aria-label="Sections of the open project">
      <button type="button" className="s3-tab" aria-haspopup="true" aria-expanded={deckOpen} aria-controls="s3-spine" onClick={() => onDeck(!deckOpen)}>
        {project ? <ProjectMark id={project.id} size={20} /> : <BrandMark size={20} />}
        <span>Projects</span>
      </button>
      {ids.map((id) => (
        <button key={id} type="button" className="s3-tab" data-section={id} aria-current={id === place.section ? 'page' : undefined} onClick={() => onGoSection(id)}>
          <SectionIcon id={id} size={20} />
          <span>{sectionById(id)?.label ?? id}</span>
        </button>
      ))}
    </nav>
  )
}
