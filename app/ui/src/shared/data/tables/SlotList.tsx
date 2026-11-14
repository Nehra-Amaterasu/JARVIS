// SlotList (wave 6, D03, spec 20.5.2): rows that seat into slots. They enter by 8 px and opacity over 140 ms with a 40 ms
// stagger capped at eight rows, and leave by collapsing their slot. Reorder is Alt+Up and Alt+Down on the focused row
// (one step, at once), or Space to pick a row up, Up and Down to carry it, Space to put it down and Escape to put it back;
// a pointer drag on the grip does the same. While a row is lifted it is a raised key and its seat is a dashed blanking
// plate. The list is controlled: it only asks (`onReorder`); with no `onReorder` the order is fixed and the grip is absent.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { LAMP_SPECS, type LampState } from '../../lamp'
import { useReducedMotion } from '../../motion/useReducedMotion'
import { SLOT_PX, altTarget, moveAnnouncement, reorder, seatDelayMs, slotAtY } from './layout'
import { LampTag } from './parts'
import './tables.css'

export interface Item {
  id: string
  label: string
  meta?: string
  /** A lamp for the row, when the thing it names has a source that can be LIVE, WAITING and so on. */
  state?: LampState
}

export interface SlotListProps {
  items: Item[]
  onReorder?: (from: number, to: number) => void
  label?: string
  empty?: ReactNode
  /** Draw one row as lifted with its plate, for the gallery's still picture of the held state. */
  liftedId?: string
}

interface Lift { id: string; from: number; to: number; dy: number; startY: number; top: number; mode: 'key' | 'pointer' }

/** The most removed rows kept on screen while their slots collapse. */
const GHOST_CAP = 8
/** A collapsing slot is removed when its animation ends; this is the bound if the end never comes (a hidden tab). */
const GHOST_FALLBACK_MS = 400
/** An id inside a quoted attribute selector. */
const esc = (s: string) => s.split('\\').join('\\\\').split('"').join('\\"')

