// A page for e2e/rw1-pins.spec.ts and for the screenshots (outside src/: it imports the clay and Well Wisher sheets, which the import-graph tests allow only in the shell): the pin map alone on the kit's ground, with a fixture view.
// ?adapter=1 gives it a save adapter that records what it was sent in window.__saved. Not part of the product bundle.
import { createRoot } from 'react-dom/client'
import '../src/styles/design/clay/index.css'
import '../src/ww/design/base.css'
import '../src/ww/kit/kit.css'
import '../src/shared/kit'
import { PinMap } from '../src/jarvis/room/pins/PinMap'
import { fixtureView } from '../src/jarvis/room/pins/fixtures'

const q = new URLSearchParams(location.search)
// The clay theme owns data-theme; the Well Wisher kit sheet reads [data-ww-theme] (the same arrangement as e2e/bench/entry.tsx).
document.documentElement.setAttribute('data-legacy-styles', '')
if (q.get('theme') !== 'dark') document.body.setAttribute('data-ww-theme', 'paper')
const w = window as unknown as { __saved: Record<string, number>[]; __tests: string[] }
w.__saved = []
w.__tests = []
const adapter = q.get('adapter') ? { save: async (c: Record<string, number>) => { w.__saved.push(c) } } : null
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 720, padding: 16, boxSizing: 'border-box', background: 'var(--surface-ground)', minHeight: '100vh' }}>
    <PinMap v={fixtureView({ virtual: q.get('virtual') === '1' })} adapter={adapter} defaultOpen={q.get('open') === '1'}
      test={async (d) => { w.__tests.push(d); return { ok: true, text: 'ok' } }} />
  </main>,
)
