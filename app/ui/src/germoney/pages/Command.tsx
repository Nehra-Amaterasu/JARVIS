/**
 * Mission → Command: Germoney's dashboard (index.tsx), in JARVIS.
 * Everything here is the phone app's logic: the daily directive checklist that
 * resets at midnight, Rule 1 (14 days without a commit = rank drop + Purgatory),
 * the Sunday ritual, lifetime metrics, factory reset — now with backup/restore.
 */
import { AlertTriangle, Calendar, Download, Flame, ListChecks, ShieldAlert, Upload } from 'lucide-react'
import { useRef } from 'react'
import { post, TOKEN } from '../../lib/api'
import { useStore } from '../../lib/store'
import { useGithub, useOnboarding } from '../hooks'
import { DAILY_ITEMS, SUNDAY_ITEMS, useChecklistStore } from '../stores/checklist-store'
import { LEVELS, usePlayerStore } from '../stores/player-store'
import { BurnHeatmap, CheckRow, confirmDialog, daysSince, MissionHeader, NeonBar } from '../ui'
import { Calibration } from './Calibration'

const DIRECTIVES = [
  'Lethargy is a choice. Choose differently.',
  'Your rival studied 4 hours today. You?',
  'Comfort is the enemy of progress.',
  'Pain is temporary. Mediocrity is permanent.',
  "No one cares that you're tired. Execute.",
]

