/**
 * SpatialTwin — the room in 3D, driven by the Aankhen engine.
 *
 * Coordinates match aankhen/room.py: metres, origin at a floor corner, +x
 * along one wall, +y along the next, +z up. Everything room-authored lives in one
 * group rotated -90° about X, so room (x, y, z) -> world (x, z, -y).
 *
 * The visual language is a hologram, but every element is an instrument:
 *   person column        a confirmed radar track; height = standing vs still
 *   floor reticle        radius = 2σ position uncertainty from the Kalman filter,
 *                        arc length = track confidence (decays while coasting)
 *   heading chevron      direction of travel; its length is the speed; gone when still
 *   radar wedge          the LD2450's real field of view; brightness = frame rate,
 *                        so a silent radar visibly dims
 *   Fresnel rings        the Wi-Fi link's first Fresnel zone — where a body can
 *                        disturb the signal; opacity = motion score. Never a position.
 *   link dashes          flow router -> ESP32 at the measured CSI packet rate
 *   heat dots            occupancy grid; dot area = time spent there
 *   amber rings          SIMULATION ONLY: where the simulated people truly are,
 *                        with a line to the track matched to them = the live error
 * Colour = provenance: cyan measured by hardware, amber simulated/replayed.
 *
 * Cost: one WebGL renderer, a few hundred draw calls, no post-processing. The
 * loop stops when the page is hidden.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

/* ------------------------------------------------------------------ wire types */
export interface RoomSpec {
  name: string; width: number; depth: number; height: number
  zones: { name: string; polygon: number[][]; is_exit?: boolean }[]
  furniture: { name: string; x: number; y: number; w: number; d: number; h: number }[]
  sensors: { id: string; kind: string; x: number; y: number; z: number; yaw_deg: number; pitch_deg: number; fov_deg: number; range_m: number }[]
  links: string[][]
}
export interface TrackMsg { id: string; x: number; y: number; vx: number; vy: number; speed: number; conf: number; std: number; zone: string | null; still: boolean }
export interface TruthMsg { name: string; x: number; y: number; posture: string; moving: boolean }
export interface FrameMsg {
  type: 'frame'; seq: number; source: string; t: number
  tracks: TrackMsg[]; motion: number; zones: Record<string, boolean>; zone_seconds: Record<string, number>
  presence: { state: string; p: number; confidence: number; count: number | null; evidence: Record<string, number>; reason: string }
  motion_detail: { state: string | null; score: number | null; threshold: number | null; baseline: string; reason: string; breathing_bpm: number | null; breathing_conf: number | null; breathing_note: string | null }
  csi: { n_subcarriers: number; rate_hz: number; rssi: number | null; fill_ratio: number; amplitudes: number[] }
  rates: { csi_hz: number; radar_hz: number }
  events: { id: number; t: number; ts: number; kind: string; text: string }[]
  truth?: TruthMsg[]
  metrics?: { pairs: { truth: string; track: string; error_m: number }[]; truth_n: number; tracked_n: number; mean_error_m: number | null }
  scenario?: { name: string; t: number; period_s: number | null }
}
export interface HeatMsg { type: 'heatmap'; layer: string; w: number; h: number; cell: number; data: number[]; hotspots: { x: number; y: number; person_seconds: number; zone: string | null }[] }
export type Layer = 'walls' | 'heat' | 'fov' | 'fresnel' | 'trails' | 'labels' | 'truth'

const LIVE = new THREE.Color('#5ce1ff')
const SIM = new THREE.Color('#ffb020')
const WHITE = new THREE.Color('#ffffff')
const LAMBDA = 299792458 / 2.437e9
const DELAY_MS = 150
const POOL = 12
const TRAIL = 56

