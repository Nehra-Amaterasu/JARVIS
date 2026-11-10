/**
 * SU18 Question harvester (plan 4.15). The card over routes_ww_harvest.py:
 *   GET  /api/mission/harvest/sources   every source with its status and licence line
 *   GET  /api/mission/harvest/queue     the queue, the switches, questions on disk
 *   POST .../pause  .../resume  .../queue  .../run
 *
 * Rules the card keeps (plan 4.15):
 *  - the harvester is OFF until the owner switches it on, and the sources with their licences are on screen
 *    BEFORE that switch; the switch is its own button that asks first (Confirm overlay), never a side effect;
 *  - a source is "on" only if the route says so (a source with no recorded licence is off, with the reason);
 *  - nothing is called fetched unless the route reports it: "questions on disk" is the route's number, and a
 *    row says "fetching" only while the route's status says so;
 *  - when the routes are absent (404, or the server is older) the card shows the registry placeholder, not an error;
 *  - Pause, Resume and Queue a topic are optimistic and roll back with a toast if the route refuses.
 * No timer: the card reads on mount and after each action, so it adds nothing to the idle frame budget.
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useStore } from '../../lib/store'
import { usePlan } from '../../germoney/game/plan'
import { EMPTY } from '../../germoney/ui'
import { Button, Chip, Field } from '../kit'
import { Planned } from '../Planned'
import { openOverlay } from '../frame/overlayRegistry'
import { SetupCard } from './forms'

export interface HarvestSource { id: string; name: string; kind: string; status: string; license: string; reason: string; terms_url: string; note: string; on_disk: number }
export interface HarvestSources {
  sources: HarvestSource[]
  not_used?: { name: string; reason: string }[]
  pdf_reader?: { available: boolean; note: string }
}
export interface HarvestItem { id: string; subject: string; topic: string; tier: string; status: string; fetched?: number; added?: number; reason?: string }
export interface HarvestQueue {
  enabled: boolean
  paused: boolean
  state: string
  queued: number
  fetching: number
  refused: number
  on_disk: number
  last_run: string | null
  items: HarvestItem[]
}

const PATH = '/api/mission/harvest'

/** What a row says about itself. "fetching" and "added" come from the route's own counters, nothing is inferred. */
export function itemLine(i: HarvestItem): string {
  if (i.status === 'refused') return `refused: ${i.reason || 'no reason given'}`
  if (i.status === 'failed') return `failed: ${i.reason || 'no reason given'}`
  if (i.status === 'fetching') return 'fetching'
  if (i.status === 'done') return `done, ${i.added ?? 0} added`
  return 'waiting'
}

