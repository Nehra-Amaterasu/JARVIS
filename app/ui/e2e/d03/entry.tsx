// The in-memory page of package D03: every state of the three entries of src/gallery/entries/d03-tables.tsx, one block per
// entry and one `[data-form]` per state. e2e/d03-tables.spec.ts builds this file with Vite in memory and serves it from a fake
// origin, the way bench.spec.ts does. ?theme=light|dark picks the clay theme; ?only=<entry id> draws one entry.
import '../../src/styles/design/clay/index.css'
import { createRoot } from 'react-dom/client'
import entries from '../../src/gallery/entries/d03-tables'

const q = new URLSearchParams(location.search)
const THEME = q.get('theme') === 'dark' ? 'dark' : 'light'
const ONLY = q.get('only')
document.documentElement.setAttribute('data-theme', `clay-${THEME}`)

const css = `
  body { margin: 0; background: var(--surface-ground); color: var(--ink-1); font: 14px/1.4 var(--font-ui); }
  #d3-root { padding: 16px; display: grid; gap: 28px; }
  .pg-h { margin: 0 0 8px; font: 600 12px/1.2 var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
  .pg-forms { display: grid; gap: 22px; }
  .pg-cap { margin: 0 0 6px; font: 12px/1.3 var(--font-mono); color: var(--ink-2); }
`

function Page() {
  const shown = entries.filter((e) => !ONLY || e.id === ONLY)
  return (
    <main id="d3-root">
      <style>{css}</style>
      {shown.map((e) => (
        <section key={e.id} data-bench={e.id} aria-label={e.title}>
          <h2 className="pg-h">{e.id}</h2>
          <div className="pg-forms">
            {e.states.map((s, i) => (
              <div key={i} data-form={s.label}>
                <p className="pg-cap">{s.label}</p>
                {s.node}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
