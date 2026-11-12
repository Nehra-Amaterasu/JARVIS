// The wrapper every art component shares: a <figure> that carries the test hooks of spec 7.7 rule 7
// (data-component, data-state), a caption plate that says where the picture comes from and in what state, and the
// data table that is the keyboard and screen-reader equivalent of the picture. The table is the real content; the
// drawing is the accelerator, so it is always rendered (visually hidden unless `showTable`).
import type { ReactNode } from 'react'
import './art.css'
import { StateTag, type ArtState } from './state'

export function ArtTable({ caption, head, rows, visible = false }: { caption: string; head: readonly string[]; rows: readonly (readonly (string | number)[])[]; visible?: boolean }) {
  return (
    <table className={visible ? 'art-table' : 'art-table art-sr'} data-art-table="">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface FigureProps {
  /** The kebab-case component name, for tests and styles: data-component. */
  component: string
  state?: ArtState
  /** One line: what this shows and where it comes from (the source). */
  caption: string
  /** The lamp contract's one line (why it is waiting, what faulted). */
  reason?: string
  busy?: boolean
  className?: string
  children: ReactNode
}

export function Figure({ component, state, caption, reason, busy, className, children }: FigureProps) {
  return (
    <figure className={className ? `art ${className}` : 'art'} data-component={component} data-state={state} aria-busy={busy || undefined}>
      {children}
      <figcaption className="art-plate">
        <span className="art-plate-text">{caption}</span>
        {state ? <StateTag state={state} reason={reason} /> : null}
      </figcaption>
    </figure>
  )
}

/** Cut a label to n characters with an ellipsis; an SVG <text> cannot wrap, so the table carries the full text. */
export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
