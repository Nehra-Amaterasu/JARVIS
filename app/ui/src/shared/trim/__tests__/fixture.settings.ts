// Two fixture settings for the tests of A.L02 only. The product glob in registry.ts leaves __tests__ out, so these never
// reach a build; the tests feed them to collectSettings through a module map.
import type { SettingDef } from '../types'

export const fixtureState = { density: 50, chime: true }
export const resetFixtures = () => {
  fixtureState.density = 50
  fixtureState.chime = true
}

export const density: SettingDef = {
  id: 'core.density',
  label: 'Ring density',
  section: 'core',
  view: 'talk',
  read: () => fixtureState.density,
  reset: () => { fixtureState.density = 50 },
  format: (v) => `${String(v)} segments`,
  defaultText: '50 segments',
  isDefault: () => fixtureState.density === 50,
}

export const chime: SettingDef = {
  id: 'day.chime',
  label: 'Block chime',
  section: 'day',
  view: 'today',
  read: () => fixtureState.chime,
  reset: () => { fixtureState.chime = true },
  defaultText: 'on',
  isDefault: () => fixtureState.chime === true,
  risk: 'hardware',
}

export const settings = [density, chime]
