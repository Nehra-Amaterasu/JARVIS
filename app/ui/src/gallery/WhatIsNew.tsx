// "What is new": the place the owner opens to see every merged component in its states, in both clay themes and under each
// section theme. A left index (grouped, roving focus, filter by group) and a specimen pane; both scroll inside themselves,
// so the document never scrolls in the 1302 x 720 canvas. Nothing here is a measurement: every number on the page comes
// from a fixture and carries its lamp. No timer, no animation, no rAF: it renders on a press and then is still.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './gallery.css'
import { SECTIONS } from '../shell/ids'
import { collectEntriesX } from './collect'
import { Radios, type RadioOption } from './Radios'
import { Specimen } from './Specimen'
import { useLegacyStyles } from './legacy'
import { GROUPS, type GalleryEntryX } from './types'

type Theme = 'clay-light' | 'clay-dark'
const THEMES: RadioOption[] = [{ id: 'clay-light', label: 'Light' }, { id: 'clay-dark', label: 'Dark' }]
const SCALES: RadioOption[] = [{ id: '1', label: '1x' }, { id: '1.5', label: '1.5x' }, { id: '2', label: '2x' }]
const SECTION_OPTIONS = [{ id: '', label: 'No section theme' }, ...SECTIONS.map((s) => ({ id: s.id, label: s.label })), { id: 'proof', label: 'Proof' }]

/** The clay theme of the page: starts from whatever the shell set, and puts that back when the place closes. */
function useClayTheme(): [Theme, (t: Theme) => void] {
  const root = typeof document === 'undefined' ? null : document.documentElement
  const initial = useRef<string | null>(root?.getAttribute('data-theme') ?? null)
  const [theme, setTheme] = useState<Theme>(() => (initial.current === 'clay-dark' ? 'clay-dark' : 'clay-light'))
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current || !root) return
    root.setAttribute('data-theme', theme)
  }, [theme, root])
  useEffect(() => () => {
    if (!root || !touched.current) return
    if (initial.current === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', initial.current)
  }, [root])
  return [theme, (t) => { touched.current = true; setTheme(t) }]
}

export default function WhatIsNew() {
  const all = useMemo<GalleryEntryX[]>(() => collectEntriesX(), [])
  const [group, setGroup] = useState<string>('all')
  const [activeId, setActiveId] = useState<string>(() => all[0]?.id ?? '')
  const [solo, setSolo] = useState<number | null>(null)
  const [section, setSection] = useState('')
  const [scale, setScale] = useState('1.5')
  const [theme, setTheme] = useClayTheme()
  const listRef = useRef<HTMLUListElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length }
    for (const e of all) c[e.group] = (c[e.group] ?? 0) + 1
    return c
  }, [all])
  const groupOptions = useMemo<RadioOption[]>(
    () => [{ id: 'all', label: 'All', count: counts.all }, ...GROUPS.filter((g) => counts[g.id]).map((g) => ({ id: g.id, label: g.label, count: counts[g.id], title: g.hint }))],
    [counts],
  )
  const shown = useMemo(() => (group === 'all' ? all : all.filter((e) => e.group === group)), [all, group])
  const active = shown.find((e) => e.id === activeId) ?? shown[0] ?? null

  // an entry the filter hides is replaced by the first one it shows; the state switch starts over for a new entry
  useEffect(() => { if (active && active.id !== activeId) setActiveId(active.id) }, [active, activeId])
  useEffect(() => { setSolo(null); paneRef.current?.scrollTo?.({ top: 0 }) }, [active?.id])

  const focusItem = useCallback((id: string) => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-entry-id="${CSS.escape(id)}"]`)
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  const onListKey = (e: KeyboardEvent) => {
    if (!shown.length) return
    const i = Math.max(0, shown.findIndex((x) => x.id === active?.id))
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : e.key === 'PageDown' ? i + 8 : e.key === 'PageUp' ? i - 8 : null
    if (to === null) return
    e.preventDefault()
    const next = shown[Math.min(shown.length - 1, Math.max(0, to))]
    setActiveId(next.id)
    focusItem(next.id)
  }
  // the pane pages by keys when it has focus (Space and PageDown are native on a scroll region; Home and End are not)
  const onPaneKey = (e: KeyboardEvent) => {
    const el = paneRef.current
    if (!el || e.target !== el) return
    if (e.key === 'Home') { e.preventDefault(); el.scrollTo({ top: 0 }) }
    else if (e.key === 'End') { e.preventDefault(); el.scrollTo({ top: el.scrollHeight }) }
  }

  const stateOptions = useMemo<RadioOption[]>(
    () => (active && active.states.length > 1 ? [{ id: 'all', label: 'All states' }, ...active.states.map((s, i) => ({ id: String(i), label: s.label, title: s.label }))] : []),
    [active],
  )
  const legacy = useLegacyStyles(!!active?.legacy)
  const groupLabel = GROUPS.find((g) => g.id === active?.group)?.label

  return (
    <section className="gl" aria-label="What is new" data-gallery="">
      <aside className="gl-side">
        <header className="gl-side-head">
          <h2 className="gl-title">What is new</h2>
          <p className="gl-sub"><span className="gl-count">{all.length}</span> specimens from the merged code, each in its states.</p>
        </header>
        <Radios label="Filter by group" value={group} options={groupOptions} onChange={setGroup} className="gl-filter" />
        <nav className="gl-index" aria-label="Specimens">
          <ul ref={listRef} className="gl-list" onKeyDown={onListKey}>
            {shown.map((e) => {
              const on = e.id === active?.id
              return (
                <li key={e.id}>
                  <button type="button" className="gl-item" data-entry-id={e.id} aria-current={on ? 'true' : undefined} tabIndex={on ? 0 : -1} onClick={() => setActiveId(e.id)}>
                    <span className="gl-item-title">{e.title}</span>
                    <span className="gl-item-meta">{GROUPS.find((g) => g.id === e.group)?.label}, {e.states.length} {e.states.length === 1 ? 'state' : 'states'}</span>
                  </button>
                </li>
              )
            })}
            {!shown.length && <li className="gl-none">Nothing in this group yet.</li>}
          </ul>
        </nav>
      </aside>

      <div className="gl-main">
        <div className="gl-bar" role="group" aria-label="How to draw the specimen">
          <div className="gl-bar-crumb">
            <span className="gl-kicker">{groupLabel ?? ''}</span>
            <span className="gl-bar-name">{active?.title ?? 'Nothing selected'}</span>
          </div>
          <div className="gl-bar-ctl">
            <Radios label="Clay theme" value={theme} options={THEMES} onChange={(t) => setTheme(t as Theme)} />
            <Radios label="Scale" value={scale} options={SCALES} onChange={setScale} />
            <label className="gl-select">
              <span className="gl-select-label">Section</span>
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                {SECTION_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            {stateOptions.length > 0 && <Radios label="State" value={solo === null ? 'all' : String(solo)} options={stateOptions} onChange={(id) => setSolo(id === 'all' ? null : Number(id))} className="gl-states-switch" />}
          </div>
        </div>
        <div ref={paneRef} className="gl-pane" tabIndex={0} role="region" aria-label="Specimen" onKeyDown={onPaneKey} data-section={section || undefined}>
          {active ? <Specimen key={active.id} entry={active} only={solo} scale={Number(scale)} legacy={legacy} /> : <p className="gl-none">Nothing to show.</p>}
        </div>
      </div>
    </section>
  )
}
