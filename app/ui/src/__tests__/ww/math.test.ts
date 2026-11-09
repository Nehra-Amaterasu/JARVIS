/**
 * Maths engine and typesetting (Well Wisher chunk 3): toTex over the whole question bank and 22 sheet
 * lines, the fallback renderer, MathText (fallback, lazy KaTeX with the import mocked, errors that do not
 * throw) and the Reader / paper-panel wiring. Fixtures are textbook exercise strings and made-up sheet
 * lines; nothing here is personal data.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from '../../germoney/Reader'
import { PaperPanel, type ExamPaper, type GeneratedPaper } from '../../germoney/pages/Exams'
import { texFallback } from '../../ww/math/fallback'
import { katexNow, loadKatex, resetKatexForTests } from '../../ww/math/katex-loader'
import { MathText } from '../../ww/math/MathText'
import { splitMath, toTex } from '../../ww/math/toTex'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A stand-in engine: the real one is 0.3 MB of JS and the question here is when it is imported, not what it draws.
const engine = vi.hoisted(() => ({ imports: 0, failOn: '' }))
vi.mock('katex', () => {
  engine.imports++
  const renderToString = (tex: string, o?: { displayMode?: boolean }) => {
    if (engine.failOn && tex.includes(engine.failOn)) throw new Error('KaTeX parse error: mock failure')
    return `<span class="katex-mock" data-display="${o?.displayMode ? 1 : 0}">${tex.replace(/</g, '&lt;')}</span>`
  }
  return { default: { renderToString }, renderToString }
})
vi.mock('katex/dist/katex.min.css', () => ({}))

/** [source, expected toTex output, or null when the line has no maths and must come back untouched] */
const BANK: [string, string | null][] = [
  ["Change the order of integration in int_0^inf int_0^x e^(-xy) y dy dx.", "Change the order of integration in $\\int_{0}^{\\infty} \\int_{0}^{x} e^{-xy} y dy dx$."],
  ["Verify whether V = 2xyz i + (x^2 z + 2y) j + x^2 y k is irrotational.", "Verify whether $V = 2xyz i + (x^{2} z + 2y) j + x^{2} y k$ is irrotational."],
  ["Prove that Delta log f(x) = log[1 + Delta f(x)/f(x)].", "Prove that $\\Delta \\log f(x) = \\log[1 + \\Delta f(x)/f(x)]$."],
  ["Evaluate int_0^6 dx/(1+x^2) by the trapezoidal rule.", "Evaluate $\\int_{0}^{6} \\frac{dx}{1+x^{2}}$ by the trapezoidal rule."],
  ["Four persons are chosen at random from 3 men, 2 women and 4 children. Probability that exactly two of them are children?", null],
  ["Change the order of integration in int_0^1 int_(x^2)^(2-x) xy dy dx and hence evaluate it.", "Change the order of integration in $\\int_{0}^{1} \\int_{x^{2}}^{2-x} xy dy dx$ and hence evaluate it."],
  ["Evaluate the triple integral of z^2/(x^2+y^2+z^2) over the volume of the sphere x^2+y^2+z^2 = 2.", "Evaluate the triple integral of $\\frac{z^{2}}{x^{2}+y^{2}+z^{2}}$ over the volume of the sphere $x^{2}+y^{2}+z^{2} = 2$."],
  ["Directional derivative of phi = x^4+y^4+z^4 at A(1,-2,1) in the direction of AB, B(2,6,-1); also the maximum directional derivative at (1,-2,1).", "Directional derivative of $\\phi = x^{4}+y^{4}+z^{4}$ at A(1,-2,1) in the direction of AB, B(2,6,-1); also the maximum directional derivative at (1,-2,1)."],
  ["Evaluate the surface integral of A.n ds, A = (x+y^2) i - 2x j + 2yz k, S = plane 2x+y+2z = 6 in the first octant.", "Evaluate the surface integral of $A\\cdot n ds$, $A = (x+y^{2}) i - 2x j + 2yz k$, S = plane $2x+y+2z = 6$ in the first octant."],
  ["False position method: smallest positive root of x - e^(-x) = 0, correct to three decimals.", "False position method: smallest positive root of $x - e^{-x} = 0$, correct to three decimals."],
  ["Population 1971-2021 (20,24,29,36,46,51 lakh, 10-year steps): estimate the increase in population from 2005 to 2011.", null],
  ["Gauss-Seidel: 20x+y-2z=17, 3x+20y-z=-18, 2x-3y+20z=25.", "Gauss-Seidel: $20x+y-2z=17$, $3x+20y-z=-18$, $2x-3y+20z=25$."],
  ["RK4: y at x=1 given y(0)=1, n=2 (h=0.5), dy/dx = (y-x)/(y+x).", "RK4: y at $x=1$ given $y(0)=1$, $n=2 (h=0.5)$, $\\frac{dy}{dx} = \\frac{y-x}{y+x}$."],
  ["Bivariate table X in {-1,0,1}, Y in {0,1,2} (fifteenths): (i) marginals of X and Y, (ii) conditional distribution of X given Y=2.", "Bivariate table X in $\\{-1,0,1\\}$, Y in $\\{0,1,2\\}$ (fifteenths): (i) marginals of X and Y, (ii) conditional distribution of X given $Y=2$."],
  ["What is a stochastic process? Three examples. Show X(t) = R cos(wt + theta) is a stochastic process.", "What is a stochastic process? Three examples. Show $X(t) = R \\cos(\\omega t + \\theta)$ is a stochastic process."],
  ["Find the value of Gamma(1/2).", "Find the value of $\\Gamma(\\frac{1}{2})$."],
  ["Green's theorem: line integral of (x^2 y dx + x^2 dy), C = triangle (0,0),(1,0),(1,1) counter-clockwise.", "Green's theorem: line integral of $(x^{2} y dx + x^{2} dy)$, C = triangle (0,0),(1,0),(1,1) counter-clockwise."],
  ["Newton's divided difference: f(8) from x = 4,5,7,10,11,13; f = 48,100,294,900,1210,2028.", "Newton's divided difference: f(8) from $x = 4,5,7,10,11,13$; $f = 48,100,294,900,1210,2028$."],
  ["Train speed every 5 s for 45 s (30,24,19,16,13,11,10,8,7,5): Simpson's 3/8 rule for distance in 45 s.", "Train speed every 5 s for 45 s (30,24,19,16,13,11,10,8,7,5): Simpson's $\\frac{3}{8}$ rule for distance in 45 s."],
  ["P(A hits)=3/5, P(B hits)=2/5; A fires 8 shots while B fires 10; they fire together. Probability that the second person hits the target.", "$P(A \\text{hits})=\\frac{3}{5}$, $P(B \\text{hits})=\\frac{2}{5}$; A fires 8 shots while B fires 10; they fire together. Probability that the second person hits the target."],
  ["Assignment-1 Q1: Urns I, II, III (1W2B3R; 2W1B1R; 4W5B3R); one urn at random, two balls white and red. Probability they came from urn I?", null],
  ["Assignment-1 Q2: 10 red, 30 white, 30 blue, 15 orange marbles, two draws with replacement: both white; first red and second white.", null],
  ["Assignment-1 Q3: 12 boys and 8 girls, three chosen in order: first two boys and third a girl; first and third same sex, second opposite.", null],
  ["Assignment-1 Q4: Die thrown twice, sum is 6: probability that 4 appeared at least once (ans 2/5).", "Assignment-1 Q4: Die thrown twice, sum is 6: probability that 4 appeared at least once (ans $\\frac{2}{5}$)."],
  ["Assignment-1 Q5: 6 white and 9 black balls, four drawn at a time: first draw four white, second four black, with and without replacement.", null],
  ["Assignment-1 Q6: Four bullets, P(kill per bullet)=0.6: probability the dacoit is still alive.", "Assignment-1 Q6: Four bullets, $P(\\text{kill} \\text{per} \\text{bullet})=0.6$: probability the dacoit is still alive."],
  ["Assignment-1 Q7: Three independent attributes with probabilities 1/20, 1/50, 1/100: probability of all three.", "Assignment-1 Q7: Three independent attributes with probabilities $\\frac{1}{20}$, $\\frac{1}{50}$, $\\frac{1}{100}$: probability of all three."],
  ["Assignment-1 Q8: Bag 1: 4W 2B, bag 2: 3W 3B; bag at random then a ball: probability white (ans 7/12).", "Assignment-1 Q8: Bag 1: 4W 2B, bag 2: 3W 3B; bag at random then a ball: probability white (ans $\\frac{7}{12}$)."],
  ["Assignment-1 Q9: Part A 9% defective, part B 5%: probability the assembled article is not defective.", null],
  ["Assignment-1 Q10: Machines A (1/4) and B (1/3) still working in 5 years: both, neither, only B, at least one.", "Assignment-1 Q10: Machines A $(\\frac{1}{4})$ and B $(\\frac{1}{3})$ still working in 5 years: both, neither, only B, at least one."],
  ["Assignment-1 Q11: Pass A 4/5, B 3/4, C 5/6, D 2/3; must pass A and at least two others: probability of qualifying (61/90).", "Assignment-1 Q11: Pass A $\\frac{4}{5}$, B $\\frac{3}{4}$, C $\\frac{5}{6}$, D $\\frac{2}{3}$; must pass A and at least two others: probability of qualifying $(\\frac{61}{90})$."],
  ["Assignment-1 Q12: Husband 1/7, wife 1/5 selected: both, only one, none.", "Assignment-1 Q12: Husband $\\frac{1}{7}$, wife $\\frac{1}{5}$ selected: both, only one, none."],
  ["Assignment-1 Q13: A hits 3/5, B 2/5, C 3/4, one shot each: exactly two hits; at least two hits.", "Assignment-1 Q13: A hits $\\frac{3}{5}$, B $\\frac{2}{5}$, C $\\frac{3}{4}$, one shot each: exactly two hits; at least two hits."],
  ["Assignment-1 Q14: Repeat of Q5 (6 white, 9 black, four at a time, with and without replacement).", null],
  ["Assignment-1 Q15: 10 white and 15 black, two in succession without replacement: first white, second black.", null],
  ["Assignment-1 Q16: Two diamonds in two draws without replacement (1/17).", "Assignment-1 Q16: Two diamonds in two draws without replacement $(\\frac{1}{17})$."],
  ["Assignment-1 Q17: Repeat of Q4 (sum 6, a 4 at least once).", null],
  ["Assignment-1 Q18: Die twice, sum 7: probability that 2 appeared at least once (1/3).", "Assignment-1 Q18: Die twice, sum 7: probability that 2 appeared at least once $(\\frac{1}{3})$."],
  ["SUBJ Special CIE 2a: joint table of X,Y in {1..4} (36ths): marginals; conditional of X given Y=1 and of Y given X=2.", "SUBJ Special CIE 2a: joint table of X,Y in $\\{1\\ldots4\\}$ (36ths): marginals; conditional of X given $Y=1$ and of Y given $X=2$."],
  ["SUBJ Special CIE 2b: f(x,y)=6x^2 on the unit square: verify total probability 1; P(0<X<3/4, 1/3<Y<2), P(X+Y<1), P(X>Y), P(X<1|Y<2).", "SUBJ Special CIE 2b: $f(x,y)=6x^{2}$ on the unit square: verify total probability 1; $P(0<X<\\frac{3}{4}, \\frac{1}{3}<Y<2)$, $P(X+Y<1)$, $P(X>Y)$, $P(X<1|Y<2)$."],
  ["SUBJ Jun 2026 2a: P(x) table with k for x=-2..3: find k, mean, variance.", "SUBJ Jun 2026 2a: P(x) table with k for $x=-2\\ldots3$: find k, mean, variance."],
  ["SUBJ Dec 2025 1a: pdf a x(2-x) on [0,2]: find a.", null],
  ["Explain the maximum power transfer theorem for a DC network.", null],
  ["State source transformation rules for an AC network.", null],
  ["V = 100 angle 30 deg V at 50 Hz: time-domain expression and voltage at t = 2 ms.", "$V = 100 \\angle 30 ^\\circ \\,\\mathrm{V}$ at 50 Hz: time-domain expression and voltage at $t = 2 \\,\\mathrm{ms}$."],
  ["State the initial and final value theorems of the Laplace transform with one example each.", null],
  ["Define ABCD (transmission) parameters, write the equations, state the symmetry condition.", null],
  ["Derive equivalent resistance for series and parallel; 2, 4, 6 ohm in parallel on 12 V: total current and each branch current.", null],
  ["Superposition theorem: current in the 23 ohm resistor and the voltage across it (circuit in paper).", null],
  ["Series RL, v = 100 sin(100t + 30) V, R = 10 ohm, L = 0.1 H: phasor voltage, impedance, phasor current, i(t).", "Series RL, $v = 100 \\sin(100t + 30) V$, $R = 10 \\,\\Omega$, $L = 0.1 \\,\\mathrm{H}$: phasor voltage, impedance, phasor current, i(t)."],
  ["Phasor analysis: current and impedance of series RL, R = 10 ohm, L = 0.1 H, v = 100 sin(100t) V.", "Phasor analysis: current and impedance of series RL, $R = 10 \\,\\Omega$, $L = 0.1 \\,\\mathrm{H}$, $v = 100 \\sin(100t) V$."],
  ["Convolution of e^(-2t)u(t) and e^(-3t)u(t) by the convolution integral and by Laplace (verify); inverse Laplace of (3s+7)/(s^2+5s+6).", "Convolution of $e^{-2t}u(t)$ and $e^{-3t}u(t)$ by the convolution integral and by Laplace (verify); inverse Laplace of $\\frac{3s+7}{s^{2}+5s+6}$."],
  ["Laplace transform: i(t), t>=0, in an RL circuit with 10 V DC applied at t=0, zero initial current.", "Laplace transform: i(t), $t\\ge0$, in an RL circuit with 10 V DC applied at $t=0$, zero initial current."],
  ["Define ABCD parameters; derive the reciprocity and symmetry conditions.", null],
  ["Derive h-parameters in terms of Y-parameters; find h for Y11=0.5 S, Y12=Y21=-0.2 S, Y22=0.4 S.", "Derive h-parameters in terms of Y-parameters; find h for $Y_{11}=0.5 \\,\\mathrm{S}$, $Y_{12}=Y_{21}=-0.2 \\,\\mathrm{S}$, $Y_{22}=0.4 \\,\\mathrm{S}$."],
  ["Explain passive filters: working and frequency response of low-pass, high-pass, band-pass and band-reject, with expressions.", null],
  ["Transfer function; derive it for a simple RC circuit; decibel scale; series and parallel resonance with frequency-response curves.", null],
  ["State and explain Thevenin's theorem; steps to find the Thevenin equivalent.", null],
  ["Concept of phasors; derive the phasor relationships for R, L and C.", null],
  ["Using Laplace transform, analyse an RL circuit with a DC input and an initial current.", null],
  ["Define Z-parameters; derive the reciprocity and symmetry conditions.", null],
  ["Behaviour of series resonant circuits; briefly describe a low-pass filter.", null],
  ["Use the convolution theorem to find L^-1{1/((s+a)(s+b))}.", "Use the convolution theorem to find $L^{-1}\\{\\frac{1}{(s+a)(s+b)}\\}$."],
  ["Find L^-1{((3a-4s)/(s^2+a^2)) e^(-5s)}.", "Find $L^{-1}\\{(\\frac{3a-4s}{s^{2}+a^{2}}) e^{-5s}\\}$."],
  ["State the convolution theorem and evaluate L^-1{p/((p^2+1)(p^2+4))}.", "State the convolution theorem and evaluate $L^{-1}\\{\\frac{p}{(p^{2}+1)(p^{2}+4)}\\}$."],
  ["Solve x'' + 2x' + 5x = e^(-t) sin t, x(0)=0, x'(0)=1 by Laplace transform.", "Solve $x'' + 2x' + 5x = e^{-t} \\sin t$, $x(0)=0$, $x'(0)=1$ by Laplace transform."],
  ["Solve y'' - 3y' + 2y = 1 - e^(2t), y(0)=1, y'(0)=0 by Laplace transform.", "Solve $y'' - 3y' + 2y = 1 - e^{2t}$, $y(0)=1$, $y'(0)=0$ by Laplace transform."],
  ["Apply the convolution theorem to evaluate L^-1{1/(s^2+a^2)^2}.", "Apply the convolution theorem to evaluate $L^{-1}\\{\\frac{1}{(s^{2}+a^{2})^{2}}\\}$."],
  ["Explain the overview of IoT systems including new trends, applications and challenges.", null],
  ["Define the MQTT protocol and mention one key feature.", null],
  ["What is a Wireless Sensor Network (WSN)?", null],
  ["Discuss communication security challenges and solutions in IoT systems.", null],
  ["Define IoT and list any two new trends in IoT systems.", null],
  ["What are sensors and actuators in an IoT system?", null],
  ["Discuss performance trade-offs (cost vs latency vs power vs accuracy) and criteria for selecting microcontrollers.", null],
  ["Describe applications of IoT in smart homes, healthcare and smart cities.", null],
  ["Describe techniques used to improve energy efficiency in WSN.", null],
  ["Discuss the use of camera and vision-based systems in IoT applications.", null],
  ["Describe smart and connected devices such as Raspberry Pi, Google Home Mini, Alexa and Echo Show.", null],
  ["Explain wireless sensor networks; discuss localization, node mobility and energy efficiency.", null],
  ["Explain the WSN architecture and discuss its energy-efficiency protocol.", null],
  ["Explain the IoT communication technologies Wi-Fi, Bluetooth, RFID, LoRa and LoRaWAN.", null],
  ["Explain design principles for low-power IoT devices and energy-harvesting methods.", null],
  ["Explain industrial IoT applications in agriculture, transportation, manufacturing and automobiles.", null],
  ["Analyse IoT communication protocols; a node sends 1000 bits at 50 nJ/bit electronics energy (ignore amplifier): total transmit energy.", null],
  ["Explain healthcare monitoring systems as a case study of IoT.", null],
  ["Discuss the use of camera and vision-based systems in IoT applications.", null],
  ["Explain the role of deep learning and basic neural-network concepts for IoT.", null],
]
const SHEET: [string, string | null][] = [
  ["The corner frequency is f_c = 1/(2πRC) for a first-order low-pass.", "The corner frequency is $f_{c} = \\frac{1}{2\\pi RC}$ for a first-order low-pass."],
  ["Natural response decays as e^(−ωnt) with ω² = k/m.", "Natural response decays as $e^{-\\omega nt}$ with $\\omega^{2} = \\frac{k}{m}$."],
  ["The code gain is 2^m − 1 levels, so the step is Vref/(2^m − 1).", "The code gain is $2^{m} - 1$ levels, so the step is $\\frac{\\text{Vref}}{2^{m} - 1}$."],
  ["Differential encoding: d_k = b_k XNOR d_(k-1) at the receiver.", "Differential encoding: $d_{k} = b_{k} \\mathrm{XNOR} d_{k-1}$ at the receiver."],
  ["Cross terms s_i s_j vanish when the symbols are orthogonal.", "Cross terms $s_{i} s_{j}$ vanish when the symbols are orthogonal."],
  ["Drain current ID ≈ ½ µn Cox (W/L)(VGS − VTH)² in saturation.", "Drain current $ID \\approx \\frac{1}{2} \\mu n Cox (\\frac{W}{L})(\\mathrm{VGS} - \\mathrm{VTH})^{2}$ in saturation."],
  ["Power P = V²/R ≤ 0.25 W for this resistor.", "Power $P = \\frac{V^{2}}{R} \\le 0.25 \\,\\mathrm{W}$ for this resistor."],
  ["Noise bandwidth B_n = ∫₀^∞ |H(f)|² df.", "Noise bandwidth $B_{n} = \\int_{0}^{\\infty} |H(f)|^{2} df$."],
  ["The charge Q = ∫₀ᴸ λ dx over the rod.", "The charge $Q = \\int_{0}^{L} \\lambda dx$ over the rod."],
  ["The sum Σ x_i² over the window gives the energy.", "The sum $\\sum x_{i}^{2}$ over the window gives the energy."],
  ["Output swing V^½ scales slowly; (0.1)^(−0.65) is the fitted slope.", "Output swing $V^{\\frac{1}{2}}$ scales slowly; $(0.1)^{-0.65}$ is the fitted slope."],
  ["(1 − X)^(k₀ − 1) is the survival term for the first stage.", "$(1 - X)^{k_{0} - 1}$ is the survival term for the first stage."],
  ["The amplitude is √(a² + b²) and the phase is atan2(b, a) → θ.", "The amplitude is $\\sqrt{a^{2} + b^{2}}$ and the phase is atan2(b, a) $\\to \\theta$."],
  ["Time constant τ = R × C = 4.7 ms for the filter.", "Time constant $\\tau = R \\times C = 4.7 \\,\\mathrm{ms}$ for the filter."],
  ["Use **bold** with e^(-t) and `x^2 stays code` in one line.", "Use **bold** with $e^{-t}$ and `x^2 stays code` in one line."],
  ["## Gain margin x_1 ≥ 2", "## Gain margin $x_{1} \\ge 2$"],
  ["| Symbol | Meaning |", null],
  ["|---|---|", null],
  ["| T_s | sampling period, 1/f_s |", "| $T_{s}$ | sampling period, $\\frac{1}{f_{s}}$ |"],
  ["This sentence has no formulas, only words like integration and pi.", null],
  ["Already fenced: $V_{OD} = V_{GS} - V_{TH}$ and then x^2 outside.", "Already fenced: $V_{OD} = V_{GS} - V_{TH}$ and then $x^{2}$ outside."],
  ["- Step 3: set N_s = 10 and A ± ΔA, then check A_max ≠ 0", "- Step 3: set $N_{s} = 10$ and $A \\pm \\Delta A$, then check $A_{max} \\ne 0$"],
]

