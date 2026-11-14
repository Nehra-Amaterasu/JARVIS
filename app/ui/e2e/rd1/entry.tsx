// The in-memory page of e2e/rd1-forms.spec.ts: the real clay tokens and the real specimen states of the number forms (D01)
// and the series forms (D02), each in a host of a stated width (?id=data/Jar&w=358&theme=dark). Nothing else is mounted.
import '../../src/styles/design/clay/index.css'
import '../../src/ww/design/base.css'
import '../../src/ww/kit/kit.css'
import { createRoot } from 'react-dom/client'
import numbers from '../../src/gallery/entries/d01-numbers'
import series from '../../src/gallery/entries/d02-series'

const q = new URLSearchParams(location.search)
const theme = q.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.setAttribute('data-theme', `clay-${theme}`)
if (theme === 'light') document.body.setAttribute('data-ww-theme', 'paper')
document.body.style.margin = '0'
document.body.style.background = 'var(--surface-ground)'
const w = Number(q.get('w') ?? 390)
const e = [...numbers, ...series].find((x) => x.id === (q.get('id') ?? 'data/Jar'))
if (!e) throw new Error('no such specimen')
createRoot(document.getElementById('root')!).render(
  <div id="host" style={{ width: w, boxSizing: 'border-box', color: 'var(--ink-1)' }}>
    {e.states.map((s, i) => (
      <div key={i} className="rd1-state" data-st={i} style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: '8px 14px' }}>
        {s.node}
      </div>
    ))}
  </div>,
)
