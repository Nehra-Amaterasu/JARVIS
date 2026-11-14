// CropCard (package Y01, spec 21.8): a question's crop with its text layer and chips. The crop is the page as printed and is
// the source of truth; the text beside it is a reading of the crop and says so: `TEXT verified` (you checked it), a dashed
// `TEXT unverified`, or `CROP only` (nothing was read). `T` in the Review Desk shows crop and text side by side.
import type { ReactNode } from 'react'
import type { TextStatus } from '../ports'
import { COPY } from '../papers/copy'

export type CropCardState = TextStatus | 'editing'

export interface CropCardProps {
  /** The crop image (URL or data URI). Absent: the crop has not been rendered and the card says so. */
  img?: string
  /** The question's box on its page [x, y, w, h]; printed as text so the crop can be found again. */
  bbox?: readonly [number, number, number, number]
  text?: string
  textStatus: TextStatus
  /** Tag chips, usually `TagChip`s. */
  chips?: ReactNode
  /** Draw the text layer beside the crop (the `T` key) instead of under it. */
  sideBySide?: boolean
  /** The text is being edited: the status line says so and the text becomes a field. */
  editing?: boolean
  onText?: (value: string) => void
  /** The student ticks "text checked against the crop". */
  onVerify?: (verified: boolean) => void
  /** `callout` is the 280 x 120 crop of a Strata hover: the image and the chips only. */
  size?: 'card' | 'callout'
  /** A fixture crop is stamped, so a drawing is never read as a scan. */
  simulated?: boolean
  label?: string
}

const STATUS_WORD: Record<TextStatus, string> = { verified: 'TEXT verified', unverified: 'TEXT unverified', 'crop-only': 'CROP only' }
const STATUS_NOTE: Record<TextStatus, string> = { verified: COPY.textVerified, unverified: COPY.textUnverified, 'crop-only': COPY.cropOnly }

export function CropCard({ img, bbox, text, textStatus, chips, sideBySide, editing, onText, onVerify, size = 'card', simulated, label = 'Question crop' }: CropCardProps) {
  const state: CropCardState = editing ? 'editing' : textStatus
  const callout = size === 'callout'
  return (
    <figure className="rv-crop" data-component="crop-card" data-state={state} data-size={size} data-side={sideBySide ? 'true' : undefined} aria-label={label}>
      <div className="rv-crop-img">
        {img ? <img src={img} alt={`${label}: the page as printed, the source of truth`} draggable={false} /> : <div className="rv-crop-none">crop not rendered</div>}
        {simulated && <span className="rv-stamp">SIMULATED</span>}
      </div>
      {!callout && (
        <figcaption className="rv-crop-text">
          <span className="rv-crop-head">
            <span className="rv-crop-status" data-status={textStatus} title={STATUS_NOTE[textStatus]}>
              {editing ? 'EDITING' : STATUS_WORD[textStatus]}
            </span>
            {chips}
          </span>
          {editing ? (
            <textarea className="rv-crop-field" value={text ?? ''} aria-label="Question text" rows={3} onChange={(e) => onText?.(e.target.value)} />
          ) : textStatus === 'crop-only' ? (
            <p className="rv-crop-body" data-empty="true">{STATUS_NOTE['crop-only']}</p>
          ) : (
            <p className="rv-crop-body" data-unverified={textStatus === 'unverified' ? 'true' : undefined}>{text}</p>
          )}
          <span className="rv-crop-meta">
            {bbox && <span className="rv-crop-bbox">box {bbox.map((n) => Math.round(n)).join(' ')}</span>}
            {onVerify && textStatus !== 'crop-only' && (
              <button type="button" className="rv-link" aria-pressed={textStatus === 'verified'} onClick={() => onVerify(textStatus !== 'verified')}>
                {textStatus === 'verified' ? 'Text checked' : 'I checked the text'}
              </button>
            )}
          </span>
        </figcaption>
      )}
      {callout && chips && <div className="rv-crop-chips">{chips}</div>}
    </figure>
  )
}
