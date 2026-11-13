// The in-memory bench (package BENCH): a thin mount of the gallery. The specimens that used to live here moved, with their
// states, to src/gallery/entries/*.tsx (one file per family); src/gallery/bench.tsx draws every kit, art and lamp entry with
// the exact markup e2e/bench.spec.ts reads (data-bench, data-form, bn-* classes, the .ww wrapper), so the bench checks and
// the export-coverage set are unchanged. The real clay token files, clay.css, the art and lamp CSS, and (for the legacy ww-*
// kit controls that shared/kit still draws with `.ww-*` classes) the real ww/design and ww/kit stylesheets are imported here.
// e2e/bench.spec.ts builds this file with Vite in memory and serves it from a fake origin.
//
// URL contract (read once, at load):  ?theme=light|dark   which clay theme (and the matching ww theme) to draw
//                                     ?open=<Overlay>     open one modal on mount (the others render closed)
//                                     ?view=gallery       mount the What is new place (e2e/gallery.spec.ts) instead of the bench
import '../../src/styles/design/clay/index.css'
import '../../src/ww/design/base.css'
import '../../src/ww/kit/kit.css'
import './bench.css'
import * as kit from '../../src/shared/kit'
import * as art from '../../src/shared/art'
import * as lampPkg from '../../src/shared/lamp'
import { createRoot } from 'react-dom/client'
import { mountBench } from '../../src/gallery/bench'
import WhatIsNew from '../../src/gallery'

const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', `clay-${THEME}`)
document.documentElement.setAttribute('data-legacy-styles', '') // this entry imports the Well Wisher kit sheet itself (see src/gallery/legacy.ts)
// The legacy ww-* controls read the Well Wisher themes (Ash = dark default, Paper = light) from html[data-theme];
// the clay theme owns that attribute here, so e2e/bench.spec.ts rewrites those selectors to [data-ww-theme].
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')

// What the spec compares: every capitalised function export, per package, against what the page drew.
const fns = (ns: Record<string, unknown>) => Object.keys(ns).filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !/^[A-Z0-9_]+$/.test(k) && typeof ns[k] === 'function')
const w = window as unknown as { __bench: unknown }
const rootEl = document.getElementById('root')!
if (q.get('view') === 'gallery') {
  // the canvas of the shell at 1366 x 768 is 1302 x 720; the spec sizes the viewport, this fills it
  rootEl.style.height = '100vh'
  createRoot(rootEl).render(<WhatIsNew />)
} else {
  w.__bench = { exports: { kit: fns(kit), art: fns(art), lamp: fns(lampPkg) }, rendered: mountBench(rootEl, THEME) }
}
