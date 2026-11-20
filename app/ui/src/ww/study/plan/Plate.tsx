// The raised plate and the pager of the Study boards (package Y03): one card pattern for the plan view, the dMAT board and the Library face.
// A plate is lifted by elevation, never drawn by a line; its head carries the title, an optional kicker and the one lamp of the plate.
import type { ReactNode } from 'react'
import { Button, Lamp } from '../../../shared/kit'
import type { LampState } from '../../../shared/lamp'
import './y3.css'

export interface Reading { state: LampState; reason: string }

export function Plate({ id, title, kicker, lamp, children, className }: { id?: string; title: string; kicker?: ReactNode; lamp?: Reading; children: ReactNode; className?: string }) {
  return (
    <section className={`y3-card${className ? ` ${className}` : ''}`} data-card={id}>
      <header className="y3-head">
        <h2 className="y3-title">{title}</h2>
        {kicker && <span className="y3-kicker">{kicker}</span>}
        {lamp && <span className="y3-lamp"><Lamp state={lamp.state} reason={lamp.reason} /></span>}
      </header>
      {children}
    </section>
  )
}

export function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (p: number) => void; label: string }) {
  if (pages <= 1) return null
  return (
    <div className="y3-pager" role="group" aria-label={label}>
      <Button size="sm" grouped aria-label={`${label}, earlier`} disabled={page === 0} onClick={() => onPage(page - 1)}>Earlier</Button>
      <span className="y3-pager-n" aria-live="polite">{page + 1} of {pages}</span>
      <Button size="sm" grouped aria-label={`${label}, later`} disabled={page === pages - 1} onClick={() => onPage(page + 1)}>Later</Button>
    </div>
  )
}