export function SlotList({ items, onReorder, label = 'List', empty, liftedId }: SlotListProps) {
  const uid = useId()
  const reduced = useReducedMotion()
  const list = useRef<HTMLUListElement>(null)
  const [lift, setLift] = useState<Lift | null>(null)
  const [stop, setStop] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const [ghosts, setGhosts] = useState<{ item: Item; at: number }[]>([])
  const focusId = useRef<string | null>(null)
  const seen = useRef(new Map<string, number>())
  const prev = useRef<Item[]>(items)
  const movable = !!onReorder

  // rows seen for the first time seat in; the number is their place in this arrival, for the stagger
  let fresh = 0
  for (const it of items) if (!seen.current.has(it.id)) seen.current.set(it.id, fresh++)

  // a removed row leaves by collapsing its slot; with reduced motion it just goes
  useLayoutEffect(() => {
    const ids = new Set(items.map((i) => i.id))
    const gone = prev.current.map((item, at) => ({ item, at })).filter((x) => !ids.has(x.item.id))
    prev.current = items
    if (gone.length === 0) return
    gone.forEach((g) => seen.current.delete(g.item.id))
    if (!reduced) setGhosts((g) => [...g, ...gone].slice(-GHOST_CAP))
  }, [items, reduced])
  useEffect(() => {
    if (ghosts.length === 0) return
    const t = setTimeout(() => setGhosts([]), GHOST_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [ghosts])

  // after a reorder the moved row keeps focus
  useLayoutEffect(() => {
    const id = focusId.current
    if (!id) return
    focusId.current = null
    list.current?.querySelector<HTMLElement>(`[data-id="${esc(id)}"] .d3s-row`)?.focus()
  }, [items])

  const shown = lift ? reorder(items, lift.from, lift.to) : items
  const tab = stop && items.some((i) => i.id === stop) ? stop : items[0]?.id
  const name = (id: string) => items.find((i) => i.id === id)?.label ?? ''

  const drop = (l: Lift) => {
    setLift(null)
    if (l.to !== l.from) {
      focusId.current = l.id
      onReorder?.(l.from, l.to)
      setSaid(moveAnnouncement(name(l.id), l.to, items.length))
    } else setSaid(`${name(l.id)} put back at position ${l.from + 1} of ${items.length}`)
  }

  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
    if (!row || !(e.target as HTMLElement).classList.contains('d3s-row')) return
    const id = row.dataset.id!
    const i = items.findIndex((x) => x.id === id)
    if (i < 0) return
    const k = e.key
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault()
      if (!movable || lift) return
      const to = altTarget(i, k, items.length)
      if (to === null) { setSaid(`${name(id)} is already ${k === 'ArrowUp' ? 'first' : 'last'}`); return }
      focusId.current = id
      onReorder!(i, to)
      setSaid(moveAnnouncement(name(id), to, items.length))
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault()
      if (lift?.mode === 'key') {
        const to = Math.max(0, Math.min(items.length - 1, lift.to + (k === 'ArrowDown' ? 1 : -1)))
        setLift({ ...lift, to })
        setSaid(`Position ${to + 1} of ${items.length}`)
      } else if (!lift) {
        const n = Math.max(0, Math.min(items.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))
        const target = items[n].id
        setStop(target)
        list.current?.querySelector<HTMLElement>(`[data-id="${esc(target)}"] .d3s-row`)?.focus()
      }
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault()
      if (lift) return
      const target = items[k === 'Home' ? 0 : items.length - 1].id
      setStop(target)
      list.current?.querySelector<HTMLElement>(`[data-id="${esc(target)}"] .d3s-row`)?.focus()
    } else if (k === ' ' || k === 'Enter') {
      e.preventDefault()
      if (!movable) return
      if (lift?.mode === 'key') drop(lift)
      else if (!lift) {
        setLift({ id, from: i, to: i, dy: 0, startY: 0, top: 0, mode: 'key' })
        setSaid(`${name(id)} picked up, position ${i + 1} of ${items.length}. Up and down to move, space to put down, escape to cancel.`)
      }
    } else if (k === 'Escape' && lift) {
      e.preventDefault()
      setSaid(`${name(lift.id)} put back at position ${lift.from + 1} of ${items.length}`)
      setLift(null)
    }
  }

  // pointer drag on the grip
  const down = (e: PointerEvent<HTMLElement>, id: string, i: number) => {
    if (!movable || (e.pointerType === 'mouse' && e.button !== 0) || lift) return
    // capture on the list, which stays mounted: the lifted row moves in the DOM while it is carried, and a capture held by a moved node is dropped
    list.current?.setPointerCapture?.(e.pointerId)
    setStop(id)
    setLift({ id, from: i, to: i, dy: 0, startY: e.clientY, top: list.current?.getBoundingClientRect().top ?? 0, mode: 'pointer' })
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!lift || lift.mode !== 'pointer') return
    const to = slotAtY(e.clientY, lift.top, items.length)
    setLift({ ...lift, to, dy: e.clientY - lift.startY - (to - lift.from) * SLOT_PX })
  }
  const up = (cancel: boolean) => {
    if (!lift || lift.mode !== 'pointer') return
    if (cancel) setLift(null)
    else drop(lift)
  }

  const renderItem = (it: Item, i: number) => {
    const lifted = lift?.id === it.id || liftedId === it.id
    const seatI = seen.current.get(it.id)
    return (
      <li
        key={it.id}
        className="d3s-item"
        data-id={it.id}
        data-seat={seatI !== undefined && !reduced ? '' : undefined}
        data-lifting={lifted || undefined}
        style={{
          ...(seatI !== undefined ? { ['--i' as string]: seatDelayMs(seatI) / 40 } : {}),
          ...(lift?.id === it.id && lift.mode === 'pointer' ? { ['--d3-dy' as string]: `${lift.dy}px` } : {}),
        }}
      >
        {lifted && <span className="d3s-plate" aria-hidden="true">seat</span>}
        <button
          type="button"
          className="d3s-row"
          tabIndex={tab === it.id ? 0 : -1}
          aria-roledescription={movable ? 'reorderable item' : undefined}
          aria-describedby={`${uid}-hint`}
          aria-label={`${it.label}${it.meta ? `, ${it.meta}` : ''}, position ${i + 1} of ${items.length}${it.state ? `, ${LAMP_SPECS[it.state].label}` : ''}${lifted ? ', picked up' : ''}`}
          onFocus={() => setStop(it.id)}
        >
          <span className="d3-idx" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
          <span className="d3s-label" aria-hidden="true">{it.label}</span>
          {it.meta ? <span className="d3s-meta" aria-hidden="true">{it.meta}</span> : <span />}
          {it.state ? <LampTag state={it.state} /> : <span />}
          {movable ? (
            <span
              className="d3s-grip"
              aria-hidden="true"
              onPointerDown={(e) => down(e, it.id, items.findIndex((x) => x.id === it.id))}
            />
          ) : <span />}
        </button>
      </li>
    )
  }

  // the rows in their shown order, with the collapsing ones put back where they were
  const nodes: ReactNode[] = shown.map((it, i) => renderItem(it, i))
  for (const g of ghosts) {
    nodes.splice(Math.min(g.at, nodes.length), 0, (
      <li key={`gone-${g.item.id}`} className="d3s-item" data-leaving="" aria-hidden="true" onAnimationEnd={() => setGhosts((x) => x.filter((y) => y !== g))}>
        <div className="d3s-row" role="presentation">
          <span className="d3-idx" />
          <span className="d3s-label">{g.item.label}</span>
          <span /><span /><span />
        </div>
      </li>
    ))
  }

  return (
    <div className="d3s" data-component="SlotList" data-state={lift ? 'lifting' : items.length ? 'idle' : 'empty'}>
      {items.length === 0 ? (
        <p className="d3s-empty">{empty ?? 'Nothing here yet.'}</p>
      ) : (
        <ul ref={list} className="d3s-list" aria-label={label} onKeyDown={onKey} onPointerMove={move} onPointerUp={() => up(false)} onPointerCancel={() => up(true)}>
          {nodes}
        </ul>
      )}
      <p id={`${uid}-hint`} className="d3s-hint">
        {movable ? 'Alt + ↑ ↓ moves a row. Space picks one up; ↑ ↓ carry it; Space puts it down; Esc cancels.' : 'This order is fixed.'}
      </p>
      <p className="d3-vh" role="status" aria-live="polite">{said}</p>
    </div>
  )
}
