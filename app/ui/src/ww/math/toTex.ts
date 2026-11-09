/**
 * toTex: the bank's ASCII dialect ("int_0^inf int_0^x e^(-xy) y dy dx", "Gamma(1/2)", "x^2 z",
 * "cos(wt + theta)") and the sheets' Unicode / caret dialect ("∫₀ᴸ", "e^(−ωnt)", "√(1 − X)")
 * into LaTeX fenced with $...$. Pure: no DOM, no React, no I/O.
 *
 * Why it is a "find the runs" problem and not a rewrite: 0 of 88 bank strings and 0 of 37 sheets
 * hold a "$", so the converter has to decide which stretch of a prose line is maths. A token is
 * STRONG when it carries a mark that prose never has ("^", "x_i", "=", "<=", a digit slash digit, a
 * Unicode operator, a set in braces). A run is a strong token plus the WEAK tokens around it
 * (single letters, numbers, "dy", "f(x)", "sin", Greek names, operators) up to the first prose word.
 * A run is wrapped only if it still holds a strong token after its edges are trimmed. That keeps
 * "integration", "pi" in a sentence and "int" inside a word out of the maths, and it is why a prose
 * line with no mark in it comes back byte for byte.
 *
 * Conservative on purpose (wrong maths must never be silent): a "/" becomes \frac only when the
 * numerator starts a term ("dx/(1+x^2)", "3/5", "(y-x)/(y+x)"), never in "Delta f(x)/f(x)" where
 * juxtaposition makes the numerator ambiguous. Flat identifiers with no marker ("VGS", "ID") are left
 * alone: no rule can tell V_GS from the word "VGS". Existing $...$ and `code` spans are never touched,
 * so toTex(toTex(x)) === toTex(x).
 */

const GREEK_LC = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'])
const GREEK_UC = new Set(['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'])
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'mod', 'arg', 'arctan', 'arcsin', 'arccos'])
const BIG = new Set(['int', 'sum', 'prod', 'lim'])   // big operators: a word only when a script follows
/** Prose words of 1 to 3 letters. A token whose letters are all short is "weak" and would join a run,
 *  so these are the ones that must end it. */
const STOP = new Set(['a', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to',
  'up', 'we', 'all', 'and', 'any', 'are', 'but', 'can', 'for', 'get', 'had', 'has', 'her', 'him', 'his', 'how', 'its', 'let', 'may', 'nor',
  'not', 'now', 'off', 'one', 'our', 'out', 'per', 'see', 'she', 'the', 'too', 'two', 'use', 'was', 'who', 'why', 'yes', 'yet', 'you', 'ans',
  'add', 'due', 'set', 'via', 'sum', 'int', 'prod'])
/** Units that follow a number after a space ("10 ohm", "50 Hz"); "3s+7" has no space and stays a variable. */
const UNITS: Record<string, string> = {
  ohm: '\\Omega', Hz: 'Hz', kHz: 'kHz', MHz: 'MHz', GHz: 'GHz', V: 'V', mV: 'mV', kV: 'kV', A: 'A', mA: 'mA', S: 'S', H: 'H', mH: 'mH',
  F: 'F', nF: 'nF', pF: 'pF', ms: 'ms', ns: 'ns', s: 's', W: 'W', mW: 'mW', kW: 'kW', dB: 'dB', J: 'J', nJ: 'nJ', K: 'K', min: 'min',
  uF: '\\mu F', us: '\\mu s', uA: '\\mu A',
}

const GREEK_CHARS: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda',
  μ: 'mu', µ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
}
/** Unicode symbols that stand as operands (atoms). Sigma is the sum here: the sheets never mean the letter. */
const SYM_ATOMS: Record<string, string> = { '∫': '\\int', '∑': '\\sum', Σ: '\\sum', '∏': '\\prod', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '°': '^\\circ', '±': '\\pm', '∠': '\\angle' }
/** Unicode symbols that stand as operators. */
const SYM_OPS: Record<string, string> = { '≈': '\\approx', '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow',
  '×': '\\times', '·': '\\cdot', '÷': '\\div', '−': '-', '–': '-', '∝': '\\propto', '∈': '\\in', '…': '\\ldots', '∼': '\\sim', '≡': '\\equiv', '⊕': '\\oplus' }
