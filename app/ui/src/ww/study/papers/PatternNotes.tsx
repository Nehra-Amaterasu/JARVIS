// The two notes the paper desk prints under the Topics by year grid (package O, 27 Nov), both straight from the engine's rules:
//   - ProvisionalNote: R-16 answers WAITING with the counts still present when fewer than 3 papers or 20 counted questions are on file.
//     The counts are a plain note, never a pattern: no topic row, no weight, no suggestion is drawn from them.
//   - PractiseNext: R-17's picks, each with the engine's printed terms (marks weight, share of papers, proficiency, syllabus weight,
//     minutes) as plain words, so the order can be redone by hand. No judgement is added.
import type { GainItem, Topic } from '../ports'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface ProvisionalCounts { papers: number; questions: number; reason: string }

export const provisionalText = (c: Pick<ProvisionalCounts, 'papers' | 'questions'>) =>
  `${plural(c.questions, 'question', 'questions')} in ${plural(c.papers, 'paper', 'papers')} so far: too few to call a pattern.`

export function ProvisionalNote({ counts }: { counts: ProvisionalCounts }) {
  return (
    <p className="pp-prov" data-component="provisional-note" role="status">
      <span>{provisionalText(counts)}</span>
      {counts.reason && <span className="pp-prov-why">{counts.reason}</span>}
    </p>
  )
}

export function PractiseNext({ items, topics, max = 3 }: { items: readonly GainItem[]; topics: readonly Topic[]; max?: number }) {
  if (!items.length) return null
  const label = (id: string) => topics.find((t) => t.id === id)?.label ?? id.slice(id.indexOf('|') + 1)
  return (
    <div className="pp-next" data-component="practise-next">
      <p className="pp-next-head">Practise next, in the engine&rsquo;s order</p>
      <ol className="pp-next-list">
        {items.slice(0, max).map((g) => (
          <li key={g.topicId}>
            <strong>{label(g.topicId)}</strong>
            <span>{g.reason}</span>
            {g.terms && <span className="pp-next-terms">{g.terms}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}
