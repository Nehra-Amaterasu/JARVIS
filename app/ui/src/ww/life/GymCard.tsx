// LF5 Gym (plan 4.6): what the last sessions were and a Start button. The session builder itself is the
// existing Forge page, opened in a drawer instead of squeezed into this card: choosing muscles, a list of
// exercises and sets x reps x kg need room, and room is what an overlay is for (no scrolling column).
import { useState } from 'react'
import { useWorkoutStore } from '../../germoney/stores/workout-store'
import { ForgePage } from '../../germoney/pages/Forge'
import { Button, Card, Drawer, EmptyState } from '../kit'
import { Planned } from '../Planned'

const DAY = 86_400_000

/** Sessions in the last 7 days, newest first, from the store's own timestamps (no figure is made up). */
export function recentSessions<T extends { date: string }>(sessions: T[], now: number): { week: number; last: T | null } {
  const dated = sessions.map((s) => ({ s, t: Date.parse(s.date) })).filter((x) => Number.isFinite(x.t)).sort((a, b) => b.t - a.t)
  return { week: dated.filter((x) => now - x.t < 7 * DAY).length, last: dated[0]?.s ?? null }
}

export function GymCard({ index, now = Date.now() }: { index?: number; now?: number }) {
  const sessions = useWorkoutStore((s) => s.sessions)
  const loaded = useWorkoutStore((s) => s.isLoaded)
  const [open, setOpen] = useState(false)
  const { week, last } = recentSessions(sessions, now)
  return (
    <Card
      data-card="LF5"
      title="Gym"
      kicker="Forge"
      action={
        <Button size="sm" onClick={() => setOpen(true)} data-gym-start="">
          Start
        </Button>
      }
      index={index}
    >
      {!loaded && sessions.length === 0 ? (
        <EmptyState title="Sessions are loading." />
      ) : last ? (
        <p className="ww-life-gym">
          <b>{week}</b> session{week === 1 ? '' : 's'} in the last 7 days. Last: {last.date.slice(0, 10)}, {last.muscles.join(', ') || 'no muscles recorded'}.
        </p>
      ) : (
        <EmptyState title="No session logged yet." body="Start builds one from the muscles you pick and logs it as body time." />
      )}
      <Planned id="body-grand" hint />
      <Drawer open={open} onClose={() => setOpen(false)} title="Gym session">
        <ForgePage />
      </Drawer>
    </Card>
  )
}
