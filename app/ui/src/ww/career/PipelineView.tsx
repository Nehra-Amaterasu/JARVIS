// Career > Pipeline: CA1 Up next, CA2 Pipeline, CA3 Campaigns (plan 3.3, 4.7).
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePlan, type Application, type Campaign } from '../../germoney/game/plan'
import { useStore } from '../../lib/store'
import { Button, Card, Drawer, Field, PrimaryButton, Row } from '../kit'
import { switchWorkspace } from '../frame/navigate'
import { Paged } from './Paged'
import { STAGE_WORD, STEPPER, dueNowCount, inDays, nextStep, pipelineRows, stageIndex, type Due } from './model'
import { useDeadlines } from './useDeadlines'

/** The stage stepper: five steps, the current one marked by a word and a glyph, never by colour alone. */
export function Stepper({ status, org }: { status: Application['status']; org: string }) {
  const at = stageIndex(status)
  if (at === null) return <span className="cr-stepper-end" data-stage={status}>{STAGE_WORD[status]}</span>
  return (
    <ol className="cr-stepper" aria-label={`${org}: ${STAGE_WORD[status]}, step ${at + 1} of ${STEPPER.length}`} data-stage={status}>
      {STEPPER.map((s, i) => (
        <li key={s} className="cr-step" data-state={i < at ? 'done' : i === at ? 'current' : 'todo'} aria-current={i === at ? 'step' : undefined} title={STAGE_WORD[s]}>
          <span aria-hidden="true">{i < at ? '✓' : i === at ? '●' : '○'}</span>
          <span className="cr-step-word">{STAGE_WORD[s]}</span>
        </li>
      ))}
    </ol>
  )
}

/** What "Do next step" does for the soonest deadline. Returns the words for the toast. */
export async function doNextStep(top: Due, apps: Application[], api: { setTask: (t: { id: string; done: boolean }) => Promise<void>; setStatus: (id: string, s: Application['status']) => Promise<void> }, open: (url: string) => void): Promise<string> {
  if (top.kind === 'task') {
    await api.setTask({ id: top.ref, done: true })
    return `Ticked off: ${top.what}.`
  }
  if (top.kind === 'trial') {
    await switchWorkspace('career', 'abroad')
    return `${top.what}: set its stage on Abroad.`
  }
  const a = apps.find((x) => x.id === top.ref)
  if (!a) return 'That application is gone.'
  const n = nextStep(a)
  if (n.kind === 'prep' && n.prepId) {
    await api.setTask({ id: n.prepId, done: true })
    return `Ticked off: ${n.text}.`
  }
  if (n.kind === 'decide') {
    await api.setStatus(a.id, 'preparing')
    return `${a.org}: moved to Preparing.`
  }
  if (n.kind === 'submit') {
    if (a.url) {
      open(a.url)
      return `${a.org}: opened its page. Mark it Applied when it is sent.`
    }
    await api.setStatus(a.id, 'applied')
    return `${a.org}: marked Applied.`
  }
  return `${a.org}: ${n.text}.`
}

