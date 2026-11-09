/**
 * The home-grown TeX renderer: what a formula looks like until KaTeX has loaded, when it never loads
 * (offline chunk missing), and under test (happy-dom, no network, deterministic).
 *
 * It reads the subset toTex produces and a person would type: ^ _ with or without braces, \frac,
 * \sqrt, Greek and operator commands, \text / \mathrm, \left \right, \{ \}, thin spaces. No matrices,
 * no cases, no alignment: those need KaTeX and fall back to the source in a <code> that says so.
 * Output is React elements, never HTML, and never a raw backslash: an unknown command prints its
 * name. It does not throw; garbage in gives text out.
 *
 * The old math() in Reader.tsx handled only ^ and _ and printed \frac and \sqrt literally; its markup
 * (<sub>, <sup>, nested once) is kept as it was so the existing tests still describe the output.
 */
import type { ReactNode } from 'react'

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  int: '∫', iint: '∬', oint: '∮', sum: '∑', prod: '∏', infty: '∞', partial: '∂', nabla: '∇', pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', sim: '∼', equiv: '≡', propto: '∝', to: '→', rightarrow: '→', leftarrow: '←',
  Rightarrow: '⇒', Leftrightarrow: '⇔', in: '∈', angle: '∠', circ: '°', ldots: '…', cdots: '⋯', dots: '…', oplus: '⊕', surd: '√', backslash: '\\',
  prime: '′', deg: '°', ll: '≪', gg: '≫', cap: '∩', cup: '∪', forall: '∀', exists: '∃', degree: '°',
}
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'mod', 'arg',
  'arctan', 'arcsin', 'arccos', 'sup', 'inf'])
const SPACES: Record<string, string> = { ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', quad: '  ', qquad: '    ' }
const UPRIGHT = new Set(['text', 'mathrm', 'operatorname', 'textrm', 'mathbf', 'mathit', 'mathsf', 'mathbb', 'mathcal', 'boldsymbol'])
const NOOP = new Set(['left', 'right', 'displaystyle', 'textstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg'])

class Unsupported extends Error {}

class P {
  i = 0
  n = 0
  readonly s: string
  readonly key: string
  constructor(s: string, key: string) { this.s = s; this.key = key }
  k() { return `${this.key}-${this.n++}` }

  /** A brace group's raw text starting at i (s[i] === '{'); i ends after the matching '}', or at the end. */
  group(): string {
    const s = this.s
    let depth = 0
    let j = this.i
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue }
      if (s[j] === '{') depth++
      else if (s[j] === '}' && --depth === 0) break
    }
    const inner = s.slice(this.i + 1, j)
    this.i = Math.min(s.length, j + 1)
    return inner
  }

  /** The argument of ^ _ \frac \sqrt: a brace group, a command, or one character. */
  arg(): string {
    const s = this.s
    while (s[this.i] === ' ') this.i++
    if (this.i >= s.length) return ''
    if (s[this.i] === '{') return this.group()
    if (s[this.i] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(this.i))
      const cmd = m ? m[0] : '\\'
      this.i += cmd.length
      return cmd
    }
    return s[this.i++]
  }

  seq(src: string, key: string): ReactNode[] { return new P(src, key).run() }

  run(): ReactNode[] {
    const s = this.s
    const out: ReactNode[] = []
    let buf = ''
    const flush = () => { if (buf) { out.push(buf); buf = '' } }
    while (this.i < s.length) {
      const c = s[this.i]
      if (c === '^' || c === '_') {
        this.i++
        const a = this.arg()
        flush()
        const Tag = c === '_' ? 'sub' : 'sup'
        const k = this.k()
        out.push(<Tag key={k}>{this.seq(a, k)}</Tag>)
        continue
      }
      if (c === '{') { flush(); const k = this.k(); out.push(<span key={k}>{this.seq(this.group(), k)}</span>); continue }
      if (c === '}') { this.i++; continue }               // a stray closer: dropped, not printed
      if (c === '\\') {
        this.i++
        const m = /^([A-Za-z]+|.)/s.exec(s.slice(this.i))
        if (!m) continue
        const name = m[1]
        this.i += name.length
        if (name === 'begin' || name === 'end') throw new Unsupported(name)
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const a = this.arg()
          const b = this.arg()
          flush()
          const k = this.k()
          out.push(<span key={k} className="rd-frac"><span className="rd-num">{this.seq(a, `${k}n`)}</span><span className="rd-den">{this.seq(b, `${k}d`)}</span></span>)
          continue
        }
        if (name === 'sqrt') {
          if (s[this.i] === '[') { const e = s.indexOf(']', this.i); this.i = e < 0 ? s.length : e + 1 }
          const a = this.arg()
          flush()
          const k = this.k()
          out.push(<span key={k}>√<span className="rd-rad">{this.seq(a, k)}</span></span>)
          continue
        }
        if (UPRIGHT.has(name)) { const a = this.arg(); flush(); const k = this.k(); out.push(<span key={k} className="rd-rm">{this.seq(a, k)}</span>); continue }
        if (NOOP.has(name)) { if (name === 'left' || name === 'right' || name.startsWith('big') || name.startsWith('Big')) { if (s[this.i] === '.') this.i++ } continue }
        if (SPACES[name] !== undefined) { buf += SPACES[name]; continue }
        if (name === '\\') { buf += ' '; continue }
        if (SYMBOLS[name] !== undefined) { buf += SYMBOLS[name]; continue }
        if (FUNCS.has(name)) { flush(); out.push(<span key={this.k()} className="rd-rm">{name}</span>); continue }
        if (name.length === 1 && !/[A-Za-z]/.test(name)) { buf += name; continue }   // \{ \} \% \& \# \_ \$
        buf += name                                       // an unknown command prints its name, never a backslash
        continue
      }
      buf += c
      this.i++
    }
    flush()
    return out
  }
}

/** The formula as React nodes. Never throws: a construct the fallback cannot draw comes back as its source. */
export function texFallback(tex: string, key = 'm'): ReactNode[] {
  try {
    return new P(tex, key).run()
  } catch (e) {
    const why = e instanceof Unsupported ? `needs the maths engine (${e.message})` : 'could not be typeset'
    return [<code key={key} className="ww-math-err" title={why}>{tex}</code>]
  }
}

/** True when the fallback can draw this formula (no \begin ... \end). */
export function fallbackCovers(tex: string): boolean { return !/\\(begin|end)\b/.test(tex) }
