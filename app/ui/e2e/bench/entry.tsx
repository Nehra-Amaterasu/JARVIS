// The in-memory bench (package BENCH): a thin mount of the gallery. The specimens that used to live here moved, with their
// states, to src/gallery/entries/*.tsx (one file per family); src/gallery/bench.tsx draws every kit, art and lamp entry with
// the exact markup e2e/bench.spec.ts reads (data-bench, data-form, bn-* classes, the .ww wrapper), so the bench checks and
// the export-coverage set are unchanged. The real clay token files, clay.css, the art and lamp CSS, and (for the legacy ww-*
// kit controls that shared/kit still draws with `.ww-*` classes) the real ww/design and ww/kit stylesheets are imported here.
// e2e/bench.spec.ts builds this file with Vite in memory and serves it from a fake origin.
//
// URL contract (read once, at load):  ?theme=light|dark   which clay theme (and the matching ww theme) to draw
//                                     ?open=<Overlay>     open one modal on mount (the others render closed)
import '../../src/styles/design/clay/index.css'
import '../../src/ww/design/base.css'
import '../../src/ww/kit/kit.css'
import './bench.css'
import * as kit from '../../src/shared/kit'
import * as art from '../../src/shared/art'
import * as lampPkg from '../../src/shared/lamp'
import { mountBench } from '../../src/gallery/bench'

const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', `clay-${THEME}`)
// The legacy ww-* controls read the Well Wisher themes (Ash = dark default, Paper = light) from html[data-theme];
// the clay theme owns that attribute here, so e2e/bench.spec.ts rewrites those selectors to [data-ww-theme].
if (THEME === 'light') document.body.setAttribute('data-ww-theme', 'paper')

// What the spec compares: every capitalised function export, per package, against what the page drew.
const fns = (ns: Record<string, unknown>) => Object.keys(ns).filter((k) => /^[A-Z][A-Za-z0-9]*$/.test(k) && !/^[A-Z0-9_]+$/.test(k) && typeof ns[k] === 'function')
const w = window as unknown as { __bench: unknown }
const rendered = mountBench(document.getElementById('root')!, THEME)
w.__bench = { exports: { kit: fns(kit), art: fns(art), lamp: fns(lampPkg) }, rendered }