const textOf = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent ?? '' }
const staticHtml = (s: string, props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(MathText, { children: s, ...props }))
const md = (s: string, raw = false) => renderToStaticMarkup(createElement('div', null, ...renderMarkdown(s, { raw })))
const count = (s: string, c: string) => s.split(c).length - 1

describe('toTex: the question bank (88 strings)', () => {
  it('has the 88 strings', () => { expect(BANK.length).toBe(88) })
  it('converts every string to the frozen output, and leaves a line with no maths byte for byte', () => {
    for (const [src, want] of BANK) expect(toTex(src), src).toBe(want ?? src)
  })
  it('renders every string with no leftover ^ _ { or backslash in the text (fallback path)', () => {
    for (const [src] of BANK) {
      const text = textOf(staticHtml(src))
      expect(text, src).not.toMatch(/[\^_\\$]/)
      expect(count(text, '{'), src).toBe(count(src, '{'))      // braces left are the set braces the author typed
      expect(count(text, '}'), src).toBe(count(src, '}'))
    }
  })
  it('is idempotent: converting the output again changes nothing', () => {
    for (const [src] of BANK) expect(toTex(toTex(src)), src).toBe(toTex(src))
  })
  it('converts the symbolic strings (at least 40 of 88)', () => {
    expect(BANK.filter(([, w]) => w !== null).length).toBeGreaterThanOrEqual(40)
  })
})

