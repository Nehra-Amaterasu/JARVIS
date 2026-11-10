/**
 * Study > Library (plan 4.4): the concept of the day, the skill-tree node being studied (its resources, the
 * Open link, minutes logged) and Findings. Findings are hidden in exam season and, in the normal season, show
 * only the active node. What is not built (chapter checklists, three tracks a day) is one muted line each,
 * from the carcass registry, never a dead control.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, post } from '../../lib/api'
import { loadBank } from '../../germoney/data/bank'
import { usePlan } from '../../germoney/game/plan'
import { useStudyNode, type StudyAnswer } from '../../germoney/pages/Study'
import type { LearnAnswer } from '../../germoney/pages/Today'
import { Button, Card, EmptyState, Field } from '../kit'
import { useFrame } from '../frame/frameStore'
import { resolveSeason, type ServerSeason } from '../frame/season'
import { MathText } from '../math/MathText'
import { Planned } from '../Planned'
import { fmtMin } from './format'

function Concept() {
  const [l, setL] = useState<LearnAnswer | null | 'failed'>(null)
  useEffect(() => {
    let live = true
    api<LearnAnswer>('/api/mission/learn').then((r) => { if (live) setL(r) }).catch(() => { if (live) setL('failed') })
    return () => { live = false }
  }, [])
  const mark = async (id: string, op: 'seen' | 'recall', ok?: boolean) => {
    try { setL(await post<LearnAnswer>(`/api/mission/learn/${id}/${op}`, op === 'recall' ? { ok } : {})) } catch { /* the card keeps what it showed */ }
  }
  return (
    <Card data-card="study-concept" title="Knowledge of the day" kicker={l && l !== 'failed' && l.progress ? `${l.progress.seen} of ${l.progress.total} read` : undefined}>
      {l === null && <p className="ww-papers-line" role="status">Reading today's concept…</p>}
      {l === 'failed' && <EmptyState title="Today's concept could not be read." body="The app did not answer." />}
      {l && l !== 'failed' && l.status === 'ok' && (
        <div className="ww-concept">
          {l.new && (
            <div data-concept={l.new.id}>
              <p className="ww-concept-title">{l.new.title}</p>
              <div className="ww-concept-body"><MathText>{l.new.body}</MathText></div>
              <Button size="sm" onClick={() => void mark(l.new!.id, 'seen')}>Read it</Button>
            </div>
          )}
          {l.due.map((d) => (
            <div key={d.id} className="ww-recall" data-recall={d.id}>
              <p className="ww-papers-line">Recall: {d.title}</p>
              <div className="ww-concept-body"><MathText>{d.question}</MathText></div>
              <span className="ww-log-acts">
                <Button size="sm" grouped onClick={() => void mark(d.id, 'recall', true)}>I knew it</Button>
                <Button size="sm" grouped onClick={() => void mark(d.id, 'recall', false)}>I did not</Button>
              </span>
            </div>
          ))}
          {!l.new && l.due.length === 0 && <p className="ww-papers-line">{l.say}</p>}
          {l.source === 'example' && <p className="ww-papers-line">These are example concepts. Add your own LEARN.md to use yours.</p>}
        </div>
      )}
      <Planned id="knowledge-of-the-day" hint />
      <Planned id="books" hint />
    </Card>
  )
}

