/**
 * The spine (design-language-v3.md 3.2): 208 px on the left, always visible on the desktop. It names the four sub-projects,
 * shows each one's state, and nests the sections of the open project. It replaces the product switch, the icon rail and the
 * "Back to" pill. Four tiles of one height; each has its own formed mark and a state line (the worst lamp of that project,
 * read from the same rows as the lamp pill). The open project is the same tile pressed into one recessed tray that also
 * holds its sections. A one-section project (Aankhen, Yadaash) has no slot: its tile is a link to its section.
 *
 * On the phone the spine is a sheet, and TabBar (below) holds the open project's sections with a first key, "Projects".
 */
import { type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clock } from '../../lib/format'
import { sectionById, type Place } from '../ids'
import { hintFor, slotBindingOf } from '../keymap'
import { BrandMark, ProjectMark, SectionIcon, StateGlyph } from './Glyphs'
import { projectState, type LampRow } from './lamps'
import { availableSubProjects, subProjectOfSection, type SubProject } from './subprojects'
import type { LampState } from '../../shared/lamp/types'

export interface TileModel {
  project: SubProject
  open: boolean
  /** One section: the tile is a link, there is no slot. */
  single: boolean
  current: boolean
  state: LampState
  /** The state word alone ("WAITING"): the tile's line, one line at 208 px. */
  word: string
  /** Word and reason ("WAITING · no sensor"): the tile's title and accessible name. */
  stateText: string
  sections: { id: string; label: string; current: boolean; hint?: string }[]
}

/** The spine's model, pure: every section reachable, the open project, the state lines. Tested without a DOM. */
export function spineModel(place: Place, rows: readonly LampRow[], projects: readonly SubProject[] = availableSubProjects()): TileModel[] {
  const open = subProjectOfSection(place.section)?.id
  return projects.map((project) => {
    const st = projectState(project.id, rows)
    const single = project.sections.length === 1
    return {
      project,
      open: project.id === open,
      single,
      current: project.id === open && single,
      state: st.state,
      word: st.word,
      stateText: st.text,
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

export function Spine({ place, rows, now, onGoSection, onChoose }: SpineProps) {
  const tiles = spineModel(place, rows)
  const go = (id: string) => {
    onGoSection(id)
    onChoose?.()
  }
  return (
    <aside className="s3-spine" id="s3-spine" aria-label="Projects and their sections">
      <div className="s3-brand">
        <BrandMark />
        <b>THE SYSTEM</b>
        <time dateTime={new Date(now).toISOString()}>{clock(now / 1000).slice(0, 5)}</time>
      </div>
      <nav className="s3-nav" aria-label="Sections" onKeyDown={walk}>
        {tiles.map((t) => {
          const head = (
            <>
              <span className="s3-disc" aria-hidden="true"><ProjectMark id={t.project.id} /></span>
              <span className="s3-hn">
                <b>{t.project.name}</b>
                <small data-state={t.state} title={t.stateText}><StateGlyph state={t.state} size={11} />{t.word}</small>
              </span>
            </>
          )
          return (
            <div key={t.project.id} className="s3-grp" data-p={t.project.id} data-open={t.open} data-single={t.single ? '1' : '0'}>
              {t.open && !t.single ? (
                <div className="s3-head">{head}</div>
              ) : (
                <button type="button" className="s3-head" data-project={t.project.id} aria-current={t.current ? 'page' : undefined}
                  aria-label={`${t.project.name}, ${t.stateText}`} onClick={() => go(t.project.sections[0])}>{head}</button>
              )}
              {t.open && !t.single && (
                <ul className="s3-slot">
                  {t.sections.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="s3-item" data-section={s.id} aria-current={s.current ? 'page' : undefined}
                        aria-keyshortcuts={s.hint?.replace(' ', '+')} title={s.hint ? `${s.label} (${s.hint})` : s.label} onClick={() => go(s.id)}>
                        <SectionIcon id={s.id} />
                        <span>{s.label}</span>
                        <i aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
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
          <SectionIcon id={id} />
          <span>{sectionById(id)?.label ?? id}</span>
        </button>
      ))}
    </nav>
  )
}
