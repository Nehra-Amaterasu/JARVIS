/**
 * The place `app.new` (A.N02 g): mounts N01's `WhatIsNew` (the default export of `app/ui/src/gallery`) lazily,
 * through the contract signature only, so this branch builds and passes without the gallery.
 *
 * Why a glob and not `import('../gallery')`: the gallery is built in the same wave on another branch, and a
 * plain dynamic import of a module that does not exist fails both `tsc -b` and the Vite build. A glob of a path
 * that does not exist is an empty object, so the build is the same with or without it; once N01 merges, the
 * glob finds `gallery/index.ts(x)` and the chunk is loaded on the first open of the place, never before.
 *
 * Whatever goes wrong (no module, no default export, a load error, a render error), the place shows one honest
 * plate that says the gallery is not built in this build, with the PLANNED lamp; it never shows a placeholder
 * dressed as content.
 */
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Lamp } from '../shared/lamp/Lamp'
import type { LampReading } from '../shared/lamp/types'

type Mod = { default?: unknown }
type Loader = () => Promise<Mod>

/** The first loader of the gallery entry module, or null when the gallery is not part of this build. */
export function galleryLoader(found: Record<string, Loader>): Loader | null {
  for (const k of ['../gallery/index.tsx', '../gallery/index.ts']) if (found[k]) return found[k]
  return null
}

const FOUND = import.meta.glob<Mod>(['../gallery/index.ts', '../gallery/index.tsx'])

/** A lazy component for a loader; any failure resolves to the honest plate instead of throwing. */
export function lazyGallery(load: Loader | null): ComponentType {
  if (!load) return NotYet
  return lazy(() =>
    load().then(
      (m) => ({ default: typeof m.default === 'function' || (m.default && typeof m.default === 'object') ? (m.default as ComponentType) : NotYet }),
      () => ({ default: NotYet }),
    ),
  )
}

const Gallery = lazyGallery(galleryLoader(FOUND))

const PLANNED: LampReading = { state: 'planned', since: null, reason: 'not in this build' }

function NotYet() {
  return (
    <section className="s2-notbuilt" aria-labelledby="s2-new-t" data-whatisnew="absent">
      <Lamp reading={PLANNED} size={16} subject="What is new" />
      <h2 id="s2-new-t">What is new is not built yet</h2>
      <p>The gallery of every merged component arrives with its own package. This build does not have it, so nothing is shown here, and nothing here is a reading.</p>
    </section>
  )
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <NotYet /> : this.props.children
  }
}

export function WhatIsNewPlace() {
  return (
    <div className="s2-place" data-place="app.new">
      <Boundary>
        <Suspense fallback={<div className="s2-loading" role="status">Loading…</div>}>
          <Gallery />
        </Suspense>
      </Boundary>
    </div>
  )
}
