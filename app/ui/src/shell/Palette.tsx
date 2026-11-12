/**
 * Ctrl+K (spec 4.2.4): Go, Do, Ask. A 640 px dialog, rows 44 px, paged at 7 rows so the list never scrolls.
 * Hints come only from the binding table (commands.ts hintOf), so no row names a key that does nothing.
 * A planned verb shows the PLANNED lamp and opens "What is coming"; it never runs. Ask goes through the
 * voice and memory ports; with both absent it is one dashed line, "Ask needs JARVIS".
 *
 * The input is a combobox over a listbox (aria-activedescendant), so focus never leaves the field and Tab has
 * nowhere to go: it stays in the dialog. Closing returns focus to the opener (ShellV2 does that).
 */
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { Lamp } from '../shared/lamp/Lamp'
import type { LampReading } from '../shared/lamp/types'
import type { Registry } from '../shared/planned/types'
import { PAGE_ROWS, filterRows, goRows, hintOf, pageOf, shellRows, type PaletteRow, type Verb } from './commands'
import type { ProductId } from './ids'
import { getPort } from './ports'
import { readRecord, resumeTarget } from './record'
import { PRODUCTS, useShell } from './store'

const PLANNED: LampReading = { state: 'planned', since: null, reason: 'not built' }

export interface PaletteProps {
  product: ProductId
  verbs: readonly Verb[]
  registries: readonly Registry[]
  onClose: () => void
}

export function Palette({ product, verbs, registries, onClose }: PaletteProps) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const core = useStore((s) => s.core)
  const toast = useStore((s) => s.toast)
  useEffect(() => input.current?.focus(), [])

  const base = useMemo<PaletteRow[]>(() => {
    const rows: PaletteRow[] = [...goRows(PRODUCTS, product), ...shellRows(PRODUCTS)]
    for (const v of verbs) if (!v.when || v.when()) rows.push({ id: `do.${v.id}`, group: 'Do', label: v.label, detail: v.detail, run: v.run })
    // planned verbs: a disabled-pattern entry is a control that does not work yet; listed, never executable
    for (const r of registries)
      for (const e of r.entries)
        if (e.pattern === 'disabled') rows.push({ id: `planned.${e.id}`, group: 'Do', label: e.label, detail: 'planned', planned: e.id })
    return rows
    // core?.running decides which wake/sleep verbs show
  }, [product, verbs, registries, core?.running]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const hits = filterRows(base, q)
    const term = q.trim()
    if (!term) return hits
    const voice = getPort('voice')
    const memory = getPort('memory')
    const ask: PaletteRow[] = []
    if (voice.present) ask.push({ id: 'ask.voice', group: 'Ask', label: `Ask JARVIS “${term}”`, run: () => voice.ask(term) })
    if (memory.present) ask.push({ id: 'ask.memory', group: 'Ask', label: `Search memory for “${term}”`, run: () => memory.search(term) })
    if (!voice.present && !memory.present) ask.push({ id: 'ask.absent', group: 'Ask', label: 'Ask needs JARVIS', detail: voice.absentText, absent: true })
    return [...hits, ...ask]
  }, [base, q])

  const at = Math.min(sel, Math.max(0, rows.length - 1))
  const page = pageOf(at)
  const shown = rows.slice(page * PAGE_ROWS, page * PAGE_ROWS + PAGE_ROWS)
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS))

  const run = (r: PaletteRow | undefined) => {
    if (!r) return
    const s = useShell.getState()
    if (r.planned || r.absent) {
      s.openOverlay('roadmap', r.planned ?? null)
      return
    }
    onClose()
    if (r.go) s.go(r.go)
    else if (r.id === 'shell.swap') s.swapProduct()
    else if (r.id === 'shell.resume') s.go(resumeTarget(s.product, readRecord(s.product)))
    else if (r.id === 'shell.shortcuts') s.openOverlay('shortcuts')
    else if (r.run) {
      void Promise.resolve(r.run()).then((res) => {
        const out = res as { ok?: boolean; reason?: string } | undefined
        if (out && out.ok === false && out.reason) toast(out.reason, 'info')
      })
    }
  }

  return (
    <div className="s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="s2-palette" role="dialog" aria-modal="true" aria-label="Command palette" data-overlay="palette">
        <div className="s2-palette-field">
          <Search size={18} aria-hidden="true" />
          <input ref={input} value={q} role="combobox" aria-expanded="true" aria-controls="s2-pal-list" aria-autocomplete="list"
            aria-activedescendant={rows[at] ? `s2-pal-${rows[at].id}` : undefined} aria-label="Go, do or ask"
            placeholder="Go to a section, run a verb, or ask"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(at + 1, rows.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(at - 1, 0)) }
              else if (e.key === 'PageDown') { e.preventDefault(); setSel(Math.min((page + 1) * PAGE_ROWS, rows.length - 1)) }
              else if (e.key === 'PageUp') { e.preventDefault(); setSel(Math.max((page - 1) * PAGE_ROWS, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(rows[at]) }
              else if (e.key === 'Tab') e.preventDefault()
            }} />
        </div>
        <ul id="s2-pal-list" role="listbox" aria-label="Results" className="s2-palette-list">
          {shown.map((r) => {
            const i = rows.indexOf(r)
            const hint = hintOf(r)
            return (
              <li key={r.id} id={`s2-pal-${r.id}`} role="option" aria-selected={i === at} className="s2-row"
                data-group={r.group} data-planned={r.planned} data-absent={r.absent ? '' : undefined}
                onMouseMove={() => i !== at && setSel(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(r)}>
                <span className="s2-row-group">{r.group}</span>
                {r.planned && <Lamp reading={PLANNED} size={12} showLabel={false} subject={r.label} />}
                <span className="s2-row-label">{r.label}</span>
                {r.detail && <span className="s2-row-detail">{r.detail}</span>}
                {hint && <kbd className="s2-kbd">{hint}</kbd>}
              </li>
            )
          })}
          {rows.length === 0 && <li className="s2-row" role="option" aria-selected="false" aria-disabled="true">No match.</li>}
        </ul>
        <p className="s2-palette-foot" aria-live="polite">{rows.length} results{pages > 1 ? `, page ${page + 1} of ${pages} (PageUp, PageDown)` : ''}</p>
      </div>
    </div>
  )
}
