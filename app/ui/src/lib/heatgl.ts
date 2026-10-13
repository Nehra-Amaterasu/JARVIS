/**
 * HeatGL — a scrolling waterfall on the GPU, for the eyes view's two ripples and its
 * spectrogram strip.
 *
 * WHY WebGL AND NOT A 2D CANVAS. The picture moves every frame by a fraction of a
 * column, is coloured AFTER the GPU interpolates between subcarriers and between
 * columns (so a gradient stays a gradient instead of becoming stripes of pre-coloured
 * pixels), and glows a little where it is bright (eight extra texture reads). The data
 * is one small texture — 256 columns x 51 subcarriers x 4 bytes, 52 kB — that gains one
 * column per message, so a frame is one quad and no uploads. A 2D canvas would colour
 * every pixel on the CPU and re-blit a scaled image each frame.
 *
 * Two layouts of the same ring:
 *   columns   time along x (newest at the right), values along y (51 subcarriers,
 *             -26 at the bottom): the ripples
 *   rows      time down y (newest at the top), values along x on a LOG frequency axis
 *             (64 spectrum bins): the spectrogram strip under the spectrum
 * Each texel is RGBA: R the value, G "measured", B "time passed without data". A stall
 * is drawn as a faint hatch, never as a calm room; the past before the view opened is
 * neither, and stays blank.
 */
import { CLIP_Z, F_MAX, F_MIN, GAMMA, KNEE, STRIP_TOP, Z_TOP, rampTable, type Provenance } from './eyes'

export type HeatLayout = 'columns' | 'rows'
export type HeatKind = 'z' | 'power'
export interface HeatOptions { layout: HeatLayout; kind: HeatKind; ring: number; size: number; binHz?: number }

// R channel: z in [-6, 6] -> 0..255 (z), or log10 x noise in [-1, 3] -> 0..255 (power).
const encode = (kind: HeatKind, v: number) => {
  const x = kind === 'z' ? (v + CLIP_Z) / (2 * CLIP_Z) : (v + 1) / 4
  return Math.round(Math.min(1, Math.max(0, x)) * 255)
}

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uData; uniform sampler2D uRamp;
uniform float uHead, uSpan, uRing, uSize, uBinHz;
uniform int uRows, uPower;
uniform vec2 uRes;
in vec2 vUv; out vec4 outColor;
const float KNEE = ${KNEE.toFixed(4)}, GAMMA = ${GAMMA.toFixed(4)}, CLIP = ${CLIP_Z.toFixed(1)}, ZTOP = ${Z_TOP.toFixed(2)};
const float TOP = ${STRIP_TOP.toFixed(3)}, FMIN = ${F_MIN.toFixed(3)}, FMAX = ${F_MAX.toFixed(3)};

