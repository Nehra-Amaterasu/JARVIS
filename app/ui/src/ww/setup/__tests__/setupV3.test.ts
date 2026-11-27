// R18: the v3 shell knows the pane ids without importing the panes (ShellV3.tsx INDEX_IDS, for a `#setup/<pane>` hash). Two lists
// that must stay equal are one test: a pane added to Setup and missed there would open Setup but not that pane.
import { describe, expect, it } from 'vitest'
import { INDEX_IDS } from '../../../shell/v3/ShellV3'
import { INDEX, anchorOf } from '../SetupPage'

describe('Setup under v3', () => {
  it('the hash knows every pane of the index, and only those', () => {
    expect([...INDEX_IDS].sort()).toEqual(INDEX.map(([a]) => a).sort())
    expect(INDEX).toHaveLength(18)
  })

  it('a saved section maps back to the pane that shows it', () => {
    expect(anchorOf('exams')).toBe('dates')
    expect(anchorOf('profile')).toBe('about')
    expect(anchorOf('attendance_rule')).toBe('attendance')
    expect(anchorOf('study')).toBe('study')
  })
})
