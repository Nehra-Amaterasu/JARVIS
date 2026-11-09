// P3 (plan 8.6): effective hit rectangle at least 40 px (44 in groups), no overlapping hit areas, at
// 1366x768 (mouse) and 390x844 (touch).
//
// Chunk 1a shipped the measuring helper and proved it on the lab's one control. Chunk 1b runs it over
// the kitchen sink (every primitive, e2e/kitchen.ts) at both sizes, and over a bare "phone lab" that
// loads only the shared controls file, to prove the phone can use the same buttons, chips and counters.
// Pages and overlays (chunks 4 to 12) add their rows when they exist.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, openLab, test } from './fixtures'
import { openKitchen } from './kitchen'

/** The effective box: probe elementFromPoint on a 4 px grid over the element grown by 12 px each side. */
export async function effectiveBox(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!
    const r = el.getBoundingClientRect()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let x = r.left - 12; x <= r.right + 12; x += 4) {
      for (let y = r.top - 12; y <= r.bottom + 12; y += 4) {
        const hit = document.elementFromPoint(x, y)
        if (hit && (hit === el || el.contains(hit))) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        }
      }
    }
    return { w: maxX - minX, h: maxY - minY }
  }, selector)
}

test('the measuring helper reads a 44 px control as at least 40 x 40', async ({ page }) => {
  await openLab(page)
  const b = await effectiveBox(page, '#tap')
  expect(b.w).toBeGreaterThanOrEqual(40)
  expect(b.h).toBeGreaterThanOrEqual(40)
})

interface Hit {
  label: string
  grouped: boolean
  x: number
  y: number
  w: number
  h: number
}

