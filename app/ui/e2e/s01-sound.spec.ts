// A.S01 in a real Chromium: Core, Sound under shell v2.
//
// The built app (dist-e2e) against the sandbox, flag on through the `#t=ww-e2e&shell=v2` fragment as e2e/core-v2.spec.ts does.
// The media, library and pronunciation routes are stubbed in the page (route.fulfill with the invented fixtures of
// jarvis/sound/fixtures.ts), because the sandbox has no player and no library; the stub also records every POST, so "nothing
// is sent without the press" is a count, not a claim. Needs `npx vite build --outDir dist-e2e` first; skips otherwise.
//
// Proved here: Space on the plate plays or pauses (one POST), Left and Right step, the library and the words each open in
// the drawer from the one tools key and Esc closes it with the focus back on that key, the words form adds and removes, a route that does not answer
// is WAITING with its reason and the keys send nothing, Spotify stays a PLANNED plate, and the geometry at 1366 x 768 (no
// document scroll, no inner scroll) and 390 x 844 (no sideways scroll), 44 px targets, 11 px text.
// Screenshots go to S01_SHOTS (a folder outside the repository) when it is set.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { fixtureAnswer, fixtureLibrary, fixtureMedia, fixtureWords, type SoundKind } from '../src/jarvis/sound/fixtures'

const SHOTS = process.env.S01_SHOTS ? resolve(process.env.S01_SHOTS) : ''
const DESKTOP = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844 }

interface Stub { sent: { path: string; method: string; body: unknown }[]; words: Record<string, string>; source: string }

async function stub(page: Page, kind: SoundKind | 'down' = 'rest', libraryKind: 'notes' | 'empty' | 'running' | 'down' = 'notes'): Promise<Stub> {
  const st: Stub = { sent: [], words: fixtureWords(), source: 'auto' }
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname
    const m = req.method()
    const body = m === 'GET' ? null : (req.postDataJSON?.() ?? null)
    if (p === '/api/media/state') return kind === 'down' ? route.fulfill({ status: 503, json: { detail: 'the player is not answering' } }) : route.fulfill({ json: { ...fixtureMedia(kind), settings: { default_source: st.source } } })
    if (p.startsWith('/api/media/') && m !== 'GET') {
      st.sent.push({ path: p, method: m, body })
      if (p === '/api/media/settings' && body && typeof body === 'object' && 'default_source' in body) st.source = String((body as { default_source: string }).default_source)
      return route.fulfill({ json: { ok: true, say: 'Sent.', confirmed: false, action: p.split('/').pop(), at: Date.now() / 1000 } })
    }
    if (p === '/api/library' && m === 'GET') return libraryKind === 'down' ? route.fulfill({ status: 503, json: { detail: 'the library is not answering' } }) : route.fulfill({ json: fixtureLibrary(libraryKind) })
    if (p === '/api/library/ask') { st.sent.push({ path: p, method: m, body }); return route.fulfill({ json: fixtureAnswer() }) }
    if (p.startsWith('/api/library/') && m !== 'GET') { st.sent.push({ path: p, method: m, body }); return route.fulfill({ json: { ok: true } }) }
    if (p === '/api/settings/pronunciations' && m === 'GET') return route.fulfill({ json: { table: st.words } })
    if (p === '/api/settings/pronunciations' && m === 'POST') {
      st.sent.push({ path: p, method: m, body })
      const b = body as { word: string; say: string }
      st.words = { ...st.words, [b.word]: b.say }
      return route.fulfill({ json: { table: st.words } })
    }
    if (p.startsWith('/api/settings/pronunciations/') && m === 'DELETE') {
      st.sent.push({ path: p, method: m, body })
      const w = decodeURIComponent(p.split('/').pop()!)
      const { [w]: _gone, ...rest } = st.words
      st.words = rest
      return route.fulfill({ json: { table: st.words } })
    }
    return route.fallback()
  })
  return st
}

