// AttachmentLadder (package C03, spec 21.4.3): the five rungs of an attachment, LINKED, ASKED, DOWNLOADED, MATCHED, READ.
// Each rung is a glyph and a word (done, next, later, or skipped when he saved the file himself), never a colour alone. No key
// here fetches a file: the only action the ladder can offer is "I will download it", which marks ASKED and nothing else.
import type { IntakeRow } from './types'
import { RUNG_WORD, ladderOf, type RungState } from './model'
import { COPY } from './copy'

const MARK: Record<RungState, string> = { done: '●', next: '◐', later: '○', skipped: '–' }
const WORD: Record<RungState, string> = { done: 'done', next: 'next', later: 'later', skipped: 'not needed' }

export function AttachmentLadder({ row }: { row: IntakeRow }) {
  const rungs = ladderOf(row)
  return (
    <div className="ik-ladder" data-component="attachment-ladder">
      <ol aria-label="Where this file stands">
        {rungs.map((r) => (
          <li key={r.stage} data-rung={r.stage} data-state={r.state}>
            <span className="ik-rung-mark" aria-hidden="true">{MARK[r.state]}</span>
            <span className="ik-rung-word">{RUNG_WORD[r.stage]}</span>
            <span className="ik-rung-state">{WORD[r.state]}</span>
          </li>
        ))}
      </ol>
      <p className="ik-ladder-note">{COPY.noFetchShort}</p>
    </div>
  )
}