describe('toTex: the sheet dialect (Unicode, caret, underscore) and edge cases', () => {
  it('converts the sheet lines (22, 20 of them with maths)', () => {
    expect(SHEET.length).toBeGreaterThanOrEqual(20)
    for (const [src, want] of SHEET) expect(toTex(src), src).toBe(want ?? src)
  })
  it('the three forms the plan names', () => {
    expect(toTex('int_0^inf int_0^x e^(-xy) y dy dx')).toBe(String.raw`$\int_{0}^{\infty} \int_{0}^{x} e^{-xy} y dy dx$`)
    expect(toTex('x^2 z')).toBe('$x^{2} z$')
    expect(toTex('Gamma(1/2)')).toBe(String.raw`$\Gamma(\frac{1}{2})$`)
    expect(toTex('cos(wt + theta)')).toBe('$' + String.raw`\cos(\omega t + \theta)` + '$')
  })
  it('keeps d_k and s_i s_j apart, and does not eat prose that contains "int" or "pi"', () => {
    expect(toTex('d_k and s_i s_j')).toBe('$d_{k}$ and $s_{i} s_{j}$')
    expect(toTex('Integration by parts, then pi appears in the answer.')).toBe('Integration by parts, then pi appears in the answer.')
    expect(toTex('The sum of the interior angles is fixed.')).toBe('The sum of the interior angles is fixed.')
  })
  it('never touches an existing $...$ span or a code span, and honours \\$', () => {
    expect(toTex('keep $x_{ab}$ and `a^b` as they are')).toBe('keep $x_{ab}$ and `a^b` as they are')
    expect(splitMath(String.raw`costs \$5 and $x$`)).toEqual([{ kind: 'text', value: 'costs $5 and ' }, { kind: 'inline', value: 'x' }])
  })
  it('makes a fraction only when the numerator starts a term', () => {
    expect(toTex('dy/dx = (y-x)/(y+x)')).toBe(String.raw`$\frac{dy}{dx} = \frac{y-x}{y+x}$`)
    expect(toTex('Delta f(x)/f(x) = 0')).toBe(String.raw`$\Delta f(x)/f(x) = 0$`)
  })
})