function UpNext({ due, apps }: { due: Due[]; apps: Application[] }) {
  const toast = useStore((s) => s.toast)
  const setTask = usePlan((s) => s.setTask)
  const setStatus = usePlan((s) => s.setAppStatus)
  const [top, ...rest] = due
  const nowCount = dueNowCount(due)
  const go = async () => {
    if (!top) return
    toast(await doNextStep(top, apps, { setTask: (t) => setTask(t), setStatus }, (u) => void window.open(u, '_blank', 'noopener')), 'live')
  }
  const shown = [top, ...rest.slice(0, 1)].filter(Boolean) as Due[]
  return (
    <Card
      data-card="CA1"
      title="Up next"
      kicker={due.length ? `next deadline in ${inDays(top.days)} . ${nowCount} due now` : 'no dated deadline'}
      action={
        <PrimaryButton claimId="career-next" rank="workspace" when={!!top} size="md" onClick={() => void go()} disabledReason={top ? undefined : 'No dated deadline'}>
          Do next step
        </PrimaryButton>
      }
    >
      {shown.length === 0 ? (
        <p className="cr-none">No dated deadline ahead. Add an application with its closing date, or set an exam date on Abroad.</p>
      ) : (
        <div className="cr-up">
          {shown.map((d) => (
            <Row
              key={d.id}
              lead={<b className="cr-days">{inDays(d.days)}</b>}
              title={d.what}
              meta={
                <>
                  {d.sub}
                  {' . '}confidence: {d.confidence}
                </>
              }
              state={d.days <= 14 ? 'behind' : 'default'}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

const BLANK = { org: '', programme: '', closes: '', url: '' }

function AddApplication({ open, onClose }: { open: boolean; onClose: () => void }) {
  const upsert = usePlan((s) => s.upsertApp)
  const [d, setD] = useState(BLANK)
  const save = () => {
    void upsert({ id: `${d.org}-${d.programme}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60), org: d.org.trim(), programme: d.programme.trim(), closes: d.closes || null, url: d.url.trim(), status: 'idea' })
    setD(BLANK)
    onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title="Add an application">
      <div className="cr-form">
        <Field label="Organisation" value={d.org} onChange={(e) => setD({ ...d, org: e.target.value })} />
        <Field label="Programme" value={d.programme} onChange={(e) => setD({ ...d, programme: e.target.value })} />
        <Field label="Closes" kind="date" value={d.closes} onChange={(e) => setD({ ...d, closes: e.target.value })} hint="Leave empty if there is no date yet." />
        <Field label="Link" placeholder="https://" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
        <Button tone="primary" disabledReason={d.org.trim() ? undefined : 'Type the organisation'} onClick={save}>
          Add application
        </Button>
      </div>
    </Drawer>
  )
}

function AppRow({ a }: { a: Application }) {
  const setStatus = usePlan((s) => s.setAppStatus)
  const n = nextStep(a)
  const soon = a.days_left !== null && a.days_left >= 0 && a.days_left <= 14
  const when = a.days_left === null ? 'no date' : a.days_left < 0 ? 'closed' : inDays(a.days_left)
  const rowState = a.status === 'not_eligible' || a.status === 'rejected' ? 'default' : soon ? 'behind' : 'default'
  return (
    <Row
      className="cr-approw"
      state={rowState}
      lead={<span className="cr-when">{when}</span>}
      title={
        <span className="cr-clip" title={`${a.org} . ${a.programme}`}>
          {a.url ? (
            <a href={a.url} target="_blank" rel="noreferrer">
              {a.org}
            </a>
          ) : (
            a.org
          )}
          {a.programme ? ` . ${a.programme}` : ''}
        </span>
      }
      meta={
        <span className="cr-clip">
          {a.status === 'not_eligible' ? `ruled out: ${a.reason || 'not eligible'}` : `next: ${n.text}`}
          {a.status !== 'not_eligible' && <> . confidence: {a.verified ? 'set' : 'approximate'}</>}
        </span>
      }
      action={
        <>
          <Stepper status={a.status} org={a.org} />
          <select className="ww-input cr-select ww-tap" aria-label={`Stage of ${a.org}`} value={a.status} onChange={(e) => void setStatus(a.id, e.target.value as Application['status'])}>
            {(['idea', 'preparing', 'applied', 'interview', 'offer', 'rejected', 'not_eligible'] as const).map((s) => (
              <option key={s} value={s}>
                {STAGE_WORD[s]}
              </option>
            ))}
          </select>
        </>
      }
    />
  )
}

function Pipeline({ apps, loaded, approximate }: { apps: Application[]; loaded: boolean; approximate: number }) {
  const [adding, setAdding] = useState(false)
  const rows = useMemo(() => apps, [apps])
  return (
    <Card
      data-card="CA2"
      title="Pipeline"
      kicker={`${rows.length} row${rows.length === 1 ? '' : 's'}${approximate ? ` . ${approximate} closing date${approximate === 1 ? ' is' : 's are'} approximate, check the page` : ''}`}
      action={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden="true" /> Add application
        </Button>
      }
      loading={!loaded}
      className="cr-fill"
    >
      <Paged items={rows} rowKey={(a) => a.id} row={(a) => <AppRow a={a} />} label="applications" fallback={5} empty="No applications yet. Add the first one with its closing date." />
      <AddApplication open={adding} onClose={() => setAdding(false)} />
    </Card>
  )
}

function CampaignRow({ c, active, cap }: { c: Campaign; active: number; cap: number }) {
  const act = usePlan((s) => s.campaign)
  const toast = useStore((s) => s.toast)
  const hasFinish = c.finish_line.trim().length > 0
  const run = async (op: 'start' | 'ship' | 'drop') => {
    const r = await act(c.id, op, '')
    toast(r.say, r.ok ? 'live' : 'info')
  }
  return (
    <Row
      state={c.status === 'shipped' ? 'done' : 'default'}
      title={<span className="cr-clip" title={c.title}>{c.title}</span>}
      meta={
        <span className="cr-clip">
          {c.status === 'shipped' ? `shipped ${c.shipped ?? ''}` : `${c.left} node${c.left === 1 ? '' : 's'} . about ${c.hours_left} h . about ${c.weeks} wk`}
          {hasFinish ? <> . finish line: {c.finish_line}</> : null}
        </span>
      }
      action={
        <>
          {!hasFinish && c.status !== 'shipped' && (
            <Button size="sm" onClick={() => void switchWorkspace('setup', 'career')}>
              Set a finish line
            </Button>
          )}
          {hasFinish && c.status === 'suggested' && (
            <Button size="sm" disabledReason={active >= cap ? `${cap} already running` : undefined} onClick={() => void run('start')}>
              Start
            </Button>
          )}
          {c.status === 'active' && (
            <>
              <Button size="sm" tone="quiet" disabledReason={c.ready_to_ship ? undefined : 'nodes left'} onClick={() => void run('ship')}>
                Ship it
              </Button>
              <Button size="sm" onClick={() => void run('drop')}>
                Drop
              </Button>
            </>
          )}
        </>
      }
    />
  )
}

function Campaigns() {
  const data = usePlan((s) => s.campaigns)
  const rows = useMemo(() => {
    const all = data?.campaigns ?? []
    const order = { active: 0, suggested: 1, shipped: 2, dropped: 3 } as const
    return all.filter((c) => c.status !== 'dropped').sort((a, b) => order[a.status] - order[b.status])
  }, [data])
  return (
    <Card data-card="CA3" title="Campaigns" kicker={data ? `${data.active} of ${data.cap} running` : undefined} loading={!data} className="cr-fill">
      <Paged items={rows} rowKey={(c) => c.id} row={(c) => <CampaignRow c={c} active={data?.active ?? 0} cap={data?.cap ?? 3} />} label="campaigns" fallback={3} empty="No campaign yet. A campaign pulls its skill-tree nodes to the front until it ships." />
    </Card>
  )
}

export function PipelineView() {
  const view = usePlan((s) => s.applications)
  const due = useDeadlines()
  const rows = useMemo(() => pipelineRows(view), [view])
  const tentative = useMemo(() => (view?.applications ?? []).filter((a) => !a.verified && a.status !== 'not_eligible').length, [view])
  return (
    <div className="cr-view" data-view="pipeline">
      <UpNext due={due} apps={view?.applications ?? []} />
      <Pipeline apps={rows} loaded={!!view} approximate={tentative} />
      <Campaigns />
    </div>
  )
}