export function CommandPage() {
  const [onboarding, reloadOnboarding] = useOnboarding()
  const player = usePlayerStore((s) => s.player)
  const resetProgress = usePlayerStore((s) => s.resetProgress)
  const daily = useChecklistStore((s) => s.daily)
  const weekly = useChecklistStore((s) => s.weekly)
  const toggleDaily = useChecklistStore((s) => s.toggleDaily)
  const toggleWeekly = useChecklistStore((s) => s.toggleWeekly)
  const setTab = useStore((s) => s.setTab)
  const toast = useStore((s) => s.toast)
  const { summary } = useGithub()
  const importRef = useRef<HTMLInputElement>(null)

  if (onboarding === undefined) return <div className="empty">Loading…</div>
  if (onboarding === null) return <Calibration onDone={reloadOnboarding} />

  const info = LEVELS.find((l) => l.level === player.level) ?? LEVELS[LEVELS.length - 1]
  const next = LEVELS.find((l) => l.level === player.level + 1)
  const directive = DIRECTIVES[new Date().getDay() % DIRECTIVES.length]
  const since = daysSince(player.lastCommitDate) ?? 14
  const remaining = Math.max(0, 14 - since)
  const warn = remaining <= 3
  const dailyDone = DAILY_ITEMS.filter((i) => daily[i.id]).length
  const weeklyDone = SUNDAY_ITEMS.filter((i) => weekly[i.id]).length

  const exportData = () => {
    // A plain link download: the token goes as a header via fetch, then a blob.
    void fetch('/api/germoney/export', { headers: { 'X-Jarvis-Token': TOKEN } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = `mission-germoney-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }
  const importData = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      confirmDialog('Import backup', `Replace Mission data with the ${Object.keys(data).length} record(s) in ${f.name}?`, 'Import', async () => {
        const r = await post<{ imported: number }>('/api/germoney/import', data)
        toast(`Imported ${r.imported} record(s). Reloading…`, 'live')
        window.setTimeout(() => window.location.reload(), 900)
      }, false)
    } catch {
      toast('That file is not a Mission Germoney backup.', 'fault')
    }
  }

  return (
    <div className="mission-page">
      <MissionHeader n="M1" title="Command" sub={`${onboarding.goal.label} · target WS ${onboarding.targetYear}`}
        right={<span className={`pill ${player.isPurgatoryActive ? 'fault' : 'live'}`}><i className="led" />{player.isPurgatoryActive ? 'Lockdown' : 'Nominal'}</span>} />

      <div className="cmd-grid">
        <section className="card rank-card">
          <div className="rank-top">
            <div>
              <span className="eyebrow">Rank {player.level} / 10 · {info.phase}</span>
              <div className="display rank-name">{info.rank}</div>
            </div>
            <div className="xp"><span className="dot">{player.xp}</span><span className="mono muted">XP</span></div>
          </div>
          <NeonBar progress={player.level / 10} />
          <div className="rank-next mono">{next ? `NEXT: ${next.rank} — ${next.req}` : 'ENDGAME REACHED'}</div>
          <div className="directive"><span className="eyebrow">// Command directive</span><p>{directive}</p></div>
        </section>

        <section className="card today-card">
          <div className="today-stats">
            <div><span className="dot big">{dailyDone}/{DAILY_ITEMS.length}</span><span className="eyebrow">Directives</span></div>
            <div><span className={`dot big ${since >= 11 ? 'fault' : ''}`}>{since}d</span><span className="eyebrow">Since commit</span></div>
          </div>
          <NeonBar progress={dailyDone / DAILY_ITEMS.length} tone={dailyDone === DAILY_ITEMS.length ? 'live' : 'chrome'} />
          <div className="card-head" style={{ marginTop: 16 }}><span className="card-title"><ListChecks size={14} style={{ marginRight: 8 }} />Daily directive checklist</span><span className="mono muted">resets 00:00</span></div>
          {DAILY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!daily[i.id]} onToggle={() => toggleDaily(i.id)} />)}
        </section>

        <section className="cmd-col">
          {player.isPurgatoryActive && (
            <div className="card purgatory">
              <AlertTriangle size={22} />
              <div className="display">System locked. You are in Purgatory.</div>
              <p>Complete a 3-hour Crucible to unlock. {player.purgatoryHoursRemaining}h remaining.</p>
            </div>
          )}
          <button className={`crucible-cta ${player.isPurgatoryActive ? 'fault' : ''}`} onClick={() => setTab('crucible')}>
            <Flame size={22} />
            <span className="display">{player.isPurgatoryActive ? 'Enter Purgatory (3h)' : 'Enter the Crucible'}</span>
            <span className="mono">{player.isPurgatoryActive ? 'no exits' : 'wager 50 · win 150'}</span>
          </button>
          <section className={`card ${warn ? 'warn' : ''}`}>
            <div className="card-head"><span className="card-title"><ShieldAlert size={14} style={{ marginRight: 8 }} />Rule 1 · GitHub integrity</span>
              {summary && <span className="pill live"><i className="led" />github</span>}</div>
            <div className={`dot big ${warn ? 'fault' : ''}`}>{player.lastCommitDate ? `${remaining} days left` : 'No commits logged'}</div>
            <p className="muted small">14 days without a commit drops your rank by 1 and locks you in Purgatory.
              {summary ? ` Last public push: ${summary.lastContribution ?? '—'}.` : ' Link GitHub in Proof for automatic tracking.'}</p>
          </section>
        </section>

        <section className="card"><BurnHeatmap github={summary} /></section>

        <section className="card">
          <div className="card-head"><span className="card-title"><Calendar size={14} style={{ marginRight: 8 }} />Sunday wind-down ritual</span><span className="mono muted">{weeklyDone}/{SUNDAY_ITEMS.length} · resets weekly</span></div>
          {SUNDAY_ITEMS.map((i) => <CheckRow key={i.id} label={i.label} checked={!!weekly[i.id]} onToggle={() => toggleWeekly(i.id)} />)}
        </section>

        <section className="card metrics-card">
          <span className="eyebrow">Lifetime metrics</span>
          <div className="metrics">
            {[
              { v: player.commitsCount, l: 'Commits' }, { v: player.completedQuests.length, l: 'Quests' },
              { v: `${player.staminaHours}h`, l: 'Stamina' }, { v: `${player.germanHours}h`, l: 'German' },
            ].map((m) => <div key={m.l}><span className="dot">{m.v}</span><span className="eyebrow">{m.l}</span></div>)}
          </div>
          <div className="danger-row">
            <button className="btn sm" onClick={exportData}><Download size={13} />Backup</button>
            <button className="btn sm" onClick={() => importRef.current?.click()}><Upload size={13} />Restore</button>
            <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
            <span style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => setTab('calibration')}>Recalibrate</button>
            <button className="btn sm danger" onClick={() => confirmDialog('Factory reset', 'Wipe ALL Mission progress — rank, XP, quests, logs, workouts, failures, proofs? (Daily backups in app/data/germoney/backups still exist.)', 'Wipe it', () => { resetProgress(); toast('Mission progress wiped.', 'fault') })}>Factory reset</button>
          </div>
        </section>
      </div>
    </div>
  )
}