/* ------------------------------------------------------------------ shaders */
const floorShader = {
  uniforms: { uSize: { value: new THREE.Vector2(4, 4) } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec2 uSize; varying vec2 vP;
    float line(vec2 p, float s, float w){ vec2 g = abs(fract(p/s - 0.5) - 0.5) * s; vec2 f = fwidth(p) * w; vec2 l = 1.0 - smoothstep(vec2(0.0), f, g); return max(l.x, l.y); }
    void main(){
      float minor = line(vP, 0.5, 1.0), major = line(vP, 1.0, 1.4);
      vec2 c = vP / uSize - 0.5;
      float v = 1.0 - dot(c, c) * 0.9;
      vec3 col = vec3(0.028, 0.032, 0.04) + vec3(0.05) * minor + vec3(0.10) * major;
      gl_FragColor = vec4(col * v, 1.0);
    }`,
}
const dotFloorShader = {
  uniforms: { uC: { value: new THREE.Vector2(2, 2) } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec2 uC; varying vec2 vP;
    void main(){
      vec2 g = fract(vP / 0.5) - 0.5;
      float d = 1.0 - smoothstep(0.025, 0.045, length(g));
      float fade = 1.0 - smoothstep(2.5, 13.0, length(vP - uC));
      gl_FragColor = vec4(vec3(1.0), d * 0.11 * fade);
    }`,
}
const wallShader = {
  vertexShader: `varying float vH; void main(){ vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying float vH; void main(){ float a = 0.09 * pow(1.0 - vH, 1.6) + 0.012; gl_FragColor = vec4(vec3(1.0), a); }`,
}
const columnShader = {
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
  vertexShader: `
    varying float vH; varying float vRim;
    void main(){
      vH = uv.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vRim = 1.0 - abs(dot(n, normalize(-mv.xyz)));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uAlpha; varying float vH; varying float vRim;
    void main(){ float a = pow(1.0 - vH, 1.3) * (0.18 + 0.82 * pow(vRim, 1.6)); gl_FragColor = vec4(uColor, a * uAlpha); }`,
}
const glowShader = {
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
  vertexShader: `varying vec2 vU; void main(){ vU = uv - 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vU; void main(){ float r = length(vU) * 2.0; gl_FragColor = vec4(uColor, pow(max(0.0, 1.0 - r), 2.2) * 0.55 * uAlpha); }`,
}
const arcShader = {
  uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uArc: { value: 1 } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uAlpha; uniform float uArc; varying vec2 vP;
    void main(){
      float a = atan(vP.x, vP.y); a = a < 0.0 ? a + 6.2831853 : a;   // clockwise from +y (north)
      if (a > uArc * 6.2831853) discard;
      gl_FragColor = vec4(uColor, uAlpha);
    }`,
}
const sectorShader = {
  uniforms: { uColor: { value: new THREE.Color() }, uR: { value: 6 }, uI: { value: 0 } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uR; uniform float uI; varying vec2 vP;
    void main(){ float r = length(vP) / uR; float a = (0.10 * pow(1.0 - r, 1.4) + 0.012) * uI; gl_FragColor = vec4(uColor, a); }`,
}
const flowShader = {
  uniforms: { uColor: { value: new THREE.Color() }, uT: { value: 0 }, uAlpha: { value: 0.7 } },
  vertexShader: `attribute float lineDistance; varying float vD; void main(){ vD = lineDistance; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uT; uniform float uAlpha; varying float vD;
    void main(){ float f = fract((vD - uT) / 0.32); if (f > 0.42) discard; gl_FragColor = vec4(uColor, uAlpha * (0.4 + 0.6 * f / 0.42)); }`,
}

const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)
const unitBoxEdges = new THREE.EdgesGeometry(unitBox)
const columnGeo = new THREE.CylinderGeometry(0.17, 0.17, 1, 28, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5)
const glowGeo = new THREE.PlaneGeometry(1.1, 1.1)
const ringGeo = new THREE.RingGeometry(0.965, 1.0, 120)
const headGeo = new THREE.SphereGeometry(0.075, 20, 12)
const chevronGeo = (() => {
  const s = new THREE.Shape().moveTo(0, 0.09).lineTo(0.16, 0).lineTo(0, -0.09).lineTo(0.04, 0).closePath()
  return new THREE.ShapeGeometry(s)
})()

function label(text: string, cls: string): CSS2DObject {
  const el = document.createElement('div')
  el.className = cls
  el.textContent = text
  return new CSS2DObject(el)
}

