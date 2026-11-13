// The jury bench page, drawn from the gallery's entries (package BENCH, now fed by N01). e2e/bench/entry.tsx mounts this; the
// markup is exactly what the bench spec reads: one `[data-bench="pkg/Name"]` block per kit, art and lamp entry, one
// `[data-form]` per state, the `bn-*` classes of e2e/bench/bench.css, the `.ww` wrapper around the legacy controls, and the
// RENDERED set the export-coverage check compares with the real export lists.
// Only entries whose id starts with kit/, art/ or lamp/ are drawn here: the bench measures those three packages and nothing
// else, so a voice, grammar or section entry never adds a block the spec would have to know about.
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { collectEntriesX } from './collect'
import { openParam } from './fixtures'
import type { GalleryEntryX } from './types'

type Pkg = 'kit' | 'art' | 'lamp'
const PKGS: readonly string[] = ['kit', 'art', 'lamp']
const pkgOf = (e: GalleryEntryX): Pkg | null => {
  const p = e.id.split('/')[0]
  return PKGS.includes(p) ? (p as Pkg) : null
}
const nameOf = (e: GalleryEntryX) => e.id.split('/').slice(1).join('/')

function Block({ e, pkg, mark }: { e: GalleryEntryX; pkg: Pkg; mark: (pkg: string, ...names: string[]) => void }) {
  const name = nameOf(e)
  mark(pkg, name, ...(e.also ?? []))
  return (
    <section className="bn-block" data-bench={`${pkg}/${name}`} data-pkg={pkg} aria-labelledby={`bn-${pkg}-${name}`}>
      <h2 className="bn-h" id={`bn-${pkg}-${name}`}>
        {pkg}/{name}
      </h2>
      <div className="bn-forms">
        {e.states.map((s, i) => (
          <div className="bn-form" data-form={s.label} key={i}>
            <p className="bn-cap">{s.label}</p>
            {s.node}
          </div>
        ))}
      </div>
    </section>
  )
}

function Legacy({ children }: { children: ReactNode }) {
  return <div className="ww bn-legacy" data-section="wellwisher" data-density="regular">{children}</div>
}

export function BenchPage({ theme, entries, mark }: { theme: string; entries: GalleryEntryX[]; mark: (pkg: string, ...names: string[]) => void }) {
  const open = openParam()
  const drawn = entries.filter((e) => pkgOf(e))
  const block = (e: GalleryEntryX) => <Block key={e.id} e={e} pkg={pkgOf(e)!} mark={mark} />
  const lamp = drawn.filter((e) => pkgOf(e) === 'lamp')
  const art = drawn.filter((e) => pkgOf(e) === 'art')
  const kit = drawn.filter((e) => pkgOf(e) === 'kit')
  const overlays = kit.filter((e) => e.overlay)
  const legacy = kit.filter((e) => e.legacy && !e.overlay)
  const clay = kit.filter((e) => !e.legacy && !e.overlay)
  const overlayBlock = <Legacy>{overlays.map(block)}</Legacy>
  return (
    <main id="bn-root">
      <h1 className="bn-title">Jury bench: kit, art and lamp, {theme}</h1>
      {/* with ?open= the modals come first: the popover is placed once from its anchor's rectangle, so an anchor far down the page would put it off screen */}
      {open && overlayBlock}
      {lamp.map(block)}
      {clay.map(block)}
      <Legacy>{legacy.map(block)}</Legacy>
      {!open && overlayBlock}
      {art.map(block)}
    </main>
  )
}

/** Mounts the bench into #root and returns the function that lists what was drawn ('pkg:Name'). */
export function mountBench(root: HTMLElement, theme: string): () => string[] {
  const rendered = new Set<string>()
  const mark = (pkg: string, ...names: string[]) => names.forEach((n) => rendered.add(`${pkg}:${n}`))
  createRoot(root).render(<BenchPage theme={theme} entries={collectEntriesX()} mark={mark} />)
  return () => [...rendered]
}