/** Scroll each control to the middle of the window and probe the points around it; returns document coordinates. */
async function measure(page: import('@playwright/test').Page, selector: string): Promise<Hit[]> {
  return page.evaluate((sel) => {
    const out: Hit[] = []
    const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
    })
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let x = Math.max(0, r.left - 12); x <= Math.min(innerWidth - 1, r.right + 12); x += 2) {
        for (let y = Math.max(0, r.top - 12); y <= Math.min(innerHeight - 1, r.bottom + 12); y += 2) {
          const hit = document.elementFromPoint(x, y)
          if (hit && (hit === el || el.contains(hit))) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
          }
        }
      }
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.id ?? '').trim().slice(0, 28)
      const inGroup = !!el.closest('.ww-taps, .ww-seg, [data-kitchen-group]') || el.dataset.grouped === 'true'
      out.push({ label: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''} "${name}"`, grouped: inGroup, x: minX + scrollX, y: minY + scrollY, w: maxX - minX + 2, h: maxY - minY + 2 })
    }
    return out
  }, selector)
}

const CONTROLS = 'button, input, select, textarea, [role="radio"], a[href]'

/** Controls whose box is deliberately smaller than 40: none today. Every entry needs a reason; the list is part of the gate report. */
const EXEMPT: Record<string, string> = {}

for (const vp of [
  { name: '1366 x 768 (mouse)', size: { width: 1366, height: 768 }, touch: false },
  { name: '390 x 844 (touch)', size: { width: 390, height: 844 }, touch: true },
]) {
  test.describe(`kitchen sink, ${vp.name}`, () => {
    test.use({ viewport: vp.size, hasTouch: vp.touch })

    test('every control has an effective hit area of at least 40 px, and 44 px in a group', async ({ page }) => {
      await openKitchen(page)
      const hits = await measure(page, CONTROLS)
      expect(hits.length).toBeGreaterThan(40)
      const short = hits.filter((h) => !(h.label in EXEMPT) && (h.w < 40 || h.h < 40)).map((h) => `${h.label}: ${h.w} x ${h.h}`)
      expect(short, 'controls under 40 px').toEqual([])
      const grouped = hits.filter((h) => h.grouped && !(h.label in EXEMPT) && h.h < 44).map((h) => `${h.label}: ${h.w} x ${h.h}`)
      expect(grouped, 'grouped controls under 44 px high').toEqual([])
    })

    test('no two hit areas overlap', async ({ page }) => {
      await openKitchen(page)
      const hits = await measure(page, CONTROLS)
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
      await openKitchen(page)
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over).toBeLessThanOrEqual(0)
    })
  })
}

// ---- the phone (plan 9.0, chunk 1b): the same buttons, chips and counters from the shared controls file ----
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')

/**
 * A bare page with ONLY what the phone can load: the shared tier-1 primitives, the Ash semantic tokens, the
 * component tokens and kit/controls.css. The markup is the phone page's +25/+50/+90, class taps and counters.
 */
function phoneLab(): string {
  const css = ['styles/design/primitive.css', 'ww/design/themes/ash.css', 'ww/design/component.css', 'ww/kit/controls.css'].map(read).join('\n').replace(/@import[^;]+;/g, '')
  return `<!doctype html><html data-ww><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body style="margin:0"><main class="ww" style="padding:14px;display:grid;gap:12px">
  <div style="display:flex;gap:8px;align-items:center"><span>Studied it:</span>
    <button class="ww-btn" data-size="sm" data-grouped="true">+25 min</button><button class="ww-btn" data-size="sm" data-grouped="true">+50 min</button><button class="ww-btn" data-size="sm" data-grouped="true">+90 min</button></div>
  <div class="ww-taps" role="group" aria-label="Maths" style="display:inline-flex;gap:4px">
    <button class="ww-btn" data-size="sm" data-grouped="true" aria-pressed="true">P</button><button class="ww-btn" data-size="sm" data-grouped="true">A</button><button class="ww-btn" data-size="sm" data-grouped="true">C</button></div>
  <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="ww-chip" data-grouped="true">&#9675; Limits</button><button class="ww-chip" data-grouped="true" data-cycle-state="learned">&#9680; Series</button><button class="ww-chip" data-grouped="true" data-cycle-state="solid">&#9679; Vectors</button></div>
  <div style="display:flex;gap:8px;align-items:center"><div class="ww-stat"><span class="ww-stat-label">Gym</span><span class="ww-stat-value">2</span></div>
    <button class="ww-btn" data-size="sm" data-grouped="true" aria-label="One less gym session">&minus;</button><button class="ww-btn" data-size="sm" data-grouped="true" aria-label="One more gym session">+</button></div>
</main></body></html>`
}

test.describe('the phone, 390 x 844 (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the shared controls file gives the phone 44 px taps with no overlap', async ({ page }) => {
    await page.setContent(phoneLab())
    const hits = await measure(page, 'button')
    expect(hits).toHaveLength(11)
    expect(hits.filter((h) => h.h < 44 || h.w < 40).map((h) => `${h.label}: ${h.w} x ${h.h}`)).toEqual([])
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i], b = hits[j]
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(ox > 2 && oy > 2, `${a.label} x ${b.label}`).toBe(false)
      }
    }
  })

  test('on the phone the control radii, heights and focus ring come from the same tokens as the desktop', async ({ page }) => {
    await page.setContent(phoneLab())
    const s = await page.evaluate(() => {
      const b = document.querySelector('.ww-btn') as HTMLElement
      const c = document.querySelector('.ww-chip') as HTMLElement
      const cs = getComputedStyle(b)
      return { radius: cs.borderTopLeftRadius, minH: cs.minHeight, chipRadius: getComputedStyle(c).borderTopLeftRadius, hit: getComputedStyle(document.querySelector('.ww')!).getPropertyValue('--hit').trim() }
    })
    expect(s).toEqual({ radius: '10px', minH: '44px', chipRadius: '6px', hit: '44px' })
  })
})

test('every page, view and overlay at 1366 and 390', async () => {
  test.skip(true, 'pages and overlays arrive in chunks 4 to 12; each adds its rows here. The kit (this chunk) is covered above.')
})
