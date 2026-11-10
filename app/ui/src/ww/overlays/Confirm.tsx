// O7 Confirm (plan 3.1): one generic question with two answers. It is opened with its words and its action:
//   openOverlay('confirm', { title, body, confirmLabel, destructive, onConfirm })
// so a page never builds its own dialog. A destructive confirm is a danger button and declares no primary
// (the saffron fill is never the way to wipe something); a plain one takes the overlay's primary.
import { useState } from 'react'
import { Button, PrimaryButton } from '../kit'
import { closeOverlay, registerOverlay } from '../frame/overlayRegistry'
import { useStore } from '../../lib/store'
import './overlays.css'

export interface ConfirmProps {
  title?: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm?: () => void | Promise<void>
}

export function Confirm({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false, onConfirm }: ConfirmProps) {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    closeOverlay()
    try {
      await onConfirm?.()
    } catch (e) {
      toast((e as Error).message || 'That did not work.', 'fault')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ov-body" data-overlay="confirm" data-primary-none={destructive ? '' : undefined}>
      {title && <p className="ov-lead">{title}</p>}
      {body && <p className="ov-note">{body}</p>}
      <div className="ov-actions">
        <Button onClick={closeOverlay}>{cancelLabel}</Button>
        {destructive
          ? <Button tone="danger" loading={busy} onClick={() => void go()}>{confirmLabel}</Button>
          : <PrimaryButton claimId="confirm-yes" rank="overlay" loading={busy} onClick={() => void go()}>{confirmLabel}</PrimaryButton>}
      </div>
    </div>
  )
}

registerOverlay('confirm', Confirm as never)