describe('fallback renderer', () => {
  const html = (tex: string) => renderToStaticMarkup(createElement('span', null, ...texFallback(tex)))
  it('draws sub/superscripts, fractions, roots, Greek and limits without a backslash', () => {
    const h = html(String.raw`\int_0^\infty \frac{\alpha}{\sqrt{x+1}} e^{-x^2} dx`)
    expect(h).toContain('∫')
    expect(h).toContain('<sub>0</sub>')
    expect(h).toContain('<sup>∞</sup>')
    expect(h).toContain('rd-frac')
    expect(h).toContain('√')
    expect(h).toContain('α')
    expect(h).toContain('<sup>-x<sup>2</sup></sup>')
    expect(textOf(h)).not.toContain('\\')
  })
  it('the old LaTeX unit test, now with String.raw so the commands really reach the renderer', () => {
    const h = md(String.raw`Dose $Q = (2/\sqrt{\pi}) N_s \sqrt{Dt}$ and $e^{-x^2/4Dt}$ with $V_{OD}$.`)
    expect(h).toContain('<span class="rd-math">')
    expect(h).toContain('√')
    expect(h).toContain('π')
    expect(h).toContain('N<sub>s</sub>')
    expect(h).toContain('V<sub>OD</sub>')
    expect(h).toContain('e<sup>-x<sup>2</sup>/4Dt</sup>')
    expect(textOf(h)).not.toContain('\\')
  })
  it('prints an unknown command by name and a matrix as its source with a reason', () => {
    expect(textOf(html(String.raw`\mystery{3}`))).not.toContain('\\')
    const h = html(String.raw`\begin{pmatrix}a&b\end{pmatrix}`)
    expect(h).toContain('<code class="ww-math-err" title="needs the maths engine (begin)">')
    expect(textOf(h)).toContain('pmatrix')
  })
})

