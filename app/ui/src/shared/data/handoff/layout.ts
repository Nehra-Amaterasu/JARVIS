// HandoffKey, the pure part (spec 21.5): the sentence a key says to assistive technology. A hand-off key opens a target
// with context. It is not a command: nothing runs, nothing is sent, and the target says what it received.
export interface HandoffTarget {
  /** A route or section id the caller understands: "study.plan", "deck". */
  target: string
  /** The context handed over, as plain data: { subject: 'physics' }. Shown to the person, never executed. */
  context?: Record<string, string>
}

export function contextText(context: Record<string, string> | undefined): string {
  if (!context) return ''
  return Object.entries(context).map(([k, v]) => `${k} ${v}`).join(', ')
}

export function handoffLabel(label: string, context: Record<string, string> | undefined): string {
  const c = contextText(context)
  return c ? `${label}. Opens with ${c}.` : `${label}. Opens a page; nothing runs.`
}
