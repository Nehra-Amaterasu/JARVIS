/**
 * The ten cards of the Proof panel (plan 4.10, section 3.3 R): P1 Rank, P2 The System suggests, P3 Stats,
 * P4 Quest lines, P5 Weekly review, P6 Building hours, P7 Proof of work, P8 Wins, P9 Recent, P10 What got in
 * the way. Each takes its slot from useProofData; none invents a number: an empty answer is said in words.
 *
 * Wording rules kept here: nothing counts what he did not log as a miss, no streak is shown (a loss-framed
 * counter, plan question 7), and a number that is a guess says so (building hours are estimated from commit times).
 */
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useFailureStore, FAILURE_CATEGORIES, type FailureCategory } from '../../germoney/stores/failure-store'
import { Banner, Button, Card, COUNTED, EmptyState, Field, Fold, Meter, PrimaryButton, Segmented, Spark, Stat } from '../kit'
import { switchWorkspace } from '../frame/navigate'
import { openOverlay } from '../frame/overlayRegistry'
import { useFrame } from '../frame/frameStore'
import type { ProofData, Slot } from './proofData'
import { STAT_NEXT, dayLabel, minutesLabel, sourceLine } from './proofData'
import type { ProofMode } from '../frame/density'

export interface CardCtx {
  data: ProofData
  mode: ProofMode
  reload: (keys?: (keyof ProofData)[]) => void
  /** Scroll to and focus another card of the panel (a suggestion whose place is inside the panel). */
  showCard: (id: string) => void
}

/** The Card props every slot-backed card shares: a skeleton while loading, a message and Retry on failure. */
function slotProps<T>(slot: Slot<T>, retry: () => void) {
  return { loading: slot.state === 'loading', error: slot.state === 'error' && !slot.data ? `${slot.error ?? 'The server did not answer.'}` : undefined, onRetry: retry }
}

/** The shown-data-is-old line, when a reload failed but the last answer is still there. */
function Stale({ slot }: { slot: Slot<unknown> }) {
  if (slot.state !== 'error' || !slot.data) return null
  return <Banner tone="sim">Could not refresh. Showing the last answer ({slot.error}).</Banner>
}