describe('<MathText />', () => {
  it('never throws on malformed maths, and never leaves the page empty', () => {
    const junk = [String.raw`$\frac{$`, '$$$', '$^$', '$_$', String.raw`$\$`, 'a $ b', '$ $', '$}{$', String.raw`$\left($`, '$$\\$$', '', '$' + 'x'.repeat(5000) + '$']
    for (const j of junk) expect(() => staticHtml(j), j).not.toThrow()
    expect(textOf(staticHtml('a $ b'))).toBe('a $ b')
  })
  it('raw shows the string untouched', () => {
    expect(textOf(staticHtml('int_0^inf x^2 dx', { raw: true }))).toBe('int_0^inf x^2 dx')
    expect(textOf(staticHtml('int_0^inf x^2 dx'))).not.toContain('^')
  })
  it('a string with a $ is authored LaTeX: the text around the span is not converted', () => {
    expect(textOf(staticHtml('then x^2 and $y$'))).toContain('x^2')
  })
  it('$$ ... $$ is display style', () => {
    expect(staticHtml('$$x^2$$')).toContain('ww-math-display')
  })
})

describe('lazy KaTeX', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); engine.failOn = '' })
  afterEach(() => { act(() => root.unmount()); host.remove(); resetKatexForTests() })

  it('is not imported until a formula mounts, draws the fallback first, then swaps to KaTeX', async () => {
    resetKatexForTests()
    expect(engine.imports).toBe(0)
    expect(katexNow()).toBeNull()
    expect(staticHtml('$x^2$')).toContain('<sup>2</sup>')       // static markup: fallback, no import
    expect(engine.imports).toBe(0)
    await act(async () => { root.render(createElement(MathText, null, 'a $x^2$ b')) })
    await act(async () => { await loadKatex() })
    expect(engine.imports).toBe(1)
    expect(host.querySelector('.katex-mock')).not.toBeNull()
    expect(host.querySelector('.rd-math')).toBeNull()
    expect(host.textContent).toContain('a ')
    expect(host.querySelector('[role="math"]')?.getAttribute('aria-label')).toBe('x^2')
  })
  it('sets display style for $$ and for the display prop', async () => {
    await act(async () => { root.render(createElement(MathText, { display: true, children: 'x^2' })) })
    await act(async () => { await loadKatex() })
    expect(host.querySelector('.ww-math-display .katex-mock')?.getAttribute('data-display')).toBe('1')
  })
  it('a formula KaTeX rejects shows its source in a <code> with the reason, and does not throw', async () => {
    engine.failOn = 'BAD'
    await act(async () => { root.render(createElement(MathText, null, String.raw`ok $\BAD x$ and $y$`)) })
    await act(async () => { await loadKatex() })
    const c = host.querySelector('code.ww-math-err')!
    expect(c.textContent).toBe(String.raw`\BAD x`)
    expect(c.getAttribute('title')).toContain('mock failure')
    expect(host.querySelectorAll('.katex-mock').length).toBe(1)   // the other formula still draws
  })
})

