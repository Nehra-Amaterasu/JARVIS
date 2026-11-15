// TrayArt (package C03): the empty ledger's picture, a sheet of paper that sinks into an inbox tray in plain ASCII, so an
// empty desk has something alive in it. Decoration only (aria-hidden; the words beside it say the state). It moves only when
// the desk is LIVE and empty: a WAITING desk shows the settled empty tray and nothing else, because a moving picture would
// suggest something is arriving. The loop is a 320 ms step that pauses while the tab is hidden; Calm, reduced motion and
// forced colours get the one still frame. No camera, no face: it is a sheet and a tray.
import { useEffect, useState } from 'react'
import { useCalm } from '../../../shared/art'

const SHEET = ['+-----+', '| === |', '| === |', '+-----+']
const TRAY = ['\\         /', ' \\_______/ ']
const WIDTH = 11
const ROWS = 6
/** Sheet row per frame; null is the empty tray, shown twice so the loop breathes. */
export const TRAY_FRAMES: (number | null)[] = [0, 1, 2, 3, null, null]
export const TRAY_STEP_MS = 320

/** One frame as text: the sheet drawn from row `at` and clipped where the tray begins, the tray over it. */
export function trayFrame(at: number | null): string {
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: WIDTH }, () => ' '))
  if (at !== null) {
    SHEET.forEach((line, i) => {
      const y = at + i
      if (y >= ROWS - TRAY.length) return
      for (let x = 0; x < line.length; x++) grid[y][2 + x] = line[x]
    })
  }
  TRAY.forEach((line, i) => { for (let x = 0; x < WIDTH; x++) grid[ROWS - TRAY.length + i][x] = line[x] ?? ' ' })
  return grid.map((r) => r.join('').trimEnd()).join('\n')
}

export function TrayArt({ moving }: { moving: boolean }) {
  const calm = useCalm()
  const [step, setStep] = useState(0)
  const run = moving && !calm
  useEffect(() => {
    if (!run) { setStep(0); return }
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => { if (id === null) id = setInterval(() => setStep((s) => (s + 1) % TRAY_FRAMES.length), TRAY_STEP_MS) }
    const stop = () => { if (id !== null) clearInterval(id); id = null }
    const onVis = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [run])
  const frame = run ? TRAY_FRAMES[step] : null
  return <pre className="ik-tray" data-component="tray-art" data-form={run ? 'moving' : 'still'} aria-hidden="true">{trayFrame(frame)}</pre>
}
