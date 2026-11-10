// Career > Abroad: CA5 Trials, CA6 Universities (plan 3.3, 4.7). At 1920 the two sit side by side; below
// that a two-way switch shows one at a time, because both cannot fit one canvas without a scroll.
import { useState } from 'react'
import { useGame } from '../../germoney/game/store'
import { TARGET_UNIVERSITIES, type University } from '../../germoney/data/universities'
import { TRIALS, type TrialDef } from '../../germoney/game/trials'
import { daysBetween, prettyDate } from '../../germoney/game/util'
import { Card, Chip, Segmented } from '../kit'
import { Paged } from './Paged'

const money = (amount: number, currency: 'INR' | 'EUR') => (currency === 'INR' ? `₹${amount.toLocaleString('en-IN')}` : `€${amount.toLocaleString('en-IN')}`)

function TrialLine({ t }: { t: TrialDef }) {
  const st = useGame((s) => s.g.trials[t.id])
  const today = useGame((s) => s.today)
  const setStage = useGame((s) => s.setTrialStage)
  const setDate = useGame((s) => s.setTrialDate)
  const stage = st?.stage ?? -1
  const date = st?.examDate
  const inDays = date && date >= today ? daysBetween(today, date) : null
  return (
    <div className="cr-trial" data-trial={t.id} data-passed={stage >= t.stages.length - 1 ? 'true' : undefined}>
      <span className="cr-trial-head">
        <span className="cr-clip cr-trial-name" title={t.name}>{t.name}</span>
        <Chip>{t.kind}</Chip>
        <span className="cr-cost">{t.cost ? money(t.cost.amount, t.cost.currency) : 'check the page'}</span>
      </span>
      <span className="cr-clip cr-sub" title={`${t.issuer} . ${t.when}`}>
        {t.issuer} . {t.when}
      </span>
      <span className="cr-trial-foot">
        <span className="cr-stages" role="group" aria-label={`${t.name} progress`}>
          {t.stages.map((s, i) => (
            <Chip key={s} grouped selected={i <= stage} onClick={() => setStage(t.id, i === stage ? i - 1 : i)}>
              {s}
            </Chip>
          ))}
        </span>
        <label className="cr-date">
          <span className="cr-sub">Exam or deadline</span>
          <input type="date" className="ww-input" value={date ?? ''} onChange={(e) => setDate(t.id, e.target.value)} />
        </label>
        {inDays !== null && <span className="cr-sub">in {inDays} d . {prettyDate(date!, true)}</span>}
      </span>
    </div>
  )
}

function UniLine({ u }: { u: University }) {
  return (
    <div className="cr-uni">
      <b className="cr-clip" title={u.name}>{u.name}</b>
      <span className="cr-clip cr-sub" title={`${u.program} . ${u.language}`}>
        {u.program} . {u.language}
      </span>
      <a href={u.portalUrl} target="_blank" rel="noreferrer" className="ww-tap">
        {u.portal}
      </a>
    </div>
  )
}

export function AbroadView() {
  const [pane, setPane] = useState<'trials' | 'unis'>('trials')
  const passed = useGame((s) => TRIALS.filter((t) => (s.g.trials[t.id]?.stage ?? -1) >= t.stages.length - 1).length)
  const main = TRIALS.filter((t) => !t.optional)
  const optional = TRIALS.filter((t) => t.optional)
  return (
    <div className="cr-view cr-abroad" data-view="abroad" data-pane={pane}>
      <div className="cr-pane-switch">
        <Segmented<'trials' | 'unis'> label="Abroad section" variant="compact" value={pane} onChange={setPane} options={[{ id: 'trials', label: 'Trials' }, { id: 'unis', label: 'Universities' }]} />
      </div>
      <div className="cr-pane" data-active={pane === 'trials' ? 'true' : 'false'}>
        <Card data-card="CA5" title="Trials" kicker={`${passed} of ${TRIALS.length} passed . fees change, check the official page before paying`} className="cr-fill">
          <Paged items={[...main, ...optional]} rowKey={(t) => t.id} row={(t) => <TrialLine t={t} />} label="trials" fallback={3} empty="No trials listed." />
        </Card>
      </div>
      <div className="cr-pane" data-active={pane === 'unis' ? 'true' : 'false'}>
        <Card data-card="CA6" title="Universities" kicker={`${TARGET_UNIVERSITIES.length} target programmes . check each page: languages, tuition and deadlines change`} className="cr-fill">
          <Paged items={TARGET_UNIVERSITIES} rowKey={(u) => u.name} row={(u) => <UniLine u={u} />} label="universities" fallback={6} empty="No universities listed." />
        </Card>
      </div>
    </div>
  )
}
