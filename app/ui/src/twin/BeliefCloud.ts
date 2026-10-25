/**
 * BeliefCloud: where movement / presence probably is, drawn as a cloud of small dots.
 *
 * Aankhen cannot see a body, so this never draws one. The hub's `belief` block (or,
 * from an older hub, the learned model's state probabilities: lib/belief.ts
 * fallbackBelief) gives zones with a probability each; every zone above 3 % gets dots
 * ∝ its probability, scattered with a Gaussian falloff inside its radius:
 *
 *   spread / height   grow with `motion`: still is a tight low haze that breathes
 *                     slowly (0.2 Hz); moving is a wider, taller, livelier cloud
 *   jitter            each dot wanders around its target, amplitude and speed ∝ motion
 *   opacity           the belief's confidence: a coin-flip belief is a faint haze
 *   colour            in_room warm copper, unsure grey, empty: the dots fade away
 *   transitions       a new belief moves each dot's target; dots glide there over
 *                     ~0.7 s (exponential, τ 0.25 s), lit/unlit dots fade the same way
 *   label             "probably: at the desk chair · 62 %" over the top zone, or
 *                     "can't tell"
 *   zone map          faint dashed circles with names (the "zones" layer): the zones
 *                     I will train against
 *
 * prefers-reduced-motion: no jitter, no breathing, transitions snap within ~0.2 s.
 *
 * Cost: one THREE.Points (one draw call) of DOTS vertices, jitter and breathing in the
 * vertex shader; the CPU lerps 240 positions per frame only while a transition is in
 * flight (no upload once settled). The zone map is one LineSegments, rebuilt only when
 * the zone set changes. Nothing is allocated per frame.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  BELIEF_COLOR, DOTS, beliefLabel, confidenceAlpha, dotOffsets, fallbackBelief, layoutDots, readBelief, shownZones, topZone,
  type Belief, type LearnedLike,
} from '../lib/belief'
import { roomPlaces, type Places, type RoomLike } from './places'

export interface BeliefSummary { state: Belief['state']; label: string; fallback: boolean; live: boolean }
interface FrameLike {
  source: string
  belief?: unknown
  learned?: LearnedLike | null
  motion_detail?: { human_band?: { energy?: number | null; recent?: number | null } | null } | null
}

const TAU_S = 0.25                    // glide time constant: ~95 % of the way in 0.75 s
const TAU_REDUCED_S = 0.06
const STALE_S = 4                     // no belief for this long: the model is not answering
const DOT_M = 0.035                   // dot diameter, metres
const CIRCLE_SEG = 48
const GREY = new THREE.Color(BELIEF_COLOR.unsure!)

const dotShader = {
  vertexShader: `
    attribute float aAlpha; attribute vec3 aSeed;
    uniform float uTime; uniform float uMotion; uniform float uReduced; uniform float uSize; uniform float uViewH; uniform float uConf;
    varying float vA;
    void main(){
      vec3 p = position;
      float live = 1.0 - uReduced;
      float amp = (0.004 + 0.06 * uMotion) * live;
      float f = (0.5 + 2.6 * uMotion) * aSeed.z;
      p.x += amp * sin(uTime * f + aSeed.x * 6.2831853);
      p.y += amp * cos(uTime * f * 1.13 + aSeed.y * 6.2831853);
      p.z += amp * 0.7 * sin(uTime * f * 0.71 + aSeed.y * 12.0);
      // still: the whole cloud breathes slowly (one phase, a little spread across dots)
      float breath = live * (1.0 - uMotion) * (0.5 + 0.5 * sin(uTime * 1.26 + aSeed.x * 0.9));
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float persp = projectionMatrix[3][3] > 0.5 ? 1.0 : 1.0 / max(0.05, -mv.z);
      gl_PointSize = max(1.5, uSize * (1.0 + 0.4 * breath) * projectionMatrix[1][1] * uViewH * 0.5 * persp);
      vA = aAlpha * uConf * (0.7 + 0.3 * breath);
    }`,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(mix(uColor, vec3(1.0), (1.0 - d) * 0.35), a);
    }`,
}

const reducedMotion = (): boolean => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export class BeliefCloud {
  /** Fired when the label or state changes: for the HUD's legend. */
  onChange: ((s: BeliefSummary | null) => void) | null = null
  private group = new THREE.Group()
  private places: Places | null = null
  private belief: Belief | null = null
  private fallback = false
  private live = false
  private lastAt = -Infinity
  private hubAt = -Infinity
  private nowS = 0
  private layers = { show: true, labels: true, zones: true }
  private summaryKey = ''

  // dots
  private n = DOTS
  private offsets = dotOffsets(DOTS)
  private target = new Float32Array(DOTS * 3)
  private targetLit = new Float32Array(DOTS)
  private posAttr: THREE.BufferAttribute
  private alphaAttr: THREE.BufferAttribute
  private settled = true
  private points: THREE.Points
  private mat: THREE.ShaderMaterial
  private colTarget = new THREE.Color(BELIEF_COLOR.in_room!)
  private motion = 0
  private conf = 0
  private reduced = reducedMotion()
  private mq: MediaQueryList | null = null
  private onMq = () => { this.reduced = reducedMotion() }

  // label over the top zone
  private label: CSS2DObject
  private labelText: HTMLElement
  private labelPos = new THREE.Vector3()
  private labelTarget = new THREE.Vector3()
  private labelShown = false

  // zone map
  private zoneLines: THREE.LineSegments
  private zoneMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.22, depthWrite: false, fog: false })
  private zoneLabels: CSS2DObject[] = []
  private zoneKey = ''

  constructor(parent: THREE.Object3D) {
    const g = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(new Float32Array(DOTS * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(DOTS), 1).setUsage(THREE.DynamicDrawUsage)
    const seed = new Float32Array(DOTS * 3)
    for (let i = 0; i < DOTS; i++) {
      // a second, independent stream for the jitter phases and rates
      const h = Math.sin((i + 1) * 12.9898) * 43758.5453
      seed[i * 3] = h - Math.floor(h)
      const h2 = Math.sin((i + 1) * 78.233) * 12543.1234
      seed[i * 3 + 1] = h2 - Math.floor(h2)
      seed[i * 3 + 2] = 0.6 + 0.8 * (this.offsets[i * 3 + 2])
    }
    g.setAttribute('position', this.posAttr)
    g.setAttribute('aAlpha', this.alphaAttr)
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3))
    // the room is a few metres across: a fixed bound saves recomputing it as dots move
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(2, 2, 0.5), 50)
    this.mat = new THREE.ShaderMaterial({
      ...dotShader,
      uniforms: {
        uTime: { value: 0 }, uMotion: { value: 0 }, uReduced: { value: 0 }, uSize: { value: DOT_M },
        uViewH: { value: 800 }, uConf: { value: 0 }, uColor: { value: this.colTarget.clone() },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.renderOrder = 9
    this.points.frustumCulled = false

    const el = document.createElement('div')
    el.className = 'tw-belief'
    el.innerHTML = '<i aria-hidden="true"></i><b></b>'
    this.labelText = el.querySelector('b')!
    this.label = new CSS2DObject(el)
    this.label.visible = false

    this.zoneLines = new THREE.LineSegments(new THREE.BufferGeometry(), this.zoneMat)
    this.zoneLines.renderOrder = 3

    this.group.add(this.points, this.label, this.zoneLines)
    parent.add(this.group)
    try {
      this.mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.mq.addEventListener('change', this.onMq)
    } catch { this.mq = null }
  }

  /* ---------------------------------------------------------------- inputs */
  setRoom(r: RoomLike) {
    this.places = roomPlaces(r)
    // a new layout moves every place: start from nothing rather than glide across a different room
    this.alphaAttr.array.fill(0)
    this.alphaAttr.needsUpdate = true
    this.belief = null
    this.zoneKey = ''
    this.relayout(true)
  }

  setLayers(l: { show: boolean; labels: boolean; zones: boolean }) {
    this.layers = l
    this.group.visible = l.show || l.zones
    this.points.visible = l.show
    this.label.visible = l.show && l.labels && this.labelShown
    this.zoneLines.visible = l.zones
    for (const z of this.zoneLabels) z.visible = l.zones && l.labels
  }

  onFrame(msg: FrameLike, nowS: number) {
    const live = msg.source === 'hardware'
    this.live = live
    const b = readBelief(msg.belief)
    if (b) this.hubAt = nowS
    // the hub's belief may come on status messages only: while it is fresh, a frame
    // without one must not overwrite it with the fallback
    else if (nowS - this.hubAt < STALE_S) return
    const next = b ?? fallbackBelief(msg.learned ?? null, msg.motion_detail?.human_band ?? null, this.places)
    this.fallback = !b
    if (!next) return
    this.belief = next
    this.lastAt = nowS
    this.relayout(false)
  }

  /** New dot targets for the current belief (or none). */
  private relayout(snap: boolean) {
    const b = this.belief
    // untrusted zones: one room-wide cloud, never a pile on an unverified place
    const drawn = b && BELIEF_COLOR[b.state] ? shownZones(b) : []
    layoutDots(drawn, b?.motion ?? 0, this.offsets, this.target, this.targetLit, this.n)
    if (b && BELIEF_COLOR[b.state]) this.colTarget.set(BELIEF_COLOR[b.state]!)
    if (snap) {
      ;(this.posAttr.array as Float32Array).set(this.target)
      this.posAttr.needsUpdate = true
    }
    this.settled = false
    this.syncZones()
    this.syncLabel()
  }

  /** The zone map: a dashed circle and a name per zone, rebuilt only when zones change. */
  private syncZones() {
    const zs = this.belief?.zones ?? []
    const key = zs.map((z) => `${z.id}:${z.x.toFixed(2)},${z.y.toFixed(2)},${z.r.toFixed(2)}`).join('|')
    if (key === this.zoneKey) return
    this.zoneKey = key
    const pts = new Float32Array(zs.length * CIRCLE_SEG * 6)
    let k = 0
    for (const z of zs) {
      for (let i = 0; i < CIRCLE_SEG; i++) {
        const a0 = (i / CIRCLE_SEG) * Math.PI * 2, a1 = ((i + 1) / CIRCLE_SEG) * Math.PI * 2
        pts[k++] = z.x + z.r * Math.cos(a0); pts[k++] = z.y + z.r * Math.sin(a0); pts[k++] = 0.008
        pts[k++] = z.x + z.r * Math.cos(a1); pts[k++] = z.y + z.r * Math.sin(a1); pts[k++] = 0.008
      }
    }
    this.zoneLines.geometry.dispose()
    this.zoneLines.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pts, 3))
    this.zoneLines.computeLineDistances()
    for (const l of this.zoneLabels) { l.element.remove(); l.removeFromParent() }
    this.zoneLabels = zs.map((z) => {
      const el = document.createElement('div')
      el.className = 'tw-bzone'
      el.textContent = z.name
      const o = new CSS2DObject(el)
      // on the circle's near (-y) edge, so it never sits on the dots
      o.position.set(z.x, z.y - z.r, 0.02)
      o.visible = this.layers.zones && this.layers.labels
      this.group.add(o)
      return o
    })
  }

  private syncLabel() {
    const b = this.belief
    const text = beliefLabel(b)
    this.labelText.textContent = text
    const top = b && BELIEF_COLOR[b.state] ? topZone({ ...b, zones: shownZones(b) }) : null
    this.labelShown = !!b
    if (top) this.labelTarget.set(top.x, top.y, 0.35 + 0.9 * (b?.motion ?? 0) * 0.6)
    else if (this.places) this.labelTarget.set(this.places.room.x, this.places.room.y, 0.3)
    if (!this.label.visible && this.labelShown) this.labelPos.copy(this.labelTarget)
    const el = this.label.element
    el.classList.toggle('unsure', b?.state !== 'in_room')
    el.classList.toggle('moving', (b?.motion ?? 0) > 0.45)
    this.label.visible = this.layers.show && this.layers.labels && this.labelShown
    const key = b ? `${b.state}|${text}|${this.fallback}|${this.live}` : ''
    if (key !== this.summaryKey) {
      this.summaryKey = key
      this.onChange?.(b ? { state: b.state, label: text, fallback: this.fallback, live: this.live } : null)
    }
  }

  /* ---------------------------------------------------------------- per frame */
  update(dt: number, t: number, viewH: number) {
    this.nowS = t
    // stale: the model stopped answering; let the cloud go rather than claim an old answer
    if (this.belief && t - this.lastAt > STALE_S) { this.belief = null; this.relayout(false) }
    const u = this.mat.uniforms
    const b = this.belief
    const k = 1 - Math.exp(-Math.max(0, dt) / (this.reduced ? TAU_REDUCED_S : TAU_S))
    // uniforms: motion, confidence, colour all glide too
    this.motion += ((b?.motion ?? 0) - this.motion) * k
    this.conf += ((b && BELIEF_COLOR[b.state] ? confidenceAlpha(b.confidence) : 0) - this.conf) * k
    ;(u.uColor.value as THREE.Color).lerp(b?.state === 'unsure' ? GREY : this.colTarget, k)
    u.uMotion.value = this.motion
    u.uConf.value = this.conf
    u.uTime.value = t % 1000
    u.uReduced.value = this.reduced ? 1 : 0
    u.uViewH.value = viewH
    if (!this.settled) {
      const p = this.posAttr.array as Float32Array, a = this.alphaAttr.array as Float32Array
      let moved = 0
      for (let i = 0; i < this.n; i++) {
        const lit = this.targetLit[i]
        // an unlit dot fades where it is; a dot lighting up from nothing appears at its target
        if (lit > 0 && a[i] < 0.02) { p[i * 3] = this.target[i * 3]; p[i * 3 + 1] = this.target[i * 3 + 1]; p[i * 3 + 2] = this.target[i * 3 + 2] }
        else if (lit > 0) {
          for (let c = 0; c < 3; c++) {
            const d = this.target[i * 3 + c] - p[i * 3 + c]
            p[i * 3 + c] += d * k
            moved = Math.max(moved, Math.abs(d))
          }
        }
        const da = lit - a[i]
        a[i] += da * k
        moved = Math.max(moved, Math.abs(da))
      }
      this.posAttr.needsUpdate = true
      this.alphaAttr.needsUpdate = true
      if (moved < 1e-3) this.settled = true
    }
    this.labelPos.lerp(this.labelTarget, k)
    this.label.position.copy(this.labelPos)
  }

  /** Test hook: what the cloud shows right now. */
  probe() {
    const a = this.alphaAttr.array as Float32Array
    let lit = 0
    for (let i = 0; i < this.n; i++) if (this.targetLit[i] > 0) lit++
    let visible = 0
    for (let i = 0; i < this.n; i++) if (a[i] > 0.1) visible++
    return {
      state: this.belief?.state ?? null, fallback: this.fallback, label: this.labelText.textContent,
      dots: lit, visible, motion: +this.motion.toFixed(3), confidence: +this.conf.toFixed(3),
      zones: (this.belief?.zones ?? []).map((z) => ({ id: z.id, p: +z.p.toFixed(3) })), reduced: this.reduced,
      age: this.belief ? +(this.nowS - this.lastAt).toFixed(2) : null,
    }
  }

  dispose() {
    this.mq?.removeEventListener('change', this.onMq)
    this.label.element.remove()
    for (const l of this.zoneLabels) l.element.remove()
    this.points.geometry.dispose()
    this.zoneLines.geometry.dispose()
    this.mat.dispose()
    this.zoneMat.dispose()
    this.group.removeFromParent()
  }
}
