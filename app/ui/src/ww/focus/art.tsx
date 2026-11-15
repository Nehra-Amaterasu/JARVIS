/**
 * The two still drawings of the Focus views (A.Y02), made in code so no third-party picture enters the tree: a halftone moon ring for
 * Start (a dot screen under a circular mask, lit from the top left like every surface) and a hill for Rest. And the 60-tick ring
 * behind the Crucible's readout. All three are static: no animation, nothing to pause, the same drawing in calm, reduced motion and
 * forced colours (where they are dropped, because a drawing carries no information).
 */
export function MoonRing() {
  return <div className="fv-moon" aria-hidden="true" data-art="moon" />
}

export function Hill() {
  return (
    <svg className="fv-hill" viewBox="0 0 574 360" role="presentation" aria-hidden="true" focusable="false" data-art="hill" preserveAspectRatio="xMidYMax slice">
      <circle className="fv-hill-sun" cx="430" cy="96" r="38" />
      <path className="fv-hill-far" d="M0 250 C 90 200 170 190 262 224 S 440 270 574 206 V360 H0 Z" />
      <path className="fv-hill-mid" d="M0 290 C 110 236 200 244 300 272 S 480 308 574 262 V360 H0 Z" />
      <path className="fv-hill-near" d="M0 332 C 120 296 230 300 330 322 S 500 344 574 316 V360 H0 Z" />
    </svg>
  )
}

/** A faint ring of 60 ticks, one per minute of the hour, at 1 px; it sits behind the readout and is never read aloud. */
export function TickRing({ size = 420 }: { size?: number }) {
  const c = size / 2
  const r = c - 6
  return (
    <svg className="fv-ticks" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false" data-art="ticks">
      {Array.from({ length: 60 }, (_, i) => {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2
        const r0 = i % 5 === 0 ? r - 14 : r - 7
        return <line key={i} x1={c + Math.cos(a) * r0} y1={c + Math.sin(a) * r0} x2={c + Math.cos(a) * r} y2={c + Math.sin(a) * r} />
      })}
    </svg>
  )
}
