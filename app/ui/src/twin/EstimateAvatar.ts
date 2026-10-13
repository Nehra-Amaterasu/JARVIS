/**
 * EstimateAvatar: where the learned model places me, drawn as a person.
 *
 * The real board has no radar, so there are no tracks: the twin's only answer to
 * "where am I" is the learned spatial model's state (desk / bed / room / outside /
 * empty) and the activity model's (still / typing / waving / walking). This draws that
 * answer as a stylised figure standing on the place's SPOT (estimate.ts), posed by the
 * activity, with a heat signal on the body where the movement is:
 *
 *   figure        a hologram mannequin (capsules on a joint hierarchy). Its opacity is
 *                 P(this place); seated at the desk, lying on the bed, standing on the
 *                 open floor. A zone change is a walk, not a jump
 *   heat          human-band energy (log-scaled, estimate.energyToHeat), painted on the
 *                 body around where the activity says the movement is: hands and
 *                 forearms typing, the raised arm waving, the legs walking, a slow chest
 *                 pulse when still. It decays over ~1.6 s, and leaves a short trail of
 *                 sparks, so a burst stays visible for a few seconds
 *   ring          a dotted ring and a soft cloud on the floor: "somewhere about here".
 *                 A radar track's reticle is a solid arc; this never is
 *   label         "estimate 82% · desk · typing"
 *   plan view     the figure becomes a top-down glyph inside the same ring, which then
 *                 carries the heat toward the side the movement is on
 *   outside       no figure: a soft marker just past the door
 *
 * No fog on any of it: the plan's camera sits 30 m up, where the scene fog would
 * swallow a fogged glyph whole (the first build drew it, black).
 *
 * Colour is provenance as everywhere: cyan from the real board, amber in simulation or
 * replay. Cost: ~20 meshes sharing one material, 3 sprites, one 80-point trail; the
 * geometries are built once per page, nothing is allocated per frame.
 */
import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  BODY, EstimateHold, MOTIONS, POSTURES, SEAT_H, blendPose, decayHeat, energyToHeat, estimateAlpha, estimateLabel,
  poseFor, roomSpots, spotFor, zeroPose,
  type Focus, type Held, type LearnedLike, type Motion, type PoseAngles, type PoseChoice, type Posture, type RoomLike, type Spot, type Spots,
} from './estimate'

export interface EstimateSummary { zone: string; activity: string; live: boolean }
interface FrameLike {
  source: string
  learned?: LearnedLike | null
  motion_detail?: { human_band?: { energy?: number | null; recent?: number | null } | null } | null
}

const LIVE = new THREE.Color('#5ce1ff')
const SIM = new THREE.Color('#ffb020')
const LIVE_COLD = new THREE.Color('#0f3a78')
const SIM_COLD = new THREE.Color('#5c2a04')
const WHITE = new THREE.Color('#ffffff')
const TAU = Math.PI * 2
const WALK_SPEED = 0.8               // m/s, an unhurried indoor walk
const TRAIL_N = 80
const TRAIL_EVERY_S = 0.06           // 80 points at two per tick: ~2.4 s of sparks
const TRAIL_TAU_S = 1.1
const SLOTS = 8                      // heat hot spots: handL handR foreL foreR upperR shinL shinR chest
const SLOT_R = [0.12, 0.12, 0.12, 0.12, 0.13, 0.2, 0.2, 0.21]
const FOCUS_W: Record<Focus, number[]> = {
  hands: [1, 1, 0.6, 0.6, 0, 0, 0, 0],
  arm: [0, 1, 0, 0.85, 0.55, 0, 0, 0],
  legs: [0, 0, 0, 0, 0, 1, 1, 0],
  chest: [0, 0, 0, 0, 0, 0, 0, 1],
}
const GLYPH: Record<string, string> = { still: '•', typing: '⌨', waving: '✋', walking: '🚶', outside: '↗' }

/* ------------------------------------------------------------------ shaders */
const bodyShader = {
  vertexShader: `
    varying vec3 vW; varying vec3 vN;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform vec3 uCold; uniform float uAlpha; uniform float uTime;
    uniform vec4 uHot[${SLOTS}]; uniform float uHotI[${SLOTS}];
    varying vec3 vW; varying vec3 vN;
    void main(){
      vec3 V = normalize(cameraPosition - vW);
      float rim = 1.0 - abs(dot(normalize(vN), V));
      float fres = pow(rim, 2.2);
      float heat = 0.0;
      for (int i = 0; i < ${SLOTS}; i++) {
        vec3 d = vW - uHot[i].xyz;
        heat += uHotI[i] * exp(-dot(d, d) / (uHot[i].w * uHot[i].w));
      }
      heat = clamp(heat, 0.0, 1.0);
      // fine scanlines drifting up the body: a projection, not a solid person
      float scan = 0.8 + 0.2 * sin((vW.y - uTime * 0.22) * 150.0);
      // a heat ramp inside the provenance hue: deep -> accent -> white-hot
      vec3 cool = mix(uCold, uColor, 0.45 + 0.55 * fres);
      vec3 hot = heat < 0.55 ? mix(uColor, uColor * 1.35 + 0.15, heat / 0.55) : mix(uColor * 1.35 + 0.15, vec3(1.0), (heat - 0.55) / 0.45);
      vec3 col = mix(cool, hot, smoothstep(0.02, 0.5, heat));
      // a faint body everywhere, a bright rim at the silhouette: legible from any side
      float a = (0.15 + 0.7 * fres + 0.85 * heat) * scan * uAlpha;
      gl_FragColor = vec4(col, a);
    }`,
}

