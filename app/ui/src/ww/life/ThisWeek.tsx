// LF3 This week (plan 4.6): the weekly habits and this week's one upgrade focus. A habit that is behind its
// pace is a quiet sand "Behind" chip with the count beside it; there is no streak and nothing resets to zero.
import { Card, Chip, EmptyState, Row } from '../kit'
import type { BodyAnswer, Load } from './useLife'

type BodyLoad = Load<BodyAnswer> & { mark: (id: string, done: boolean) => Promise<void>; markError: string | null }

export function ThisWeek({ state, index }: { state: BodyLoad; index?: number }) {
  const { data: b, error, loading, reload, mark, markError } = state
  return (
    <Card data-card="LF3" title="This week" kicker="Habits" loading={loading && !b} error={!b && error ? error : undefined} onRetry={() => void reload()} index={index}>
      {b && b.status !== 'ok' ? (
        <EmptyState title="Habits are not available." body={b.say} />
      ) : b && b.habits.length === 0 ? (
        <EmptyState title="No habit is switched on." body="Habits are chosen in Setup. None is on yet." />
      ) : b ? (
        <div className="ww-life-weekbody">
          {b.habits.map((h) => (
            <Row
              key={h.id}
              title={h.target || h.id}
              meta={`${h.done_this_week} of ${h.per_week} this week`}
              state={h.met ? 'done' : h.on_track ? 'default' : 'behind'}
              action={
                <Chip selected={h.today_done} onClick={() => void mark(h.id, !h.today_done)} grouped>
                  {h.today_done ? 'Done today' : 'Mark today'}
                </Chip>
              }
            />
          ))}
          {markError && (
            <p className="ww-life-notice" role="alert" data-tone="fault">
              {markError}
            </p>
          )}
          <p className="ww-life-focus">
            <span className="ww-kicker">Upgrade · {b.focus.name}</span>
            <span>{b.focus.text}</span>
          </p>
        </div>
      ) : null}
    </Card>
  )
}
