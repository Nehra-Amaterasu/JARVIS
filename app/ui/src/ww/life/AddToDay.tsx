// LF1 Add to day (plan 4.6): one row to log a meal, anime, movie, series or reel, the Logged today list with a
// delete on every row and an Undo for the last change, and the points rule behind a fold. The counters are
// not here: they live in the left column, where one tap reaches them from every workspace.
import { useRef, useState, type FormEvent } from 'react'
import { Clapperboard, Film, Link2, Sparkles, Trash2, Utensils, type LucideIcon } from 'lucide-react'
import { Button, Card, Chip, Drawer, EmptyState, Field, Fold, IconButton, Row, Segmented } from '../kit'
import { Planned } from '../Planned'
import { itemCue, pendingWord, type ItemRow } from './derive'
import type { LifeDay, Notice } from './useLife'

export const KINDS = [
  { id: 'meal', label: 'Meal', icon: Utensils },
  { id: 'anime', label: 'Anime', icon: Sparkles },
  { id: 'movie', label: 'Movie', icon: Film },
  { id: 'series', label: 'Series', icon: Clapperboard },
  { id: 'reel', label: 'Reel', icon: Link2 },
] as const
type Kind = (typeof KINDS)[number]['id']
const ICON: Record<string, LucideIcon> = Object.fromEntries(KINDS.map((k) => [k.id, k.icon]))

/** Rows shown in the card itself. Three keeps the card inside one laptop screen; "Show all" opens the rest in a drawer. */
export const VISIBLE_ROWS = 3

/** The MIN a reel's explain-back needs, the same 20 characters the old card asked for. */
const EXPLAIN_MIN = 20

interface Props {
  state: {
    data: LifeDay | null
    error: string | null
    loading: boolean
    reload: () => Promise<void>
    add: (kind: string, text: string, extra?: { minutes?: number; url?: string }) => Promise<boolean>
    remove: (row: ItemRow) => Promise<void>
    explained: (date: string, index: number, text: string) => Promise<void>
    notice: Notice | null
    dismiss: () => void
  }
  index?: number
}

export function AddToDay({ state, index }: Props) {
  const { data: d, error, loading, reload, add, remove, explained, notice, dismiss } = state
  const [kind, setKind] = useState<Kind>('meal')
  const [text, setText] = useState('')
  const [extra, setExtra] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const [all, setAll] = useState(false)
  const [explain, setExplain] = useState(false)
  const form = useRef<HTMLFormElement>(null)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) {
      setProblem('Say what it was.')
      form.current?.querySelector('input')?.focus()
      return
    }
    setProblem(undefined)
    const body = kind === 'reel' ? (extra.trim() ? { url: extra.trim() } : {}) : Number(extra) > 0 ? { minutes: Number(extra) } : {}
    const keep = { text, extra }
    setText('')
    setExtra('')
    if (!(await add(kind, text, body))) {
      setText(keep.text) // a failed save keeps what was typed
      setExtra(keep.extra)
    }
  }

  const rows = d ? [...d.item_rows].reverse() : []
  const pending = d?.reels_pending
  const head = d ? (
    <div className="ww-life-head">
      <span className="ww-life-points" aria-label={`${d.points_today} points today, ${d.weeks[0]?.points ?? 0} this week`}>
        <b>{d.points_today}</b> pt today · <b>{d.weeks[0]?.points ?? 0}</b> this week
      </span>
      {pending && pending.total > 0 &&
        (pending.due > 0 ? (
          <Button size="sm" onClick={() => setExplain(true)} data-pending="">
            {pending.total} reel{pending.total === 1 ? '' : 's'} pending
          </Button>
        ) : (
          <Chip tone="neutral">
            <span data-pending="">
              {pending.total} reel{pending.total === 1 ? '' : 's'} pending
            </span>
          </Chip>
        ))}
    </div>
  ) : undefined

  return (
    <Card data-card="LF1" title="Add to day" kicker="Today" action={head} loading={loading && !d} error={!d && error ? error : undefined} onRetry={() => void reload()} index={index}>
      {d && (
        <div className="ww-life-body">
          <Segmented<Kind> label="What to add" variant="choice" value={kind} onChange={setKind} options={KINDS.map((k) => ({ id: k.id, label: k.label }))} />
          <form ref={form} className="ww-life-add" onSubmit={(e) => void submit(e)} noValidate>
            <Field
              label={kind === 'reel' ? 'What it taught, in one line' : kind === 'meal' ? 'What you ate' : 'Title'}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                if (problem) setProblem(undefined)
              }}
              error={problem}
              maxLength={500}
              autoComplete="off"
              className="ww-life-what"
              data-add-text=""
            />
            <Field
              label={kind === 'reel' ? 'Link' : 'Minutes'}
              kind={kind === 'reel' ? 'text' : 'number'}
              inputMode={kind === 'reel' ? 'url' : 'numeric'}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              min={kind === 'reel' ? undefined : 1}
              max={kind === 'reel' ? undefined : 1440}
              autoComplete="off"
              className="ww-life-extra"
            />
            <Button type="submit" size="md" className="ww-life-addbtn">
              Add
            </Button>
          </form>
          {kind === 'reel' && <Planned id="reels-v2" hint />}

          {notice && (
            <p className="ww-life-notice" role={notice.tone === 'fault' ? 'alert' : 'status'} data-tone={notice.tone}>
              <span>{notice.text}</span>
              {notice.undo && (
                <Button size="sm" onClick={() => void notice.undo!().then(() => undefined)}>
                  Undo
                </Button>
              )}
              <Button size="sm" onClick={dismiss} aria-label="Dismiss this message">
                Dismiss
              </Button>
            </p>
          )}

          <section className="ww-life-logged" aria-label="Logged today">
            <h3 className="ww-life-sub">Logged today</h3>
            {rows.length === 0 ? (
              <EmptyState title="Nothing logged yet today." />
            ) : (
              <>
                {rows.slice(0, VISIBLE_ROWS).map((r) => (
                  <ItemLine key={`${r.index}:${r.kind}:${r.text}`} row={r} onDelete={remove} />
                ))}
                {rows.length > VISIBLE_ROWS && (
                  <Button size="sm" className="ww-life-all" onClick={() => setAll(true)}>
                    Show all {rows.length}
                  </Button>
                )}
              </>
            )}
          </section>

          <Fold title="How points work">
            <p className="ww-life-rule">{d.rule}</p>
          </Fold>
          <Planned id="life-v2" />
        </div>
      )}

      <Drawer open={all} onClose={() => setAll(false)} title={`Logged today, ${rows.length} items`}>
        <div className="ww-life-drawerlist">
          {rows.map((r) => (
            <ItemLine key={`${r.index}:${r.kind}:${r.text}`} row={r} onDelete={remove} />
          ))}
        </div>
      </Drawer>

      <Drawer open={explain} onClose={() => setExplain(false)} title="Explain it back">
        {d && <ExplainBack day={d} onSave={explained} onClose={() => setExplain(false)} />}
      </Drawer>
    </Card>
  )
}