export function Harvester() {
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState<HarvestQueue | null>(null)
  const [src, setSrc] = useState<HarvestSources | null>(null)
  const [absent, setAbsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const subjects = usePlan((s) => s.academics?.subjects) ?? EMPTY
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [tier, setTier] = useState('gate')

  const load = useCallback(async () => {
    const [a, b] = await Promise.allSettled([api<HarvestQueue>(`${PATH}/queue`), api<HarvestSources>(`${PATH}/sources`)])
    if (a.status === 'fulfilled') setQ(a.value)
    if (b.status === 'fulfilled') setSrc(b.value)
    setAbsent(a.status === 'rejected' && b.status === 'rejected')
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  if (loading) return <SetupCard n="SU18" anchor="harvester" title="Question harvester"><p className="su-empty">Asking the harvester.</p></SetupCard>
  if (absent || !q || !src) {
    return (
      <SetupCard n="SU18" anchor="harvester" title="Question harvester" hint="Questions from openly licensed sources, saved on this laptop.">
        <Planned id="harvester" />
        <Planned id="harvester-pdf" />
      </SetupCard>
    )
  }

  const act = async (what: 'pause' | 'resume') => {
    const before = q
    // optimistic: the button answers at once; a refusal puts the old state back
    setQ({ ...q, enabled: what === 'resume' ? true : q.enabled, paused: what === 'pause', state: what === 'pause' ? 'paused' : q.state === 'off' ? 'idle' : q.state })
    setBusy(true)
    try {
      await api(`${PATH}/${what}`, { method: 'POST', body: {} })
      await load()
    } catch (e) {
      setQ(before)
      toast((e as Error).message || `Could not ${what}.`, 'fault')
    } finally { setBusy(false) }
  }

  const queueTopic = async () => {
    if (!subject || !topic.trim()) return
    const temp: HarvestItem = { id: `tmp-${Date.now()}`, subject, topic: topic.trim(), tier, status: 'waiting' }
    const before = q
    setQ({ ...q, queued: q.queued + 1, items: [temp, ...q.items] })
    setBusy(true)
    try {
      await api(`${PATH}/queue`, { method: 'POST', body: { subject, topic: topic.trim(), tier } })
      setTopic('')
      await load()
    } catch (e) {
      setQ(before)
      toast((e as Error).message || 'Could not queue that topic.', 'fault')
    } finally { setBusy(false) }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      const r = await api<{ ran: boolean; reason?: string }>(`${PATH}/run`, { method: 'POST', body: { max_requests: 10 } })
      if (!r.ran) toast(r.reason || 'Nothing ran.', 'fault')
      await load()
    } catch (e) {
      toast((e as Error).message || 'The run did not start.', 'fault')
    } finally { setBusy(false) }
  }

  const off = !q.enabled
  const switchOn = () => openOverlay('confirm', {
    title: 'Switch the question harvester on?',
    body: 'It fetches only from the sources marked on above, one request at a time, 2 to 5 seconds apart, and keeps what it fetches on this laptop. A source with no recorded licence stays off. You can pause it any time.',
    confirmLabel: 'Switch on',
    destructive: false,
    onConfirm: () => act('resume'),
  })

  return (
    <SetupCard n="SU18" anchor="harvester" title="Question harvester" hint="Questions from openly licensed sources, saved on this laptop. Official papers and textbooks are pointers only: a link, a topic and marks, never the text."
      action={<span className="su-meta" data-harvest="disk">{`questions on disk: ${q.on_disk}`}</span>}>
      <table className="su-table" aria-label="Sources">
        <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Licence</th></tr></thead>
        <tbody>
          {src.sources.map((s) => (
            <tr key={s.id} data-source={s.id}>
              <th scope="row">
                {s.terms_url ? <a href={s.terms_url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}
                {s.reason && <span className="su-why">{s.reason}</span>}
              </th>
              <td><Chip tone={s.status === 'on' ? 'live' : s.status === 'off' || s.status === 'stopped today' ? 'fault' : 'neutral'}>{s.status}</Chip></td>
              <td>{s.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(src.not_used?.length ?? 0) > 0 && (
        <ul className="su-notused" aria-label="Sources not used">
          {src.not_used!.map((n) => <li key={n.name}>{`${n.name}: not used. ${n.reason}.`}</li>)}
        </ul>
      )}
      {src.pdf_reader && !src.pdf_reader.available && <Planned id="harvester-pdf" />}

      <div className="su-actions">
        {off
          ? <Button disabled={busy} onClick={switchOn}>Switch the harvester on</Button>
          : q.paused
            ? <Button disabled={busy} onClick={() => void act('resume')}>Resume</Button>
            : <Button disabled={busy} onClick={() => void act('pause')}>Pause</Button>}
        <Button disabled={busy} disabledReason={off ? 'The harvester is off. Switch it on first.' : q.paused ? 'Paused. Resume first.' : undefined} onClick={() => void runNow()}>Fetch now</Button>
        <span className="su-meta" data-harvest="state">{`${q.state}${q.last_run ? `, last run ${q.last_run.slice(0, 10)}` : ''}`}</span>
      </div>

      <h3 className="su-sub">{`Queue (${q.items.length})`}</h3>
      {q.items.length === 0
        ? <p className="su-empty">The queue is empty. Queue a topic below; it waits until the harvester is on.</p>
        : (
          <ul className="su-queue" aria-label="Queue">
            {q.items.map((i) => (
              <li key={i.id} data-queue-status={i.status}>
                <span>{`${i.subject} / ${i.topic}`}</span>
                <span className="su-queue-state">{itemLine(i)}</span>
              </li>
            ))}
          </ul>
        )}

      <div className="su-row-fields" role="group" aria-label="Queue a topic">
        <Field label="Subject" kind="select" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">choose a subject</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Field>
        <Field label="Topic" value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} />
        <Field label="Tier" kind="select" value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="exam">Exam</option><option value="gate">GATE</option>
        </Field>
        <Button disabled={busy} disabledReason={!subject || !topic.trim() ? 'Choose a subject and type a topic.' : undefined} onClick={() => void queueTopic()}>Queue a topic</Button>
      </div>
      {off && <p className="su-hint">Queued topics wait. Nothing is fetched while the harvester is off.</p>}
    </SetupCard>
  )
}
