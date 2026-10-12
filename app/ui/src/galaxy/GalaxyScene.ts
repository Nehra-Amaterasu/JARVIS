/**
 * GalaxyScene — the memory galaxy in 3D (ROADMAP Y1), in the twin's house style:
 * dark, additive glow, colour = provenance (lib/galaxy.ts says which colour means what).
 *
 *   every node     ONE THREE.Points draw call. Shape says the kind (dot = memory,
 *                  ring = person, diamond = belief, star = taste topic), so identity
 *                  never rests on colour alone; size = importance.
 *   edges          one LineSegments call: nearest neighbours in meaning, and the
 *                  person / belief / topic links. Faint on purpose: structure, not data.
 *   marks          one tiny Points call for the hover and selection rings.
 * Three draw calls whatever the node count.
 *
 * Time is a uniform. Each point carries the month it was born; the vertex shader hides
 * it before that month and springs it in (with a flash) as the scrubber passes it, so
 * replaying 6 years of growth costs no buffer uploads at all. A layout refresh glides
 * every known node from its old place to its new one, and new nodes pop in where they
 * land.
 *
 * Picking is a brute-force screen-space search (lib/galaxy pickNearest), ~0.3 ms for
 * 10k points; the hover label is one DOM node moved with a transform. The loop stops
 * when the page is hidden, and auto-rotation pauses while you touch or hover.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  buildBuffers, hexToRgb, KIND_LABEL, monthLabel, morphStart, pickNearest, recolor, visibility,
  type Buffers, type ColorMode, type GalaxyPayload,
} from '../lib/galaxy'

const SPRITE = 0.35              // world size of a size-1 sprite
const MORPH_S = 1.2
const ROTATE_IDLE_MS = 6000

const pointsVert = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float birth;
  attribute float kind;
  attribute float pop;
  attribute float vis;
  uniform float uMonth;
  uniform float uPopMonths;
  uniform float uNow;
  uniform float uScale;
  varying vec3 vColor;
  varying float vKind;
  varying float vFlash;
  // A damped spring sampled at a in [0,1]: 0 -> overshoot ~1.15 at a=0.35 -> 1.
  float springIn(float a) { return a >= 1.0 ? 1.0 : 1.0 - exp(-5.5 * a) * cos(9.0 * a); }
  void main() {
    float born = step(birth, uMonth);
    float am = birth < 0.0 ? 1.0 : clamp((uMonth - birth) / uPopMonths, 0.0, 1.0);
    float ap = pop > 0.0 ? clamp((uNow - pop) / 0.9, 0.0, 1.0) : 1.0;
    float a = min(am, ap);
    float s = born * vis * springIn(a);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uScale * s / max(-mv.z, 0.1), 0.0, 64.0);
    if (s < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);    // outside the clip volume
    vColor = color;
    vKind = kind;
    vFlash = born * vis * (1.0 - a);
  }`

const pointsFrag = /* glsl */ `
  uniform float uGain;
  varying vec3 vColor;
  varying float vKind;
  varying float vFlash;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float shape;
    if (vKind < 0.5) {                     // memory: a soft dot
      shape = smoothstep(0.5, 0.15, r) * 0.85 + pow(max(0.0, 1.0 - r), 3.0) * 0.35;
    } else if (vKind < 1.5) {              // person: a ring with a faint core
      shape = smoothstep(0.16, 0.02, abs(r - 0.62)) + smoothstep(0.25, 0.0, r) * 0.6
            + pow(max(0.0, 1.0 - r), 3.0) * 0.25;
    } else if (vKind < 2.5) {              // belief: a diamond
      float d = abs(p.x) + abs(p.y);
      shape = smoothstep(0.7, 0.5, d) * 0.9 + pow(max(0.0, 1.0 - d), 2.5) * 0.3;
    } else {                               // taste topic: a four-point star
      float d = min(abs(p.x), abs(p.y)) + r * 0.18;
      shape = smoothstep(0.2, 0.06, d) * smoothstep(1.0, 0.5, r) + smoothstep(0.32, 0.08, r) * 0.7;
    }
    // Additive glow saturates a dense core to white; memories dim as they multiply
    // (uGain), the hubs (people, beliefs, topics) never do.
    shape = clamp(shape, 0.0, 1.0) * (vKind < 0.5 ? uGain : 1.0);
    if (shape < 0.01) discard;
    gl_FragColor = vec4(vColor * (1.0 + 1.8 * vFlash), shape * (0.85 + 0.15 * vFlash));
  }`

