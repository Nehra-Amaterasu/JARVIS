/**
 * A bug in one Mission screen (or one section of it) must never blank the whole app.
 * React unmounts the entire tree when a render throws and nothing catches it: that
 * was the black window when Road crashed on 2026-10-25. This boundary catches it and
 * shows what broke, in words, with a "Copy details" button for the bug report and a
 * "Try again" that re-mounts the screen.
 *
 * Usage: <MissionBoundary name="Road"> around a screen (MissionRoot does this for
 * every screen and the Settings drawer), <MissionBoundary name="Campaigns" small>
 * around a section so the rest of the screen keeps working.
 */
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { name: string; small?: boolean; children?: ReactNode }
interface State { error: Error | null; stack: string; copied: boolean }

/** The text that goes on the clipboard: enough to find the bug without asking. */
export function errorDetails(name: string, error: Error, componentStack: string): string {
  return [
    `Well Wisher: "${name}" crashed`,
    `When: ${new Date().toISOString()}`,
    `Where: ${typeof location !== 'undefined' ? location.pathname : ''}`,
    `Error: ${error.name}: ${error.message}`,
    '',
    'Stack:',
    (error.stack ?? '(none)').split('\n').slice(0, 12).join('\n'),
    '',
    'Components:',
    componentStack.trim().split('\n').slice(0, 12).join('\n'),
  ].join('\n')
}

export class MissionBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? '' })
    console.error(`[mission] ${this.props.name} crashed:`, error)
  }

  private copy = async () => {
    const { error, stack } = this.state
    if (!error) return
    const text = errorDetails(this.props.name, error, stack)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // No clipboard permission: select the text in a prompt-free way (a hidden textarea).
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* nothing more to try */ }
      ta.remove()
    }
    this.setState({ copied: true })
  }

  private retry = () => this.setState({ error: null, stack: '', copied: false })

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children
    const { name, small } = this.props
    return (
      <section className={`card crash-card ${small ? 'small' : ''}`} role="alert">
        <div className="card-head">
          <span className="card-title"><AlertTriangle size={15} />{small ? `${name} couldn't load` : `${name} hit a bug`}</span>
        </div>
        <p className="small">
          {small
            ? 'This section broke; the rest of the screen still works. Your saves are untouched.'
            : 'This screen broke while drawing. The other Mission screens still work and your saves are untouched.'}
        </p>
        <p className="mono small crash-msg">{error.name}: {error.message}</p>
        <div className="field-row">
          <button className="btn sm primary" onClick={() => void this.copy()}><Copy size={13} />{copied ? 'Copied' : 'Copy details'}</button>
          <button className="btn sm" onClick={this.retry}><RotateCcw size={13} />Try again</button>
        </div>
        {!small && <p className="muted small">Paste the details into a bug note: they say which part failed and where.</p>}
      </section>
    )
  }
}