const ringShader = {
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uAlpha; uniform float uHeat; uniform float uTime; uniform vec2 uDir; uniform float uFocus; uniform float uPlan;
    varying vec2 vP;
    void main(){
      float r = length(vP);
      float ang = atan(vP.y, vP.x);
      // a soft cloud: somewhere about here
      float cloud = exp(-r * r / 0.10) * (0.10 + 0.08 * uPlan);
      // a dotted ring: dots, never the solid arc of a measured radar track
      float band = 1.0 - smoothstep(0.004, 0.016, abs(r - 0.5));
      float dots = step(0.55, fract(ang / 6.2831853 * 44.0 - uTime * 0.04));
      float ring = band * dots * 0.7;
      // the heat ring just outside it, brighter on the side the movement is
      vec2 dir = r > 1e-4 ? vP / r : vec2(0.0);
      float side = mix(1.0, 0.25 + 1.1 * pow(max(0.0, dot(dir, uDir)), 1.6), uFocus);
      float w = 0.05 + 0.03 * uHeat;
      float hb = exp(-pow((r - 0.62 - 0.05 * uHeat) / w, 2.0)) * uHeat * side * (0.75 + 0.25 * uPlan);
      float a = (cloud * (0.6 + uHeat) + ring + hb) * uAlpha;
      vec3 col = mix(uColor, vec3(1.0), clamp(hb * 0.7, 0.0, 0.6));
      gl_FragColor = vec4(col, a);
    }`,
}

/* ------------------------------------------------------------------ geometry, built once */
function limb(r: number, len: number): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, 5, 14).rotateX(Math.PI / 2).translate(0, 0, -len / 2)
}
const G = (() => {
  // torso: a lathe from the hip joint (z 0) to the base of the neck (z 0.5): hips, waist, chest, shoulders
  const prof = [[0.0, -0.08], [0.11, -0.07], [0.15, 0.0], [0.145, 0.1], [0.13, 0.2], [0.145, 0.3], [0.165, 0.39], [0.15, 0.46], [0.08, 0.51], [0.0, 0.52]]
  const torso = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r, h)), 22).rotateX(Math.PI / 2).scale(0.7, 1, 1)
  const head = new THREE.SphereGeometry(BODY.head, 22, 16).scale(0.98, 0.86, 1.12).translate(0.012, 0, 0)
  const neck = new THREE.CylinderGeometry(0.045, 0.05, BODY.neck + 0.04, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, BODY.neck / 2)
  const hand = new THREE.SphereGeometry(0.042, 12, 10).scale(0.62, 1, 1.45).translate(0, 0, -0.045)
  const foot = new THREE.CapsuleGeometry(0.038, 0.13, 4, 10).rotateZ(Math.PI / 2).translate(0.055, 0, -0.022)
  return {
    torso, head, neck, hand, foot,
    upperArm: limb(0.047, BODY.upperArm), forearm: limb(0.04, BODY.forearm),
    thigh: limb(0.068, BODY.thigh), shin: limb(0.052, BODY.shin),
    ring: new THREE.PlaneGeometry(2, 2),
  }
})()

/** A desk chair in lines, like the twin's furniture: seat, legs and a backrest. */
function chairGeometry(): THREE.BufferGeometry {
  const s = 0.21, h = SEAT_H, back = 0.92, bx = -0.24
  const p: number[] = []
  const seg = (a: number[], b: number[]) => p.push(...a, ...b)
  const c = [[-s - 0.03, -s], [s - 0.03, -s], [s - 0.03, s], [-s - 0.03, s]]
  for (let i = 0; i < 4; i++) { seg([...c[i], h], [...c[(i + 1) % 4], h]); seg([...c[i], h], [...c[i], 0]) }
  seg([bx, -s, h], [bx, -s, back]); seg([bx, s, h], [bx, s, back]); seg([bx, -s, back], [bx, s, back]); seg([bx, -s, h + 0.2], [bx, s, h + 0.2])
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
}

/** Top-down glyphs, facing +x (lying: head toward +x). */
const GLYPHS = (() => {
  const ell = (cx: number, cy: number, rx: number, ry: number) => { const s = new THREE.Shape(); s.absellipse(cx, cy, rx, ry, 0, TAU, false, 0); return s }
  const rr = (x0: number, y0: number, x1: number, y1: number, r: number) => {
    const s = new THREE.Shape()
    s.moveTo(x0 + r, y0).lineTo(x1 - r, y0).quadraticCurveTo(x1, y0, x1, y0 + r).lineTo(x1, y1 - r).quadraticCurveTo(x1, y1, x1 - r, y1)
      .lineTo(x0 + r, y1).quadraticCurveTo(x0, y1, x0, y1 - r).lineTo(x0, y0 + r).quadraticCurveTo(x0, y0, x0 + r, y0)
    return s
  }
  const wedge = new THREE.Shape().moveTo(0.1, 0.045).lineTo(0.17, 0).lineTo(0.1, -0.045).closePath()
  return {
    standing: new THREE.ShapeGeometry([ell(0, 0, 0.12, 0.24)], 24),
    seated: new THREE.ShapeGeometry([ell(-0.05, 0, 0.12, 0.24), rr(0.07, 0.03, 0.46, 0.16, 0.05), rr(0.07, -0.16, 0.46, -0.03, 0.05)], 24),
    lying: new THREE.ShapeGeometry([rr(-0.08, -0.19, 0.5, 0.19, 0.09), rr(-0.96, 0.02, -0.05, 0.15, 0.05), rr(-0.96, -0.15, -0.05, -0.02, 0.05),
      rr(0.02, 0.21, 0.46, 0.29, 0.035), rr(0.02, -0.29, 0.46, -0.21, 0.035)], 24),
    headFacing: new THREE.ShapeGeometry([ell(0.01, 0, 0.1, 0.1), wedge], 24),
    head: new THREE.ShapeGeometry([ell(0, 0, 0.1, 0.1)], 24),
  }
})()

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const damp = THREE.MathUtils.damp
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/* ------------------------------------------------------------------ the avatar */
export class EstimateAvatar {
  /** Fired when what the figure shows changes (place, activity, shown or not). */
  onChange: ((s: EstimateSummary | null) => void) | null = null
  private group = new THREE.Group()
  private room: RoomLike | null = null
  private spots: Spots | null = null
  private hold = new EstimateHold()
  private held: Held = { zone: null, activity: 'none', p: 0, occupied: 0 }
  private choice: PoseChoice = poseFor(null, null)
  private target: Spot | null = null
  private live = false
  private view: '3d' | 'plan' = '3d'
  private layers = { show: true, labels: true, trails: true }
  private summaryKey = ''

  // motion state
  private present = false                     // a figure is on stage (maybe fading)
  private leaving = false                     // walking out through the door
  private pos = new THREE.Vector2()
  // where the figure is going: walked legs, or glides (onto the bed, up off it)
  private path: { p: THREE.Vector2; glide: boolean }[] = []
  private speed = 0
  private yaw = 0
  private travel = 0
  private wP: Record<Posture, number> = { standing: 1, seated: 0, lying: 0 }
  private wM: Record<Motion, number> = { still: 1, typing: 0, waving: 0, walking: 0 }
  private pose: PoseAngles = zeroPose()
  private tmpPose: PoseAngles = zeroPose()
  private bedBase = 0.5
  private alpha = 0
  private outAlpha = 0
  private heatIn = 0
  private heat = 0
  private slotI = new Array<number>(SLOTS).fill(0)

  // body
  private root = new THREE.Group()
  private spine = new THREE.Object3D()
  private neck = new THREE.Object3D()
  private torso: THREE.Mesh
  private sh = [new THREE.Object3D(), new THREE.Object3D()]        // L, R
  private el = [new THREE.Object3D(), new THREE.Object3D()]
  private hip = [new THREE.Object3D(), new THREE.Object3D()]
  private kn = [new THREE.Object3D(), new THREE.Object3D()]
  private marks: THREE.Object3D[] = []                             // the heat slots, in the body
  private headMark = new THREE.Object3D()
  private bodyMat: THREE.ShaderMaterial
  private chair: THREE.LineSegments
  private chairMat = new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0, depthWrite: false, fog: false })

  // floor, plan, glow, trail, labels
  private ring: THREE.Mesh
  private ringMat: THREE.ShaderMaterial
  private glyph = new THREE.Group()
  private glyphBody: Record<Posture, THREE.Mesh>
  private glyphHead: THREE.Mesh
  private glyphMat = new THREE.MeshBasicMaterial({ color: LIVE.clone(), transparent: true, opacity: 0, depthWrite: false, fog: false })
  private glyphHeadMat = new THREE.MeshBasicMaterial({ color: LIVE.clone(), transparent: true, opacity: 0, depthWrite: false, fog: false })
  private sprites: THREE.Sprite[] = []
  private trail: THREE.Points
  private trailPos = new Float32Array(TRAIL_N * 3)
  private trailCol = new Float32Array(TRAIL_N * 4)
  private trailBorn = new Float32Array(TRAIL_N).fill(-1e9)
  private trailI = new Float32Array(TRAIL_N)
  private trailHead = 0
  private trailAt = 0
  private label: CSS2DObject
  private labelText: HTMLElement
  private labelIcon: HTMLElement
  private outGroup = new THREE.Group()
  private outRingMat: THREE.ShaderMaterial
  private outLine: THREE.Line
  private outLabel: CSS2DObject
  private tex: THREE.Texture
  private v = new THREE.Vector3()
  private col = new THREE.Color()

  constructor(parent: THREE.Object3D) {
    this.bodyMat = new THREE.ShaderMaterial({
      ...bodyShader,
      uniforms: {
        uColor: { value: LIVE.clone() }, uCold: { value: LIVE_COLD.clone() }, uAlpha: { value: 0 }, uTime: { value: 0 },
        uHot: { value: Array.from({ length: SLOTS }, () => new THREE.Vector4(0, -50, 0, 0.1)) },
        uHotI: { value: new Array<number>(SLOTS).fill(0) },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const mesh = (g: THREE.BufferGeometry, parentObj: THREE.Object3D, z = 0) => {
      const m = new THREE.Mesh(g, this.bodyMat)
      m.position.z = z
      m.renderOrder = 8
      parentObj.add(m)
      return m
    }
    // spine and head
    this.root.add(this.spine)
    this.torso = mesh(G.torso, this.spine)
    this.neck.position.z = BODY.spine
    this.spine.add(this.neck)
    mesh(G.neck, this.neck)
    const head = mesh(G.head, this.neck, BODY.neck + BODY.head * 0.95)
    this.headMark.position.copy(head.position)
    this.neck.add(this.headMark)
    // arms
    for (const i of [0, 1]) {
      const s = i === 0 ? 1 : -1
      this.sh[i].position.set(0, s * BODY.shoulderY, BODY.shoulderZ)
      this.sh[i].rotation.order = 'XYZ'
      this.spine.add(this.sh[i])
      mesh(G.upperArm, this.sh[i])
      this.el[i].position.z = -BODY.upperArm
      this.el[i].rotation.order = 'XYZ'
      this.sh[i].add(this.el[i])
      mesh(G.forearm, this.el[i])
      mesh(G.hand, this.el[i], -BODY.forearm)
      this.hip[i].position.set(0, s * BODY.hipY, 0)
      this.hip[i].rotation.order = 'XYZ'
      this.root.add(this.hip[i])
      mesh(G.thigh, this.hip[i])
      this.kn[i].position.z = -BODY.thigh
      this.hip[i].add(this.kn[i])
      mesh(G.shin, this.kn[i])
      mesh(G.foot, this.kn[i], -BODY.shin)
    }
    // heat slots: handL handR foreL foreR upperR shinL shinR chest
    const mark = (p: THREE.Object3D, z: number) => { const o = new THREE.Object3D(); o.position.z = z; p.add(o); this.marks.push(o) }
    mark(this.el[0], -BODY.forearm - 0.05); mark(this.el[1], -BODY.forearm - 0.05)
    mark(this.el[0], -BODY.forearm * 0.45); mark(this.el[1], -BODY.forearm * 0.45)
    mark(this.sh[1], -BODY.upperArm * 0.6)
    mark(this.kn[0], -BODY.shin * 0.45); mark(this.kn[1], -BODY.shin * 0.45)
    mark(this.spine, 0.33)

    this.chair = new THREE.LineSegments(chairGeometry(), this.chairMat)

    // floor ring and the plan glyph
    this.ringMat = new THREE.ShaderMaterial({
      ...ringShader,
      uniforms: { uColor: { value: LIVE.clone() }, uAlpha: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 },
        uDir: { value: new THREE.Vector2(1, 0) }, uFocus: { value: 0 }, uPlan: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.ring = new THREE.Mesh(G.ring, this.ringMat)
    this.ring.renderOrder = 3
    this.glyphBody = {
      standing: new THREE.Mesh(GLYPHS.standing, this.glyphMat),
      seated: new THREE.Mesh(GLYPHS.seated, this.glyphMat),
      lying: new THREE.Mesh(GLYPHS.lying, this.glyphMat),
    }
    this.glyphHead = new THREE.Mesh(GLYPHS.headFacing, this.glyphHeadMat)
    this.glyph.add(this.glyphBody.standing, this.glyphBody.seated, this.glyphBody.lying, this.glyphHead)
    this.glyph.renderOrder = 4
    for (const m of [...Object.values(this.glyphBody), this.glyphHead]) m.renderOrder = 4

    // glow sprites and the spark trail
    this.tex = dotTexture()
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: LIVE.clone(), transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
      s.renderOrder = 9
      this.sprites.push(s)
    }
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage))
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 4).setUsage(THREE.DynamicDrawUsage))
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ size: 0.07, map: this.tex, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }))
    this.trail.frustumCulled = false
    this.trail.renderOrder = 9

    // the label, built with textContent (never innerHTML)
    const el = document.createElement('div')
    el.className = 'tw-est live'
    this.labelIcon = document.createElement('i')
    this.labelText = document.createElement('b')
    el.append(this.labelIcon, this.labelText)
    this.label = new CSS2DObject(el)

    // outside: a ring past the door, a dashed line to it, a label
    this.outRingMat = new THREE.ShaderMaterial({ ...ringShader, uniforms: THREE.UniformsUtils.clone(this.ringMat.uniforms),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const outRing = new THREE.Mesh(G.ring, this.outRingMat)
    outRing.scale.setScalar(0.62)
    this.outLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: LIVE.clone(), dashSize: 0.06, gapSize: 0.06, transparent: true, opacity: 0, depthWrite: false, fog: false }))
    this.outLine.frustumCulled = false
    const oel = document.createElement('div')
    oel.className = 'tw-est out live'
    oel.append(document.createElement('i'), document.createElement('b'))
    ;(oel.children[0] as HTMLElement).textContent = GLYPH.outside
    this.outLabel = new CSS2DObject(oel)
    this.outLabel.position.z = 0.35
    this.outGroup.add(outRing, this.outLabel)

    this.group.add(this.root, this.chair, this.ring, this.glyph, ...this.sprites, this.trail, this.label, this.outGroup, this.outLine)
    parent.add(this.group)
    this.root.visible = false
    this.group.visible = false
  }

  /* ---------------------------------------------------------------- inputs */
  setRoom(r: RoomLike) {
    this.room = r
    this.spots = roomSpots(r)
    this.bedBase = this.spots.bed?.base ?? 0.5
    const o = this.spots.outside, d = this.spots.door
    if (o && d) {
      this.outGroup.position.set(o.x, o.y, 0.013)
      const a = this.outLine.geometry.attributes.position as THREE.BufferAttribute
      a.setXYZ(0, d.x, d.y, 0.014); a.setXYZ(1, o.x, o.y, 0.014); a.needsUpdate = true
      this.outLine.computeLineDistances()
    }
    // a new layout moves every spot: re-place at once rather than walk across a different room
    this.present = false
    this.alpha = 0
    this.choice = poseFor(null, null)
    this.retarget(true)
  }

  setView(v: '3d' | 'plan') { this.view = v; this.applyVisibility() }
  setLayers(l: { show: boolean; labels: boolean; trails: boolean }) { this.layers = l; this.applyVisibility() }

  onFrame(msg: FrameLike, nowS: number) {
    const live = msg.source === 'hardware'
    if (live !== this.live) {
      this.live = live
      const c = live ? LIVE : SIM, cold = live ? LIVE_COLD : SIM_COLD
      this.bodyMat.uniforms.uColor.value.copy(c); this.bodyMat.uniforms.uCold.value.copy(cold)
      this.ringMat.uniforms.uColor.value.copy(c); this.outRingMat.uniforms.uColor.value.copy(c)
      this.glyphMat.color.copy(c); this.glyphHeadMat.color.copy(c).lerp(WHITE, 0.35)
      ;(this.outLine.material as THREE.LineDashedMaterial).color.copy(c)
      for (const s of this.sprites) s.material.color.copy(c)
      this.label.element.classList.toggle('live', live); this.label.element.classList.toggle('sim', !live)
      this.outLabel.element.classList.toggle('live', live); this.outLabel.element.classList.toggle('sim', !live)
    }
    this.heatIn = energyToHeat(msg.motion_detail?.human_band)
    const h = this.hold.update(msg.learned ?? null, nowS)
    const changed = h.zone !== this.held.zone || h.activity !== this.held.activity
    const prevZone = this.held.zone
    this.held = h
    if (changed) this.retarget(false, prevZone)
    const key = h.zone ? `${h.zone}|${h.activity}|${live}` : ''
    if (key !== this.summaryKey) {
      this.summaryKey = key
      this.onChange?.(h.zone ? { zone: h.zone, activity: h.activity, live } : null)
    }
  }

  /** Where the figure goes for the held estimate. */
  private retarget(snap: boolean, prevZone: string | null = null) {
    const s = this.spots
    if (!s) return
    const c = poseFor(this.held.zone, this.held.activity)
    this.choice = c
    if (c.show !== 'figure') {
      this.target = null
      // out through the door, when the model says I went out; otherwise just fade
      if (this.present && c.show === 'outside' && s.door && !snap) {
        this.path = this.plan(new THREE.Vector2(s.door.x, s.door.y), false)
        this.leaving = true
      } else {
        this.path = []
        this.leaving = false
      }
      return
    }
    const spot = spotFor(s, c.at)!
    this.leaving = false
    const fromOutside = prevZone === 'outside' && !!s.door
    if (!this.present || this.alpha < 0.05) {
      if (fromOutside && !snap) {
        // back in: walk in from the doorway
        this.pos.set(s.door!.x, s.door!.y)
        this.target = null
        this.path = this.plan(new THREE.Vector2(spot.x, spot.y), spot.posture === 'lying')
        const first = this.path[0]?.p ?? new THREE.Vector2(spot.x, spot.y)
        this.yaw = Math.atan2(first.y - s.door!.y, first.x - s.door!.x)
        this.setWeights('standing', 'walking')
      } else {
        this.pos.set(spot.x, spot.y)
        this.path = []
        this.yaw = this.restYaw(spot)
        this.setWeights(c.posture, c.motion)
      }
      this.present = true
    } else if (!this.target || Math.hypot(this.target.x - spot.x, this.target.y - spot.y) > 0.05) {
      this.path = this.plan(new THREE.Vector2(spot.x, spot.y), spot.posture === 'lying')
    }
    this.target = spot
  }

  /** The way from here to a point: up off the bed first if I am on it, a walk (round
   *  furniture), and onto the bed last if that is where I am going. */
  private plan(to: THREE.Vector2, ontoBed: boolean): { p: THREE.Vector2; glide: boolean }[] {
    const s = this.spots!
    const side = s.stand.bed ? new THREE.Vector2(s.stand.bed.x, s.stand.bed.y) : null
    const out: { p: THREE.Vector2; glide: boolean }[] = []
    let from = this.pos.clone()
    const onBed = this.target?.posture === 'lying' && s.bed && Math.hypot(this.pos.x - s.bed.x, this.pos.y - s.bed.y) < 0.4
    if (onBed && side) { out.push({ p: side, glide: true }); from = side }
    const end = ontoBed && side ? side : to
    if (from.distanceTo(end) > 0.03) for (const p of this.route(from, end)) out.push({ p, glide: false })
    if (ontoBed && side) out.push({ p: to.clone(), glide: true })
    return out
  }

  /** A straight walk, or via the open floor when furniture is in the way. */
  private route(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] {
    const s = this.spots!, r = this.room!
    const blocked = (a: THREE.Vector2, b: THREE.Vector2) => {
      const n = Math.ceil(a.distanceTo(b) / 0.05)
      for (let i = 1; i < n; i++) {
        const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k
        if (Math.hypot(x - a.x, y - a.y) < 0.3 || Math.hypot(x - b.x, y - b.y) < 0.3) continue
        if (r.furniture.some((f) => x > f.x + 0.04 && x < f.x + f.w - 0.04 && y > f.y + 0.04 && y < f.y + f.d - 0.04)) return true
      }
      return false
    }
    const via = new THREE.Vector2(s.room.x, s.room.y)
    if (blocked(from, to) && from.distanceTo(via) > 0.2 && to.distanceTo(via) > 0.2) return [via, to.clone()]
    return [to.clone()]
  }

  private restYaw(spot: Spot): number { return spot.posture === 'lying' ? spot.facing - Math.PI : spot.facing }

  private setWeights(p: Posture, m: Motion) {
    for (const k of POSTURES) this.wP[k] = k === p ? 1 : 0
    for (const k of MOTIONS) this.wM[k] = k === m ? 1 : 0
  }

  /* ---------------------------------------------------------------- per frame */
  update(dt: number, t: number) {
    this.bodyMat.uniforms.uTime.value = t
    this.ringMat.uniforms.uTime.value = t
    this.outRingMat.uniforms.uTime.value = t
    this.heat = decayHeat(this.heat, this.heatIn, dt)

    // the outside marker
    const outOn = this.held.zone === 'outside' && !!this.spots?.outside
    this.outAlpha = damp(this.outAlpha, outOn ? estimateAlpha(this.held.p) : 0, 3, dt)
    this.outGroup.visible = this.outAlpha > 0.01
    this.outLine.visible = this.outGroup.visible
    this.outRingMat.uniforms.uAlpha.value = this.outAlpha * (0.75 + 0.25 * Math.sin(t * 1.6))
    ;(this.outLine.material as THREE.LineDashedMaterial).opacity = 0.4 * this.outAlpha
    if (outOn) {
      const b = this.outLabel.element.children[1] as HTMLElement
      const txt = estimateLabel(this.held)
      if (b.textContent !== txt) b.textContent = txt
    }
    this.outLabel.element.style.opacity = this.outAlpha.toFixed(3)

    if (!this.present || !this.spots) { this.root.visible = false; this.hideBodyExtras(); return }
    this.step(dt, t)
  }

  private hideBodyExtras() {
    this.chair.visible = false; this.ring.visible = false; this.glyph.visible = false; this.label.visible = false
    for (const s of this.sprites) s.visible = false
    this.trail.visible = false
  }

  private step(dt: number, t: number) {
    const c = this.choice
    const moving = this.path.length > 0
    const figure = c.show === 'figure' || this.leaving
    const wp = this.path[0]
    const gliding = moving && wp.glide
    const settling = gliding && this.path.length === 1           // onto the bed: lie down as I go
    // walking somewhere: stand up first, then go; arrive, then settle
    const postureT: Posture = !figure || (moving && !settling) ? 'standing' : c.posture
    const motionT: Motion = !figure ? 'still' : moving ? (gliding ? (settling ? c.motion : 'still') : 'walking') : c.motion
    for (const k of POSTURES) this.wP[k] = damp(this.wP[k], k === postureT ? 1 : 0, 3.2, dt)
    for (const k of MOTIONS) this.wM[k] = damp(this.wM[k], k === motionT ? 1 : 0, 5, dt)

    let travelling = false
    let yawT = this.target ? this.restYaw(this.target) : this.yaw
    if (gliding) {
      this.pos.x = damp(this.pos.x, wp.p.x, 2.4, dt)
      this.pos.y = damp(this.pos.y, wp.p.y, 2.4, dt)
      const next = this.path[1]
      if (next) yawT = Math.atan2(next.p.y - this.pos.y, next.p.x - this.pos.x)
      if (this.pos.distanceTo(wp.p) < 0.02) this.path.shift()
    } else if (moving && this.wP.standing > 0.72) {
      const goal = wp.p, last = this.path.length === 1
      const d = this.pos.distanceTo(goal)
      const vMax = last ? Math.min(WALK_SPEED, 0.25 + d * 1.6) : WALK_SPEED
      this.speed = damp(this.speed, vMax, 4, dt)
      const stepLen = Math.min(d, this.speed * dt)
      if (d > 1e-4) {
        yawT = Math.atan2(goal.y - this.pos.y, goal.x - this.pos.x)
        this.pos.x += ((goal.x - this.pos.x) / d) * stepLen
        this.pos.y += ((goal.y - this.pos.y) / d) * stepLen
        travelling = true
      }
      if (d - stepLen < 0.03) {
        this.path.shift()
        if (!this.path.length) this.speed = 0
      }
    } else if (moving) {
      yawT = Math.atan2(wp.p.y - this.pos.y, wp.p.x - this.pos.x)
    } else if (figure && c.at === 'room' && c.motion === 'walking' && this.target) {
      // walking about the open floor: drift on a slow loop round the room spot
      const R = this.spots!.wander
      const gx = this.target.x + R * Math.sin(t * 0.6), gy = this.target.y + R * Math.sin(t * 0.85 + 1.1)
      const dx = gx - this.pos.x, dy = gy - this.pos.y
      if (Math.hypot(dx, dy) > 0.01) yawT = Math.atan2(dy, dx)
      this.pos.x = damp(this.pos.x, gx, 1.5, dt)
      this.pos.y = damp(this.pos.y, gy, 1.5, dt)
      travelling = Math.hypot(dx, dy) > 0.04
    } else if (this.target) {
      this.pos.x = damp(this.pos.x, this.target.x, 3, dt)
      this.pos.y = damp(this.pos.y, this.target.y, 3, dt)
    }
    this.travel = damp(this.travel, travelling ? 1 : 0, 4, dt)
    this.yaw += wrap(yawT - this.yaw) * (1 - Math.exp(-5 * dt))

    // fade: by P(place), out at the door when leaving, out when the estimate goes
    const arrivedOut = this.leaving && !this.path.length
    const aT = figure && !arrivedOut ? estimateAlpha(this.held.zone === 'outside' ? Math.max(this.held.p, 0.5) : this.held.p) : 0
    this.alpha = damp(this.alpha, aT, aT > this.alpha ? 2.5 : 3.5, dt)
    if (aT === 0 && this.alpha < 0.01) { this.present = false; this.leaving = false; this.root.visible = false; this.hideBodyExtras(); return }

    // pose
    const ctx = { standing: { base: 0, travel: this.travel }, seated: { base: SEAT_H, travel: 0 }, lying: { base: this.bedBase, travel: 0 } }
    const p = blendPose(this.wP, this.wM, t, (k) => ctx[k], this.pose, this.tmpPose)
    this.root.position.set(this.pos.x, this.pos.y, p.pelvisZ)
    this.root.rotation.set(0, -Math.PI / 2 * this.wP.lying, this.yaw, 'ZYX')
    this.spine.rotation.y = p.lean
    this.torso.scale.set(p.breathe, 1 + (p.breathe - 1) * 0.4, 1)
    this.neck.rotation.y = p.nod
    this.sh[0].rotation.set(p.shLa, -p.shLf, 0); this.sh[1].rotation.set(-p.shRa, -p.shRf, 0)
    this.el[0].rotation.set(p.elLb, -p.elLf, 0); this.el[1].rotation.set(-p.elRb, -p.elRf, 0)
    this.hip[0].rotation.set(0.03, -p.hipL, 0); this.hip[1].rotation.set(-0.03, -p.hipR, 0)
    this.kn[0].rotation.y = p.knL; this.kn[1].rotation.y = p.knR
    this.group.updateMatrixWorld(true)

    // heat: where the activity says the movement is, as strong as the human band says
    const motion = (figure ? c.motion : 'still')
    const focus: Focus = this.travel > 0.5 ? 'legs' : c.show === 'figure' ? c.focus : 'chest'
    const breath = 0.6 + 0.4 * Math.sin(TAU * 0.25 * t)
    // still: a slow chest pulse at breathing pace, always shown (the body is there);
    // otherwise a faint mark where the activity puts the movement, lit by the energy
    const level = motion === 'still' && focus === 'chest' ? (0.45 + 0.55 * this.heat) * breath : 0.12 + 0.88 * Math.max(this.heat, this.travel * 0.5)
    const fw = FOCUS_W[focus]
    const hot = this.bodyMat.uniforms.uHot.value as THREE.Vector4[]
    const hotI = this.bodyMat.uniforms.uHotI.value as number[]
    let cx = 0, cy = 0, cw = 0
    for (let i = 0; i < SLOTS; i++) {
      this.slotI[i] = damp(this.slotI[i], fw[i] * level, 6, dt)
      this.marks[i].getWorldPosition(this.v)
      hot[i].set(this.v.x, this.v.y, this.v.z, SLOT_R[i])
      hotI[i] = this.slotI[i]
      if (i < 7) {                                  // direction of the movement, for the plan ring
        this.group.worldToLocal(this.v)
        cx += (this.v.x - this.pos.x) * this.slotI[i]; cy += (this.v.y - this.pos.y) * this.slotI[i]; cw += this.slotI[i]
      }
    }
    this.bodyMat.uniforms.uAlpha.value = this.alpha

    // the chair, while seated
    this.chair.position.set(this.target?.posture === 'seated' ? this.target.x : this.pos.x, this.target?.posture === 'seated' ? this.target.y : this.pos.y, 0)
    this.chair.rotation.z = this.target?.posture === 'seated' ? this.target.facing : this.yaw
    this.chairMat.opacity = 0.3 * this.alpha * Math.max(0, Math.min(1, (this.wP.seated - 0.1) / 0.6 + (this.target?.posture === 'seated' ? 0.4 : 0)))

    // floor ring (both views) and the plan glyph
    const plan = this.view === 'plan'
    const dir = Math.hypot(cx, cy)
    this.ring.position.set(this.pos.x, this.pos.y, 0.011)
    const u = this.ringMat.uniforms
    u.uAlpha.value = this.alpha
    u.uHeat.value = Math.min(1, this.heat * 1.1 + (focus === 'chest' ? 0.12 * breath : 0))
    u.uPlan.value = plan ? 1 : 0
    if (dir > 1e-3) (u.uDir.value as THREE.Vector2).set(cx / dir, cy / dir)
    u.uFocus.value = cw > 0 ? Math.min(1, dir / cw / 0.3) : 0
    this.glyph.position.set(this.pos.x, this.pos.y, 0.02)
    let top: Posture = 'standing'
    for (const k of POSTURES) if (this.wP[k] > this.wP[top]) top = k
    for (const k of POSTURES) this.glyphBody[k].visible = k === top
    this.glyph.rotation.z = top === 'lying' ? this.yaw + Math.PI : this.yaw
    this.glyphHead.geometry = top === 'lying' ? GLYPHS.head : GLYPHS.headFacing
    this.glyphHead.position.set(top === 'lying' ? 0.63 : top === 'seated' ? -0.04 : 0, 0, 0.001)
    this.glyphMat.opacity = 0.42 * this.alpha
    this.glyphHeadMat.opacity = 0.85 * this.alpha

    // glow sprites on the two hottest places (and the chest when still)
    let a = -1, b = -1
    for (let i = 0; i < 7; i++) {
      if (a < 0 || this.slotI[i] > this.slotI[a]) { b = a; a = i } else if (b < 0 || this.slotI[i] > this.slotI[b]) b = i
    }
    const glowSlots = [a, b, 7]
    for (let k = 0; k < 3; k++) {
      const i = glowSlots[k], s = this.sprites[k], I = i >= 0 ? this.slotI[i] : 0
      this.marks[i].getWorldPosition(this.v); this.group.worldToLocal(this.v)
      s.position.copy(this.v)
      s.scale.setScalar(0.16 + 0.42 * I)
      s.material.opacity = Math.min(1, I * 0.9) * this.alpha
      s.material.color.copy(this.live ? LIVE : SIM).lerp(WHITE, Math.min(0.7, I * 0.6))
    }

    // the spark trail: the hottest moving places, every 60 ms
    if (t - this.trailAt >= TRAIL_EVERY_S) {
      this.trailAt = t
      for (const i of [a, b]) {
        if (i < 0 || this.slotI[i] < 0.14) continue
        this.marks[i].getWorldPosition(this.v); this.group.worldToLocal(this.v)
        const j = this.trailHead
        this.trailPos[j * 3] = this.v.x + (Math.random() - 0.5) * 0.03
        this.trailPos[j * 3 + 1] = this.v.y + (Math.random() - 0.5) * 0.03
        this.trailPos[j * 3 + 2] = this.v.z
        this.trailBorn[j] = t; this.trailI[j] = this.slotI[i]
        this.trailHead = (j + 1) % TRAIL_N
      }
    }
    const base = this.live ? LIVE : SIM
    for (let j = 0; j < TRAIL_N; j++) {
      const age = t - this.trailBorn[j], I = this.trailI[j]
      const al = age < 0 || age > 4 ? 0 : I * Math.exp(-age / TRAIL_TAU_S) * this.alpha
      this.col.copy(base).lerp(WHITE, Math.min(0.75, I * 0.7))
      this.trailCol[j * 4] = this.col.r; this.trailCol[j * 4 + 1] = this.col.g; this.trailCol[j * 4 + 2] = this.col.b; this.trailCol[j * 4 + 3] = al
    }
    this.trail.geometry.attributes.position.needsUpdate = true
    this.trail.geometry.attributes.color.needsUpdate = true

    // the label: over the head (and over a raised hand); in the plan, beside the glyph
    // (top of the screen is +y there), so it never covers it
    if (plan) this.label.position.set(this.pos.x, this.pos.y + 0.82, 0.05)
    else {
      this.marks[1].getWorldPosition(this.v); this.group.worldToLocal(this.v)
      const hand = this.v.z
      this.headMark.getWorldPosition(this.v); this.group.worldToLocal(this.v)
      this.label.position.set(this.v.x, this.v.y, Math.max(this.v.z + (this.wP.lying > 0.5 ? 0.3 : 0.36), hand + 0.24))
    }
    const txt = this.leaving ? 'estimate · going out' : estimateLabel(this.held)
    if (this.labelText.textContent !== txt) this.labelText.textContent = txt
    const act = this.leaving ? 'walking' : this.held.activity
    const el = this.label.element
    if (el.dataset.act !== act) {
      el.dataset.act = act
      for (const m of MOTIONS) el.classList.toggle(`act-${m}`, m === act)
      this.labelIcon.textContent = GLYPH[act] ?? '•'
    }
    el.style.opacity = Math.min(1, 0.35 + this.alpha).toFixed(3)
    this.applyVisibility()
  }

  private applyVisibility() {
    const on = this.layers.show
    this.group.visible = on
    if (!this.present) return
    const plan = this.view === 'plan'
    this.root.visible = !plan
    this.chair.visible = !plan && this.chairMat.opacity > 0.005
    this.ring.visible = true
    this.glyph.visible = plan
    for (const s of this.sprites) s.visible = !plan && s.material.opacity > 0.01
    this.trail.visible = this.layers.trails
    // in the plan the sparks lie on the floor, under the glyph
    this.trail.scale.z = plan ? 0 : 1
    this.trail.position.z = plan ? 0.03 : 0
    this.label.visible = this.layers.labels
    this.outLabel.visible = this.layers.labels
  }

  /** Test hook: what the figure shows right now. */
  probe() {
    let top: Posture = 'standing'
    for (const k of POSTURES) if (this.wP[k] > this.wP[top]) top = k
    return {
      zone: this.held.zone, activity: this.held.activity, p: this.held.p, present: this.present,
      alpha: +this.alpha.toFixed(3), heat: +this.heat.toFixed(3), posture: top,
      x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), walking: this.path.length > 0,
      label: this.labelText.textContent,
    }
  }

  dispose() {
    this.label.element.remove()
    this.outLabel.element.remove()
    this.chair.geometry.dispose()
    this.outLine.geometry.dispose()
    this.trail.geometry.dispose()
    this.tex.dispose()
    for (const m of [this.bodyMat, this.ringMat, this.outRingMat, this.chairMat, this.glyphMat, this.glyphHeadMat,
      this.trail.material as THREE.Material, this.outLine.material as THREE.Material, ...this.sprites.map((s) => s.material)]) m.dispose()
    this.group.removeFromParent()
  }
}