/* ------------------------------------------------------------------ person view */
class PersonView {
  group = new THREE.Group()
  colMat = new THREE.ShaderMaterial({ ...columnShader, uniforms: THREE.UniformsUtils.clone(columnShader.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  glowMat = new THREE.ShaderMaterial({ ...glowShader, uniforms: THREE.UniformsUtils.clone(glowShader.uniforms), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  ringMat = new THREE.ShaderMaterial({ ...arcShader, uniforms: THREE.UniformsUtils.clone(arcShader.uniforms), transparent: true, depthWrite: false, side: THREE.DoubleSide })
  headMat = new THREE.MeshBasicMaterial({ transparent: true })
  chevMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
  column = new THREE.Mesh(columnGeo, this.colMat)
  glow = new THREE.Mesh(glowGeo, this.glowMat)
  ring = new THREE.Mesh(ringGeo, this.ringMat)
  head = new THREE.Mesh(headGeo, this.headMat)
  chevron = new THREE.Mesh(chevronGeo, this.chevMat)
  tag: CSS2DObject
  tagEl: HTMLDivElement
  tagId: HTMLElement
  tagSub: HTMLElement
  trail: THREE.Line
  trailPos = new Float32Array(TRAIL * 3)
  trailN = 0
  id: string | null = null
  ts = new Float64Array(8); xs = new Float32Array(8); ys = new Float32Array(8); n = 0
  conf = 0; std = 0.15; speed = 0; heading = 0; still = false; lastSeen = 0; alive = 0
  height = 1.7; radius = 0.3

  constructor(parent: THREE.Object3D) {
    this.glow.position.z = 0.012
    this.ring.position.z = 0.016
    this.chevron.position.z = 0.017
    this.group.add(this.column, this.glow, this.ring, this.head, this.chevron)
    // Built with textContent, never innerHTML: zone names come from room.json.
    this.tagEl = document.createElement('div')
    this.tagEl.className = 'tw-tag'
    this.tagId = document.createElement('b')
    this.tagSub = document.createElement('span')
    this.tagEl.append(this.tagId, this.tagSub)
    this.tag = new CSS2DObject(this.tagEl)
    this.group.add(this.tag)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage))
    const alpha = new Float32Array(TRAIL)
    for (let i = 0; i < TRAIL; i++) alpha[i] = 1 - i / TRAIL
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1))
    this.trail = new THREE.Line(g, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA * vA * 0.7 * uAlpha); }`,
      transparent: true, depthWrite: false,
    }))
    this.trail.frustumCulled = false
    parent.add(this.group, this.trail)
    this.hide()
  }
  hide() { this.group.visible = false; this.trail.visible = false; this.id = null; this.n = 0; this.trailN = 0; this.alive = 0 }
  push(now: number, t: TrackMsg, color: THREE.Color, showLabels: boolean, showTrails: boolean) {
    if (this.n === 8) { this.ts.copyWithin(0, 1); this.xs.copyWithin(0, 1); this.ys.copyWithin(0, 1); this.n = 7 }
    this.ts[this.n] = now; this.xs[this.n] = t.x; this.ys[this.n] = t.y; this.n++
    this.conf = t.conf; this.std = t.std; this.speed = t.speed; this.still = t.still; this.lastSeen = now
    if (t.speed > 0.08) this.heading = Math.atan2(t.vy, t.vx)
    const zone = t.zone ? t.zone.toUpperCase() : 'UNZONED'
    const sub = `${zone} · ${t.still ? 'STILL' : `${t.speed.toFixed(1)} m/s`}`
    if (this.tagId.textContent !== t.id) this.tagId.textContent = t.id
    if (this.tagSub.textContent !== sub) this.tagSub.textContent = sub
    for (const u of [this.colMat.uniforms, this.glowMat.uniforms, this.ringMat.uniforms]) u.uColor.value.copy(color)
    ;(this.trail.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color)
    this.headMat.color.copy(color)
    this.chevMat.color.copy(color)
    if (this.id !== t.id) {
      this.id = t.id
      this.group.visible = true
    }
    this.tag.visible = showLabels
    this.trail.visible = showTrails
  }
  sample(rt: number, out: THREE.Vector2): boolean {
    const n = this.n
    if (!n) return false
    if (rt <= this.ts[0]) { out.set(this.xs[0], this.ys[0]); return true }
    for (let i = 1; i < n; i++) if (rt <= this.ts[i]) {
      const k = (rt - this.ts[i - 1]) / (this.ts[i] - this.ts[i - 1])
      out.set(this.xs[i - 1] + (this.xs[i] - this.xs[i - 1]) * k, this.ys[i - 1] + (this.ys[i] - this.ys[i - 1]) * k)
      return true
    }
    out.set(this.xs[n - 1], this.ys[n - 1])        // hold the last reading — never extrapolate
    return true
  }
  update(now: number, dt: number, p: THREE.Vector2) {
    const seen = now - this.lastSeen < 1200
    this.alive = THREE.MathUtils.damp(this.alive, seen ? 1 : 0, 6, dt)
    this.height = THREE.MathUtils.damp(this.height, this.still ? 1.2 : 1.72, 4, dt)
    this.radius = THREE.MathUtils.damp(this.radius, Math.max(0.22, 2 * this.std), 6, dt)
    this.group.position.set(p.x, p.y, 0)
    this.column.scale.set(1, 1, this.height)
    this.head.position.z = this.height - 0.02
    this.tag.position.set(0, 0, this.height + 0.32)
    const a = this.alive * (0.35 + 0.65 * this.conf)
    this.colMat.uniforms.uAlpha.value = a
    this.glowMat.uniforms.uAlpha.value = this.alive
    this.ringMat.uniforms.uAlpha.value = 0.85 * this.alive
    this.ringMat.uniforms.uArc.value = Math.max(0.04, this.conf)
    this.ring.scale.setScalar(this.radius)
    this.headMat.opacity = 0.9 * a
    const moving = !this.still && this.speed > 0.08
    this.chevron.visible = moving
    if (moving) {
      this.chevron.rotation.z = this.heading
      const r = this.radius + 0.05
      this.chevron.position.set(Math.cos(this.heading) * r, Math.sin(this.heading) * r, 0.017)
      this.chevron.scale.setScalar(0.7 + Math.min(this.speed, 1.6) * 0.9)
      this.chevMat.opacity = this.alive
    }
    const tp = this.trailPos
    if (this.trailN === 0 || Math.hypot(tp[0] - p.x, tp[1] - p.y) > 0.03) {
      tp.copyWithin(3, 0, (TRAIL - 1) * 3)
      tp[0] = p.x; tp[1] = p.y; tp[2] = 0.02
      this.trailN = Math.min(TRAIL, this.trailN + 1)
      this.trail.geometry.setDrawRange(0, this.trailN)
      this.trail.geometry.attributes.position.needsUpdate = true
    }
    ;(this.trail.material as THREE.ShaderMaterial).uniforms.uAlpha.value = this.alive
    if (this.alive < 0.01 && !seen) this.hide()
  }
}

/* ------------------------------------------------------------------ truth view (simulation only) */
class TruthView {
  ring: THREE.LineLoop
  cross: THREE.LineSegments
  err: THREE.Line
  tag: CSS2DObject
  name: string | null = null
  constructor(parent: THREE.Object3D) {
    const pts = Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2) * 0.2, Math.sin((i / 48) * Math.PI * 2) * 0.2, 0.02))
    const mat = new THREE.LineDashedMaterial({ color: SIM, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.95 })
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat)
    this.ring.computeLineDistances()
    this.cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.07, 0, 0.02), new THREE.Vector3(0.07, 0, 0.02), new THREE.Vector3(0, -0.07, 0.02), new THREE.Vector3(0, 0.07, 0.02),
    ]), new THREE.LineBasicMaterial({ color: SIM, transparent: true, opacity: 0.9 }))
    this.ring.add(this.cross)
    this.err = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: SIM, transparent: true, opacity: 0.8 }))
    this.err.frustumCulled = false
    this.tag = label('', 'tw-truth')
    this.tag.position.set(0, 0, 0.05)
    this.ring.add(this.tag)
    parent.add(this.ring, this.err)
    this.set(null)
  }
  set(t: TruthMsg | null, matched?: { x: number; y: number }, showLabels = true) {
    this.ring.visible = !!t
    this.err.visible = !!(t && matched)
    if (!t) { this.name = null; return }
    this.name = t.name
    this.ring.position.set(t.x, t.y, 0)
    this.tag.visible = showLabels
    this.tag.element.textContent = `TRUTH ${t.name} · ${t.posture}`
    if (matched) {
      const a = this.err.geometry.attributes.position as THREE.BufferAttribute
      a.setXYZ(0, t.x, t.y, 0.025); a.setXYZ(1, matched.x, matched.y, 0.025); a.needsUpdate = true
    }
  }
}

/* ------------------------------------------------------------------ the twin */
export class SpatialTwin {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private labels: CSS2DRenderer
  private scene = new THREE.Scene()
  private persp: THREE.PerspectiveCamera
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  private orbit: OrbitControls
  private pan: OrbitControls
  private camera: THREE.Camera
  private room = new THREE.Group()
  private roomStatic = new THREE.Group()
  private sensors = new THREE.Group()
  private planCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.35)
  private zoneViews = new Map<string, { fill: THREE.MeshBasicMaterial; line: THREE.LineDashedMaterial; target: number }>()
  private fresnel: { group: THREE.Group; rings: THREE.LineBasicMaterial[]; foot: THREE.Mesh; flow: THREE.ShaderMaterial; length: number }[] = []
  private fov: { mat: THREE.ShaderMaterial; edge: THREE.LineBasicMaterial; objs: THREE.Object3D[] }[] = []
  private walls: THREE.Object3D[] = []
  private people: PersonView[] = []
  private truths: TruthView[] = []
  private byId = new Map<string, PersonView>()
  private heat: THREE.InstancedMesh | null = null
  private heatW = 0
  private heatH = 0
  private heatColors: THREE.Color[] = []
  private layers: Record<Layer, boolean> = { walls: true, heat: true, fov: true, fresnel: true, trails: true, labels: true, truth: true }
  private accent = SIM.clone()
  private live = false
  private motion = 0
  private motionTarget = 0
  private radarI = 0
  private radarTarget = 0
  private flowSpeed = 0
  private raf = 0
  private last = performance.now()
  private tmp = new THREE.Vector2()
  private resizeObs: ResizeObserver
  roomSpec: RoomSpec | null = null
  view: '3d' | 'plan' = '3d'

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.localClippingEnabled = true
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)
    this.labels = new CSS2DRenderer()
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    container.appendChild(this.labels.domElement)

    this.persp = new THREE.PerspectiveCamera(42, 1, 0.05, 200)
    this.ortho.up.set(0, 0, -1)
    this.camera = this.persp
    this.orbit = new OrbitControls(this.persp, this.renderer.domElement)
    this.orbit.enableDamping = true
    this.orbit.dampingFactor = 0.08
    this.orbit.maxPolarAngle = Math.PI * 0.47
    this.orbit.minDistance = 2
    this.orbit.maxDistance = 22
    this.pan = new OrbitControls(this.ortho, this.renderer.domElement)
    this.pan.enableRotate = false
    this.pan.enabled = false

    this.scene.fog = new THREE.Fog(0x050506, 14, 34)
    this.room.rotation.x = -Math.PI / 2
    this.room.add(this.roomStatic, this.sensors)
    this.scene.add(this.room)
    for (let i = 0; i < POOL; i++) this.people.push(new PersonView(this.room))
    for (let i = 0; i < 6; i++) this.truths.push(new TruthView(this.room))

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ---------------------------------------------------------------- room */
  setRoom(r: RoomSpec) {
    this.roomSpec = r
    for (const g of [this.roomStatic, this.sensors]) {
      g.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.geometry !== unitBox && m.geometry !== unitBoxEdges) m.geometry.dispose()
        if (o instanceof CSS2DObject) o.element.remove()
      })
      g.clear()
    }
    this.zoneViews.clear(); this.fresnel = []; this.fov = []; this.walls = []
    const W = r.width, D = r.depth, H = r.height

    // ambient dot floor that fades into the dark: the room sits in space
    const dots = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).translate(W / 2, D / 2, 0),
      new THREE.ShaderMaterial({ ...dotFloorShader, uniforms: { uC: { value: new THREE.Vector2(W / 2, D / 2) } }, transparent: true, depthWrite: false }))
    dots.position.z = -0.004
    this.roomStatic.add(dots)

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).translate(W / 2, D / 2, 0),
      new THREE.ShaderMaterial({ ...floorShader, uniforms: { uSize: { value: new THREE.Vector2(W, D) } } }))
    this.roomStatic.add(floor)

    // walls: a fading glass pane + crisp edges
    const corners = [[0, 0], [W, 0], [W, D], [0, D]]
    const wallMat = new THREE.ShaderMaterial({ ...wallShader, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4]
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute([ax, ay, 0, bx, by, 0, bx, by, H, ax, ay, H], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
      g.setIndex([0, 1, 2, 0, 2, 3])
      const m = new THREE.Mesh(g, wallMat)
      m.renderOrder = 6
      this.roomStatic.add(m)
      this.walls.push(m)
    }
    const edge = (pts: number[][], opacity: number, wall = true) => {
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))),
        new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity }))
      this.roomStatic.add(l)
      if (wall) this.walls.push(l)
    }
    const fl: number[][] = [], tops: number[][] = [], verts: number[][] = []
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4]
      fl.push([ax, ay, 0.002], [bx, by, 0.002]); tops.push([ax, ay, H], [bx, by, H]); verts.push([ax, ay, 0], [ax, ay, H])
    }
    edge(fl, 0.5, false); edge(verts, 0.22); edge(tops, 0.12)
    // scale ticks along two walls every metre: the eye gets a ruler
    const ticks: number[][] = []
    for (let x = 1; x < W; x++) ticks.push([x, -0.02, 0.003], [x, -0.14, 0.003])
    for (let y = 1; y < D; y++) ticks.push([-0.02, y, 0.003], [-0.14, y, 0.003])
    edge(ticks, 0.35, false)
    for (let x = 0; x <= W; x++) { const l = label(`${x}m`, 'tw-ruler'); l.position.set(x, -0.3, 0); this.roomStatic.add(l) }

    // furniture
    const fill = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.035, depthWrite: false })
    const lines = new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.32 })
    for (const f of r.furniture) {
      const m = new THREE.Mesh(unitBox, fill)
      const e = new THREE.LineSegments(unitBoxEdges, lines)
      for (const o of [m, e]) { o.position.set(f.x, f.y, 0); o.scale.set(f.w, f.d, f.h) }
      this.roomStatic.add(m, e)
      const l = label(f.name, 'tw-label')
      l.position.set(f.x + f.w / 2, f.y + f.d / 2, f.h + 0.08)
      this.roomStatic.add(l)
    }

    // zones
    for (const z of r.zones) {
      const shape = new THREE.Shape(z.polygon.map((p) => new THREE.Vector2(p[0], p[1])))
      const fillMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.015, depthWrite: false })
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat)
      mesh.position.z = 0.005
      const pts = [...z.polygon, z.polygon[0]].map((p) => new THREE.Vector3(p[0], p[1], 0.006))
      const lineMat = new THREE.LineDashedMaterial({ color: WHITE, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.28 })
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat)
      line.computeLineDistances()
      const c = z.polygon.reduce((s, p) => [s[0] + p[0] / z.polygon.length, s[1] + p[1] / z.polygon.length], [0, 0])
      const l = label(z.is_exit ? `${z.name} ↗` : z.name, 'tw-zone')
      l.position.set(c[0], c[1], 0.02)
      this.roomStatic.add(mesh, line, l)
      this.zoneViews.set(z.name, { fill: fillMat, line: lineMat, target: 0 })
    }
    this.buildSensors(r)
    this.frameCameras()
    this.applyLayers()
  }

  private buildSensors(r: RoomSpec) {
    const byId = Object.fromEntries(r.sensors.map((s) => [s.id, s]))
    for (const s of r.sensors) {
      const mat = new THREE.MeshBasicMaterial({ color: WHITE })
      const geo = s.kind === 'ld2450' ? new THREE.BoxGeometry(0.12, 0.05, 0.08) : new THREE.OctahedronGeometry(0.06)
      const m = new THREE.Mesh(geo, mat)
      m.position.set(s.x, s.y, s.z)
      if (s.kind === 'ld2450') m.rotation.z = THREE.MathUtils.degToRad(s.yaw_deg)
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.x, s.y, 0), new THREE.Vector3(s.x, s.y, s.z)]),
        new THREE.LineDashedMaterial({ color: WHITE, dashSize: 0.04, gapSize: 0.05, transparent: true, opacity: 0.3 }))
      stem.computeLineDistances()
      const l = label(`${s.id.toUpperCase()}`, 'tw-sensor')
      l.position.set(s.x, s.y, s.z + 0.2)
      this.sensors.add(m, stem, l)

      if (s.kind === 'ld2450') {
        const start = THREE.MathUtils.degToRad(s.yaw_deg - s.fov_deg / 2), len = THREE.MathUtils.degToRad(s.fov_deg)
        const mat2 = new THREE.ShaderMaterial({ ...sectorShader, uniforms: { uColor: { value: this.accent.clone() }, uR: { value: s.range_m }, uI: { value: 0 } },
          transparent: true, depthWrite: false, clippingPlanes: this.roomClipRoomSpace() })
        const sector = new THREE.Mesh(new THREE.CircleGeometry(s.range_m, 64, start, len), mat2)
        sector.position.set(s.x, s.y, 0.004)
        const arc: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)]
        for (let i = 0; i <= 48; i++) { const a = start + (len * i) / 48; arc.push(new THREE.Vector3(Math.cos(a) * s.range_m, Math.sin(a) * s.range_m, 0)) }
        arc.push(new THREE.Vector3(0, 0, 0))
        const edgeMat = new THREE.LineBasicMaterial({ color: this.accent.clone(), transparent: true, opacity: 0.3, clippingPlanes: this.roomClipRoomSpace() })
        const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), edgeMat)
        outline.position.set(s.x, s.y, 0.005)
        this.sensors.add(sector, outline)
        this.fov.push({ mat: mat2, edge: edgeMat, objs: [sector, outline] })
      }
    }
    for (const [txId, rxId] of r.links) {
      const tx = byId[txId], rx = byId[rxId]
      if (!tx || !rx) continue
      const T = new THREE.Vector3(tx.x, tx.y, tx.z), R = new THREE.Vector3(rx.x, rx.y, rx.z)
      const d = T.distanceTo(R), a = (d + LAMBDA / 2) / 2, b = Math.sqrt(Math.max(1e-6, a * a - (d / 2) ** 2))
      const group = new THREE.Group()
      group.position.copy(T).add(R).multiplyScalar(0.5)
      group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), R.clone().sub(T).normalize())
      const rings: THREE.LineBasicMaterial[] = []
      const mk = (pts: THREE.Vector3[]) => {
        const m = new THREE.LineBasicMaterial({ color: this.accent.clone(), transparent: true, opacity: 0.1, depthWrite: false })
        group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), m))
        rings.push(m)
      }
      for (let i = 1; i <= 9; i++) {                 // latitude rings across the ellipsoid
        const x = -a + (2 * a * i) / 10, rr = b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2))
        mk(Array.from({ length: 48 }, (_, k) => new THREE.Vector3(x, Math.cos((k / 48) * Math.PI * 2) * rr, Math.sin((k / 48) * Math.PI * 2) * rr)))
      }
      for (let j = 0; j < 3; j++) {                   // three meridians
        const ang = (j / 3) * Math.PI
        mk(Array.from({ length: 64 }, (_, k) => {
          const th = (k / 64) * Math.PI * 2
          return new THREE.Vector3(a * Math.cos(th), b * Math.sin(th) * Math.cos(ang), b * Math.sin(th) * Math.sin(ang))
        }))
      }
      const foot = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: this.accent.clone(), transparent: true, opacity: 0.08, depthWrite: false }))
      foot.position.set(group.position.x, group.position.y, 0.007)
      foot.rotation.z = Math.atan2(R.y - T.y, R.x - T.x)
      foot.scale.set(a, b, 1)
      foot.visible = false
      // the link itself: dashes flowing transmitter -> receiver at the packet rate
      const lg = new THREE.BufferGeometry().setFromPoints([T, R])
      lg.setAttribute('lineDistance', new THREE.Float32BufferAttribute([0, d], 1))
      const flow = new THREE.ShaderMaterial({ ...flowShader, uniforms: { uColor: { value: this.accent.clone() }, uT: { value: 0 }, uAlpha: { value: 0.75 } }, transparent: true, depthWrite: false })
      const line = new THREE.Line(lg, flow)
      this.sensors.add(group, foot, line)
      this.fresnel.push({ group, rings, foot, flow, length: d })
    }
  }

  /** Room-space clip planes as world-space planes (clipping works in world space). */
  private roomClipRoomSpace(): THREE.Plane[] {
    const r = this.roomSpec!
    // room (x,y,z) -> world (x, z, -y): x in [0,W] -> world x; y in [0,D] -> world z in [-D,0]
    return [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), 0.001),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), r.width + 0.001),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.001),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), r.depth + 0.001),
    ]
  }

  private frameCameras() {
    const r = this.roomSpec
    if (!r) return
    const c = new THREE.Vector3(r.width / 2, 0, -r.depth / 2)
    const span = Math.max(r.width, r.depth)
    // Pulled back far enough that the whole room, walls included, sits between
    // the HUD columns at a 16:10 window.
    this.persp.position.set(c.x + span * 1.25, span * 1.55, c.z + span * 1.9)
    this.orbit.target.copy(c).setY(0.2)
    this.ortho.position.set(c.x, 30, c.z)
    this.ortho.lookAt(c)
    this.pan.target.copy(c)
    this.fitOrtho(span / 2 + 0.9)
  }
  private orthoHalf = 3
  private fitOrtho(half = this.orthoHalf) {
    this.orthoHalf = half
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1
    const asp = w / h
    this.ortho.left = -half * asp; this.ortho.right = half * asp; this.ortho.top = half; this.ortho.bottom = -half
    this.ortho.updateProjectionMatrix()
  }
  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.fitOrtho()
  }

  /* ---------------------------------------------------------------- controls */
  setView(v: '3d' | 'plan') {
    this.view = v
    const plan = v === 'plan'
    this.camera = plan ? this.ortho : this.persp
    this.orbit.enabled = !plan
    this.pan.enabled = plan
    this.renderer.clippingPlanes = plan ? [this.planCut] : []
    for (const f of this.fresnel) { f.group.visible = !plan && this.layers.fresnel; f.foot.visible = plan && this.layers.fresnel }
  }
  setLayer(l: Layer, on: boolean) {
    this.layers[l] = on
    this.applyLayers()
  }
  private applyLayers() {
    for (const w of this.walls) w.visible = this.layers.walls
    for (const f of this.fov) for (const o of f.objs) o.visible = this.layers.fov
    for (const f of this.fresnel) { f.group.visible = this.layers.fresnel && this.view === '3d'; f.foot.visible = this.layers.fresnel && this.view === 'plan' }
    if (this.heat) this.heat.visible = this.layers.heat
    this.roomStatic.traverse((o) => { if (o instanceof CSS2DObject) o.visible = this.layers.labels })
    this.sensors.traverse((o) => { if (o instanceof CSS2DObject) o.visible = this.layers.labels })
    for (const t of this.truths) if (!this.layers.truth) t.set(null)
  }
  resetCamera() { this.frameCameras() }

  /* ---------------------------------------------------------------- data */
  onFrame(msg: FrameMsg) {
    const now = performance.now()
    this.live = msg.source === 'hardware'
    const color = this.live ? LIVE : SIM
    if (!this.accent.equals(color)) {
      this.accent.copy(color)
      for (const f of this.fov) { f.mat.uniforms.uColor.value.copy(color); f.edge.color.copy(color) }
      for (const f of this.fresnel) { f.rings.forEach((m) => m.color.copy(color)); (f.foot.material as THREE.MeshBasicMaterial).color.copy(color); f.flow.uniforms.uColor.value.copy(color) }
    }
    for (const t of msg.tracks) {
      let v = this.byId.get(t.id)
      if (!v || v.id !== t.id) {
        v = this.people.find((p) => p.id === null)
        if (!v) continue
        this.byId.set(t.id, v)
      }
      v.push(now, t, color, this.layers.labels, this.layers.trails)
    }
    for (const [name, z] of this.zoneViews) z.target = msg.zones[name] ? 1 : 0
    this.motionTarget = Math.max(0, Math.min(1, msg.motion))
    this.radarTarget = Math.min(1, (msg.rates?.radar_hz ?? 0) / 10)
    this.flowSpeed = (msg.rates?.csi_hz ?? 0) / 100 * 1.6
    // simulation ground truth + the live error line to the matched track
    const truth = this.layers.truth ? msg.truth ?? [] : []
    const pairs = new Map((msg.metrics?.pairs ?? []).map((p) => [p.truth, p.track]))
    const trackPos = new Map(msg.tracks.map((t) => [t.id, t]))
    this.truths.forEach((tv, i) => {
      const t = truth[i]
      const m = t ? trackPos.get(pairs.get(t.name) ?? '') : undefined
      tv.set(t ?? null, m ? { x: m.x, y: m.y } : undefined, this.layers.labels)
    })
  }

  onHeatmap(msg: HeatMsg) {
    if (msg.w !== this.heatW || msg.h !== this.heatH || !this.heat) {
      if (this.heat) { this.room.remove(this.heat); this.heat.dispose() }
      const geo = new THREE.CircleGeometry(0.5, 14)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false })
      this.heat = new THREE.InstancedMesh(geo, mat, msg.w * msg.h)
      this.heat.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.heat.renderOrder = 2
      this.heatW = msg.w; this.heatH = msg.h
      this.heatColors = Array.from({ length: msg.w * msg.h }, () => new THREE.Color())
      this.room.add(this.heat)
      this.heat.visible = this.layers.heat
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const dim = new THREE.Color(0x2a3038)
    for (let r = 0; r < msg.h; r++) for (let c = 0; c < msg.w; c++) {
      const i = r * msg.w + c, v = msg.data[i] ?? 0
      const k = v < 0.03 ? 0 : Math.sqrt(v)                 // dot AREA ∝ time spent
      p.set((c + 0.5) * msg.cell, (r + 0.5) * msg.cell, 0.009)
      s.setScalar(k * msg.cell * 0.92)
      m.compose(p, q, s)
      this.heat!.setMatrixAt(i, m)
      this.heatColors[i].copy(dim).lerp(this.accent, Math.min(1, v * 1.4))
      this.heat!.setColorAt(i, this.heatColors[i])
    }
    this.heat!.instanceMatrix.needsUpdate = true
    if (this.heat!.instanceColor) this.heat!.instanceColor.needsUpdate = true
  }

  /* ---------------------------------------------------------------- loop */
  private loop = (ts: number) => {
    this.raf = requestAnimationFrame(this.loop)
    if (document.hidden) return
    const dt = Math.min((ts - this.last) / 1000, 0.1)
    this.last = ts
    const now = performance.now(), rt = now - DELAY_MS
    for (const v of this.people) if (v.id !== null && v.sample(rt, this.tmp)) v.update(now, dt, this.tmp)
    for (const [id, v] of this.byId) if (v.id !== id) this.byId.delete(id)
    for (const z of this.zoneViews.values()) {
      z.fill.opacity = THREE.MathUtils.damp(z.fill.opacity, 0.015 + 0.12 * z.target, 5, dt)
      z.line.opacity = THREE.MathUtils.damp(z.line.opacity, 0.28 + 0.6 * z.target, 5, dt)
      z.fill.color.copy(z.target > 0.5 ? this.accent : WHITE)
      z.line.color.copy(z.target > 0.5 ? this.accent : WHITE)
    }
    this.motion = THREE.MathUtils.damp(this.motion, this.motionTarget, 3, dt)
    this.radarI = THREE.MathUtils.damp(this.radarI, this.radarTarget, 3, dt)
    const t = now / 1000
    for (const f of this.fresnel) {
      f.rings.forEach((m, i) => {
        const shimmer = 0.65 + 0.35 * Math.sin(t * (1 + 6 * this.motion) + i * 0.7)
        m.opacity = (0.05 + 0.55 * this.motion) * shimmer
      })
      ;(f.foot.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.25 * this.motion
      f.flow.uniforms.uT.value = (f.flow.uniforms.uT.value + dt * this.flowSpeed) % 1000
    }
    for (const f of this.fov) { f.mat.uniforms.uI.value = 0.15 + 0.85 * this.radarI; f.edge.opacity = 0.08 + 0.3 * this.radarI }
    ;(this.camera === this.persp ? this.orbit : this.pan).update()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    this.orbit.dispose()
    this.pan.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }

  /** Test hook: what is on screen right now. */
  probe() {
    return {
      people: this.people.filter((p) => p.id !== null).map((p) => p.id),
      truths: this.truths.filter((t) => t.name).map((t) => t.name),
      zones: [...this.zoneViews.keys()], fresnel: this.fresnel.length, heat: [this.heatW, this.heatH],
      calls: this.renderer.info.render.calls, geometries: this.renderer.info.memory.geometries,
    }
  }
}
