// O5 Roadmap (plan 4.12): the one home of everything unbuilt. It is GENERATED from plannedFeatures.ts, so a
// feature that ships disappears from here in the same commit that deletes its entry. The overlay declares no
// primary ("none, close only"): rows are text, there is nothing to press but the drawer's Close.
import { registerOverlay } from '../frame/overlayRegistry'
import { GROUPS, PLANNED, groupOf, type Planned } from '../plannedFeatures'
import './roadmap.css'

export function RoadmapBody({ entries = PLANNED }: { entries?: readonly Planned[] }) {
  return (
    <div className="ww-roadmap" data-overlay="roadmap" data-primary-none="">
      <p className="ww-roadmap-lead">What is not built, and why.</p>
      {GROUPS.map((g) => {
        const rows = entries.filter((p) => groupOf(p) === g)
        if (rows.length === 0) return null
        return (
          <section key={g} className="ww-roadmap-group" data-roadmap-group={g} aria-labelledby={`ww-roadmap-${g}`}>
            <h3 id={`ww-roadmap-${g}`} className="ww-kicker">{g}</h3>
            <ul className="ww-roadmap-list">
              {rows.map((p) => (
                <li key={p.id} className="ww-roadmap-row" data-roadmap-row={p.id}>
                  <p className="ww-roadmap-label">{p.label}</p>
                  <p className="ww-roadmap-line">{p.line}</p>
                  <p className="ww-roadmap-needs">Needs: {p.needs}</p>
                  {p.when && <p className="ww-roadmap-when">When: {p.when}</p>}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="ww-roadmap-foot">Generated from plannedFeatures.ts; each row names what it needs.</p>
    </div>
  )
}

// Registered on import. The Frame's flag branch imports this module (germoney/MissionRoot.tsx), so with the
// flag off the Roadmap code is never downloaded.
registerOverlay('roadmap', RoadmapBody as never)
