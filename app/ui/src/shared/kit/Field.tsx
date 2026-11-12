import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from './util'

export type FieldKind = 'text' | 'number' | 'date' | 'time' | 'area' | 'select'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'children' | 'type'> {
  /** Above the control, always visible: a placeholder is not a label. */
  label: string
  hint?: string
  /** Replaces the hint; sets aria-invalid and the fault border. Written as words ("Error: ..."), never colour alone. */
  error?: string
  unit?: string
  kind?: FieldKind
  /** The <option>s of a select. */
  children?: ReactNode
}

/**
 * One field instead of `field`, `field sm`, `input sm`, `area` and eight height overrides: label above,
 * 40 px (--field-h), ring in --field-ring, the same control in every workspace.
 */
export function Field({ label, hint, error, unit, kind = 'text', children, className, id, disabled, ...rest }: FieldProps) {
  const auto = useId()
  const fid = id ?? auto
  const noteId = `${fid}-note`
  const note = error ?? hint
  // A disabled text field stays focusable (readOnly plus aria-disabled), as every kit control does, so its value and
  // the reason beside it can be reached and its focus ring drawn; the native attribute made it unfocusable (the bench
  // measured "outline none on focus"). A select has no read-only form, so it keeps the native attribute.
  const inert = disabled && kind !== 'select'
  const common = {
    id: fid,
    disabled: kind === 'select' ? disabled : undefined,
    readOnly: inert ? true : undefined,
    'aria-disabled': inert ? true : undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': note ? noteId : undefined,
    className: 'ww-input',
  }
  let control: ReactNode
  if (kind === 'area') control = <textarea rows={3} {...common} {...(rest as unknown as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
  else if (kind === 'select') control = <select {...common} {...(rest as unknown as SelectHTMLAttributes<HTMLSelectElement>)}>{children}</select>
  else control = <input type={kind} {...common} {...rest} />
  return (
    <div className={cx('ww-field', className)} data-kind={kind} data-error={error ? 'true' : undefined} data-disabled={disabled ? 'true' : undefined}>
      <label className="ww-field-label" htmlFor={fid}>
        {label}
      </label>
      <div className="ww-field-box">
        {control}
        {unit && <span className="ww-field-unit">{unit}</span>}
      </div>
      {note && (
        <p id={noteId} className="ww-field-note">
          {error ? `Error: ${error}` : hint}
        </p>
      )}
    </div>
  )
}
