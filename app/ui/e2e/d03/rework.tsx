// The in-memory page of the RD2 rework: the gallery entries of D03, D04, D05 and L02 drawn bare, one `[data-form]` per state,
// with no gallery chrome around them (the chrome zooms the stage 1.5x and has its own toolbar that overlaps a picture).
// ?id=<entry id> picks the entry (default: all four packages' entries), ?w=<px> sets the width the forms get, ?theme=light|dark
// the clay theme, and ?stage=1 draws the first form of the entry inside a 1302 x 720 box at (64, 48), which is the canvas
// the shell leaves at 1366 x 768 (rail 64, title bar 48). Built by e2e/d05-specimen.spec.ts and e2e/d04-capture.spec.ts with Vite.
import '../../src/styles/design/clay/index.css'
import { createRoot } from 'react-dom/client'
import d03 from '../../src/gallery/entries/d03-tables'
import d04 from '../../src/gallery/entries/d04-capture'
import d05 from '../../src/gallery/entries/d05-specimen'
import l02 from '../../src/gallery/entries/l02-trim'

const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
const ID = q.get('id')
const W = Number(q.get('w')) || 0
const STAGE = q.get('stage') === '1'
document.documentElement.setAttribute('data-theme', `clay-${THEME}`)

const css = `
  body { margin: 0; background: var(--surface-ground); color: var(--ink-1); font: 14px/1.4 var(--font-ui); }
  #rw-root { padding: 8px 16px; display: grid; gap: 20px; }
  #rw-root.stage { padding: 0; display: block; }
  .rw-stage { position: absolute; left: 64px; top: 48px; width: 1302px; height: 720px; overflow: hidden; }
  #rw-root > * { min-width: 0; }
  .rw-cap { margin: 0 0 6px; font: 11px/1.3 var(--font-mono); color: var(--ink-2); }
`

const all = [...d03, ...d04, ...d05, ...l02]

function Page() {
  const shown = all.filter((e) => !ID || e.id === ID)
  if (STAGE) {
    const s = shown[0].states[0]
    return (
      <main id="rw-root" className="stage">
        <style>{css}</style>
        <div className="rw-stage" data-stage data-form={s.label}>{s.node}</div>
      </main>
    )
  }
  return (
    <main id="rw-root">
      <style>{css}</style>
      {shown.map((e) =>
        e.states.map((s, i) => (
          <div key={`${e.id}-${i}`} data-entry={e.id} data-form={s.label} style={W ? { width: W } : undefined}>
            <p className="rw-cap">{e.id} / {s.label}</p>
            {s.node}
          </div>
        )),
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
