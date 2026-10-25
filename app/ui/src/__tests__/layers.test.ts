import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LAYERS } from '../twin/layers'

// Aankhen is Wi-Fi only: no radar, no camera. The layer bar must not offer either.
describe('Aankhen layer chips', () => {
  it('has no Radar chip and no radar wedge layer', () => {
    expect(LAYERS.map((l) => l.label.toLowerCase())).not.toContain('radar')
    expect(LAYERS.map((l) => l.id)).not.toContain('fov')
    expect(LAYERS.some((l) => /radar|camera/i.test(l.label))).toBe(false)
  })

  it('starts with the radar wedge hidden, everything with a chip shown', () => {
    expect(DEFAULT_LAYERS.fov).toBe(false)
    for (const l of LAYERS) expect(DEFAULT_LAYERS[l.id]).toBe(true)
  })

  it('still offers the Wi-Fi zone', () => {
    expect(LAYERS.find((l) => l.id === 'fresnel')?.label).toBe('Wi-Fi zone')
  })
})
