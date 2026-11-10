/**
 * The Proof panel's body (plan 4.10, R): ten cards in a fixed order. ProofRail draws it in three places: pinned
 * as a column from 1500 px, in a 320 px sheet from 1000 px, and in a full sheet below that. The panel scrolls
 * inside itself (it is not the workspace centre, so the no-page-scroll rule does not apply to it).
 *
 * Data is read when the panel mounts, when it is opened again, and when the plan store refreshes after a log, so
 * a finished session shows in Recent without polling (a timer under 60 s would break the idle budget, 5.7.7).
 */
import { useCallback, useEffect, useRef } from 'react'
import { usePlan } from '../../germoney/game/plan'
import { useFailureStore } from '../../germoney/stores/failure-store'
import { Section } from '../kit'
import type { ProofMode } from '../frame/density'
import { useFrame } from '../frame/frameStore'
import { BuildingCard, GithubCard, QuestsCard, RankCard, RecentCard, StatsCard, SuggestCard, WayCard, WeeklyCard, WinsCard, type CardCtx } from './cards'
import { useProofData } from './proofData'
import './proof.css'

/** The ten cards, in the order the contract test expects. */
export const PROOF_CARDS = [
  { id: 'P1', hint: 'Your rank and every requirement for the next one, met and unmet', Card: RankCard },
  { id: 'P2', hint: 'What the rules suggest, each with a button to its place, and sourced advice', Card: SuggestCard },
  { id: 'P3', hint: 'Six stats from logged work and the 4-week line of each Life counter', Card: StatsCard },
  { id: 'P4', hint: 'The optional quest lines, on or off', Card: QuestsCard },
  { id: 'P5', hint: 'The weekly review and the month in one line', Card: WeeklyCard },
  { id: 'P6', hint: 'Hours of building, estimated from commit times', Card: BuildingCard },
  { id: 'P7', hint: 'Public GitHub activity', Card: GithubCard },
  { id: 'P8', hint: 'Shipped work, certificates, level ups', Card: WinsCard },
  { id: 'P9', hint: 'What was logged, grouped by day', Card: RecentCard },
  { id: 'P10', hint: 'What got in the way, kept on this device', Card: WayCard },
] as const

export function ProofPanel({ mode = 'rail' }: { mode?: ProofMode }) {
  const { data, reload } = useProofData()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => void useFailureStore.getState().hydrate(), [])

  // opened again: the numbers may have moved while it was shut
  const open = useFrame((s) => s.proofOpen)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (open) reload()
  }, [open, reload])

  // a log elsewhere refreshes the plan store; read again (skip the value present at mount)
  const planTick = usePlan((s) => s.today)
  const seen = useRef(planTick)
  useEffect(() => {
    if (seen.current === planTick) return
    seen.current = planTick
    reload()
  }, [planTick, reload])

  const showCard = useCallback((id: string) => {
    const card = root.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'start' })
    const head = card.querySelector<HTMLElement>('.ww-card-title')
    if (head) {
      head.tabIndex = -1
      head.focus({ preventScroll: true })
    }
  }, [])

  const ctx: CardCtx = { data, mode, reload: reload as CardCtx['reload'], showCard }
  return (
    <div ref={root} className="ww-proof" data-proof-panel="" data-mode={mode}>
      {PROOF_CARDS.map(({ id, hint, Card }) => (
        <Section key={id} id={id} hint={hint} as="div">
          <Card {...ctx} />
        </Section>
      ))}
    </div>
  )
}
