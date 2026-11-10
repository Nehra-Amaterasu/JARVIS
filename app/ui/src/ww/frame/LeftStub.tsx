import type { SeasonView } from './season'

/**
 * The left column until chunk 6 (plan 4.1): the four cards are not built, and this says so instead of
 * showing numbers it does not have. What IS real already is the season: the first slot is named
 * Countdown or Horizon and the second Now or Close the day from the server's one season dict, and
 * the slot keeps its height when the name changes ("reserves its space"). Chunk 6 replaces this with
 * `ww/left/*` and passes it to Frame through the `left` prop.
 */
export function LeftStub({ season }: { season: SeasonView }) {
  const first = season.left_top === 'countdown' ? 'Countdown' : 'Horizon'
  const second = season.now_card === 'close_the_day' ? 'Close the day' : 'Now'
  return (
    <div className="ww-left-stub" data-left="stub">
      <section className="ww-left-slot" data-slot="season">
        <span className="ww-kicker">{first}</span>
        <span className="ww-left-line">
          {season.known
            ? season.nearest_days === null
              ? 'No dated paper ahead.'
              : `Next paper in ${season.nearest_days} ${season.nearest_days === 1 ? 'day' : 'days'}.`
            : 'Season not read yet.'}
        </span>
      </section>
      <section className="ww-left-slot" data-slot="now">
        <span className="ww-kicker">{second}</span>
        <span className="ww-left-line">The Today column is built in chunk 6.</span>
      </section>
    </div>
  )
}
