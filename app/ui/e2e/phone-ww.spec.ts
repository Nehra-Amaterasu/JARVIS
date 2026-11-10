// The phone Study page (chunk 1b, plan 9.0 + 4.14): 390 x 844, 44 px targets, no sideways scroll, the
// kit's focus ring, reduced motion.
//
// No phone listener is needed. The three files are read from disk and served through page.route on a host that
// cannot resolve, and /api/phone/ww/* is answered with the shapes routes_phone_ww.today_view returns. Names,
// papers and counts below are invented for the test.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const PAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../jarvis_app/phone_page')
const ORIGIN = 'http://phone-ww.test'

const topic = (key: string, unit: number, name: string, state: 'none' | 'learned' | 'solid') => ({ key, unit, unit_title: `Unit ${unit}`, topic: name, weight: 1, state })

const PAYLOAD = {
  date: '2026-11-12',
  say: 'Two papers ahead; control first.',
  blocks: [{ label: 'Morning', minutes: 120, blocks: [{ paper: 'p1', title: 'Control systems', minutes: 90, focus: [{ title: 'Root locus' }, { title: 'Bode plots' }] }] }],
  papers: [
    { id: 'p1', subject: 'control', title: 'Control', code: 'EE301', date: '2026-11-20', start: '10:00', days_left: 8, coverage: 0.4, kind: 'end', approx: false },
    { id: 'p2', subject: 'maths', title: 'Maths 3', code: 'MA301', date: '2026-11-24', start: null, days_left: 0, coverage: 0.1, kind: 'end', approx: true },
  ],
  paper: {
    id: 'p1', subject: 'control', title: 'Control', code: 'EE301', date: '2026-11-20', start: '10:00', days_left: 8, coverage: 0.4, kind: 'end', approx: false,
    counts: { none: 2, learned: 1, solid: 1 },
    topics: [topic('a', 1, 'Transfer functions', 'solid'), topic('b', 1, 'Block diagram reduction', 'learned'), topic('c', 2, 'Root locus and a long topic name that has to wrap', 'none'), topic('d', 3, 'Bode', 'none')],
  },
  classes: [
    { id: 's1', start: '08:45', name: 'Control systems', kind: 'theory', status: null },
    { id: 's2', start: '10:45', name: 'Maths 3', kind: 'theory', status: 'present' },
    { id: 's3', start: '14:00', name: 'Machines laboratory', kind: 'lab', status: 'absent' },
  ],
  attendance: [
    { subject: 'control', name: 'Control systems', held: 4, attended: 3, pct: 0.75, can_miss: 0, need: 0 },
    { subject: 'maths', name: 'Maths 3', held: 5, attended: 3, pct: 0.6, can_miss: 0, need: 2 },
  ],
  rule: { threshold: 0.75, confirmed: true },
  counters: [{ id: 'water', name: 'Glasses of water', today: 3 }, { id: 'gym', name: 'Gym', today: 0 }],
}

async function openPhone(page: Page, payload: unknown = PAYLOAD) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p === '/phone/ww') return route.fulfill({ contentType: 'text/html', body: readFileSync(resolve(PAGE_DIR, 'ww.html'), 'utf8') })
    if (p === '/phone/ww.css') return route.fulfill({ contentType: 'text/css', body: readFileSync(resolve(PAGE_DIR, 'ww.css'), 'utf8') })
    if (p === '/phone/ww.js') return route.fulfill({ contentType: 'text/javascript', body: readFileSync(resolve(PAGE_DIR, 'ww.js'), 'utf8') })
    if (p.startsWith('/api/phone/ww/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
    return route.fulfill({ status: 204, body: '' }) // manifest and icons
  })
  await page.goto(`${ORIGIN}/phone/ww`)
  await page.waitForSelector('#main:not([hidden]) #counters li b')
}

/** The effective box of a control: probe elementFromPoint on a 2 px grid over the element grown by 12 px. */
async function boxes(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const out: { label: string; x: number; y: number; w: number; h: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let x = Math.max(0, r.left - 12); x <= Math.min(innerWidth - 1, r.right + 12); x += 2) {
        for (let y = Math.max(0, r.top - 12); y <= Math.min(innerHeight - 1, r.bottom + 12); y += 2) {
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === el || el.contains(hit))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
        }
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.id ?? '').trim().slice(0, 28)
      out.push({ label: `${el.tagName.toLowerCase()} "${name}"`, x: minX + scrollX, y: minY + scrollY, w: maxX - minX + 2, h: maxY - minY + 2 })
    }
    return out
  }, selector)
}

