/**
 * The motion governor (plan 5.7.7): one switch, three levels, read from the glass probe.
 *   high  tier blur or refract and 5th-percentile fps >= 50: everything in 5.7.3
 *   low   tier flat, p5 < 50, hidden tab or battery saver: tilt, companion, pin scrub and
 *         stagger off, switch becomes the 160 ms fade (the CSS reads data-motion-load="low")
 *   none  data-motion="calm" or the OS asks for reduced motion (handled by the tokens)
 */
export type MotionLoad = 'high' | 'low'

export function motionLoad(input: { tier: 'refract' | 'blur' | 'flat'; p5?: number; hidden?: boolean; saver?: boolean }): MotionLoad {
  if (input.tier === 'flat' || input.hidden || input.saver) return 'low'
  if (input.p5 !== undefined && input.p5 < 50) return 'low'
  return 'high'
}

export function setMotionLoad(level: MotionLoad): void {
  document.documentElement.setAttribute('data-motion-load', level)
}