describe('Reader wiring', () => {
  it('typesets the old dialect, keeps the italic fix, and shows the source on Raw', () => {
    const h = md('Change the order in int_0^inf int_0^x e^(-xy) y dy dx now.')
    expect(h).toContain('<sub>0</sub><sup>∞</sup>')
    expect(h).not.toContain('<i>')
    expect(md('a _slanted_ word and s_i s_j')).toContain('<i>slanted</i>')
    expect(md('Change int_0^inf int_0^x e^(-xy) dx', true)).toContain('int_0^inf int_0^x e^(-xy) dx')
  })
  it('a paper is one numbered list: sections carry on, and the unit line stays under its question', () => {
    const paper = [
      '# Paper', '', '## Section A: 2 marks each, answer all', '',
      '1. First, int_0^6 dx/(1+x^2)  ', '   _Unit 1, topic; source: bank_',
      '2. Second  ', '   _Unit 2, topic; source: bank_', '',
      '## Section B: 5 marks each, answer any 1 of 2', '',
      '1. Third  ', '   _Unit 3, topic; source: bank_',
      '2. Fourth', '',
    ].join('\n')
    const h = md(paper)
    expect(h).toContain('<ol>')
    expect(h).toContain('<ol start="3">')
    expect((h.match(/<ol/g) ?? []).length).toBe(2)
    expect(h).not.toContain('<p><i>Unit')
    expect(h).toContain('<br/>')
  })
  it('a plain numbered list is untouched, and $$ on its own line is a display block', () => {
    expect(md('1. one\n2. two')).toBe('<div><ol><li class="">one</li><li class="">two</li></ol></div>')
    expect(md('$$\\int_0^1 x dx$$')).toContain('rd-display')
  })
})

