import { Component, useId, useLayoutEffect, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { Skeleton } from './Skeleton'
import { useArrive } from './Reveal'
import { cx } from './util'

export type CardTone = 'default' | 'raised' | 'quiet'

/** Ids of the cards that are mounted right now (the dev duplicate check). */
const mounted = new Map<string, number>()

function useUniqueCard(id: string) {
  useLayoutEffect(() => {
    const n = mounted.get(id) ?? 0
    // Throw BEFORE counting: an effect that throws never registers its cleanup, so counting first would leak.
    if (n >= 1 && import.meta.env.DEV) throw new Error(`Two mounted cards share data-card="${id}". A card id is a primary key (plan 5.5, 8.1 card-ownership test).`)
    mounted.set(id, n + 1)
    return () => {
      const left = (mounted.get(id) ?? 1) - 1
      if (left <= 0) mounted.delete(id)
      else mounted.set(id, left)
    }
  }, [id])
}

interface BoundaryProps {
  onRetry?: () => void
  children: ReactNode
}
/** The card's error state: a render failure inside one card costs that card, not the page. */
class CardBoundary extends Component<BoundaryProps, { failed: boolean; tries: number }> {
  state = { failed: false, tries: 0 }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Well Wisher card failed to render', error, info.componentStack)
  }
  retry = () => {
    this.props.onRetry?.()
    this.setState((s) => ({ failed: false, tries: s.tries + 1 }))
  }
  render() {
    if (this.state.failed) return <CardError message="This card could not be drawn." onRetry={this.retry} />
    return <div key={this.state.tries} className="ww-card-body">{this.props.children}</div>
  }
}

function CardError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ww-card-error" role="alert">
      <p className="ww-card-error-text">Error: {message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export interface CardHeadProps {
  title: string
  kicker?: string
  /** A control at the right of the head (a Button, a Segmented). */
  action?: ReactNode
  /** 2 for a page-level card, 3 inside a card that already has a heading. */
  level?: 2 | 3
  id?: string
}

/** A real heading, never a styled div: the title is what a screen reader lists the page by. */
export function CardHead({ title, kicker, action, level = 2, id }: CardHeadProps) {
  const Tag = level === 2 ? 'h2' : 'h3'
  return (
    <header className="ww-card-head">
      <div className="ww-card-headtext">
        {kicker && <span className="ww-kicker">{kicker}</span>}
        <Tag id={id} className="ww-card-title">
          {title}
        </Tag>
      </div>
      {action && <div className="ww-card-action">{action}</div>}
    </header>
  )
}

export interface CardProps {
  /** Required by type: the stable id the card-ownership test counts (plan 8.1). */
  'data-card': string
  title?: string
  kicker?: string
  action?: ReactNode
  level?: 2 | 3
  tone?: CardTone
  /** Data has not arrived: the body becomes a Skeleton (shown only after 200 ms). */
  loading?: boolean
  /** The load failed: a message and a Retry; the page keeps working. */
  error?: string
  onRetry?: () => void
  /** Hover lift on an interactive card (5.7.3 #9): -2 px on the inner face; the hit area stays put. */
  lift?: boolean
  /** Position in its group, for the `arrive` stagger. Omit for a card that does not reveal. */
  index?: number
  /** 3 at a workspace switch, 6 (default) for a scrolled group. */
  revealCap?: number
  className?: string
  children?: ReactNode
}

export function Card({ 'data-card': cardId, title, kicker, action, level = 2, tone = 'default', loading, error, onRetry, lift, index, revealCap, className, children }: CardProps) {
  useUniqueCard(cardId)
  const headId = useId()
  const reveal = useArrive<HTMLElement>(index ?? 0, revealCap)
  return (
    <section
      ref={index === undefined ? undefined : reveal}
      className={cx('ww-card', lift && 'ww-lift', className)}
      data-card={cardId}
      data-tone={tone}
      data-state={error ? 'error' : loading ? 'loading' : undefined}
      aria-labelledby={title ? headId : undefined}
      aria-busy={loading || undefined}
    >
      <div className={cx('ww-card-face', lift && 'ww-lift-face')}>
        {title && <CardHead title={title} kicker={kicker} action={action} level={level} id={headId} />}
        {error ? <CardError message={error} onRetry={onRetry} /> : loading ? <Skeleton /> : <CardBoundary onRetry={onRetry}>{children}</CardBoundary>}
      </div>
    </section>
  )
}
