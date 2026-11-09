import { useEffect, useState } from 'react'

/*
 * Liquid glass for panels that float over the live 3D twin.
 *
 * WHY THIS SHAPE (2026-10-26)
 * - The Aankhen cards used to pay for a 28 px backdrop blur and then paint a 62 %-opaque
 *   fill over it: the cost of glass, none of the look. A backdrop blur is recomputed
 *   every frame the WebGL canvas under it changes, and its cost grows with the radius,
 *   so the radius drops to 12 px and the fill becomes truly translucent.
 * - Refraction: the rim of real glass bends what is behind it. A displacement map (made
 *   once, here, 96 x 96 px) is neutral in the middle and pushes pixels inward near the
 *   edges; `backdrop-filter: url(#lg-refract)` applies it to the backdrop. Chromium
 *   (WebView2) supports it; elsewhere the declaration is dropped and plain blur stays.
 * - It must never slow the app: on first use a 2 s frame probe runs with refraction on.
 *   Under 50 fps -> "blur" (no refraction); under 38 fps even then -> "flat" (no
 *   backdrop work at all). The verdict is remembered per machine.
 */

export type GlassTier = 'refract' | 'blur' | 'flat'
const KEY = 'jarvis.glassTier.v1'

let mapUrl: string | null = null

/** The lens: R = x shift, G = y shift (128 = none), strongest at the rim, zero inside. */
export function lensMap(size = 96, rim = 0.2): string {
  if (mapUrl) return mapUrl
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size
      // distance to the nearest vertical / horizontal edge, as a share of the rim width
      const fx = Math.max(0, 1 - Math.min(u, 1 - u) / rim)
      const fy = Math.max(0, 1 - Math.min(v, 1 - v) / rim)
      const i = (y * size + x) * 4
      img.data[i] = 128 + Math.round((u < 0.5 ? 1 : -1) * fx * fx * 127)   // pull inward
      img.data[i + 1] = 128 + Math.round((v < 0.5 ? 1 : -1) * fy * fy * 127)
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  mapUrl = c.toDataURL()
  return mapUrl
}

/** The SVG filter the CSS points at. Mount once per page that uses refraction. */
export function GlassDefs() {
  const [href, setHref] = useState('')
  useEffect(() => setHref(lensMap()), [])
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <filter id="lg-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        {href && <feImage href={href} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />}
        <feDisplacementMap in="SourceGraphic" in2="map" scale="22" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

function readTier(): GlassTier | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'refract' || v === 'blur' || v === 'flat' ? v : null
  } catch {
    return null
  }
}

function saveTier(t: GlassTier) {
  try { localStorage.setItem(KEY, t) } catch { /* private window: probe again next time */ }
}

/** Average frames per second over `ms`, measured with requestAnimationFrame. */
export function measureFps(ms = 2000): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      frames++
      if (t - t0 < ms) requestAnimationFrame(tick)
      else resolve((frames * 1000) / (t - t0))
    }
    requestAnimationFrame(tick)
  })
}

/** The tier for this machine: remembered, else probed once (refraction on while probing). */
export function useGlassTier(opts?: GlassTierOptions): GlassTier {
  const ww = useWwGlassTier(opts)
  const legacy = useLegacyGlassTier()
  return opts ? ww : legacy
}

function useLegacyGlassTier(): GlassTier {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches
  const [tier, setTier] = useState<GlassTier>(() => (reduced ? 'flat' : readTier() ?? 'refract'))
  useEffect(() => {
    if (reduced || readTier()) return
    let live = true
    // let the twin settle first: its first second is shader compiles, not steady state
    const t = window.setTimeout(async () => {
      const fps = await measureFps(2000)
      if (!live) return
      let next: GlassTier = fps >= 50 ? 'refract' : 'blur'
      if (next === 'blur') {
        setTier('blur')
        const again = await measureFps(1500)
        if (!live) return
        if (again < 38) next = 'flat'
      }
      setTier(next)
      saveTier(next)
    }, 1500)
    return () => { live = false; window.clearTimeout(t) }
  }, [reduced])
  return tier
}