describe('paper panel wiring', () => {
  const EXAM: ExamPaper = {
    id: 'see-x', subject: 'x', title: 'X', code: '', date: '2026-12-08', start: '10:00', end: '13:00', units: [], may_miss: false, days_left: 29,
    coverage: 0.2, topics: [], work_minutes: 0, planned_minutes: 0, logged_minutes: 0, paper_score: null, counts: { none: 0, learned: 0, solid: 0 },
    forecast: { half_plan: 0.2, full_plan: 0.4, assumption: '' }, max: 60, target: 40,
  }
  const PAPER: GeneratedPaper = {
    exam: 'see-x', subject: 'x', title: 'X', seed: 11, tier: 'exam', total_marks: 60, bank_size: 20, pattern_source: 'JSS SEE', shortfall: [], rule: 'the rule', markdown: '# X',
    sections: [{ name: 'A', marks: 2, attempt: 2, set: 2, questions: [
      { id: 'q1', n: 1, text: 'Evaluate int_0^6 dx/(1+x^2) by the trapezoidal rule.', marks: 2, unit: 1, topic: 't1', key: '1|t1', p: 0.1, source: 'Jun 2026' },
      { id: 'q2', n: 2, text: 'Find the value of Gamma(1/2).', marks: 2, unit: 2, topic: 't2', key: '2|t2', p: 0.8, source: '' }] }],
  }
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAPER), { status: 200, headers: { 'content-type': 'application/json' } })))
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); resetKatexForTests() })

  it('shows q.n and the question as maths, not as raw ASCII', async () => {
    await act(async () => { root.render(createElement(PaperPanel, { exam: EXAM, onSaved: () => undefined })) })
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Practice paper'))!.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    await act(async () => { await loadKatex() })
    const ns = [...host.querySelectorAll('.ex-gen-n')].map((e) => e.textContent)
    expect(ns).toEqual(['1.', '2.'])
    const qs = host.querySelectorAll('.ex-gen-q')
    expect(qs[0].querySelectorAll('[role="math"]').length).toBeGreaterThan(0)
    expect(qs[0].textContent).not.toContain('int_0^6')
    expect(qs[0].textContent).toContain('Evaluate')
    expect(qs[1].textContent).toContain('Find the value of')
  })
})