// Chips scroll sideways inside their own strip; a control scrolled out of that strip is probed after scrollIntoView.
const TAPS = 'button, a[href], #counters b'

test.describe('phone Study page at 390 x 844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('every button, chip and counter has a hit area of at least 44 x 44', async ({ page }) => {
    await openPhone(page)
    const hits = await boxes(page, TAPS)
    // 3 minute buttons + 2 paper chips + 4 topics + 9 class taps + 4 counter buttons + 2 counter values + back link
    expect(hits.length).toBeGreaterThanOrEqual(25)
    const short = hits.filter((h) => h.w < 44 || h.h < 44).map((h) => `${h.label}: ${h.w} x ${h.h}`)
    expect(short, 'targets under 44 px').toEqual([])
  })

  test('the +25 / +50 / +90 buttons are 44 px high with at least 8 px between them', async ({ page }) => {
    await openPhone(page)
    const r = await page.$$eval('#minutesRow [data-min]', (bs) => bs.map((b) => b.getBoundingClientRect().toJSON()))
    expect(r).toHaveLength(3)
    for (const b of r) expect(b.height).toBeGreaterThanOrEqual(44)
    for (let i = 1; i < r.length; i++) expect(r[i].left - r[i - 1].right).toBeGreaterThanOrEqual(8)
  })

  test('no two hit areas overlap', async ({ page }) => {
    await openPhone(page)
    const hits = await boxes(page, TAPS)
    const clash: string[] = []
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i], b = hits[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 2 && oy > 2) clash.push(`${a.label} x ${b.label} (${ox} x ${oy})`)
      }
    }
    expect(clash).toEqual([])
  })

  test('the page does not scroll sideways', async ({ page }) => {
    await openPhone(page)
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
  })

  test('a focused control shows the kit ring: 2 px solid, offset 2, saffron-400', async ({ page }) => {
    await openPhone(page)
    await page.keyboard.press('Tab') // back link first
    await page.keyboard.press('Tab') // then the first paper chip
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement!)
      return { w: cs.outlineWidth, s: cs.outlineStyle, o: cs.outlineOffset, c: cs.outlineColor }
    })
    expect(ring).toEqual({ w: '2px', s: 'solid', o: '2px', c: 'rgb(255, 148, 84)' })
  })

  test('the controls use the kit radius and the 44 px token', async ({ page }) => {
    await openPhone(page)
    const v = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#minutesRow [data-min]')!)
      return { r: cs.borderTopLeftRadius, h: getComputedStyle(document.documentElement).getPropertyValue('--hit').trim() }
    })
    expect(v).toEqual({ r: '10px', h: '44px' })
  })

  test('reduced motion: the coverage bar does not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPhone(page)
    const d = await page.$eval('#covBar', (e) => getComputedStyle(e).transitionDuration)
    expect(d).toBe('0s')
  })

  test('motion is on by default: the bar has a 160 ms transition', async ({ page }) => {
    await openPhone(page)
    const d = await page.$eval('#covBar', (e) => getComputedStyle(e).transitionDuration)
    expect(d).toBe('0.16s')
  })

  test('a number the API did not send is shown as a dash, never as 0', async ({ page }) => {
    const bare = { ...PAYLOAD, counters: [{ id: 'water', name: 'Glasses of water' }], papers: [{ ...PAYLOAD.papers[0], days_left: null, coverage: null }], paper: { ...PAYLOAD.paper, coverage: null, counts: null } }
    await openPhone(page, bare)
    expect(await page.$eval('#counters b', (e) => e.textContent)).toBe('–')
    expect(await page.$eval('#paperChips button', (e) => e.textContent)).toBe('Control')
    const cov = await page.$eval('#covText', (e) => e.textContent ?? '')
    expect(cov).toContain('– by your taps')
    expect(cov).not.toMatch(/\d+ solid/)
  })

  test('the counter shows the number the API sent', async ({ page }) => {
    await openPhone(page)
    expect(await page.$$eval('#counters b', (bs) => bs.map((b) => b.textContent))).toEqual(['3', '0'])
  })
})