// ---------------------------------------------------------------- P1 Rank
export function RankCard({ data, reload }: CardCtx) {
  const { status, v2 } = data
  const retry = () => reload(['status', 'v2'])
  const st = status.data
  const rk = v2.data?.rank
  const lv = st?.level
  const loading = status.state === 'loading' || v2.state === 'loading'
  const failed = (status.state === 'error' && !st) || (v2.state === 'error' && !rk)
  return (
    <Card data-card="P1" level={3} title="Rank" kicker="Is it working?" loading={loading} error={failed ? (status.error ?? v2.error ?? 'The server did not answer.') : undefined} onRetry={retry}>
      {st && rk && lv && (
        <div className="ww-proof-stack">
          <div className="ww-proof-rank">
            <span className="ww-proof-letter" role="img" aria-label={`Rank ${st.rank.rank}`}>
              {st.rank.rank}
            </span>
            <div className="ww-proof-level">
              <span className="ww-proof-line">
                Level {lv.level} · {lv.into}/{lv.need} XP to {lv.level + 1}
              </span>
              <Meter value={lv.need ? lv.into / lv.need : 0} label={`Level ${lv.level} progress`} reading={COUNTED} />
            </div>
          </div>
          <p className="ww-proof-line" data-rank-head="">
            {rk.top ? `Top rank. All ${rk.of} requirements:` : `Rank ${rk.target} needs ${rk.of} things; ${rk.met} met.`}
          </p>
          <ul className="ww-proof-reqs" aria-label={`Requirements for rank ${rk.target}`}>
            {rk.requirements.map((r) => (
              <li key={r.req} className="ww-proof-req" data-met={r.met ? 'true' : 'false'} data-req={r.req}>
                <span className="ww-proof-reqword">{r.met ? 'Met' : 'Open'}</span>
                <span className="ww-proof-reqname">{r.name}</span>
                <span className="ww-proof-reqnum">
                  {r.have}/{r.need}
                </span>
                <Meter value={r.need ? Math.min(1, r.have / r.need) : 1} label={`${r.name}: ${r.have} of ${r.need}`} reading={COUNTED} />
              </li>
            ))}
          </ul>
          <p className="ww-proof-note">A rank needs proof. XP raises the level, never the rank.</p>
          <Fold title={`Not counted (${st.not_counted.xp_from_games + st.not_counted.xp_carried_over} XP)`}>
            <p className="ww-proof-note">{st.not_counted.explain}</p>
            <p className="ww-proof-note">
              {st.not_counted.xp_from_games} XP from games · {st.not_counted.xp_carried_over} XP carried over
              {st.not_counted.nodes_claimed.length > 0 && ` · marked mastered without a contract: ${st.not_counted.nodes_claimed.join(', ')}`}
            </p>
          </Fold>
          <Stale slot={status} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P2 The System suggests
export function SuggestCard({ data, reload, mode, showCard }: CardCtx) {
  const slot = data.v2
  const v = slot.data
  const go = (g: NonNullable<ProofData['v2']['data']>['suggestions'][number]['go']) => {
    if (!g) return
    if (g.card) return showCard(g.card)
    if (g.ws) {
      if (mode !== 'pinned') useFrame.getState().setProof(false)
      void switchWorkspace(g.ws, g.view ?? null)
    }
  }
  return (
    <Card data-card="P2" level={3} title="The System suggests" {...slotProps(slot, () => reload(['v2']))}>
      {v && (
        <div className="ww-proof-stack">
          {v.suggestions.length === 0 ? (
            <EmptyState title="Nothing to suggest today" body="The rules found nothing to point at in your logged work." />
          ) : (
            <ol className="ww-proof-list" aria-label="Suggestions">
              {v.suggestions.map((s) => (
                <li key={s.text} className="ww-proof-sugg" data-suggestion={s.id ?? 'other'}>
                  <p className="ww-proof-text">{s.text}</p>
                  {s.go && (
                    <Button size="sm" onClick={() => go(s.go)}>
                      {s.go.label}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="ww-proof-note">Suggestions only. Nothing changes until you act on one. Each line comes from a rule over your logged work.</p>
          <Fold title={`Advice with sources (${v.advice.length})`}>
            {v.advice.length === 0 ? (
              <p className="ww-proof-note">No sourced advice file is readable, so nothing is shown rather than an unsourced line.</p>
            ) : (
              <ul className="ww-proof-list" aria-label="Advice with sources">
                {v.advice.map((a) => (
                  <li key={a.id} className="ww-proof-advice" data-advice={a.id}>
                    <p className="ww-proof-text">{a.text}</p>
                    <p className="ww-proof-source" data-source="">
                      Source: {sourceLine(a.source)}
                    </p>
                    <p className="ww-proof-note">
                      Strength: {a.strength} ({a.strength_note}). Limit: {a.limit}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Fold>
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P3 Stats
export function StatsCard({ data, reload }: CardCtx) {
  const { status, v2 } = data
  const stats = status.data?.stats
  const retry = () => reload(['status', 'v2'])
  return (
    <Card data-card="P3" level={3} title="Stats" kicker={status.data ? `from logged work, ${status.data.date}` : undefined} {...slotProps(status, retry)}>
      {stats && (
        <div className="ww-proof-stack">
          <div className="ww-proof-tiles">
            {stats.map((s) => (
              <Stat key={s.id} label={s.name} value={s.value} unit={s.unit} next={STAT_NEXT[s.id]} reading={COUNTED} />
            ))}
          </div>
          <Fold title="How these are counted">
            <ul className="ww-proof-list">
              {stats.map((s) => (
                <li key={s.id} className="ww-proof-note">
                  <b>{s.name}.</b> {s.explain}
                </li>
              ))}
            </ul>
          </Fold>
          <CounterWeeks v2={v2} />
          <Stale slot={status} />
        </div>
      )}
    </Card>
  )
}

/** "3 of 7 judged days on the fullest counter": how far the first consistency number still is. */
function fullest(rows: { asked: number; need: number }[]): string {
  if (rows.length === 0) return 'no counters are set up'
  const best = rows.reduce((a, r) => (r.asked > a.asked ? r : a), rows[0])
  return `${best.asked} of ${best.asked + best.need} judged days on the fullest counter`
}

/** The 4-week slot. A week with no logged day is left out (never a 0), and the card says how many weeks exist. */
export function CounterWeeks({ v2 }: { v2: Slot<NonNullable<ProofData['v2']['data']>> }) {
  const v = v2.data
  if (v2.state === 'loading') return null
  if (!v) return <p className="ww-proof-note">The 4-week lines are not available: {v2.error}</p>
  const c = v.consistency
  return (
    <section className="ww-proof-weeks" aria-label="Life counters, last 4 weeks" data-slot="four-weeks">
      <h4 className="ww-proof-sub">Life counters, last 4 weeks</h4>
      <ul className="ww-proof-list">
        {v.series.slice(0, 8).map((s) => {
          const latest = s.points.length ? s.points[s.points.length - 1] : null
          return (
            <li key={s.id} className="ww-proof-counter" data-counter={s.id} data-weeks={s.weeks_with_data}>
              <span className="ww-proof-cname">{s.name}</span>
              {s.enough_for_line ? <Spark points={s.points} label={`${s.name}, ${s.weeks_with_data} weeks`} /> : null}
              <span className="ww-proof-cnote">
                {s.weeks_with_data === 0
                  ? 'No days logged yet'
                  : s.enough_for_line
                    ? `${s.weeks_with_data} of 4 weeks logged · latest ${latest} a day`
                    : `1 of 4 weeks logged (${latest} a day), too few for a line`}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="ww-proof-line" data-consistency="">
        {c.ratio === null
          ? `Counters on their line: not enough days yet (${fullest(c.counters)}).`
          : `Counters on their line: ${c.hit} of ${c.asked} judged days (${Math.round(c.ratio * 100)} %).`}
      </p>
      <p className="ww-proof-note">{v.weeks_note} {c.rule}</p>
    </section>
  )
}

// ---------------------------------------------------------------- P4 Quest lines
export function QuestsCard({ data, reload }: CardCtx) {
  const slot = data.status
  const [err, setErr] = useState<string | null>(null)
  const toggle = async (id: string, on: boolean) => {
    setErr(null)
    try {
      await api(`/api/mission/quest/${id}`, { method: 'PUT', body: { on } })
    } catch (e) {
      setErr((e as Error).message)
    }
    reload(['status', 'v2'])
  }
  const domains = slot.data?.domains
  return (
    <Card data-card="P4" level={3} title="Quest lines" kicker="optional" {...slotProps(slot, () => reload(['status']))}>
      {domains && (
        <div className="ww-proof-stack">
          <ul className="ww-proof-list" aria-label="Quest lines">
            {domains.map((d) => (
              <li key={d.id} className="ww-proof-quest" data-quest={d.id} data-state={d.status}>
                <div className="ww-proof-qhead">
                  <b className="ww-proof-qname">{d.name}</b>
                  <span className="ww-proof-qstate">{d.status === 'planned' ? 'Not built' : d.status === 'on' ? 'On' : 'Off'}</span>
                  {d.status !== 'planned' && (
                    <Button size="sm" onClick={() => void toggle(d.id, d.status !== 'on')}>
                      {d.status === 'on' ? 'Turn off' : 'Turn on'}
                    </Button>
                  )}
                </div>
                {d.status === 'planned' && d.why && <p className="ww-proof-note">{d.why}</p>}
                {d.status === 'on' && d.tracks && d.tracks.length > 0 && (
                  <ul className="ww-proof-tracks">
                    {d.tracks.map((t) => (
                      <li key={t.id} className="ww-proof-note">
                        {t.name}: level {t.level}/{t.max_level}, {t.level_name}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {err && <Banner tone="fault">{err}</Banner>}
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P5 Weekly review
export function WeeklyCard({ data, reload, mode }: CardCtx) {
  const slot = data.weekly
  const w = slot.data
  const st = data.status.data
  const [open, setOpen] = useState(false)
  const consistency = st?.stats.find((s) => s.id === 'consistency')
  const ready = !!w && w.status === 'ok'
  return (
    <Card data-card="P5" level={3} title="Weekly review" kicker={w ? `${dayLabel(w.week.start)} to ${dayLabel(w.week.end)}` : undefined} {...slotProps(slot, () => reload(['weekly']))}>
      {w && (
        <div className="ww-proof-stack">
          <p className="ww-proof-text" data-review="totals">
            {w.totals}
          </p>
          <p className="ww-proof-text" data-review="change">
            {w.change.text}
          </p>
          <p className="ww-proof-line" data-review="month">
            Month: {consistency ? `${consistency.value} of 30 days had a logged action.` : 'not measured yet.'}
          </p>
          <PrimaryButton claimId="proof-review" rank="overlay" when={mode !== 'pinned' && ready} size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Close review' : 'Open review'}
          </PrimaryButton>
          {open && (
            <div className="ww-proof-review" data-review="open">
              <h4 className="ww-proof-sub">Moved</h4>
              {w.moved.length ? (
                <ul className="ww-proof-list">
                  {w.moved.map((m) => (
                    <li key={m} className="ww-proof-note">
                      {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ww-proof-note">Nothing moved up against last week.</p>
              )}
              <h4 className="ww-proof-sub">Quiet</h4>
              {w.stalled.length ? (
                <ul className="ww-proof-list">
                  {w.stalled.map((m) => (
                    <li key={m} className="ww-proof-note">
                      {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ww-proof-note">Nothing went quiet.</p>
              )}
            </div>
          )}
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P6 Building hours
export function BuildingCard({ data, reload }: CardCtx) {
  const slot = data.sessions
  const s = slot.data
  const areas = s ? Object.entries(s.week_areas).slice(0, 3) : []
  const none = !!s && s.today_minutes === 0 && s.week_minutes === 0
  return (
    <Card data-card="P6" level={3} title="Building hours" kicker="estimated from commit times" {...slotProps(slot, () => reload(['sessions']))}>
      {s && (
        <div className="ww-proof-stack">
          {none ? (
            <EmptyState title="No building hours yet" body={s.say} />
          ) : (
            <>
              <div className="ww-proof-tiles">
                <Stat label="Today" value={s.today_minutes} unit="min" reading={COUNTED} />
                <Stat label="This week" value={Math.round((s.week_minutes / 60) * 10) / 10} unit="h" reading={COUNTED} />
              </div>
              {areas.length > 0 && (
                <p className="ww-proof-line" data-areas="">
                  Most time: {areas.map(([a, m]) => `${a} ${minutesLabel(m)}`).join(', ')}
                </p>
              )}
            </>
          )}
          <Fold title="How this is estimated">
            <p className="ww-proof-note">{s.model.explain}</p>
          </Fold>
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P7 Proof of work
export function GithubCard({ data, reload }: CardCtx) {
  const slot = data.github
  const g = slot.data
  return (
    <Card data-card="P7" level={3} title="Proof of work" kicker="public GitHub activity" {...slotProps(slot, () => reload(['github']))}>
      {g && (
        <div className="ww-proof-stack">
          {!g.configured ? (
            <EmptyState title="No GitHub name yet" body={g.say} />
          ) : (
            <>
              <p className="ww-proof-text" data-github="count">
                {g.active_last_30} of the last 30 days had public activity{g.today_done ? ', today included.' : '.'}
              </p>
              {g.suggestion && !g.today_done && <p className="ww-proof-note">{g.suggestion.text}</p>}
              <p className="ww-proof-note">
                @{g.user}
                {g.fetched ? ` · fetched ${g.fetched}` : ''} · public events only, about the last 90 days.
              </p>
              {g.error && <Banner tone="sim">GitHub did not answer ({g.error}). Showing what was cached.</Banner>}
            </>
          )}
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P8 Wins
export function WinsCard({ data, reload, mode }: CardCtx) {
  const slot = data.v2
  const wins = slot.data?.wins
  const record = () => {
    if (mode !== 'pinned') useFrame.getState().setProof(false)
    openOverlay('record')
  }
  return (
    <Card data-card="P8" level={3} title="Wins" kicker="shipped, certified, levelled up" action={<Button size="sm" onClick={record}>Open record</Button>} {...slotProps(slot, () => reload(['v2']))}>
      {wins && (
        <div className="ww-proof-stack">
          {wins.length === 0 ? (
            <EmptyState title="No wins on record yet" body="Something shipped with a link, a certificate, a level up or a node mastered appears here when it happens." />
          ) : (
            <ul className="ww-proof-list" aria-label="Wins">
              {wins.map((w) => (
                <li key={`${w.date}-${w.kind}-${w.label}`} className="ww-proof-win" data-win={w.kind}>
                  <span className="ww-proof-wdate">{dayLabel(w.date)}</span>
                  <span className="ww-proof-wwhat">{w.what}</span>
                  <span className="ww-proof-wlabel">{w.label}{w.link ? ' · with a link' : ''}</span>
                </li>
              ))}
            </ul>
          )}
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P9 Recent
export function RecentCard({ data, reload }: CardCtx) {
  const slot = data.v2
  const days = slot.data?.recent
  return (
    <Card data-card="P9" level={3} title="Recent" kicker="by day, newest first" {...slotProps(slot, () => reload(['v2']))}>
      {days && (
        <div className="ww-proof-stack">
          {days.length === 0 ? (
            <EmptyState title="Nothing logged in the last 14 days" body="Finished contracts, logged minutes and shipped work show here, grouped by day." />
          ) : (
            days.map((d, i) => (
              <Fold key={d.date} title={`${dayLabel(d.date)} · ${d.count} ${d.count === 1 ? 'entry' : 'entries'} · ${d.xp} XP${d.minutes ? ` · ${minutesLabel(d.minutes)}` : ''}`} defaultOpen={i === 0}>
                <ul className="ww-proof-list" data-day={d.date}>
                  {d.rows.map((r, j) => (
                    <li key={`${r.kind}-${j}`} className="ww-proof-recent" data-kind={r.kind}>
                      <span className="ww-proof-rlabel">{r.label || r.kind}</span>
                      <span className="ww-proof-rmeta">
                        +{r.xp} XP{r.minutes ? ` · ${r.minutes} min` : ''}{r.link ? ' · link' : ''}
                      </span>
                    </li>
                  ))}
                  {d.more > 0 && <li className="ww-proof-note">and {d.more} more with XP</li>}
                  {d.zero_xp.count > 0 && (
                    <li className="ww-proof-note" data-zero="">
                      {d.zero_xp.count} with no XP ({d.zero_xp.kinds.join(', ')}){d.zero_xp.minutes ? `, ${d.zero_xp.minutes} min` : ''}
                    </li>
                  )}
                </ul>
              </Fold>
            ))
          )}
          <Stale slot={slot} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- P10 What got in the way
const ENERGY = ['1', '2', '3', '4', '5'].map((n) => ({ id: n, label: n }))
export function WayCard(_: CardCtx) {
  const entries = useFailureStore((s) => s.entries)
  const add = useFailureStore((s) => s.addEntry)
  const [what, setWhat] = useState('')
  const [energy, setEnergy] = useState('3')
  const [cause, setCause] = useState<FailureCategory>('planning')
  const [saved, setSaved] = useState(false)
  const pattern = useMemo(() => useFailureStore.getState().getPatterns(), [entries])
  const submit = () => {
    if (!what.trim()) return
    add({ whatHappened: what, energy: Number(energy), category: cause })
    setWhat('')
    setSaved(true)
  }
  return (
    <Card data-card="P10" level={3} title="What got in the way" kicker="kept on this device">
      <div className="ww-proof-stack">
        <Field
          label="What happened"
          kind="area"
          maxLength={280}
          value={what}
          onChange={(e) => {
            setWhat(e.target.value)
            setSaved(false)
          }}
          hint="Be specific. It is information, not a verdict."
        />
        <Segmented label="Energy, 1 to 5" options={ENERGY} value={energy} onChange={setEnergy} variant="compact" />
        <Field label="Root cause" kind="select" value={cause} onChange={(e) => setCause(e.target.value as FailureCategory)}>
          {FAILURE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Field>
        <Button size="sm" disabledReason={what.trim() ? undefined : 'Write what happened first'} onClick={submit}>
          Save
        </Button>
        {saved && (
          <p className="ww-proof-note" role="status">
            Saved on this device.
          </p>
        )}
        {entries.length === 0 ? (
          <p className="ww-proof-note">Nothing logged yet.</p>
        ) : (
          <>
            <p className="ww-proof-line" data-way="pattern">
              {pattern.totalFailures} logged · most common cause: {pattern.topCategory ?? 'none yet'}
              {pattern.avgEnergy ? ` · average energy ${pattern.avgEnergy}` : ''}
            </p>
            <ul className="ww-proof-list" aria-label="Recent entries">
              {entries.slice(0, 3).map((e) => (
                <li key={e.id} className="ww-proof-note">
                  {new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {e.category} · energy {e.energy}: {e.whatHappened.slice(0, 90)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  )
}
