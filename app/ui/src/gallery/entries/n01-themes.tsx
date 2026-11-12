// The themes as swatch plates: the clay roles in the page theme and in the always-dark immersive scene, and the section
// themes (layer 3). A swatch is never the only carrier of a meaning: each carries its token name as text.
import { useEffect, useRef, useState } from 'react'
import { SECTIONS } from '../../shell/ids'
import type { GalleryEntryX } from '../types'

const ROLES: { token: string; group: 'surface' | 'ink' | 'edge' | 'state' | 'action' }[] = [
  { token: '--surface-ground', group: 'surface' },
  { token: '--surface-raised', group: 'surface' },
  { token: '--surface-sunk', group: 'surface' },
  { token: '--surface-paper', group: 'surface' },
  { token: '--ink-1', group: 'ink' },
  { token: '--ink-2', group: 'ink' },
  { token: '--ink-3', group: 'ink' },
  { token: '--edge-ui', group: 'edge' },
  { token: '--edge-hair', group: 'edge' },
  { token: '--state-measured', group: 'state' },
  { token: '--state-simulated', group: 'state' },
  { token: '--state-fault', group: 'state' },
  { token: '--state-waiting', group: 'state' },
  { token: '--state-planned', group: 'state' },
  { token: '--accent-fill', group: 'action' },
  { token: '--focus-ring', group: 'action' },
]

function Swatch({ token }: { token: string }) {
  return (
    <li className="gl-swatch">
      <span className="gl-swatch-chip" style={{ background: `var(${token})` }} aria-hidden="true" />
      <code className="gl-swatch-name">{token.slice(2)}</code>
    </li>
  )
}

function ThemePlate({ scene, title }: { scene?: 'immersive'; title: string }) {
  return (
    <section className="gl-themeplate" data-scene={scene} aria-label={title}>
      <h4 className="gl-themeplate-h">{title}</h4>
      <p className="gl-themeplate-sample">Aa, ink on ground. <span className="gl-themeplate-quiet">Quiet ink. </span></p>
      <ul className="gl-swatches">{ROLES.map((r) => <Swatch key={r.token} token={r.token} />)}</ul>
    </section>
  )
}

/** Reads the computed section tokens once per theme change; no timer, no animation. */
function useComputed(names: string[], deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cs = getComputedStyle(el)
    setVals(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return [ref, vals] as const
}

function useRootTheme() {
  const [t, setT] = useState(() => document.documentElement.getAttribute('data-theme') ?? '')
  useEffect(() => {
    const mo = new MutationObserver(() => setT(document.documentElement.getAttribute('data-theme') ?? ''))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return t
}

function SectionPlate({ id, label, product }: { id: string; label: string; product: string }) {
  const theme = useRootTheme()
  const [ref, v] = useComputed(['--tempo', '--sec-scene'], [theme])
  return (
    <section className="gl-secplate" data-section={id} aria-label={`${label} section theme`}>
      <div ref={ref} className="gl-secplate-in">
        <h4 className="gl-secplate-h">{label}</h4>
        <p className="gl-secplate-meta">{product}</p>
        <ul className="gl-secplate-chips">
          {['--sec-art-1', '--sec-art-2', '--sec-art-3', '--sec-mark'].map((t) => (
            <li key={t} className="gl-secplate-chip">
              <span className="gl-swatch-chip" style={{ background: `var(${t})` }} aria-hidden="true" />
              <code className="gl-swatch-name">{t.slice(6)}</code>
            </li>
          ))}
        </ul>
        <div className="gl-secplate-shapes" aria-hidden="true">
          <span className="gl-secplate-control" />
          <span className="gl-secplate-panel" />
        </div>
        <p className="gl-secplate-meta">scene {v['--sec-scene'] || '...'}, tempo {v['--tempo'] || '...'}</p>
      </div>
    </section>
  )
}

const SECTION_PLATES = [
  ...SECTIONS.map((s) => ({ id: s.id, label: s.label, product: s.product === 'jarvis' ? 'JARVIS' : 'Well Wisher' })),
  { id: 'proof', label: 'Proof', product: 'Well Wisher panel' },
]

const entries: GalleryEntryX[] = [
  {
    id: 'theme/clay',
    title: 'Clay themes',
    group: 'theme',
    merged: 'tokens, 12 Nov',
    note: 'The semantic roles by name. The theme switch at the top flips the whole page; the right-hand plate is the immersive scene and stays dark.',
    states: [
      { label: 'the page theme', node: <ThemePlate title="Page theme" /> },
      { label: 'immersive scene (always dark)', node: <ThemePlate scene="immersive" title="Immersive scene" /> },
    ],
  },
  {
    id: 'section/themes',
    title: 'Section themes',
    group: 'section',
    merged: 'section themes, 12 Nov',
    note: 'Layer 3 declares only art colours, a radius pair and a tempo. A section never restyles the chrome, and colour only ever means state.',
    states: [{ label: `${SECTION_PLATES.length} section plates`, node: <div className="gl-secgrid">{SECTION_PLATES.map((s) => <SectionPlate key={s.id} {...s} />)}</div> }],
  },
]
export default entries
