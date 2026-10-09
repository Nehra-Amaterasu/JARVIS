/**
 * Ctrl K: the keyboard path to everything. Typing filters commands; anything
 * that isn't a command becomes "search memory for …" or "ask JARVIS …", so the
 * palette is also the fastest way into Yaadash.
 */
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { post } from '../lib/api'
import { TABS, useStore } from '../lib/store'

interface Cmd { id: string; group: string; label: string; hint?: string; run: () => void | Promise<void> }

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPalette)
  const setTab = useStore((s) => s.setTab)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  const setPendingQuery = useStore((s) => s.setPendingQuery)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      window.setTimeout(() => input.current?.focus(), 10)
    }
  }, [open])

  const commands = useMemo<Cmd[]>(() => {
    const act = (label: string, fn: () => Promise<unknown>, ok?: string) => async () => {
      try {
        await fn()
        if (ok) toast(ok, 'live')
      } catch (e) {
        toast(`${label}: ${(e as Error).message}`, 'fault')
      }
    }
    const list: Cmd[] = TABS.map((t, i) => ({
      id: `go-${t.id}`, group: 'Go to', label: t.title, hint: `Ctrl ${i + 1}`, run: () => setTab(t.id),
    }))
    if (!core?.running) {
      list.push(
        { id: 'wake-voice', group: 'JARVIS', label: 'Wake JARVIS — voice', hint: 'mic + Whisper + speech',
          run: act('Wake', () => post('/api/core/start', { mode: 'voice' })) },
        { id: 'wake-text', group: 'JARVIS', label: 'Wake JARVIS — text only', hint: 'fast, no audio',
          run: act('Wake', () => post('/api/core/start', { mode: 'text' })) },
      )
    } else {
      list.push({ id: 'sleep', group: 'JARVIS', label: 'Put JARVIS to sleep', hint: 'frees the GPU',
        run: act('Sleep', () => post('/api/core/stop')) })
    }
    list.push(
      { id: 'light-on', group: 'Room', label: 'Light on', run: act('Light', () => post('/api/limbs/light', { action: 'on' })) },
      { id: 'light-off', group: 'Room', label: 'Light off', run: act('Light', () => post('/api/limbs/light', { action: 'off' })) },
      { id: 'fan-on', group: 'Room', label: 'Fan on', run: act('Fan', () => post('/api/limbs/fan', { action: 'on' })) },
      { id: 'fan-off', group: 'Room', label: 'Fan off', run: act('Fan', () => post('/api/limbs/fan', { action: 'off' })) },
      { id: 'scene-focus', group: 'Room', label: 'Scene: deep focus', run: act('Scene', () => post('/api/limbs/scene/focus')) },
      { id: 'scene-sleep', group: 'Room', label: 'Scene: sleep', run: act('Scene', () => post('/api/limbs/scene/sleep')) },
    )
    for (const s of ['evening', 'walk', 'still', 'empty']) {
      list.push({ id: `sim-${s}`, group: 'Aankhen', label: `Simulate: ${s}`, hint: 'labelled as simulation',
        run: act('Aankhen', () => post('/api/aankhen/start', { mode: 'simulation', scenario: s }), `Aankhen simulating “${s}”`) })
    }
    list.push({ id: 'hw', group: 'Aankhen', label: 'Use the ESP32 hardware', run: act('Aankhen', () => post('/api/aankhen/start', { mode: 'hardware' })) })
    return list
  }, [core?.running, setTab, toast])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const hits = term ? commands.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(term)) : commands
    const extra: Cmd[] = []
    if (term) {
      extra.push({ id: 'mem', group: 'Yaadash', label: `Search memory for “${q.trim()}”`, run: () => {
        setPendingQuery(q.trim())
        setTab('yaadash')
      } })
      if (core?.running) {
        extra.push({ id: 'ask', group: 'JARVIS', label: `Ask JARVIS “${q.trim()}”`, run: async () => {
          setTab('core')
          try {
            await post('/api/core/say', { text: q.trim() })
          } catch (e) {
            toast((e as Error).message, 'fault')
          }
        } })
      }
    }
    return [...hits, ...extra]
  }, [q, commands, core?.running, setPendingQuery, setTab, toast])

  if (!open) return null
  const run = (c: Cmd | undefined) => {
    if (!c) return
    setOpen(false)
    void c.run()
  }
  return (
    <div className="palette-scrim" onMouseDown={() => setOpen(false)}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={17} />
          <input ref={input} value={q} placeholder="Type a command, or anything to search memory…"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter') run(filtered[sel])
            }} />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {filtered.map((c, i) => (
            <button key={c.id} className={`palette-item ${i === sel ? 'on' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span className="eyebrow">{c.group}</span>
              <span className="pi-label">{c.label}</span>
              {c.hint && <span className="pi-hint mono">{c.hint}</span>}
              {i === sel && <CornerDownLeft size={14} className="pi-enter" />}
            </button>
          ))}
          {filtered.length === 0 && <div className="empty">No match.</div>}
        </div>
      </div>
    </div>
  )
}
