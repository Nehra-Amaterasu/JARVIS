// One rule drawn as a logic gate (A.J02, spec 20.9.2, after C04-127): inputs on the left, each with its own lamp and word and a
// bubble where the rule needs it NOT to hold; an AND gate; the output on the right; under it the last time the rule really fired.
// A gate whose route did not answer draws hollow (dashed) with the reason: it never shows an invented firing.
import type { ReactNode } from 'react'
import { Sigil } from '../../shared/grammar'
import { LampGlyph, LAMP_WORD } from '../../shared/kit'
import { lastFiredText, type Gate } from './model'
import './room.css'

export interface GateCardProps {
  gate: Gate
  /** The Switch that turns the rule on or off, or any lead control; sits in the header. */
  lead?: ReactNode
  /** The row under the schematic: the rule's own fields and keys. */
  foot?: ReactNode
}

export function GateCard({ gate, lead, foot }: GateCardProps) {
  const hollow = gate.inputs.length === 0
  const rows = Math.max(gate.inputs.length, 1)
  return (
    <section className="jr-gate" data-gate={gate.id} data-state={gate.state} data-hollow={hollow ? 'true' : undefined} aria-label={gate.title}>
      <header className="jr-gate-head">
        <span className="jr-mark" aria-hidden="true"><Sigil seed={`jarvis.room.gate.${gate.id}`} size={16} fold={4} /></span>
        <span className="jr-tag">{gate.tag}</span>
        <h3 className="jr-gate-title">{gate.title}</h3>
        <span className="jr-gate-lamp"><LampGlyph state={gate.state} size={12} /> <b>{LAMP_WORD[gate.state]}</b> <span className="jr-gate-reason">{gate.reason}</span></span>
        {lead && <span className="jr-gate-lead">{lead}</span>}
      </header>
      <div className="jr-gate-art" style={{ ['--rows' as string]: rows }}>
        <ul className="jr-gate-in" aria-label="Inputs">
          {gate.inputs.map((i) => (
            <li key={i.id} data-holds={i.holds === null ? 'unknown' : i.holds ? 'yes' : 'no'} title={i.reason}>
              <LampGlyph state={i.state} size={12} />
              <span className="jr-gate-label">{i.not && <i className="jr-gate-not" aria-label="not">NOT</i>}{i.label}</span>
              <span className="jr-gate-holds">{i.holds === null ? 'not reported' : i.holds ? 'holds' : 'does not hold'}</span>
              <span className="jr-gate-wire" aria-hidden="true" />
            </li>
          ))}
          {hollow && <li data-holds="unknown"><LampGlyph state={gate.state} size={12} /><span className="jr-gate-label">no input reported</span><span className="jr-gate-wire" aria-hidden="true" /></li>}
        </ul>
        <svg className="jr-gate-sym" viewBox="0 0 56 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M1 1H28C60 1 60 99 28 99H1Z" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="jr-gate-and" aria-hidden="true">AND</span>
        <span className="jr-gate-out"><span className="jr-gate-wire" aria-hidden="true" /><span className="jr-gate-out-text">{gate.output}</span></span>
      </div>
      <footer className="jr-gate-foot">
        <span className="jr-gate-last"><b>LAST FIRED</b> {lastFiredText(gate)}</span>
        {foot && <span className="jr-gate-foot-ctl">{foot}</span>}
      </footer>
    </section>
  )
}