function NodeStudy() {
  const bank = useMemo(() => loadBank(), [])
  const statuses = usePlan((s) => s.state?.statuses) as Record<string, string> | undefined
  const chosen = useStudyNode((s) => s.id)
  const setNode = useStudyNode((s) => s.set)
  const fallback = bank.order.find((n) => statuses?.[n] === 'in_progress') ?? bank.order.find((n) => statuses?.[n] === 'available') ?? bank.order[0]
  const id = chosen ?? fallback
  const [a, setA] = useState<StudyAnswer | null | 'failed'>(null)
  const [what, setWhat] = useState('')
  const [minutes, setMinutes] = useState('45')
  const [say, setSay] = useState<string | null>(null)
  const reload = () => api<StudyAnswer>(`/api/mission/study/${encodeURIComponent(id)}`).then(setA).catch(() => setA('failed'))
  useEffect(() => { if (id) void reload() }, [id])   // eslint-disable-line react-hooks/exhaustive-deps
  const open = useMemo(() => bank.order.filter((n) => statuses?.[n] === 'in_progress' || statuses?.[n] === 'available'), [bank, statuses])
  if (!id) return <Card data-card="study-node" title="Study a node"><EmptyState title="No skill-tree node is loaded." /></Card>
  const res = a && a !== 'failed' ? [...(a.primary ? [a.primary] : []), ...a.backups] : []
  const log = async () => {
    try {
      const r = await post<{ say: string }>('/api/mission/learning', { what: what.trim(), minutes: Number(minutes) || 0, nodes: [id], tags: ['study'] })
      setSay(r.say)
      setWhat('')
      void reload()
    } catch { setSay('Could not log that session.') }
  }
  return (
    <Card data-card="study-node" title="Skill-tree study" kicker="follows the Tree node">
      {/* in the body, not the card head: a long node name made the head wider than a 390 px screen */}
      <div className="ww-nodepick">
        <Field kind="select" label="Node" value={id} onChange={(e) => setNode(e.target.value)}>
          {(open.length ? open : bank.order).map((n) => <option key={n} value={n}>{bank.nodes[n]?.name ?? n}</option>)}
        </Field>
      </div>
      {a === null && <p className="ww-papers-line" role="status">Reading the node…</p>}
      {a === 'failed' && <EmptyState title="This node could not be read." body="The app did not answer." />}
      {a && a !== 'failed' && a.node && (
        <>
          <p className="ww-papers-line" data-stage="">Stage: {a.stage ?? 'not started'}{a.next ? `. Next: ${a.next.title}${a.next.minutes ? `, ${fmtMin(a.next.minutes)}` : ''}.` : ''}</p>
          <ul className="ww-resources" aria-label="Resources">
            {res.length === 0 && <li className="ww-papers-line">No resource is listed for this node.</li>}
            {res.map((r) => {
              const on = a.primary?.id === r.id
              const meta = [r.kind, r.free ? 'free' : '', r.hours ? `about ${r.hours} h` : ''].filter(Boolean).join(' · ')
              return (
                <li key={r.id} className="ww-resource" data-resource={r.id} data-primary-resource={on ? 'true' : undefined}>
                  <span className="ww-resource-title">{r.title}</span>
                  <span className="ww-resource-meta">{meta}</span>
                  <span className="ww-log-acts">
                    {r.url
                      ? <a className="ww-btn ww-tap quiet ww-link" data-size="sm" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.title}`}>Open</a>
                      : <span className="ww-resource-meta">no link</span>}
                    {!on && <Button size="sm" onClick={() => void post<StudyAnswer>(`/api/mission/study/${encodeURIComponent(id)}/primary`, { resource: r.id }).then(setA)}>Use this one</Button>}
                  </span>
                </li>
              )
            })}
          </ul>
          <Planned id="resource-progress" hint />
          <form className="ww-studylog" onSubmit={(e) => { e.preventDefault(); if (what.trim()) void log() }}>
            <Field label="What you studied" value={what} onChange={(e) => setWhat(e.target.value)} />
            <Field kind="number" label="Minutes" unit="min" value={minutes} min={1} max={600} onChange={(e) => setMinutes(e.target.value)} />
            <Button size="sm" type="submit" disabled={!what.trim()}>Log it</Button>
          </form>
          {say && <p className="ww-papers-line" role="status">{say}</p>}
        </>
      )}
    </Card>
  )
}

function Findings({ nodeId }: { nodeId: string | undefined }) {
  const findings = usePlan((s) => s.findings)
  useEffect(() => { void usePlan.getState().loadFindings() }, [])
  const rows = (findings ?? []).filter((f) => !nodeId || f.node_id === nodeId)
  return (
    <Card data-card="study-findings" title="Findings" kicker="newest papers on the active node">
      {findings === null && <p className="ww-papers-line" role="status">Reading findings…</p>}
      {findings !== null && rows.length === 0 && <p className="ww-papers-line">No findings for this node yet. Start it on the Tree and its newest papers show up here once a day.</p>}
      {rows.map((f) => (
        <div key={f.node_id} className="ww-finding">
          <p className="ww-papers-line">{f.name}{f.stale ? ' (cached)' : ''}</p>
          <ul className="ww-findings">
            {f.papers.slice(0, 3).map((p) => (
              <li key={p.id}><a href={p.url} target="_blank" rel="noopener noreferrer"><MathText>{p.title}</MathText></a></li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  )
}

export function Library() {
  const server = usePlan((s) => (s.today as { season?: ServerSeason } | null)?.season ?? null)
  const mode = useFrame((s) => s.seasonMode)
  const hidden = resolveSeason(server, mode).findings_hidden
  const node = useStudyNode((s) => s.id) ?? undefined
  return (
    <div className="ww-library" data-view="library">
      <Concept />
      <NodeStudy />
      {hidden ? <p className="ww-papers-line" data-findings-hidden="">Findings are hidden in exam season.</p> : <Findings nodeId={node} />}
    </div>
  )
}
