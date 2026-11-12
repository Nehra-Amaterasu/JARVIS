// O4 Record (plan 4.12, 3.3 O4): the old Career "Record", Achievements and Season One as one overlay.
// It declares no primary ("none, close only"): everything here is read, there is nothing to press but the drawer's Close.
//
// The numbers come from the Mission game record kept on THIS device (germoney/game/store, the same source the old
// Career page drew them from), not from the server, and the overlay says so. Attributes are percentages of the
// targets he set, over the last 28 days; where there is no ledger yet every row says "not measured yet" and
// nothing is drawn as 0.
import { useMemo } from 'react'
import { ACHIEVEMENTS } from '../../germoney/game/achievements'
import { BOSSES } from '../../germoney/game/campaign'
import * as E from '../../germoney/game/engine'
import { useGame } from '../../germoney/game/store'
import { prettyDate } from '../../germoney/game/util'
import { registerOverlay } from '../frame/overlayRegistry'
import { COUNTED, Fold, Meter, Stat } from '../kit'
import './record.css'

const ATTRS: [keyof ReturnType<typeof E.attributes>, string][] = [
  ['SIL', 'Silicon hours against your target'],
  ['DEU', 'German hours against your target'],
  ['VIT', 'Training days against your target'],
  ['CAP', 'Career and paperwork actions'],
  ['WIL', 'Days the plan was kept'],
]

export function RecordBody() {
  const g = useGame((s) => s.g)
  const today = useGame((s) => s.today)
  const attrs = useMemo(() => E.attributes(g, today), [g, today])
  const inv = useMemo(() => E.investment(g), [g])
  const got = g.achievements
  const gotCount = Object.keys(got).length
  const won = BOSSES.filter((b) => g.bosses[b.id]?.defeatedAt)
  const contracts = g.ledger.filter((e) => e.kind === 'contract').length
  const noLedger = g.ledger.length === 0
  return (
    <div className="ww-record" data-overlay="record" data-primary-none="">
      <p className="ww-record-lead">Kept on this device, from the Mission game record. Nothing here is sent anywhere.</p>

      <section className="ww-record-block" data-record="attributes" aria-labelledby="ww-record-attrs">
        <h3 id="ww-record-attrs" className="ww-kicker">
          The last 28 days
        </h3>
        {noLedger ? (
          <p className="ww-record-line">Not measured yet: nothing is in the ledger.</p>
        ) : (
          <ul className="ww-record-rows">
            {ATTRS.map(([k, label]) => (
              <li key={k} className="ww-record-row" data-attr={k}>
                <span className="ww-record-key">{k}</span>
                <span className="ww-record-label">{label}</span>
                <span className="ww-record-num">{attrs[k]} %</span>
                <Meter value={attrs[k] / 100} label={`${label}: ${attrs[k]} percent`} reading={COUNTED} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ww-record-block" data-record="invested" aria-labelledby="ww-record-inv">
        <h3 id="ww-record-inv" className="ww-kicker">
          Invested so far
        </h3>
        <div className="ww-record-tiles">
          <Stat label="Hours" value={inv.hours} unit="h" next="log your first hour" reading={COUNTED} />
          <Stat label="Contracts" value={inv.contracts} next="finish one contract" reading={COUNTED} />
          <Stat label="Days secured" value={inv.days} next="secure the floor today" reading={COUNTED} />
          <Stat label="Drill cards" value={inv.cards} next="review one card" reading={COUNTED} />
        </div>
      </section>

      <section className="ww-record-block" data-record="achievements" aria-labelledby="ww-record-ach">
        <h3 id="ww-record-ach" className="ww-kicker">
          Achievements · {gotCount} of {ACHIEVEMENTS.length}
        </h3>
        <ul className="ww-record-rows">
          {ACHIEVEMENTS.map((a) => (
            <li key={a.id} className="ww-record-ach" data-ach={a.id} data-got={got[a.id] ? 'true' : 'false'}>
              <span className="ww-record-label">
                <b>{a.name}</b> {a.desc}
              </span>
              <span className="ww-record-num">{got[a.id] ? `Earned ${prettyDate(got[a.id], true)}` : 'Not yet'}</span>
            </li>
          ))}
        </ul>
      </section>

      <Fold title="Season One record">
        <p className="ww-record-line">
          {won.length ? `Defeated: ${won.map((b) => `${b.name} (${prettyDate(g.bosses[b.id].defeatedAt!)})`).join(', ')}.` : 'No bosses defeated in the old season.'} {contracts} contracts in the ledger.
        </p>
        <p className="ww-record-line">Bosses were replaced by campaigns built from the skill tree. Their deliverables are projects on tree nodes now.</p>
      </Fold>
    </div>
  )
}

// Registered on import. The Frame's flag branch imports this module (germoney/MissionRoot.tsx), so with the
// flag off the Record code is never downloaded.
registerOverlay('record', RecordBody as never)