float bright(float r) {
  if (uPower == 0) {
    float z = abs(r * 2.0 * CLIP - CLIP);
    return pow(clamp((z - KNEE) / (ZTOP - KNEE), 0.0, 1.0), GAMMA);
  }
  float p = r * 4.0 - 1.0;
  return pow(clamp((p - 0.15) / (TOP - 0.15), 0.0, 1.0), 0.8);
}
vec2 texAt(vec2 q) {
  if (uRows == 0) return vec2((uHead - (1.0 - q.x) * uSpan) / uRing, q.y);
  float f = FMIN * exp(q.x * log(FMAX / FMIN));
  return vec2((f / uBinHz - 0.5) / uSize, (uHead - (1.0 - q.y) * uSpan) / uRing);
}
void main() {
  vec4 t = texture(uData, texAt(vUv));
  float b = bright(t.r);
  vec2 px = 1.0 / uRes;
  float g = 0.0;
  g += bright(texture(uData, texAt(vUv + vec2( 6.0,  0.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2(-6.0,  0.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2( 0.0,  5.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2( 0.0, -5.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2( 11.0,  8.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2(-11.0, -8.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2( 11.0, -8.0) * px)).r);
  g += bright(texture(uData, texAt(vUv + vec2(-11.0,  8.0) * px)).r);
  g *= 0.125;
  vec3 col = texture(uRamp, vec2(b, 0.5)).rgb;
  vec3 halo = texture(uRamp, vec2(min(1.0, g * 1.15), 0.5)).rgb * g * 0.5;
  // premultiplied output: what is dark stays see-through, so the glass card shows;
  // the halo may exceed alpha, which composites as light added on top
  float a = clamp(max(b, g * 0.75) * 1.05, 0.0, 1.0);
  vec3 lit = col * a + halo;
  float hatch = step(0.84, fract((gl_FragCoord.x - gl_FragCoord.y) / 9.0)) * 0.09;
  float age = uRows == 0 ? vUv.x : vUv.y;
  float fade = smoothstep(0.0, 0.14, age);
  outColor = (vec4(lit, a) * t.g + vec4(vec3(hatch), hatch) * t.b) * fade;
}`

export class HeatGL {
  ok = false
  private canvas: HTMLCanvasElement
  private opts: HeatOptions
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null
  private data: WebGLTexture | null = null
  private ramp: WebGLTexture | null = null
  private u: Record<string, WebGLUniformLocation | null> = {}
  private prov: Provenance = 'sim'
  private slot: Uint8Array
  private lost = () => { this.ok = false }
  private restored = () => this.init()

  constructor(canvas: HTMLCanvasElement, opts: HeatOptions) {
    this.canvas = canvas
    this.opts = opts
    this.slot = new Uint8Array(opts.size * 4)
    canvas.addEventListener('webglcontextlost', this.lost)
    canvas.addEventListener('webglcontextrestored', this.restored)
    this.init()
  }

  private init() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true })
    this.gl = gl
    if (!gl) return
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[eyes] shader:', gl.getShaderInfoLog(s))
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[eyes] link:', gl.getProgramInfoLog(p)); return }
    this.prog = p
    gl.useProgram(p)
    for (const n of ['uData', 'uRamp', 'uHead', 'uSpan', 'uRing', 'uSize', 'uBinHz', 'uRows', 'uPower', 'uRes']) this.u[n] = gl.getUniformLocation(p, n)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const { layout, ring, size, kind } = this.opts
    const w = layout === 'columns' ? ring : size, h = layout === 'columns' ? size : ring
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    this.data = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.data)
    const empty = new Uint8Array(w * h * 4)
    const mid = encode(kind, 0)
    for (let i = 0; i < w * h; i++) empty[i * 4] = mid          // zero, never written: blank
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    // time wraps around the ring; values clamp at the band edges
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, layout === 'columns' ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, layout === 'columns' ? gl.CLAMP_TO_EDGE : gl.REPEAT)

    this.ramp = gl.createTexture()
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rampTable(this.prov))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.uniform1i(this.u.uData, 0)
    gl.uniform1i(this.u.uRamp, 1)
    gl.uniform1f(this.u.uRing, ring)
    gl.uniform1f(this.u.uSize, size)
    gl.uniform1f(this.u.uBinHz, this.opts.binHz ?? 0.15625)
    gl.uniform1i(this.u.uRows, layout === 'rows' ? 1 : 0)
    gl.uniform1i(this.u.uPower, kind === 'power' ? 1 : 0)
    gl.disable(gl.BLEND)
    this.ok = true
  }

  /** Ice for what the ESP32 measured, amber for anything simulated or replayed. */
  setProvenance(p: Provenance) {
    if (p === this.prov) return
    this.prov = p
    const gl = this.gl
    if (!gl || !this.ok) return
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, rampTable(p))
  }

  /** Write one time slot (column or row) of the ring; null = time passed without data. */
  write(slot: number, values: ArrayLike<number> | null) {
    const gl = this.gl
    if (!gl || !this.ok) return
    const { layout, ring, size, kind } = this.opts
    const s = ((slot % ring) + ring) % ring
    const b = this.slot
    for (let i = 0; i < size; i++) {
      const v = values ? values[i] : NaN
      const ok = Number.isFinite(v)
      b[i * 4] = ok ? encode(kind, v) : encode(kind, 0)
      b[i * 4 + 1] = ok ? 255 : 0
      b[i * 4 + 2] = ok ? 0 : 255
      b[i * 4 + 3] = 255
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.data)
    if (layout === 'columns') gl.texSubImage2D(gl.TEXTURE_2D, 0, s, 0, 1, size, gl.RGBA, gl.UNSIGNED_BYTE, b)
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, s, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, b)
  }

  /** Draw with the newest slot centre at `head` (slot units) and `span` slots visible. */
  draw(head: number, span: number) {
    const gl = this.gl
    if (!gl || !this.ok) return
    const c = this.canvas
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.u.uRes, w, h)
    gl.uniform1f(this.u.uHead, head)
    gl.uniform1f(this.u.uSpan, Math.min(span, this.opts.ring - 6))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.lost)
    this.canvas.removeEventListener('webglcontextrestored', this.restored)
    const gl = this.gl
    if (gl) {
      gl.deleteTexture(this.data)
      gl.deleteTexture(this.ramp)
      gl.deleteProgram(this.prog)
      // free the GPU context now, not when the garbage collector gets to it: the twin
      // keeps its own context alive underneath
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    this.gl = null
    this.ok = false
  }
}
