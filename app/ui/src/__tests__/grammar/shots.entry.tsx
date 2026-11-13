// The jury page for G02: the gallery entry's five states on one page, in the theme the URL names. Built in memory
// by shots.mjs (Vite, then Playwright) exactly as e2e/bench.spec.ts builds the bench; nothing is written near dist.
import { createRoot } from 'react-dom/client'
import '../../styles/design/clay/index.css'
import { entry } from '../../shared/grammar/gallery'

const q = new URLSearchParams(location.search)
const theme = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', `clay-${theme}`)
if (q.get('calm') === '1') document.documentElement.setAttribute('data-motion', 'calm')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'

function Page() {
  return (
    <main data-view="gallery.g02" style={{ padding: '20px 16px', display: 'grid', gap: 22, maxWidth: 1334, boxSizing: 'border-box' }}>
      <h1 style={{ margin: 0, font: 'var(--type-title)', color: 'var(--ink-1)' }}>{entry.title}</h1>
      {entry.states.map((s) => (
        <section key={s.label} data-shot={s.label} style={{ display: 'grid', gap: 10 }}>
          <h2 style={{ margin: 0, font: '600 13px/18px var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>{s.label}</h2>
          {s.node}
        </section>
      ))}
      <p style={{ margin: 0, font: 'var(--type-small)', color: 'var(--ink-2)' }}>{entry.note}</p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
