/** USB boards card: verdicts become honest words and colours; Scan asks the server again. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boardsHeadline, hotplugLine, portIds, verdictLabel, verdictTone, type BoardsView, type PortView } from '../lib/boards'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const port = (o: Partial<PortView>): PortView => ({
  device: 'COM5', verdict: 'foreign', detail: 'sent 312 bytes in 2.0 s, none of them an Aankhen frame',
  vid: '1A86', pid: '7523', chip: 'WCH CH340 / CH343 USB-UART bridge', description: 'USB-SERIAL CH340',
  bytes: 312, frame: null, fw: null, listened_s: 2, at: 0, in_use: false, ...o,
})

const view = (o: Partial<BoardsView> = {}): BoardsView => ({
  ports: [port({}), port({ device: 'COM7', verdict: 'aankhen', in_use: true, detail: 'in use by Aankhen · handshake 3 s ago', fw: 'aankhen-3.1.0' })],
  board: { source: 'hardware', port: 'COM7', handshake: true, handshake_at: 1, fw: 'aankhen-3.1.0' },
  hub: { running: true, mode: 'hardware', kind: 'hardware', scenario: null, requested_mode: 'auto', port: 'COM7' },
  hotplug: { enabled: true, watching: true, interval_s: 2, requested_mode: 'auto', announced: [], last: null },
  ...o,
})

describe('verdicts', () => {
  it('only a port that identified itself is cyan; a CH340 that printed text is not Aankhen', () => {
    expect(verdictTone({ verdict: 'aankhen' })).toBe('live')
    expect(verdictTone({ verdict: 'claimed' })).toBe('sim')          // opened, not yet confirmed
    expect(verdictTone({ verdict: 'error' })).toBe('fault')
    for (const v of ['foreign', 'silent', 'busy'] as const) expect(verdictTone({ verdict: v })).toBe('')
    expect(verdictLabel({ verdict: 'foreign', in_use: false })).toBe('not Aankhen')
    expect(verdictLabel({ verdict: 'aankhen', in_use: true })).toBe('Aankhen · live')
    expect(verdictLabel({ verdict: 'aankhen', in_use: false })).toBe('Aankhen board')
    expect(portIds({ vid: '1A86', pid: '7523' })).toBe('1A86:7523')
    expect(portIds({ vid: null, pid: null })).toBe('no USB id')
  })

  it('the headline says whether there is a board and whether it is in use', () => {
    expect(boardsHeadline(view())).toBe('ESP32 live on COM7')
    expect(boardsHeadline(view({ ports: [port({ device: 'COM9', verdict: 'aankhen' })] }))).toBe('ESP32 answered on COM9')
    expect(boardsHeadline(view({ ports: [port({ verdict: 'claimed', in_use: true })] }))).toBe('Waiting for COM5 to identify itself')
    expect(boardsHeadline(view({ ports: [port({})] }))).toBe('No Aankhen board')
    expect(boardsHeadline(view({ ports: [] }))).toBe('No USB serial devices')
  })

  it('the hot-plug line follows what was asked for, not just the mode', () => {
    const sim = { running: true, mode: 'simulation', kind: 'simulation', scenario: 'still', port: null }
    expect(hotplugLine(view({ hub: { ...sim, requested_mode: 'auto' } }))).toMatch(/takes over from the simulation/)
    expect(hotplugLine(view({ hub: { ...sim, requested_mode: 'simulation' } }))).toMatch(/announced; your simulation stays/)
    expect(hotplugLine(view())).toBe('On the board')
    expect(hotplugLine(view({ board: { handshake: false } }))).toMatch(/waiting for it to talk/)
    expect(hotplugLine(view({ hub: { ...sim, running: false, requested_mode: 'auto' } }))).toMatch(/stopped/)
    const off = view()
    off.hotplug = { ...off.hotplug, enabled: false }
    expect(hotplugLine(off)).toBe('Hot-plug is off')
  })
})

describe('<BoardPorts>', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists every port with its verdict, and Scan posts to the server', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      return new Response(JSON.stringify(view()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const { BoardPorts } = await import('../components/BoardPorts')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(BoardPorts, { pollMs: 0 })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    const text = host.textContent ?? ''
    expect(text).toContain('ESP32 live on COM7')
    expect(text).toContain('not Aankhen')
    expect(text).toContain('1A86:7523')
    expect(text).toContain('On the board')
    expect(host.querySelector('.boards-row .pill.live')?.textContent).toBe('Aankhen · live')
    expect(host.querySelectorAll('.boards-row.rise').length).toBe(2)            // rows arrive with motion
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Scan'))!
    await act(async () => { btn.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(calls).toContain('POST /api/boards/scan')
    expect(calls.filter((c) => c === 'GET /api/boards').length).toBeGreaterThanOrEqual(2)  // reloaded after
    await act(async () => { root.unmount() })
  })
})
