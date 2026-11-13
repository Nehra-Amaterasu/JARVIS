// The jury bench's wave 5 additions (G01), mounted beside the bench page that e2e/bench/entry.tsx draws (N01 owns that
// file, so G01 adds its specimens here instead): LitPanel in its rest, lit and eight-angle forms, PlannedGlyph at its
// sizes in both packages that export it, and the planned plate and chip in their corner-bracket frame. Every block
// carries data-bench, so the same in-page probes (edges, hit areas, Tab, motion, contrast, reflow) measure it, and the
// two new exports are added to the page's RENDERED set only because they are really drawn here.
// e2e/bench.spec.ts builds a virtual entry that imports e2e/bench/entry.tsx first and then this file.
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { LIT_ANGLES, LitPanel, PlannedGlyph } from '../../shared/kit'
import { PlannedGlyph as LampPlannedGlyph } from '../../shared/lamp'
import { PlannedPlate } from '../../shared/planned/PlannedPlate'
import { PlannedChip } from '../../shared/planned/PlannedChip'
import { createRegistry, globbedFor } from '../../shared/planned/registry'

const noop = () => {}
const DRAWN = ['kit:LitPanel', 'kit:PlannedGlyph', 'lamp:PlannedGlyph']

function B({ name, pkg, children }: { name: string; pkg: string; children: ReactNode }) {
  return (
    <section className="bn-block" data-bench={`${pkg}/${name}`} data-pkg={pkg} aria-labelledby={`bn-g01-${pkg}-${name}`}>
      <h2 className="bn-h" id={`bn-g01-${pkg}-${name}`}>
        {pkg}/{name}
      </h2>
      <div className="bn-forms">{children}</div>
    </section>
  )
}
function F({ form, children }: { form: string; children: ReactNode }) {
  return (
    <div className="bn-form" data-form={form}>
      <p className="bn-cap">{form}</p>
      {children}
    </div>
  )
}

const wave5 = createRegistry(globbedFor('ww'))
const SIZES = [12, 16, 24, 48] as const

function Wave5() {
  return (
    <main id="bn-g01" aria-label="Wave 5 material" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, maxWidth: 1280, margin: '0 auto' }}>
      <B name="LitPanel" pkg="kit">
        <F form="rest, light follows the pointer">
          <LitPanel>
            <p style={{ margin: 0 }}>A raised face with a lit ridge, a matte shade and tooth. Hover it.</p>
          </LitPanel>
        </F>
        <F form="lit, eight angles">
          {LIT_ANGLES.map((a) => (
            <LitPanel key={a} angle={a} lit>
              <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12 }}>{a} deg</span>
            </LitPanel>
          ))}
        </F>
        <F form="error and planned">
          <LitPanel angle={315} error="could not load">Faulty panel</LitPanel>
          <LitPanel angle={315} planned>Planned panel</LitPanel>
        </F>
      </B>
      <B name="PlannedGlyph" pkg="kit">
        <F form="sizes 12, 16, 24, 48">{SIZES.map((s) => <PlannedGlyph key={s} size={s} />)}</F>
      </B>
      <B name="PlannedGlyph" pkg="lamp">
        <F form="the same ring from shared/lamp">{SIZES.map((s) => <LampPlannedGlyph key={s} size={s} />)}</F>
      </B>
      <B name="PlannedPlate" pkg="planned">
        <F form="the wave 5 homes, in the corner-bracket frame">
          {wave5.entries.map((e) => (
            <PlannedPlate key={e.id} entry={e} onOpen={noop} />
          ))}
        </F>
        <F form="the chip of a view">
          <PlannedChip registry={wave5} home="day.month" onOpen={noop} />
        </F>
      </B>
    </main>
  )
}

const host = document.createElement('div')
host.id = 'bn-g01-root'
document.body.append(host)
createRoot(host).render(<Wave5 />)

const w = window as unknown as { __bench?: { exports: Record<string, string[]>; rendered: () => string[] } }
if (w.__bench) {
  const before = w.__bench.rendered
  w.__bench.rendered = () => [...before(), ...DRAWN]
}
