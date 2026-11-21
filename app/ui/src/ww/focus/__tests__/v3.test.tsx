// The layout pass of 21 Nov: under the v3 look the Focus views sit in the three trays of <Zones>, each tray named by its job, and the
// pieces inside still work (Start is pressable, the Drill still checks an answer). The look is read once per page load, so the test
// stands it in with a mock of shell/look.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../shell/look', () => ({ lookV3Enabled: () => true, glassEnabled: () => true, setLookV3: () => {}, setGlass: () => {}, LOOK_KEY: 'app.look', GLASS_KEY: 'app.glass' }))

import { Drill } from '../DrillScreen'
import { FocusRestPanel } from '../FocusRest'
import { FocusStartPanel } from '../FocusStart'
import { CrucibleIdlePanel, CruciblePanel } from '../CrucibleSession'
import { fixturePort } from '../fixtures'
import { buttons, cleanup, click, flush, render } from './dom'

const jobs = () => [...document.querySelectorAll('.s3-tray .s3-step')].map((e) => (e.textContent ?? '').replace(/Step \d: /, '').replace(/^\d\s*/, '').trim())
const noop = () => {}

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Focus under the v3 look', () => {
  it('Start has three trays (SET, LENGTH, RULES) and the one primary starts the block', () => {
    const start = vi.fn()
    render(
      <FocusStartPanel tracks={[{ id: 'a', label: 'Digital logic' }]} trackId="a" onTrack={noop} len={50} onLen={noop} cue="" onCue={noop}
        wager={false} onWager={noop} guards={false} onGuards={noop} onStart={start} eyesLine="eyes: waiting" />,
    )
    expect(jobs().join('|')).toMatch(/SET.*LENGTH.*RULES/)
    expect(document.querySelectorAll('[data-testid="length-numeral"]')).toHaveLength(1)
    click(buttons(document.body, /Start session/)[0])
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('the session has TIMER, BLOCK and PARKED, and the idle pose keeps its WAITING lamp', () => {
    render(<CruciblePanel plannedMin={50} elapsedMin={12} paused={false} trackLabel="Maths" guards={false} wager={false} parked={[]} onPause={noop} onResume={noop} onEnd={noop} onFile={noop} />)
    expect(jobs().join('|')).toMatch(/TIMER.*BLOCK.*PARKED/)
    expect(document.querySelector('[data-testid="readout"]')?.textContent).toMatch(/12 min/)
    cleanup()
    render(<CrucibleIdlePanel onStart={noop} />)
    expect(jobs().join('|')).toMatch(/TIMER.*BLOCK.*PARKED/)
    expect(document.body.textContent).toMatch(/No block started/)
  })

  it('Rest has REST, HELD and LOG, and says WAITING with no block', () => {
    render(<FocusRestPanel last={null} onStart={noop} onToday={noop} />)
    expect(jobs().join('|')).toMatch(/REST.*HELD.*LOG/)
    expect(document.body.textContent).toMatch(/No block has ended/)
  })

  it('the Drill has QUESTION, PROGRESS and SET and still takes an answer', async () => {
    const port = fixturePort()
    render(<Drill port={port} elapsedMin={3} onGo={noop} />)
    await flush()
    expect(jobs().join('|')).toMatch(/QUESTION.*PROGRESS.*SET/)
    expect(document.querySelector('.dr-kick')?.textContent).toMatch(/Question 1 of/)
    expect(document.querySelectorAll('.dd-btn').length).toBeGreaterThan(0)
  })
})
