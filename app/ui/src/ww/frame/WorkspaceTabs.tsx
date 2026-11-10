import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { cx } from '../kit/util'
import { useFrame } from './frameStore'
import { switchWorkspace } from './navigate'
import { useSceneDirty } from './workspaceMemory'
import { WORKSPACES, type WsDef, type WsId } from './workspaces'

const BADGE_KEY = 'ww.tabBadges'
/** Appearance > Tab badges (chunk 12 puts the switch on it). Default on; off hides every dot. */
export function tabBadgesOn(): boolean {
  try {
    return localStorage.getItem(BADGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** The dot is static and neutral (never the accent, never animated): it is a fact, not an alert. */
function TabDot({ ws, badges }: { ws: WsId; badges: boolean }) {
  const unsaved = useFrame((s) => !!s.dirty[ws])
  const scene = useSceneDirty(ws)
  if (!badges || (!unsaved && !scene)) return null
  return <i className="ww-tab-dot" data-kind={unsaved ? 'unsaved' : 'scene'} aria-label={unsaved ? 'unsaved edits' : 'not in its default view'} role="img" />
}

/**
 * Six tabs, always in one order, none dimmed (plan 3.2). A tablist: arrows, Home and End walk it and
 * select (the panel is the centre), one roving tab stop. The indicator is one element moved by a CSS
 * transform from the active tab's measured box, so the switch is a transform and nothing else (5.8 #1).
 */
export function WorkspaceTabs({ ws, panelId }: { ws: WsId; panelId: string }) {
  const list = useRef<HTMLDivElement>(null)
  const badges = tabBadgesOn()

  useLayoutEffect(() => {
    const l = list.current
    const on = l?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!l || !on) return
    l.style.setProperty('--ink-x', `${on.offsetLeft}px`)
    l.style.setProperty('--ink-w', String(on.offsetWidth))
  }, [ws])

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = WORKSPACES.length - 1
    const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (next < 0) return
    e.preventDefault()
    const t = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    t?.focus()
    void switchWorkspace(WORKSPACES[next].id)
  }

  return (
    <div className="ww-tabs" role="tablist" aria-label="Well Wisher workspaces" ref={list}>
      {WORKSPACES.map((w: WsDef, i) => (
        <button
          key={w.id}
          type="button"
          role="tab"
          id={`ww-tab-${w.id}`}
          className={cx('ww-tab', 'ww-tap', ws === w.id && 'on')}
          aria-selected={ws === w.id}
          aria-controls={panelId}
          aria-keyshortcuts={`Alt+${w.key}`}
          title={`${w.label} (Alt+${w.key})`}
          tabIndex={ws === w.id ? 0 : -1}
          onClick={() => void switchWorkspace(w.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {w.label}
          <TabDot ws={w.id} badges={badges} />
        </button>
      ))}
      <span className="ww-tab-ink" aria-hidden="true" />
    </div>
  )
}