const edgeVert = /* glsl */ `
  attribute float birth;
  attribute float vis;
  uniform float uMonth;
  varying float vA;
  void main() {
    vA = step(birth, uMonth) * vis;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const edgeFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vA;
  void main() { if (vA < 0.5) discard; gl_FragColor = vec4(uColor, uAlpha); }`

const markVert = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uPx;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uPx;
    vColor = color;
  }`
const markFrag = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float ring = smoothstep(0.09, 0.0, abs(length(p) - 0.8));
    if (ring < 0.02) discard;
    gl_FragColor = vec4(vColor, ring * 0.95);
  }`

export interface GalaxyStats { frames: number; fps: number; frameP50: number; frameP95: number; workP50: number; workP95: number }

function quantile(a: Float32Array, n: number, q: number): number {
  if (n === 0) return 0
  const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y)
  return s[Math.min(n - 1, Math.floor(q * (n - 1)))]
}

export class GalaxyScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400)
  private controls: OrbitControls
  private geo = new THREE.BufferGeometry()
  private edgeGeo = new THREE.BufferGeometry()
  private markGeo = new THREE.BufferGeometry()
  private mat: THREE.ShaderMaterial
  private edgeMat: THREE.ShaderMaterial
  private markMat: THREE.ShaderMaterial
  private points: THREE.Points
  private edges: THREE.LineSegments
  private marks: THREE.Points
  private markPos = new Float32Array(6)
  private markSize = new Float32Array(2)
  private markColor = new Float32Array(6)
  private label: HTMLDivElement
  private labelText: HTMLElement
  private labelSub: HTMLElement
  private data: GalaxyPayload | null = null
  private buf: Buffers | null = null
  private edgePairs = new Int32Array(0)
  private vis: Float32Array = new Float32Array(0)
  private edgeVis: Float32Array = new Float32Array(0)
  private pop: Float32Array = new Float32Array(0)
  private mode: ColorMode = 'provenance'
  private hidden: ReadonlySet<string> = new Set()
  private month = 1e6
  private morph: { from: Float32Array; to: Float32Array; t: number } | null = null
  private fly: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null
  private pointer = { x: 0, y: 0, inside: false, downX: 0, downY: 0, downT: 0 }
  private hover = -1
  private selected = -1
  private autoRotate = true
  private idleUntil = 0
  private fitted = false
  private raf = 0
  private last = 0
  private t0 = performance.now()
  private frameMs = new Float32Array(600)
  private workMs = new Float32Array(600)
  private nFrames = 0
  private resizeObs: ResizeObserver
  private mvp = new THREE.Matrix4()
  private tmp = new THREE.Vector3()
  onPick: ((index: number) => void) | null = null
  onHover: ((index: number) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)

    this.camera.position.set(0, 6, 24)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.35
    this.controls.minDistance = 3
    this.controls.maxDistance = 90
    this.controls.addEventListener('start', () => { this.idleUntil = performance.now() + ROTATE_IDLE_MS })

    this.mat = new THREE.ShaderMaterial({
      vertexShader: pointsVert, fragmentShader: pointsFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMonth: { value: 1e6 }, uPopMonths: { value: 1 }, uNow: { value: 0 }, uScale: { value: 300 }, uGain: { value: 1 } },
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.edgeMat = new THREE.ShaderMaterial({
      vertexShader: edgeVert, fragmentShader: edgeFrag, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMonth: { value: 1e6 }, uColor: { value: new THREE.Color('#9fb4c8') }, uAlpha: { value: 0.07 } },
    })
    this.edges = new THREE.LineSegments(this.edgeGeo, this.edgeMat)
    this.edges.frustumCulled = false
    this.markGeo.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage))
    this.markGeo.setAttribute('size', new THREE.BufferAttribute(this.markSize, 1).setUsage(THREE.DynamicDrawUsage))
    this.markGeo.setAttribute('color', new THREE.BufferAttribute(this.markColor, 3).setUsage(THREE.DynamicDrawUsage))
    this.markMat = new THREE.ShaderMaterial({
      vertexShader: markVert, fragmentShader: markFrag, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } },
    })
    this.marks = new THREE.Points(this.markGeo, this.markMat)
    this.marks.frustumCulled = false
    this.marks.renderOrder = 5
    this.scene.add(this.edges, this.points, this.marks)

    // The hover label: built with textContent, never innerHTML (labels are his words).
    this.label = document.createElement('div')
    this.label.className = 'gx-hover'
    this.labelText = document.createElement('b')
    this.labelSub = document.createElement('span')
    this.label.append(this.labelText, this.labelSub)
    container.appendChild(this.label)

    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointerup', this.onUp)

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ---------------------------------------------------------------- data */
  setData(p: GalaxyPayload, mode: ColorMode = this.mode) {
    const prev = this.data
    const prevPos = this.buf ? (this.geo.getAttribute('position')?.array as Float32Array | undefined) ?? null : null
    const prevSelectedId = this.selected >= 0 && prev ? prev.nodes[this.selected]?.id : null
    this.mode = mode
    const b = buildBuffers(p, mode)
    const n = b.count
    const now = this.now()
    this.pop = new Float32Array(n)
    let pos = b.positions
    if (prev && prevPos) {
      const m = morphStart(prev, prevPos, p, b.positions)
      pos = m.start
      for (let i = 0; i < n; i++) if (m.fresh[i]) this.pop[i] = now
      this.morph = { from: m.start.slice(), to: b.positions, t: 0 }
    }
    this.data = p
    this.buf = b
    this.mat.uniforms.uGain.value = Math.min(1, Math.max(0.3, Math.sqrt(1800 / Math.max(1, n))))
    this.vis = visibility(p, mode, this.hidden)
    this.edgePairs = new Int32Array(b.edgeCount * 2)
    let k = 0
    for (const [a, c] of p.edges) {
      if (a < 0 || c < 0 || a >= n || c >= n) continue
      this.edgePairs[k++] = a
      this.edgePairs[k++] = c
    }
    this.edgeVis = new Float32Array(b.edgeCount * 2)

    const g = this.geo
    for (const name of ['position', 'color', 'size', 'birth', 'kind', 'pop', 'vis']) g.deleteAttribute(name)
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(b.colors, 3))
    g.setAttribute('size', new THREE.BufferAttribute(b.sizes, 1))
    g.setAttribute('birth', new THREE.BufferAttribute(b.births, 1))
    g.setAttribute('kind', new THREE.BufferAttribute(b.kinds, 1))
    g.setAttribute('pop', new THREE.BufferAttribute(this.pop, 1))
    g.setAttribute('vis', new THREE.BufferAttribute(this.vis, 1))
    g.setDrawRange(0, n)
    const eg = this.edgeGeo
    for (const name of ['position', 'birth', 'vis']) eg.deleteAttribute(name)
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.edgePositions), 3).setUsage(THREE.DynamicDrawUsage))
    eg.setAttribute('birth', new THREE.BufferAttribute(b.edgeBirths, 1))
    eg.setAttribute('vis', new THREE.BufferAttribute(this.edgeVis, 1))
    eg.setDrawRange(0, b.edgeCount * 2)
    this.syncEdgeVis()
    if (this.morph) this.writeEdgePositions(pos)

    this.hover = -1
    this.selected = prevSelectedId ? p.nodes.findIndex((x) => x.id === prevSelectedId) : -1
    if (!this.fitted && n) this.fit(b.fitRadius)
  }

  setColorMode(mode: ColorMode) {
    if (!this.data || !this.buf || mode === this.mode) { this.mode = mode; return }
    this.mode = mode
    recolor(this.data, mode, this.buf.colors)
    this.geo.getAttribute('color').needsUpdate = true
  }

  /** Legend filter: groups (see lib/galaxy groupOf) that are switched off. */
  setHidden(hidden: ReadonlySet<string>) {
    this.hidden = hidden
    if (!this.data) return
    visibility(this.data, this.mode, hidden, this.vis)
    this.geo.getAttribute('vis').needsUpdate = true
    this.syncEdgeVis()
  }

  private syncEdgeVis() {
    const v = this.vis
    for (let i = 0; i < this.edgePairs.length; i += 2) {
      const on = v[this.edgePairs[i]] && v[this.edgePairs[i + 1]] ? 1 : 0
      this.edgeVis[i] = on
      this.edgeVis[i + 1] = on
    }
    const a = this.edgeGeo.getAttribute('vis')
    if (a) a.needsUpdate = true
  }

  /** Scrubber position in month slots (float). Anything >= months.length shows all. */
  setMonth(m: number) {
    this.month = m
    this.mat.uniforms.uMonth.value = m
    this.edgeMat.uniforms.uMonth.value = m
  }
  /** How many months a pop lasts (so it lasts ~0.5 s at the replay speed). */
  setPopMonths(m: number) { this.mat.uniforms.uPopMonths.value = Math.max(0.05, m) }
  setEdgesVisible(on: boolean) { this.edges.visible = on }
  setAutoRotate(on: boolean) { this.autoRotate = on }

  select(i: number | null, flyTo = false) {
    this.selected = i ?? -1
    if (flyTo && this.buf && this.selected >= 0) {
      const p = this.buf.positions
      const j = this.selected * 3
      this.fly = { from: this.controls.target.clone(), to: new THREE.Vector3(p[j], p[j + 1], p[j + 2]), t: 0 }
      this.idleUntil = performance.now() + ROTATE_IDLE_MS
    }
  }

  resetCamera() {
    this.fitted = false
    if (this.buf) this.fit(this.buf.fitRadius)
    this.fly = { from: this.controls.target.clone(), to: new THREE.Vector3(), t: 0 }
  }

  private fit(radius: number) {
    // Frame the radius in the narrower of the two directions (a phone is portrait).
    const r = Math.max(radius, 4) / Math.min(1, this.camera.aspect || 1)
    this.camera.position.set(0, r * 0.5, r * 2.1)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.fitted = true
  }

  /* ---------------------------------------------------------------- input */
  private onMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = e.clientX - r.left
    this.pointer.y = e.clientY - r.top
    this.pointer.inside = true
  }
  private onLeave = () => { this.pointer.inside = false }
  private onDown = (e: PointerEvent) => {
    this.pointer.downX = e.clientX
    this.pointer.downY = e.clientY
    this.pointer.downT = performance.now()
  }
  private onUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY)
    if (moved > 5 || performance.now() - this.pointer.downT > 450) return
    const i = this.pickAt(this.pointer.x, this.pointer.y)
    this.selected = i
    this.onPick?.(i)
  }

  private pickAt(x: number, y: number): number {
    if (!this.buf) return -1
    const el = this.renderer.domElement
    this.mvp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
    return pickNearest(this.geo.getAttribute('position').array as Float32Array, this.buf.births, this.vis,
      this.month, this.mvp.elements, el.clientWidth, el.clientHeight, x, y, 14)
  }

  /* ---------------------------------------------------------------- frame */
  private now() { return (performance.now() - this.t0) / 1000 }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const px = this.renderer.getPixelRatio()
    this.mat.uniforms.uScale.value = SPRITE * px * h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
    this.markMat.uniforms.uPx.value = px
  }

  private writeEdgePositions(pos: Float32Array) {
    const ep = this.edgeGeo.getAttribute('position')
    if (!ep) return
    const arr = ep.array as Float32Array
    for (let i = 0, k = 0; i < this.edgePairs.length; i += 2, k += 6) {
      const a = this.edgePairs[i] * 3
      const b = this.edgePairs[i + 1] * 3
      arr[k] = pos[a]; arr[k + 1] = pos[a + 1]; arr[k + 2] = pos[a + 2]
      arr[k + 3] = pos[b]; arr[k + 4] = pos[b + 1]; arr[k + 5] = pos[b + 2]
    }
    ep.needsUpdate = true
  }

  private stepMorph(dt: number) {
    const m = this.morph
    if (!m) return
    m.t = Math.min(1, m.t + dt / MORPH_S)
    // critically damped approach: 1 - (1 + wt) e^(-wt), w = 7 -> 0.993 at t = 1
    const w = 7 * m.t
    const k = m.t >= 1 ? 1 : 1 - (1 + w) * Math.exp(-w)
    const attr = this.geo.getAttribute('position')
    const arr = attr.array as Float32Array
    for (let i = 0; i < arr.length; i++) arr[i] = m.from[i] + (m.to[i] - m.from[i]) * k
    attr.needsUpdate = true
    this.writeEdgePositions(arr)
    if (m.t >= 1) this.morph = null
  }

  private loop = (ts: number) => {
    this.raf = requestAnimationFrame(this.loop)
    if (document.hidden) { this.last = ts; return }
    this.frame(ts)
  }

  /** One frame: everything the loop does per tick. Public so the bench can time
   * frames synchronously (with a GPU flush) where requestAnimationFrame is throttled. */
  frame(ts: number) {
    const w0 = performance.now()
    const dt = this.last ? Math.min((ts - this.last) / 1000, 0.1) : 1 / 60
    if (this.last) {
      const k = this.nFrames % this.frameMs.length
      this.frameMs[k] = ts - this.last
    }
    this.last = ts
    this.mat.uniforms.uNow.value = this.now()
    this.stepMorph(dt)
    if (this.fly) {
      this.fly.t = Math.min(1, this.fly.t + dt / 0.8)
      const e = 1 - Math.pow(1 - this.fly.t, 3)
      this.controls.target.lerpVectors(this.fly.from, this.fly.to, e)
      if (this.fly.t >= 1) this.fly = null
    }
    this.controls.autoRotate = this.autoRotate && this.hover < 0 && performance.now() > this.idleUntil
    this.controls.update()
    this.camera.updateMatrixWorld()

    // hover: what is under the pointer now (the galaxy turns under a still mouse too)
    const h = this.pointer.inside ? this.pickAt(this.pointer.x, this.pointer.y) : -1
    if (h !== this.hover) {
      this.hover = h
      this.onHover?.(h)
      if (h >= 0 && this.data) {
        const nd = this.data.nodes[h]
        this.labelText.textContent = nd.label
        this.labelSub.textContent = `${KIND_LABEL[nd.kind]}${nd.time ? ` · ${monthLabel(nd.time.slice(0, 7))}` : ''}`
      }
      this.label.classList.toggle('on', h >= 0)
      this.renderer.domElement.style.cursor = h >= 0 ? 'pointer' : ''
    }
    this.updateMarks()
    this.renderer.render(this.scene, this.camera)
    const k = this.nFrames % this.workMs.length
    this.workMs[k] = performance.now() - w0
    this.nFrames++
  }

  private updateMarks() {
    const pos = this.geo.getAttribute('position')?.array as Float32Array | undefined
    const set = (slot: number, i: number, size: number, hex: string) => {
      if (!pos || i < 0 || i * 3 + 2 >= pos.length) { this.markSize[slot] = 0; return }
      this.markPos[slot * 3] = pos[i * 3]
      this.markPos[slot * 3 + 1] = pos[i * 3 + 1]
      this.markPos[slot * 3 + 2] = pos[i * 3 + 2]
      this.markSize[slot] = size
      const [r, g, b] = hexToRgb(hex)
      this.markColor[slot * 3] = r; this.markColor[slot * 3 + 1] = g; this.markColor[slot * 3 + 2] = b
    }
    const pulse = 1 + 0.12 * Math.sin(this.now() * 4)
    set(0, this.hover, 24, '#ffffff')
    set(1, this.selected, 34 * pulse, '#5ce1ff')
    for (const n of ['position', 'size', 'color']) this.markGeo.getAttribute(n).needsUpdate = true
    if (this.hover >= 0 && pos) {
      this.tmp.set(pos[this.hover * 3], pos[this.hover * 3 + 1], pos[this.hover * 3 + 2]).project(this.camera)
      const el = this.renderer.domElement
      const x = (this.tmp.x * 0.5 + 0.5) * el.clientWidth
      const y = (1 - (this.tmp.y * 0.5 + 0.5)) * el.clientHeight
      this.label.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 12)}px)`
    }
  }

  /** Frame-rate figures over the last ≤600 frames: what the bench reports. */
  stats(): GalaxyStats {
    const n = Math.min(this.nFrames, this.frameMs.length)
    const p50 = quantile(this.frameMs, n, 0.5)
    return {
      frames: this.nFrames, fps: p50 > 0 ? 1000 / p50 : 0, frameP50: p50, frameP95: quantile(this.frameMs, n, 0.95),
      workP50: quantile(this.workMs, n, 0.5), workP95: quantile(this.workMs, n, 0.95),
    }
  }
  resetStats() { this.nFrames = 0; this.last = 0 }
  /** Stop the animation loop (the bench drives frames itself). */
  pause() { cancelAnimationFrame(this.raf); this.raf = 0 }
  /** Wait for the GPU to finish everything queued (readPixels blocks on it). */
  flush() {
    const gl = this.renderer.getContext()
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }
  get rendererName(): string {
    const gl = this.renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  }

  /** Test hook: what is on screen. */
  probe() {
    return {
      points: this.buf?.count ?? 0, edges: this.buf?.edgeCount ?? 0, calls: this.renderer.info.render.calls,
      hover: this.hover, selected: this.selected, month: this.month, morphing: this.morph !== null,
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerleave', this.onLeave)
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointerup', this.onUp)
    this.controls.dispose()
    for (const g of [this.geo, this.edgeGeo, this.markGeo]) g.dispose()
    for (const m of [this.mat, this.edgeMat, this.markMat]) m.dispose()
    this.renderer.dispose()
    el.remove()
    this.label.remove()
  }
}