const SUB_CHARS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '-',
  ₐ: 'a', ₑ: 'e', ₕ: 'h', ᵢ: 'i', ⱼ: 'j', ₖ: 'k', ₗ: 'l', ₘ: 'm', ₙ: 'n', ₒ: 'o', ₚ: 'p', ᵣ: 'r', ₛ: 's', ₜ: 't', ᵤ: 'u', ᵥ: 'v', ₓ: 'x' }
const SUP_CHARS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
  ⁿ: 'n', ⁱ: 'i', ᴸ: 'L', ᵀ: 'T', ᵏ: 'k', ᵐ: 'm' }
const SUB_RE = /[₀-₉₊₋ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+/y
const SUP_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿⁱᴸᵀᵏᵐ]+/y
const UNI_MATH = /[∫∑Σ∏√≈≤≥≠→←⇒⇔×·÷∞∂∇±°∠∝∈…∼≡⊕½α-ωΑ-Ω₀-₉⁰-⁹¹²³⁺⁻ⁿᴸµ]/

/* ------------------------------------------------------------------------------------------------ run finding */

type Kind = 'strong' | 'weak' | 'prose'
const OPTOK = /^[-+*/=<>~|,;:!%−–]+$/                    // includes the Unicode minus the sheets use
const TRAIL = /[,;:.?!]+$/

function lettersOf(t: string): string[] { return t.match(/[A-Za-z]+/g) ?? [] }

function isMathWord(w: string): boolean {
  return GREEK_LC.has(w) || GREEK_UC.has(w) || FUNCS.has(w) || BIG.has(w) || w === 'sqrt' || w === 'inf' || w === 'infty' || w === 'angle' || w === 'ohm' || w === 'atan' || w === 'asin' || w === 'acos'
}
function isAcronym(w: string): boolean { return w.length >= 2 && w.length <= 6 && w === w.toUpperCase() }

