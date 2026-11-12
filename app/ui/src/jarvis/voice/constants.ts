// Every number of the voice picture, named once (spec 9.2 to 9.11, docs/design/jarvis-product-overhaul.md).
// Where the spec says "target" or "assumption" the comment says so; the measured ones live in docs/research/voice.md.

// --- the band map (9.2). Identical to core/playback.py: N_BANDS, F_LO, F_HI, BAND_DB_LO, BAND_DB_SPAN. ---
export const N_BANDS = 24
export const F_LO = 100
export const F_HI = 8000
/** One frame every 50 ms = 20 Hz while a stream is open. */
export const FRAME_MS = 50
/** The mapping window is 60 dB wide for both channels. Output floor -60 dB, input floor -70 dB (assumption: the mic floor is higher). */
export const DB_SPAN = 60
export const OUT_DB_LO = -60
export const IN_DB_LO = -70
/** Settings "Hill sensitivity: High" shifts the window by +12 dB and the legend then says "display +12 dB". */
export const SENSITIVITY_HIGH_DB = 12
/** The legacy scalar `level` is `norm(block) * 10` and unbounded; 10 is "a full-scale block" and only a relative unit (9.9 T0). */
export const T0_FULL_SCALE = 10
/** Legacy `level` arrives at most every 0.08 s (12.5 Hz). */
export const T0_RATE_HZ = 12.5

// --- freshness (9.3, 9.6) ---
/** A frame older than this marks the channel stale: 8 missed frames at 20 Hz (assumption). Stale means "age greater than", so 399 and 400 are live, 401 is not. */
export const STALE_MS = 400
/** After the core says `speaking`, the first out_level may take this long before the state is NO SIGNAL (first audio has latency). */
export const FIRST_AUDIO_MS = 1000
/** Frames kept per channel: 64 at 20 Hz is about 3.2 s. */
export const RING_CAP = 64
/** Largest time step the smoother trusts; a longer gap starts a new stream, so a stale value is never blended in. */
export const SMOOTH_DT_MAX_MS = STALE_MS

// --- smoothing, applied once on ingest to real values (9.3) ---
export const ATTACK_MS = 40
export const RELEASE_MS = 160
/** One-pole coefficient for a step of dt ms; at 50 ms it is 0.713 up and 0.268 down. */
export const smoothCoef = (dtMs: number, tauMs: number): number => 1 - Math.exp(-dtMs / tauMs)

// --- the stage (9.4) ---
export const STAGE_W = 720
export const STAGE_H = 360
export const HILL_HALF_W = 320
export const HILL_BASELINE = 300
export const HILL_MAX_H = 190
export const HILL_CENTER_X = 360
export const RING_CX = 360
export const RING_CY = 176
export const RING_BEZEL_R = 120
export const RING_BASE_R = 128
export const RING_BARS = 96
export const RING_BAR_MIN = 4
export const RING_BAR_SPAN = 32
export const RING_BAR_W = 2
/** 3.75 degrees between bars: 360 / 96. */
export const RING_STEP_DEG = 360 / RING_BARS
/** Bars whose midpoint is below the hill baseline are drawn at half alpha. */
export const RING_BELOW_ALPHA = 0.5

// --- the hill (9.5) ---
export const HILL_LAYER_SPACING_MS = 100
export const HILL_STIPPLES = 4
export const HILL_STIPPLE_FRACTION = [0.40, 0.65, 0.85, 1.00] as const
export const HILL_JITTER_Y = 0.04
export const HILL_JITTER_X = 0.8
export const HILL_JITTER_SEED = 0x5eed
export const HILL_LAYER_DROP_Y = 9
export const HILL_LAYER_SHRINK = 0.045
/** Alpha per layer on the scene ink: one path per bucket, 8 fills a frame. */
export const HILL_ALPHA = [1.0, 0.80, 0.62, 0.46, 0.34, 0.26, 0.20, 0.15] as const
/** Layers 0 to 3 draw 2 px squares, deeper ones 1.5 px. */
export const HILL_PX_NEAR = 2
export const HILL_PX_FAR = 1.5
/** Under prefers-contrast: more the alpha floor is 0.5 and points are 2.5 px (9.5). */
export const HILL_ALPHA_FLOOR_MORE = 0.5
export const HILL_PX_MORE = 2.5
/** Layer 0 may show a frame at most this far from its target; deeper layers with no real frame near their time are not drawn at all. */
export const HILL_HISTORY_TOLERANCE_MS = 75

export const QUALITY = {
  high: { cols: 96, layers: 8, points: 96 * 8 * 4, fpsCap: 30, dpr: 2 },
  low: { cols: 64, layers: 5, points: 64 * 5 * 4, fpsCap: 20, dpr: 1 },
} as const
export type Quality = keyof typeof QUALITY

/** T0 envelope: x is time, 2.4 s across half the hill (centre = now), one layer, 4 stipples = 384 points. */
export const T0_WINDOW_MS = 2400
export const T0_COLS = 96

// --- the placeholder (9.7) ---
export const PH_BASE = 0.10
export const PH_BUMP = 0.08
export const PH_SQUARE_PX = 3
export const PH_BREATH_AMP = 0.25
export const PH_BREATH_PERIOD_MS = 2500
export const PH_BREATH_CYCLES = 2
export const PH_BREATH_MS = PH_BREATH_PERIOD_MS * PH_BREATH_CYCLES
export const PH_RING_BREATH_PX = 2

// --- the level bar and the dB readout (9.4, 9.5, 9.10, 9.12) ---
export const PEAK_HOLD_MS = 800
/** The peak tick falls at this rate after the hold (assumption). */
export const PEAK_FALL_DB_PER_S = 40
export const READOUT_MS = 250
export const METER_TEXT_MS = 1000
export const METER_MIN_DB = -60
export const METER_MAX_DB = 0

// --- the loop (9.11) ---
/** The tick stops this long after the last value reaches the floor. */
export const SETTLE_MS = 300
/** The thinking marker orbits once per 2.4 s for at most 5 s, then sits at the top. */
export const THINK_ORBIT_MS = 2400
export const THINK_MARK_MS = 5000
export const THINK_MARK_BARS = 3

// --- the test pattern (9.6): 5 s, only when the owner presses the button ---
export const TEST_PATTERN_MS = 5000