async function openSound(page: Page, baseURL: string | undefined) {
  const res = await fetch(baseURL!).catch(() => null)
  test.skip(!res || !res.ok, 'dist-e2e is not built, so the preview server is not running; run `npx vite build --outDir dist-e2e` first')
  await page.goto('/#t=ww-e2e&shell=v2')
  const shell = page.locator('[data-shell="v2"]')
  await expect(shell).toBeVisible({ timeout: 15_000 })
  if ((await shell.getAttribute('data-product')) !== 'jarvis') await page.keyboard.press('Alt+0')
  await page.keyboard.press('Control+1')
  await page.keyboard.press(']')
  await expect(page.locator('.s2-page[data-view="sound"] .sd')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
}

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) })
}

const sent = (st: Stub, path: string) => st.sent.filter((s) => s.path === path)

/** Geometry: nothing of the view clipped, no document scroll, targets and text sizes. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const sd = document.querySelector<HTMLElement>('.sd')!
    const box = sd.getBoundingClientRect()
    const small: string[] = []
    for (const el of sd.querySelectorAll<HTMLElement>('button, input, [role="radio"], [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
      if (r.height < 43.5 || r.width < 43.5) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    const tiny: string[] = []
    for (const el of sd.querySelectorAll<HTMLElement>('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim()).map((n) => n.textContent!.trim()).join(' ')
      if (!own) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (parseFloat(cs.fontSize) < 10.9) tiny.push(`${own.slice(0, 24)} ${cs.fontSize}`)
    }
    const over: string[] = []
    for (const el of sd.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || el.closest('dialog')) continue
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) over.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} l${Math.round(r.left)} r${Math.round(r.right)}`)
    }
    // a plate or card must hold everything it draws (a collapsed row on the phone once cut the transport off)
    const clipped: string[] = []
    for (const host of sd.querySelectorAll<HTMLElement>('.sd-now, .sd-recent')) {
      const hb = host.getBoundingClientRect()
      for (const el of host.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.bottom > hb.bottom + 1 || r.top < hb.top - 1) clipped.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} in ${host.className.split(' ')[0]}`)
      }
    }
    return {
      small, tiny, over, clipped,
      doc: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
      sd: { sh: sd.scrollHeight, ch: sd.clientHeight, sw: sd.scrollWidth, cw: sd.clientWidth },
    }
  })
}

test.describe('Core, Sound under shell v2', () => {
  test('desktop: one canvas, no scroll, 44 px targets, 11 px text, Spotify PLANNED', async ({ page, baseURL }) => {
    await stub(page, 'playing')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    const g = await geometry(page)
    expect(g.doc.sh, 'document does not scroll').toBeLessThanOrEqual(g.doc.ih + 1)
    expect(g.doc.sw).toBeLessThanOrEqual(g.doc.iw + 1)
    expect(g.sd.sh, 'the view does not scroll inside itself').toBeLessThanOrEqual(g.sd.ch + 1)
    expect(g.sd.sw).toBeLessThanOrEqual(g.sd.cw + 1)
    expect(g.small, g.small.join('\n')).toEqual([])
    expect(g.tiny, g.tiny.join('\n')).toEqual([])
    expect(g.over, g.over.join('\n')).toEqual([])
    await expect(page.getByRole('radio', { name: /Spotify/ })).toContainText('PLANNED')
    await expect(page.locator('[data-card="recent"]')).toContainText('No plays from this window yet')
    await expect(page.locator('[data-card="recent"] li')).toHaveCount(0)
    // one status row for the player; the volume keeps its own WAITING lamp inside the dial
    await expect(page.locator('[data-status]')).toContainText('PLAYING')
    await expect(page.locator('[data-vol] .lamp')).toHaveAttribute('data-lamp', 'waiting')
    // every right edge of the words column ends on that column (jury round 2 found three edges)
    const edges = await page.evaluate(() => {
      const right = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().right)
      return { col: right('.sd-right'), receipt: right('.sd-receipt'), song: right('.sd-song .sd-row'), chips: right('.sd-chips'), last: right('.sd-chips > :last-child') }
    })
    expect(Math.abs(edges.receipt - edges.col), JSON.stringify(edges)).toBeLessThanOrEqual(1)
    expect(Math.abs(edges.song - edges.col), JSON.stringify(edges)).toBeLessThanOrEqual(1)
    expect(Math.abs(edges.last - edges.col), JSON.stringify(edges)).toBeLessThanOrEqual(1)
    await expect(page.locator('.sd-title')).toHaveText('Slow Lanterns')
    await expect(page.locator('.sd-word')).toHaveText('PLAYING')
    expect(g.clipped, g.clipped.join(', ')).toEqual([])
    await shot(page, 'sound-playing-1366')
  })

  test('Space on the plate plays or pauses, the arrows step, nothing is sent before a press', async ({ page, baseURL }) => {
    const st = await stub(page, 'playing')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    expect(sent(st, '/api/media/control')).toHaveLength(0)
    await page.locator('.sd-now').focus()
    await page.keyboard.press('Space')
    await expect.poll(() => sent(st, '/api/media/control').length).toBe(1)
    expect(sent(st, '/api/media/control')[0].body).toEqual({ action: 'toggle' })
    await expect(page.locator('.sd-play')).not.toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => sent(st, '/api/media/control').length).toBe(2)
    expect(sent(st, '/api/media/control')[1].body).toEqual({ action: 'next' })
    await expect(page.locator('.sd-play')).not.toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => sent(st, '/api/media/control').length).toBe(3)
    expect(sent(st, '/api/media/control')[2].body).toEqual({ action: 'prev' })
    // the server's own sentence, word for word, is the receipt
    await expect(page.locator('.sd-receipt-text')).toHaveText('Sent.')
  })

  test('the play form sends the query with the chosen source; the radio group moves with the arrows', async ({ page, baseURL }) => {
    const st = await stub(page, 'rest')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    await page.locator('.sd-chip[aria-checked="true"]').focus()
    await expect(page.locator('.sd-play')).not.toHaveAttribute('aria-busy', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.sd-chip[aria-checked="true"]')).toHaveText('Folder')
    await expect.poll(() => sent(st, '/api/media/settings').length).toBe(1)
    expect(sent(st, '/api/media/settings')[0].body).toEqual({ default_source: 'local' })
    await page.getByLabel('Play a song').fill('slow lanterns')
    await page.keyboard.press('Enter')
    await expect.poll(() => sent(st, '/api/media/play').length).toBe(1)
    expect(sent(st, '/api/media/play')[0].body).toEqual({ query: 'slow lanterns', source: 'local' })
  })

  test('the library opens in the drawer, asks with a cited passage, and Esc closes it with the focus back', async ({ page, baseURL }) => {
    const st = await stub(page, 'rest')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    const key = page.locator('[data-open="tools"]')
    await key.focus()
    await page.keyboard.press('Enter')
    const dlg = page.locator('dialog.sd-drawer')
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-open="library"]').click()
    await expect(dlg).toContainText('fixture-sequential-logic.pdf')
    await page.getByLabel('Ask your notes').fill('Explain setup and hold time')
    await page.keyboard.press('Enter')
    await expect(dlg.locator('.sd-answer')).toContainText('Setup time')
    await expect(dlg.locator('.sd-passage')).toContainText('fixture-sequential-logic.pdf')
    expect(sent(st, '/api/library/ask')).toHaveLength(1)
    await shot(page, 'sound-library-drawer-1366')
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    await expect(key).toBeFocused()
  })

  test('the spoken words add and remove through the drawer', async ({ page, baseURL }) => {
    const st = await stub(page, 'rest')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    await page.locator('[data-open="tools"]').click()
    const dlg = page.locator('dialog.sd-drawer')
    await expect(dlg).toBeVisible()
    await dlg.locator('[data-open="words"]').click()
    await dlg.getByLabel('Word', { exact: true }).fill('veena')
    await dlg.getByLabel('Say it as').fill('vee-nah')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => sent(st, '/api/settings/pronunciations').length).toBe(1)
    expect(sent(st, '/api/settings/pronunciations')[0].body).toEqual({ word: 'veena', say: 'vee-nah' })
    await expect(dlg.locator('.sd-word-row', { hasText: 'veena' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Remove veena' }).click()
    await expect(dlg.locator('.sd-word-row', { hasText: 'veena' })).toHaveCount(0)
    await shot(page, 'sound-words-drawer-1366')
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
  })

  test('a route that does not answer is WAITING with its reason, and the keys send nothing', async ({ page, baseURL }) => {
    const st = await stub(page, 'down', 'down')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    await expect(page.locator('.sd-word')).toHaveText('NO REPORT')
    await expect(page.locator('.sd-now .lamp[data-lamp="waiting"]').first()).toBeVisible()
    await expect(page.locator('.sd-sub')).toContainText('did not answer')
    await page.locator('[data-sound-toggle]').click({ force: true })
    await page.locator('.sd-now').focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    expect(sent(st, '/api/media/control')).toHaveLength(0)
    const g = await geometry(page)
    expect(g.sd.sh).toBeLessThanOrEqual(g.sd.ch + 1)
    await shot(page, 'sound-waiting-1366')
    // no number is drawn for a library that did not answer (it lives behind the tools key since jury round 2)
    await page.locator('[data-open="tools"]').click()
    await expect(page.locator('[data-card="library"] .sd-note')).not.toContainText('documents')
    await expect(page.locator('[data-card="library"]')).toContainText('did not answer')
  })

  test('a route that fails after it answered is WAITING, never the old "playing"', async ({ page, baseURL }) => {
    const st = await stub(page, 'playing')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    await expect(page.locator('.sd-word')).toHaveText('PLAYING')
    await page.route('**/api/media/state', (route) => route.fulfill({ status: 503, json: { detail: 'the player is not answering' } }))
    // the poll is 5 s; the toggle press forces an immediate read after it, but nothing may be sent once the route is down
    await expect(page.locator('.sd-word')).toHaveText('NO REPORT', { timeout: 15_000 })
    await expect(page.locator('.sd-now .lamp[data-lamp="waiting"]').first()).toBeVisible()
    await expect(page.locator('.sd-sub')).toContainText('did not answer')
    await page.locator('.sd-now').focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    expect(sent(st, '/api/media/control')).toHaveLength(0)
  })

  test('nothing playing is a designed rest state', async ({ page, baseURL }) => {
    await stub(page, 'folder')
    await page.setViewportSize(DESKTOP)
    await openSound(page, baseURL)
    await expect(page.locator('.sd-word')).toHaveText('IDLE')
    await expect(page.locator('.sd-title')).toHaveText('Nothing playing')
    await expect(page.locator('.sd-ring')).toHaveAttribute('data-lit', '0')
    await shot(page, 'sound-rest-1366')
  })

  test('phone: one column, no sideways scroll, 44 px targets', async ({ page, baseURL }) => {
    await stub(page, 'playing')
    await page.setViewportSize(PHONE)
    await openSound(page, baseURL)
    const g = await geometry(page)
    expect(g.doc.sw, 'no sideways scroll').toBeLessThanOrEqual(g.doc.iw + 1)
    expect(g.sd.sw).toBeLessThanOrEqual(g.sd.cw + 1)
    expect(g.small, g.small.join('\n')).toEqual([])
    expect(g.tiny, g.tiny.join('\n')).toEqual([])
    expect(g.over, g.over.join('\n')).toEqual([])
    expect(g.clipped, g.clipped.join(', ')).toEqual([])
    await shot(page, 'sound-playing-390')
  })
})
