// Seam S5: four ports, each with a null adapter that says plainly why it did nothing, and never reports LIVE.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NULL_PORTS, PORT_NAMES, getPort, installPort, resetPortsForTests, subscribePorts, type VoicePort,
} from '../../shell/ports'
import { pillState, readRecord, writeRecord, clearRecord, STALE_MS } from '../../shell/record'

afterEach(() => resetPortsForTests())

describe('the four ports and their null adapters', () => {
  it('there are exactly four ports: voice, memory, notify, ambient', () => {
    expect([...PORT_NAMES]).toEqual(['voice', 'memory', 'notify', 'ambient'])
    expect(Object.keys(NULL_PORTS).sort()).toEqual([...PORT_NAMES].sort())
  })

  it('every null adapter is marked absent and carries words for the empty state', () => {
    for (const n of PORT_NAMES) {
      expect(getPort(n).present).toBe(false)
      expect(getPort(n).absentText.length).toBeGreaterThan(3)
    }
    expect(getPort('voice').absentText).toBe('text only')
    expect(getPort('ambient').absentText).toBe('no sensing here')
  })

  it('null voice has no level and its ask resolves with a reason, never throws', async () => {
    expect(getPort('voice').level()).toBeNull()
    await expect(getPort('voice').ask('hello')).resolves.toEqual({ ok: false, reason: expect.stringMatching(/text only/) })
  })

  it('null memory search resolves with a reason', async () => {
    await expect(getPort('memory').search('x')).resolves.toMatchObject({ ok: false })
  })

  it('null notify is a silent no-op', () => {
    expect(() => getPort('notify').notify('x', 'fault')).not.toThrow()
  })

  it('null ambient presence is WAITING "no sensing here", never LIVE', () => {
    const r = getPort('ambient').presence()
    expect(r.state).toBe('waiting')
    expect(r.reason).toBe('no sensing here')
  })

  it('installing an adapter notifies subscribers; the undo puts the null adapter back', () => {
    const fn = vi.fn()
    const off = subscribePorts(fn)
    const real: VoicePort = { present: true, absentText: 'text only', level: () => 0.2, ask: async () => ({ ok: true }) }
    const undo = installPort('voice', real)
    expect(getPort('voice')).toBe(real)
    undo()
    expect(getPort('voice')).toBe(NULL_PORTS.voice)
    expect(fn).toHaveBeenCalledTimes(2)
    off()
  })

  it('installing null restores the null adapter', () => {
    installPort('memory', { present: true, absentText: 'x', search: async () => ({ ok: true }) })
    installPort('memory', null)
    expect(getPort('memory')).toBe(NULL_PORTS.memory)
  })
})

describe('the Resume record', () => {
  afterEach(() => {
    clearRecord('jarvis')
    clearRecord('ww')
  })

  it('first run reads the one start line per product', () => {
    expect(pillState('ww', null, 0)).toEqual({ kind: 'start', text: 'Start: plan the day' })
    expect(pillState('jarvis', null, 0)).toEqual({ kind: 'start', text: 'Start: wake JARVIS' })
  })

  it('a record round-trips through localStorage and a bad one is ignored', () => {
    writeRecord({ product: 'ww', section: 'study', view: 'practice', object: 'Paper 2', openedAt: 1, lastConfirmedAt: 2 })
    expect(readRecord('ww')).toMatchObject({ section: 'study', view: 'practice', object: 'Paper 2' })
    localStorage.setItem('shell.resume.jarvis', JSON.stringify({ section: 'study', view: 'practice', openedAt: 1, lastConfirmedAt: 1 }))
    expect(readRecord('jarvis')).toBeNull()
    localStorage.setItem('shell.resume.jarvis', '{not json')
    expect(readRecord('jarvis')).toBeNull()
  })

  it('a fresh record names the place; a stale one says "last seen" and shows no running time', () => {
    const r = { product: 'ww' as const, section: 'study', view: 'practice', object: 'Paper 2', openedAt: 0, lastConfirmedAt: 0 }
    expect(pillState('ww', r, 60_000)).toEqual({ kind: 'open', text: 'Study / Practice: Paper 2' })
    const stale = pillState('ww', r, STALE_MS + 60 * 60_000 * 20)
    expect(stale.kind).toBe('stale')
    expect(stale.text).toMatch(/^Paper 2, last seen /)
    expect(stale.text).not.toMatch(/min in/)
  })
})

describe('the app.shell flag', () => {
  it('is off by default, on with storage v2 or the fragment shell=v2, and the fragment is remembered', async () => {
    const { shellV2Enabled, resetShellFlagForTests, SHELL_FLAG_KEY } = await import('../../shell/flag')
    localStorage.removeItem(SHELL_FLAG_KEY)
    history.replaceState(null, '', '/')
    resetShellFlagForTests()
    expect(shellV2Enabled()).toBe(false)
    localStorage.setItem(SHELL_FLAG_KEY, 'v2')
    resetShellFlagForTests()
    expect(shellV2Enabled()).toBe(true)
    localStorage.removeItem(SHELL_FLAG_KEY)
    history.replaceState(null, '', '/#t=abc&shell=v2')
    resetShellFlagForTests()
    // the fragment may be wiped right after load (lib/api.ts does); the value read at load still decides
    history.replaceState(null, '', '/')
    expect(shellV2Enabled()).toBe(true)
    expect(localStorage.getItem(SHELL_FLAG_KEY)).toBe('v2')
    history.replaceState(null, '', '/#shell=off')
    resetShellFlagForTests()
    expect(shellV2Enabled()).toBe(false)
    expect(localStorage.getItem(SHELL_FLAG_KEY)).toBe('off')
    localStorage.removeItem(SHELL_FLAG_KEY)
    history.replaceState(null, '', '/')
  })
})