/* ------------------------------------------------------------------------------------------
 * Additions for Well Wisher (plan 5.6, 5.8.5). Everything above is unchanged; the old
 * useGlassTier() call with no argument behaves exactly as before.
 *
 * WHY: the average-fps probe hides stutter (a 60 fps average can hold a 12 fps stall), and it
 * starts at `refract` and keeps its verdict forever. Well Wisher wants glass flat until
 * measured, capped at `blur` (refract has no visual owner and its cost is unmeasured), and
 * decided on the 5th-percentile frame rate: 1000 / the 95th-percentile frame gap, with a
 * 55 fps floor. The sampler's rAF loop runs only while something animates and stops 300 ms
 * after the last animation, so idle stays at 0 callbacks.
 * ---------------------------------------------------------------------------------------- */

export interface GlassTierOptions {
  /** the highest tier this surface may reach; Well Wisher passes 'blur' */
  ceiling?: GlassTier
  /** the tier shown until the first measurement; Well Wisher passes 'flat' */
  start?: GlassTier
  /** p5 fps needed to leave `flat` (default 55) */
  floorFps?: number
}

const ORDER: GlassTier[] = ['flat', 'blur', 'refract']
export const clampTier = (t: GlassTier, ceiling: GlassTier): GlassTier => (ORDER.indexOf(t) > ORDER.indexOf(ceiling) ? ceiling : t)

/** 5th-percentile fps from frame gaps in ms: 1000 / the 95th-percentile gap. */
export function p5FromGaps(gaps: readonly number[]): number {
  if (gaps.length === 0) return 0
  const sorted = [...gaps].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return 1000 / sorted[idx]
}

/** Frame-gap sampler: start() when an animation begins, stop() 300 ms after the last one ends. Keeps the last 5 windows. */
export class FrameSampler {
  private raf = 0
  private last = 0
  private gaps: number[] = []
  private windows: number[][] = []
  get running(): boolean {
    return this.raf !== 0
  }
  start(): void {
    if (this.raf) return
    this.gaps = []
    this.last = 0
    const tick = (t: number) => {
      if (this.last) this.gaps.push(t - this.last)
      this.last = t
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    if (this.gaps.length) this.windows = [...this.windows.slice(-4), this.gaps]
  }
  /** p5 over the stored windows (null until one exists) */
  p5(): number | null {
    const all = this.windows.flat()
    return all.length ? p5FromGaps(all) : null
  }
  maxGap(): number {
    return Math.max(0, ...this.windows.flat())
  }
}

/** Measure p5 fps over `ms` with a rAF loop that stops by itself. */
export function measureP5Fps(ms = 2000): Promise<number> {
  return new Promise((resolve) => {
    const gaps: number[] = []
    let last = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      if (last) gaps.push(t - last)
      last = t
      if (t - t0 < ms) requestAnimationFrame(tick)
      else resolve(p5FromGaps(gaps))
    }
    requestAnimationFrame(tick)
  })
}

const WW_KEY = 'jarvis.glassTier.ww.v1'

function useWwGlassTier(opts?: GlassTierOptions): GlassTier {
  const ceiling = opts?.ceiling ?? 'blur'
  const floor = opts?.floorFps ?? 55
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-transparency: reduce)').matches
  const [tier, setTier] = useState<GlassTier>(() => (reduced ? 'flat' : opts?.start ?? 'flat'))
  useEffect(() => {
    if (!opts || reduced) return
    let live = true
    const t = window.setTimeout(async () => {
      const p5 = await measureP5Fps(2000)
      if (!live) return
      const next: GlassTier = p5 >= floor ? clampTier('blur', ceiling) : 'flat'
      setTier(next)
      try { localStorage.setItem(WW_KEY, next) } catch { /* private window */ }
    }, 1500)
    return () => { live = false; window.clearTimeout(t) }
  }, [reduced, ceiling, floor]) // eslint-disable-line react-hooks/exhaustive-deps
  return tier
}
