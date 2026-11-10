/**
 * L2: Now, or Close the day in the evening (plan 4.1). Now OWNS "what next": its sentence is step 1 of
 * the director and nothing else in the column decides it. Start takes the page's one saffron fill unless
 * a workspace or an overlay claims it (PrimaryOwner, rank "now").
 *
 *  - Start goes to the workspace the step belongs to (a study step to Study, a habit to Life, a build
 *    step to Focus). It does not start a timer: the timer lives in Focus (chunk 10).
 *  - +25 / +50 / +90 post minutes through usePlan.log. The line "Logged today" moves at once and is taken
 *    back, with a toast saying so, if the server refuses.
 *  - Other opens the Log-minutes sheet (O6), a stub until chunk 12.
 *  - Close the day: there is no "day closed" event in the plan log yet (plan 3.3 marks it as an
 *    assumption), so its fill is "See tomorrow" and the card says what stays: not done is kept, not lost.
 */
import { memo, useCallback } from 'react'
import { Button, Card, Fold, PrimaryButton, Section } from '../kit'
import { usePlan } from '../../germoney/game/plan'
import { useStore } from '../../lib/store'
import { switchWorkspace } from '../frame/navigate'
import { openOverlay } from '../frame/overlayRegistry'
import type { WsId } from '../frame/workspaces'
import { useDay } from './hooks'
import { buildL2, type RawNow } from './model'
import { bump } from './renders'
import { useLeft } from './store'

const WHERE: Record<RawNow['kind'], WsId> = { study: 'study', recall: 'study', habit: 'life', build: 'focus' }

export const L2Card = memo(function L2Card({ nowCard }: { nowCard: 'now' | 'close_the_day' }) {
  bump('L2')
  const now = useLeft((s) => s.now)
  const phase = useLeft((s) => s.phase.director)
  const day = useDay()
  const m = buildL2({ season: { left_top: 'horizon', now_card: nowCard }, now, day })
  const close = m.variant === 'close'

  const logMinutes = useCallback(async (minutes: number) => {
    const left = useLeft.getState()
    left.addPending(minutes)
    const toast = useStore.getState().toast
    try {
      const plan = usePlan.getState()
      const track = now?.kind === 'habit' ? 'body' : plan.today?.track || 'silicon'
      const r = await plan.log({ minutes, track, note: now?.title ?? '' })
      toast(r.say, r.ok ? 'live' : 'fault')
    } catch {
      toast('Could not log that. Nothing changed.', 'fault')
    } finally {
      left.addPending(-minutes)
    }
  }, [now])

  const waiting = !close && now === null && phase === 'loading'
  return (
    <Section id="L2" hint="The one next step, Start, and minutes; in the evening, Close the day" primary className="ww-left-sec">
      <Card
        data-card="L2"
        title={m.title}
        loading={waiting}
        error={!close && now === null && phase === 'error' ? 'Could not read the day.' : undefined}
        onRetry={() => void useLeft.getState().loadSlice('director')}
        className="ww-l2"
      >
        {m.welcome && <p className="ww-left-note" data-welcome="">{m.welcome}</p>}
        <p className="ww-left-head">{m.sentence}</p>
        {m.meta && <p className="ww-left-meta">{m.meta}</p>}
        {m.logged && <p className="ww-left-meta" aria-live="polite">{m.logged}</p>}
        {close ? (
          <>
            {m.kept && <p className="ww-left-meta">{m.kept}</p>}
            <p className="ww-left-meta">{m.tomorrow ? `Tomorrow first: ${m.tomorrow}` : 'Tomorrow has no block planned yet.'}</p>
            <div className="ww-left-actions">
              <PrimaryButton claimId="now-start" rank="now" onClick={() => void switchWorkspace('study', 'plan')}>
                See tomorrow
              </PrimaryButton>
              <Button size="sm" onClick={() => openOverlay('log')}>Log minutes</Button>
            </div>
          </>
        ) : (
          <>
            {m.kind && (
              <PrimaryButton claimId="now-start" rank="now" onClick={() => void switchWorkspace(WHERE[m.kind!])}>
                Start
              </PrimaryButton>
            )}
            <div className="ww-left-presets" role="group" aria-label="Log minutes">
              {m.presets.map((p) => (
                <Button key={p} grouped size="sm" onClick={() => void logMinutes(p)} aria-label={`Log ${p} minutes`}>
                  +{p}
                </Button>
              ))}
              <Button grouped size="sm" onClick={() => openOverlay('log')}>Other</Button>
            </div>
            {m.why && (
              <Fold title="Why this?">
                <p className="ww-left-meta" data-why="">{m.why}</p>
              </Fold>
            )}
          </>
        )}
      </Card>
    </Section>
  )
})
