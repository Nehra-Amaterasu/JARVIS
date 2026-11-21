// shell/look.ts: the switch of the v3 look. Read once per load, the fragment wins and is stored, `look=off` turns it back,
// glass is on unless the fragment, the stored choice or the host says off.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GLASS_KEY, LOOK_KEY, glassEnabled, lookV3Enabled, resetLookForTests, setGlass } from '../../../shell/look'

const load = (hash: string) => {
  history.replaceState(null, '', `/${hash}`)
  resetLookForTests()
}

beforeEach(() => {
  localStorage.clear()
  delete window.jarvisHost
  load('')
})
afterEach(() => {
  history.replaceState(null, '', '/')
})

describe('lookV3Enabled', () => {
  it('is off by default, so the current look renders unchanged', () => {
    expect(lookV3Enabled()).toBe(false)
  })
  it('turns on from the stored key app.look = v3', () => {
    localStorage.setItem(LOOK_KEY, 'v3')
    resetLookForTests()
    expect(lookV3Enabled()).toBe(true)
  })
  it('turns on from the fragment look=v3 and stores it, beside the sandbox token', () => {
    load('#t=ww-e2e&shell=v2&look=v3')
    expect(lookV3Enabled()).toBe(true)
    expect(localStorage.getItem(LOOK_KEY)).toBe('v3')
  })
  it('look=off turns a stored v3 back off and stores that', () => {
    localStorage.setItem(LOOK_KEY, 'v3')
    load('#look=off')
    expect(lookV3Enabled()).toBe(false)
    expect(localStorage.getItem(LOOK_KEY)).toBe('off')
  })
  it('is read ONCE per load: a flip mid-session changes nothing until the next load', () => {
    load('#look=v3')
    expect(lookV3Enabled()).toBe(true)
    localStorage.setItem(LOOK_KEY, 'off')
    expect(lookV3Enabled()).toBe(true)
    load('') // the next page load: no fragment, the stored choice decides
    expect(lookV3Enabled()).toBe(false)
  })
  it('captures the fragment when the module is evaluated, not when it is first asked (the rule of flag.ts)', () => {
    load('#look=v3')
    history.replaceState(null, '', '/') // lib/api.ts wipes the fragment after the token is read
    expect(lookV3Enabled()).toBe(true)
  })
  it('an unknown value is off', () => {
    load('#look=banana')
    expect(lookV3Enabled()).toBe(false)
  })
})

describe('glassEnabled', () => {
  it('is on by default', () => {
    expect(glassEnabled()).toBe(true)
  })
  it('the stored choice off wins over the default', () => {
    localStorage.setItem(GLASS_KEY, 'off')
    resetLookForTests()
    expect(glassEnabled()).toBe(false)
  })
  it('the fragment glass=off is stored and wins over a stored on', () => {
    localStorage.setItem(GLASS_KEY, 'on')
    load('#glass=off')
    expect(glassEnabled()).toBe(false)
    expect(localStorage.getItem(GLASS_KEY)).toBe('off')
  })
  it('a host that cannot make the window transparent turns it off when nothing else says', () => {
    window.jarvisHost = { glass: false }
    resetLookForTests()
    expect(glassEnabled()).toBe(false)
  })
  it('setGlass stores the choice and tells the host', () => {
    let told: boolean | null = null
    window.jarvisHost = { setGlass: (on) => { told = on } }
    setGlass(false)
    expect(localStorage.getItem(GLASS_KEY)).toBe('off')
    expect(told).toBe(false)
    expect(glassEnabled()).toBe(false)
  })
})