function ItemLine({ row, onDelete }: { row: ItemRow; onDelete: (r: ItemRow) => Promise<void> }) {
  const Icon = ICON[row.kind]
  const cue = itemCue(row)
  const meta = [row.minutes ? `${row.minutes} min` : null, cue].filter(Boolean).join(' · ')
  return (
    <Row
      className="ww-life-item"
      lead={Icon ? <Icon size={16} aria-hidden="true" /> : null}
      title={
        <span className="ww-life-itemtext">
          <span className="ww-sr-only">{row.kind}: </span>
          {row.text}
        </span>
      }
      meta={meta || undefined}
      action={
        <IconButton label={`Delete ${row.kind}: ${row.text}`} size="sm" onClick={() => void onDelete(row)} data-delete="">
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      }
    />
  )
}

function ExplainBack({ day, onSave, onClose }: { day: LifeDay; onSave: (date: string, index: number, text: string) => Promise<void>; onClose: () => void }) {
  const [t, setT] = useState('')
  const r = day.reels_to_explain[0]
  if (!r) return <EmptyState title="No reel is ready to explain yet." body={pendingWord(day.reels_pending) || 'Reels you log today are asked tomorrow.'} />
  const left = EXPLAIN_MIN - t.trim().length
  return (
    <div className="ww-life-explain">
      <p className="ww-life-explain-what">
        <b>{r.text}</b>
        {r.url && (
          <>
            {' · '}
            <a href={r.url} target="_blank" rel="noreferrer">
              the reel
            </a>
          </>
        )}
        <span className="ww-life-explain-n"> {day.reels_to_explain.length > 1 ? ` · ${day.reels_pending.due - 1} more waiting` : ''}</span>
      </p>
      <Field
        kind="area"
        label="In your own words, without looking: what was the idea?"
        value={t}
        onChange={(e) => setT((e.target as unknown as HTMLTextAreaElement).value)}
        hint={left > 0 ? `${left} more characters` : 'Ready.'}
      />
      <Button
        tone="primary"
        disabledReason={left > 0 ? `Write ${left} more characters` : undefined}
        onClick={() => {
          void onSave(r.date, r.index, t).then(() => {
            setT('')
            if (day.reels_to_explain.length <= 1) onClose()
          })
        }}
      >
        Save to my knowledge
      </Button>
      {day.last_grade && (
        <p className="ww-life-grade">
          Last grade {day.last_grade.score}/3{day.last_grade.missing.length > 0 && <> · missing: {day.last_grade.missing.join('; ')}</>}
          {day.last_grade.note && <> · {day.last_grade.note}</>}
        </p>
      )}
    </div>
  )
}
