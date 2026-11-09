/**
 * MathText: text with $...$ and $$...$$ runs, typeset. One component for the paper, the Reader, Drill,
 * Study, the Tree panel and Findings, so the surfaces cannot drift.
 *
 *  - KaTeX when it has loaded (lazy: the first formula to mount asks for it, see katex-loader).
 *  - Until then, under test, and if the chunk never loads: the home-grown fallback (fallback.tsx).
 *  - A formula that fails either way renders its source in a <code> with the reason in a title.
 *    It never throws into the page and never shows a raw backslash command as prose.
 *  - A string with no "$" in it is legacy content (the bank's ASCII, the sheets' Unicode): it goes
 *    through toTex first. A string with a "$" was authored as LaTeX and is left exactly as written.
 *    `raw` shows the string untouched, which is what the Reader's raw toggle uses so wrong maths is
 *    never silent.
 */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { texFallback } from './fallback'
import { katexNow, loadKatex, subscribeKatex } from './katex-loader'
import { splitMath, toTex } from './toTex'
import './math.css'

function MathRun({ tex, display }: { tex: string; display: boolean }) {
  // The server snapshot is null, so renderToStaticMarkup and the first client render agree: fallback.
  const katex = useSyncExternalStore(subscribeKatex, katexNow, () => null)
  useEffect(() => { void loadKatex() }, [])
  const rendered = useMemo<{ html: string } | { err: string } | null>(() => {
    if (!katex) return null
    try {
      // trust:false keeps \href and \url inert; the output is KaTeX's own escaped markup, not the author's HTML.
      return { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore', trust: false }) }
    } catch (e) {
      return { err: e instanceof Error ? e.message : 'could not be typeset' }
    }
  }, [katex, tex, display])
  if (rendered && 'html' in rendered) {
    const Tag = display ? 'div' : 'span'
    return <Tag className={display ? 'ww-math ww-math-display' : 'ww-math'} role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: rendered.html }} />
  }
  if (rendered && 'err' in rendered) return <code className="ww-math-err" title={rendered.err}>{tex}</code>
  const body = texFallback(tex)
  // Plain markup on purpose: the same <span class="rd-math"> the Reader always produced, real text for assistive tech.
  return display
    ? <div className="rd-math ww-math-display">{body}</div>
    : <span className="rd-math">{body}</span>
}

export interface RenderMathOptions {
  /** Set every run in display style (its own centred line). */
  display?: boolean
  /** Show the source untouched: no conversion, no typesetting. */
  raw?: boolean
  /** Treat the string as LaTeX-authored even though it has no "$": skip toTex. */
  tex?: boolean
  keyPrefix?: string
}

/** The string as React nodes: text stays text, each $...$ run becomes a MathRun. */
export function renderMath(src: string, opts: RenderMathOptions = {}): ReactNode[] {
  if (opts.raw) return [src]
  const kp = opts.keyPrefix ?? 'mt'
  const legacy = !opts.tex && !src.includes('$')
  const text = legacy ? toTex(src) : src
  if (!text.includes('$')) return [text]
  return splitMath(text).map((r, i) => (r.kind === 'text'
    ? r.value
    : <MathRun key={`${kp}-${i}`} tex={r.value} display={opts.display === true || r.kind === 'display'} />))
}

export interface MathTextProps extends RenderMathOptions {
  children: string
  className?: string
}

export function MathText({ children, className, ...opts }: MathTextProps) {
  const nodes = useMemo(() => renderMath(children ?? '', opts), [children, opts.display, opts.raw, opts.tex, opts.keyPrefix])   // eslint-disable-line react-hooks/exhaustive-deps
  const Tag = opts.display ? 'div' : 'span'
  return <Tag className={className}>{nodes}</Tag>
}