function hasStrongMark(t: string): boolean {
  return /\^/.test(t) || /[A-Za-z0-9)\]]_[A-Za-z0-9({]/.test(t) || /sqrt\(/.test(t) || /(<=|>=|!=|->|=>)/.test(t) || /=/.test(t) ||
    /[A-Za-z0-9)][<>][A-Za-z0-9(]/.test(t) || /\d\/\d/.test(t) || /^[A-Z]\.[a-z]$/.test(t) || UNI_MATH.test(t) ||
    /^\{[^{}]*\}$/.test(t) || /(Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega)\(/.test(t) ||
    /(^|[^A-Za-z])(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|log|ln|exp|arctan|arcsin|arccos)\(/.test(t) || /\.\.\d/.test(t)
}

function classify(tok: string): Kind {
  const core = tok.replace(TRAIL, '')
  if (!core) return 'prose'
  if (hasStrongMark(core)) return 'strong'
  if (OPTOK.test(core)) return 'weak'
  if (/^\*|\*$|^#|^\||\|$|^>/.test(core)) return 'prose'    // Markdown marks stay out of the maths
  if (/\d(st|nd|rd|th|ths)\b/.test(core)) return 'prose'    // 36ths, 2nd: ordinals and fractions in words
  const words = lettersOf(core)
  for (const w of words) {
    if (w.length >= 2 ? STOP.has(w.toLowerCase()) : w === 'a') return 'prose'
    if (w.length <= 3 || isMathWord(w) || isAcronym(w)) continue
    return 'prose'
  }
  // letters only joined by ordinary punctuation or digits: weak. Anything else (quotes, @, URLs) is prose.
  return /^[A-Za-z0-9()[\]{}+\-*/=<>.,'^_|!%]+$/.test(core) ? 'weak' : 'prose'
}

function bal(t: string): number {
  let d = 0
  for (const c of t) { if (c === '(' || c === '[' || c === '{') d++; else if (c === ')' || c === ']' || c === '}') d-- }
  return d
}

/** True when a closing bracket has no opener in the range and cannot be peeled off the last token's end
 *  ("bullet)=0.6" cannot, "2/5)" can: peeling the final ")" leaves "2/5"). */
function straddles(cores: string[]): boolean {
  let total = 0
  for (const c of cores) total += bal(c)
  let need = Math.max(0, -total)
  const copy = cores.slice()
  const last = copy.length - 1
  while (need > 0 && /[)\]}]$/.test(copy[last])) { copy[last] = copy[last].slice(0, -1); need-- }
  let d = 0
  for (const c of copy) for (const ch of c) { if ('([{'.includes(ch)) d++; else if (')]}'.includes(ch) && --d < 0) return true }
  return false
}

/** Wrap the maths runs of one plain text segment (no $ spans, no code). */
function wrapPlain(text: string): string {
  const pieces = text.split(/(\s+)/)                 // tokens and the whitespace between them
  const toks: { t: string; ws: string; k: Kind }[] = []
  let ws = ''
  for (const p of pieces) {
    if (!p) continue
    if (/^\s+$/.test(p)) ws += p
    else { toks.push({ t: p, ws, k: classify(p) }); ws = '' }
  }
  const tail = ws
  if (!toks.some((x) => x.k === 'strong')) return text
  // 1. ranges of adjacent non-prose tokens; a trailing , ; : . ? ! ends a range unless a bracket is still open
  const ranges: [number, number][] = []
  let from = -1
  let depth = 0
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].k === 'prose') { if (from >= 0) ranges.push([from, i]); from = -1; depth = 0; continue }
    if (from < 0) from = i
    const core = toks[i].t.replace(TRAIL, '')
    depth += bal(core)
    if (core.length < toks[i].t.length && depth <= 0) { ranges.push([from, i + 1]); from = -1; depth = 0 }
  }
  if (from >= 0) ranges.push([from, toks.length])
  // 2. a closing bracket with no opener inside the range ("P(kill per bullet)=0.6") pulls the prose before it in
  //    (at most 8 tokens), so a bracket never straddles the $
  let prevEnd = 0
  const plan: [number, number][] = []
  for (let [a, b] of ranges) {
    let lim = 8
    while (a > prevEnd && lim-- > 0 && straddles(toks.slice(a, b).map((x) => x.t.replace(TRAIL, '')))) a--
    plan.push([a, b])
    prevEnd = b
  }
  let out = ''
  let cursor = 0
  const plain = (a: number, b: number) => { for (let i = a; i < b; i++) out += toks[i].ws + toks[i].t }
  for (const [a0, b0] of plan) {
    let a = a0
    let b = b0
    // 3. trim operators at the edges, and a lone letter that only labels the number after it ("B 2/5")
    const isOp = (i: number) => OPTOK.test(toks[i].t.replace(TRAIL, ''))
    for (;;) {
      if (a < b && isOp(a)) { a++; continue }
      if (b > a && isOp(b - 1)) { b--; continue }
      if (a + 1 < b && /^[A-Za-z]$/.test(toks[a].t) && /^[([]?[-]?\d/.test(toks[a + 1].t)) { a++; continue }
      break
    }
    const body = toks.slice(a, b).map((x) => ({ t: x.t, ws: x.ws }))
    let lead = ''
    let trail = ''
    if (body.length) {
      let total = body.reduce((n, x) => n + bal(x.t.replace(TRAIL, '')), 0)
      while (total > 0 && /^[([{]/.test(body[0].t)) { lead += body[0].t[0]; body[0].t = body[0].t.slice(1); total-- }
      const last = body[body.length - 1]
      let core = last.t.replace(TRAIL, '')
      const punct = last.t.slice(core.length)
      while (total < 0 && /[)\]}]$/.test(core)) { trail = core[core.length - 1] + trail; core = core.slice(0, -1); total++ }
      last.t = core + punct
    }
    const strong = body.some((x) => classify(x.t) === 'strong')
    plain(cursor, a)
    if (!body.length || !strong) { plain(a, b); cursor = b; continue }
    const lastTok = body[body.length - 1]
    const punct = (TRAIL.exec(lastTok.t) ?? [''])[0]
    const src = body.map((x, i) => (i === 0 ? '' : x.ws) + (x === lastTok ? x.t.slice(0, x.t.length - punct.length) : x.t)).join('')
    out += body[0].ws + lead + '$' + convRun(src) + '$' + trail + punct
    cursor = b
  }
  plain(cursor, toks.length)
  return out + tail
}

/* ------------------------------------------------------------------------------------------------ run conversion */

interface Part { k: 'atom' | 'op' | 'sp'; t: string; raw?: string; inner?: string; paren?: boolean; big?: boolean; frac?: boolean }

function texWord(w: string): string {
  if (GREEK_LC.has(w) || GREEK_UC.has(w)) return '\\' + w
  if (FUNCS.has(w)) return '\\' + w
  if (w === 'atan' || w === 'asin' || w === 'acos') return `\\operatorname{${w}}`
  if (w === 'inf' || w === 'infty' || w === 'infinity') return '\\infty'
  if (w === 'angle') return '\\angle'
  if (w === 'sqrt') return '\\sqrt'
  if (STOP.has(w.toLowerCase()) && w.length >= 2) return `\\text{${w}}`
  if (w.length >= 3 && isAcronym(w)) return `\\mathrm{${w}}`
  if (w.length >= 4) return `\\text{${w}}`
  return w
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

class Conv {
  private s: string
  constructor(s: string) { this.s = s }
  i = 0

  seq(close: string | null, depth: number): Part[] {
    const s = this.s
    const parts: Part[] = []
    let numCtx = false
    let sawSpace = false
    const push = (p: Part) => { parts.push(p) }
    while (this.i < s.length) {
      const c = s[this.i]
      if (close && c === close) break
      if (/\s/.test(c)) {
        while (this.i < s.length && /\s/.test(s[this.i])) this.i++
        if (parts.length && parts[parts.length - 1].k !== 'sp') push({ k: 'sp', t: ' ' })
        sawSpace = true
        continue
      }
      // a unit after a number and a space: "10 ohm", "50 Hz", "2 ms"
      if (numCtx && sawSpace) {
        const m = /^[A-Za-z]+/.exec(s.slice(this.i))
        if (m && UNITS[m[0]] !== undefined && !/[A-Za-z0-9_^(]/.test(s[this.i + m[0].length] ?? '')) {
          this.i += m[0].length
          push({ k: 'atom', t: `\\,\\mathrm{${UNITS[m[0]]}}`.replace('\\mathrm{\\Omega}', '\\Omega').replace('\\mathrm{\\mu ', '\\mu\\mathrm{') })
          sawSpace = false
          continue
        }
        if (m && m[0] === 'deg') { this.i += 3; push({ k: 'atom', t: '^\\circ' }); sawSpace = false; continue }
      }
      // a Unicode script right after an operator or a bracket ("|H(f)|²"): it rides on the previous part
      if (SUB_CHARS[c] !== undefined || SUP_CHARS[c] !== undefined) {
        const sc = this.script()!
        const prev = parts[parts.length - 1]
        if (prev && prev.k !== 'sp') prev.t += sc
        else push({ k: 'atom', t: sc })
        continue
      }
      const startI = this.i
      const chain = this.chain(depth)
      if (chain) {
        push(chain)
        numCtx = !!chain.raw && /\d$/.test(chain.raw)
        sawSpace = false
        continue
      }
      this.i = startI
      // operators and stray punctuation
      const two = s.slice(this.i, this.i + 2)
      let t: string
      let adv = 1
      if (two === '<=') { t = '\\le'; adv = 2 } else if (two === '>=') { t = '\\ge'; adv = 2 } else if (two === '!=') { t = '\\ne'; adv = 2 }
      else if (two === '->') { t = '\\to'; adv = 2 } else if (two === '=>') { t = '\\Rightarrow'; adv = 2 } else if (two === '..') { t = '\\ldots'; adv = 2; while (s[this.i + adv] === '.') adv++ }
      else if (c === '*') t = '\\cdot'
      else if (c === '.') t = /[A-Za-z]/.test(s[this.i + 1] ?? '') ? '\\cdot' : '.'
      else if (c === '~') t = '\\sim'
      else if (c === '%') t = '\\%'
      else if (c === '&') t = '\\&'
      else if (c === '#') t = '\\#'
      else if (c === '_') t = '\\_'
      else if (c === '\\') t = '\\backslash'
      else if (c === '{') t = '\\{'
      else if (c === '}') t = '\\}'
      else if (SYM_OPS[c] !== undefined) t = SYM_OPS[c]
      else t = c
      if (t.startsWith('\\') && /[A-Za-z]/.test(s[this.i + adv] ?? '')) t += ' '   // "\cdot n", not "\cdotn"
      this.i += adv
      push({ k: 'op', t, raw: c })
      numCtx = false
      sawSpace = false
    }
    return this.fractions(parts)
  }

  /** "A/B" becomes \frac only when A starts a term and both sides are single chains. */
  fractions(parts: Part[]): Part[] {
    for (let k = 1; k < parts.length - 1; k++) {
      const p = parts[k]
      if (p.k !== 'op' || p.raw !== '/') continue
      const n = parts[k - 1]
      const d = parts[k + 1]
      if (n.k !== 'atom' || d.k !== 'atom' || n.frac) continue
      let j = k - 2
      while (j >= 0 && parts[j].k === 'sp') j--
      if (j >= 0 && !(parts[j].k === 'op' || parts[j].big)) continue
      const num = n.paren ? n.inner! : n.t
      const den = d.paren ? d.inner! : d.t
      parts.splice(k - 1, 3, { k: 'atom', t: `\\frac{${num}}{${den}}`, frac: true, raw: d.raw })
      k--
    }
    return parts
  }

  script(): string | null {
    const s = this.s
    const c = s[this.i]
    const start = this.i
    let sign = ''
    let which: '^' | '_' | null = null
    if (c === '^') { which = '^'; this.i++ } else if (c === '_') { which = '_'; this.i++ }
    else if (SUB_CHARS[c] !== undefined) {
      SUB_RE.lastIndex = this.i
      const m = SUB_RE.exec(s)!
      this.i += m[0].length
      return '_{' + [...m[0]].map((ch) => SUB_CHARS[ch]).join('') + '}'
    } else if (SUP_CHARS[c] !== undefined) {
      SUP_RE.lastIndex = this.i
      const m = SUP_RE.exec(s)!
      this.i += m[0].length
      return '^{' + [...m[0]].map((ch) => SUP_CHARS[ch]).join('') + '}'
    }
    if (!which) return null
    const d = s[this.i]
    let arg: string | null = null
    if (d === '{' || d === '(') {
      const close = d === '{' ? '}' : ')'
      const save = this.i
      this.i++
      const inner = this.seq(close, 1)
      if (this.s[this.i] === close) { this.i++; arg = this.render(inner) } else { this.i = save; arg = null }
    }
    if (arg === null) {
      if (/[-+−]/.test(s[this.i] ?? '') && /[A-Za-z0-9½]/.test(s[this.i + 1] ?? '')) { sign = s[this.i] === '+' ? '+' : '-'; this.i++ }
      const rest = s.slice(this.i)
      let m: RegExpExecArray | null
      if ((m = /^\d+(\.\d+)?/.exec(rest))) { arg = m[0]; this.i += m[0].length }
      else if (rest[0] === '½') { arg = '\\frac{1}{2}'; this.i++ }
      else if (GREEK_CHARS[rest[0]]) { arg = '\\' + GREEK_CHARS[rest[0]]; this.i++ }
      else if ((m = /^[A-Za-z]+/.exec(rest))) {
        if (which === '_') { arg = m[0]; this.i += m[0].length }
        else if (isMathWord(m[0]) && m[0] !== 'sqrt') { arg = texWord(m[0]); this.i += m[0].length }
        else { arg = m[0][0]; this.i += 1 }
      } else if (SYM_ATOMS[rest[0]] !== undefined && rest[0] !== '°') { arg = SYM_ATOMS[rest[0]]; this.i++ }
      else { this.i = start; return null }              // "^" with nothing usable after it stays a literal
    }
    return `${which}{${sign}${arg}}`
  }

  /** One chain: adjacent words, numbers and groups with their scripts, up to a space or an operator. */
  chain(depth: number): Part | null {
    const s = this.s
    let tex = ''
    let raw = ''
    let units = 0
    let only: Part | null = null
    let big = false
    for (;;) {
      const c = s[this.i]
      if (c === undefined) break
      let unit = ''
      let rawU = ''
      let isGroup = false
      let inner = ''
      let wasBig = false
      if (/[0-9]/.test(c)) {
        const m = /^\d+(\.\d+)?/.exec(s.slice(this.i))!
        unit = m[0]; rawU = m[0]; this.i += m[0].length
      } else if (/[A-Za-z]/.test(c)) {
        const m = /^[A-Za-z]+/.exec(s.slice(this.i))!
        let w = m[0]
        const after = s[this.i + w.length]
        // "wt" inside a cosine: omega t (the bank writes the angular frequency as w)
        if (w === 'wt') { this.i += 2; unit = '\\omega t'; rawU = 'wt' }
        else {
          this.i += w.length
          if (BIG.has(w) && (after === '_' || after === '^')) { unit = '\\' + w; wasBig = true }
          else if (w === 'sqrt' && after === '(') {
            this.i++
            const inn = this.seq(')', depth + 1)
            if (s[this.i] === ')') this.i++
            unit = `\\sqrt{${this.render(inn)}}`
          } else if (/^[YZHyzh]$/.test(w) && /^[12]{2}(?![0-9])/.test(s.slice(this.i))) { unit = `${w}_{${s.slice(this.i, this.i + 2)}}`; this.i += 2 }
          else unit = texWord(w)
          rawU = w
        }
        // a word glued to a function name's argument: "cos(" keeps the paren in the chain
      } else if (GREEK_CHARS[c]) {
        unit = '\\' + GREEK_CHARS[c]
        rawU = c
        this.i++
        if (/[A-Za-z]/.test(s[this.i] ?? '')) unit += ' '
      } else if (c === '√') {
        this.i++
        const nx = s[this.i]
        if (nx === '(') {
          this.i++
          const inn = this.seq(')', depth + 1)
          if (s[this.i] === ')') this.i++
          unit = `\\sqrt{${this.render(inn)}}`
        } else {
          const m = /^[A-Za-z0-9]+/.exec(s.slice(this.i))
          if (m) { unit = `\\sqrt{${m[0]}}`; this.i += m[0].length } else unit = '\\surd'
        }
        rawU = '√'
      } else if (SYM_ATOMS[c] !== undefined) {
        unit = SYM_ATOMS[c]; rawU = c; this.i++
        if (c === '∫' || c === '∑' || c === 'Σ' || c === '∏') wasBig = true
        else if (/[A-Za-z]/.test(s[this.i] ?? '')) unit += ' '
      } else if (c === '½') { unit = '\\frac{1}{2}'; rawU = c; this.i++ }
      else if (c === '(' || c === '[' || c === '{') {
        const close = OPEN_TO_CLOSE[c]
        const save = this.i
        this.i++
        const inn = this.seq(close, depth + 1)
        if (s[this.i] === close) {
          this.i++
          inner = this.render(inn)
          const lo = c === '{' ? '\\{' : c
          const lc = c === '{' ? '\\}' : close
          unit = lo + inner + lc
          isGroup = c === '('
          rawU = c
        } else { this.i = save; break }                 // unmatched: the caller emits it as a literal
      } else if (c === "'") { unit = "'"; rawU = "'"; this.i++; tex += unit; raw += rawU; continue }
      else break
      // scripts on the unit
      let scripts = ''
      for (;;) {
        const sc = this.script()
        if (sc === null) break
        scripts += sc
      }
      tex += unit + scripts
      raw += rawU + (scripts ? '^' : '')
      units++
      big = units === 1 && wasBig
      only = units === 1 ? { k: 'atom', t: unit + scripts, inner, paren: isGroup && !scripts } : null
    }
    if (!units && !tex) return null
    return { k: 'atom', t: tex, raw: raw.replace(/\^$/, ''), inner: only?.paren ? only.inner : undefined, paren: !!only?.paren, big }
  }

  render(parts: Part[]): string {
    return parts.map((p) => p.t).join('').replace(/\s+/g, ' ').trim()
  }
}

function convRun(src: string): string {
  const c = new Conv(src)
  const parts = c.seq(null, 0)
  // a stray unmatched closer ends the loop in seq only when it equals `close`; with null it never does
  let tex = parts.map((p) => p.t).join('')
  while (c.i < src.length) { tex += src[c.i]; c.i++ }
  return tex.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------------------------------------ public */

/** Pieces of a string that are already fenced (math, display math) or must not be read as maths (code). */
const PROTECT = /(\$\$[\s\S]+?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$|`[^`\n]*`|\*\*)/g

export function toTex(src: string): string {
  if (!src) return src
  const bits = src.split(PROTECT)
  return bits.map((b, i) => (i % 2 === 1 ? b : wrapPlain(b))).join('')
}

export interface MathRun { kind: 'text' | 'inline' | 'display'; value: string }

/** Split a TeX-bearing string into text, $...$ and $$...$$ runs. "\$" is a literal dollar. */
export function splitMath(src: string): MathRun[] {
  const out: MathRun[] = []
  const re = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index).replace(/\\\$/g, '$') })
    if (m[1] !== undefined) out.push({ kind: 'display', value: m[1].trim() })
    else out.push({ kind: 'inline', value: m[2] })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last).replace(/\\\$/g, '$') })
  return out
}

/** True when toTex found maths in a string that carried none (what the Reader's raw toggle undoes). */
export function wasConverted(src: string): boolean { return toTex(src) !== src }
