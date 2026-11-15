// L04 in a real Chromium: Today and both rails measured on the gallery's L04 entry (the jury harness builds the gallery in
// memory, so no server and no dist build are needed). At the desk the entry draws the 1302 x 664 canvas the shell leaves at
// 1366 x 768 under a 0.72 zoom; every measured box is divided by that zoom, so the sizes below are real CSS px.
//
//   (a) no inner scrollbar: the page box, the left rail and the Proof rail each fit their content (scrollHeight <= clientHeight)
//   (b) both rails whole: every part of the left rail and every Proof pin lies inside its rail
//   (c) every focusable part of Today is at least 44 x 44 (Fitts and hit areas, principles 13 and 14)
//   (d) the document never scrolls: not at 1366 x 768 and not at 358 px (the phone form scrolls inside its own box)
//   (e) one accent key, and every callout plate carries a lamp
//   (f) RT1, 15 Nov: no leader crosses a text of the specimen; SIMULATED is printed once on the dial; the 390 px page is about 1,400 px
//       tall, no word is broken per syllable, and a lamp word stands beside every figure
import { expect, test, type Page } from '@playwright/test'
import { openGallery, pickEntry, showState } from './jury/lib'

async function openToday(page: Page, state: number) {
  await openGallery(page, 'light')
  const { states } = await pickEntry(page, 'L04')
  await showState(page, state, states.length)
  await page.locator('.td').first().waitFor()
  await page.waitForTimeout(150) // the ResizeObserver's first measurement
}

const geometry = (page: Page) => page.evaluate(() => {
  const td = document.querySelector<HTMLElement>('.td')!
  const box = td.closest<HTMLElement>('.td-gallery-box')
  const z = Number(box ? getComputedStyle(box).zoom : 1) || 1
  const lr = document.querySelector<HTMLElement>('.lr')
  const ps = document.querySelector<HTMLElement>('.ps')
  const inside = (outer: HTMLElement | null, sel: string) => {
    if (!outer) return []
    const o = outer.getBoundingClientRect()
    return [...outer.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && (r.top < o.top - 1 || r.bottom > o.bottom + 1 || r.left < o.left - 1 || r.right > o.right + 1)
    }).map((e) => e.className || e.tagName)
  }
  const focusable = [...td.querySelectorAll<HTMLElement>('button, input, [tabindex="0"], a[href], summary')].filter((e) => e.getClientRects().length > 0 && !e.closest('[aria-hidden="true"]'))
  const small = focusable.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width / z < 43.5 || r.height / z < 43.5)
    .map(({ e, r }) => `${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30)} ${Math.round(r.width / z)}x${Math.round(r.height / z)}`)
  const scrolls = (e: HTMLElement | null) => (e ? e.scrollHeight - e.clientHeight : 0)
  return {
    form: td.dataset.form,
    width: td.offsetWidth,
    tdScroll: scrolls(td),
    lrScroll: scrolls(lr),
    psScroll: scrolls(ps),
    lrOut: inside(lr, '.lr-sec, .lr-foot, .lr-key'),
    psOut: inside(ps, '.ps-figs li, .ps-ring, .ps-open, .ps-foot'),
    small,
    primaries: td.querySelectorAll('[data-primary]').length,
    plates: td.querySelectorAll('.td-plate').length,
    lamps: [...td.querySelectorAll('.td-plate')].filter((p) => p.querySelector('.lamp-glyph')).length,
    docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

test.describe('L04 Today and the rails', () => {
  for (const [i, name] of [[0, 'a full day'], [1, 'first run'], [2, 'nothing read yet']] as const) {
    test(`desk 1366 x 768, ${name}: one canvas, rails whole, no inner scrollbar, 44 px targets`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await openToday(page, i)
      const g = await geometry(page)
      expect(g.form).toBe('desk')
      expect(g.width).toBe(1302)
      expect(g.tdScroll, 'the page box scrolls').toBeLessThanOrEqual(0)
      expect(g.lrScroll, 'the left rail scrolls').toBeLessThanOrEqual(0)
      expect(g.psScroll, 'the Proof rail scrolls').toBeLessThanOrEqual(0)
      expect(g.lrOut, 'parts outside the left rail').toEqual([])
      expect(g.psOut, 'parts outside the Proof rail').toEqual([])
      expect(g.small, 'targets under 44 px').toEqual([])
      expect(g.primaries).toBe(1)
      expect(g.lamps).toBe(g.plates)
    })
  }

  test('the frame rails with every part (Now and Counters too): whole at 664 px, no inner scrollbar, 44 px keys', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await openGallery(page, 'light')
    const { states } = await pickEntry(page, 'L04')
    await showState(page, 3, states.length)
    await page.locator('.lr').waitFor()
    await page.waitForTimeout(150)
    const r = await page.evaluate(() => {
      const lr = document.querySelector<HTMLElement>('.lr')!
      const o = lr.getBoundingClientRect()
      const out = [...lr.querySelectorAll<HTMLElement>('.lr-sec, .lr-foot, .lr-key, .lr-phone')].filter((e) => {
        const b = e.getBoundingClientRect()
        return b.height > 0 && (b.bottom > o.bottom + 1 || b.top < o.top - 1)
      }).map((e) => e.className)
      const small = [...lr.querySelectorAll<HTMLElement>('button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width < 43.5 || b.height < 43.5).length
      return { scroll: lr.scrollHeight - lr.clientHeight, out, small, parts: lr.querySelectorAll('.lr-sec').length, phone: !!lr.querySelector('.lr-foot .lr-phone, .lr-foot .lr-phone-key') }
    })
    expect(r.scroll).toBeLessThanOrEqual(0)
    expect(r.out).toEqual([])
    expect(r.small).toBe(0)
    expect(r.parts).toBe(4)
    expect(r.phone).toBe(true)
  })

  test('phone 358 px: the phone form, nothing wider than the screen, 44 px targets, Now first', async ({ page }) => {
    await page.setViewportSize({ width: 358, height: 780 })
    await openGallery(page, 'light')
    const { states } = await pickEntry(page, 'L04')
    await showState(page, 0, states.length)
    await page.locator('.td[data-form="phone"]').waitFor()
    const g = await geometry(page)
    expect(g.form).toBe('phone')
    expect(g.docX, 'the document scrolls sideways').toBeLessThanOrEqual(0)
    expect(g.small, 'targets under 44 px').toEqual([])
    const first = await page.locator('.td .td-plate').first().getAttribute('data-callout')
    expect(first).toBe('now')
  })
})

// ---- RT1 (15 Nov): the jury's findings on Today, measured -------------------------------------------------------------------------
test.describe('L04 Today after the jury', () => {
  const real = async (page: Page, state: number) => {
    await openToday(page, state)
    await page.addStyleTag({ content: '.td-gallery-box{zoom:1 !important}' }) // screen px = CSS px, so leaders and text share one space
    await page.waitForTimeout(250)
  }

  for (const [i, name] of [[0, 'a full day'], [1, 'first run'], [2, 'nothing read yet']] as const) {
    test(`desk 1366 x 768, ${name}: no leader crosses a text, and the plates give their body air`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await real(page, i)
      const r = await page.evaluate(() => {
        const boxes: { name: string; r: DOMRect }[] = []
        const add = (sel: string) => document.querySelectorAll<HTMLElement | SVGElement>(sel).forEach((e) => {
          const b = e.getBoundingClientRect()
          if (b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden') boxes.push({ name: `${sel}: ${(e.textContent ?? '').trim().slice(0, 24)}`, r: b })
        })
        for (const sel of ['.td-spec text', '.td-arc-keys > span', '.td-arc-lamp', '.td-strip-head > span', '.td-strip-head .lw', '.td-spec .d1-odo', '.td-quiet']) add(sel)
        const hits: string[] = []
        document.querySelectorAll<SVGPathElement>('.td-leader path').forEach((path, k) => {
          const len = path.getTotalLength()
          const m = path.getScreenCTM()!
          for (let t = 10; t < len; t += 2) {
            const p = path.getPointAtLength(t)
            const x = p.x * m.a + p.y * m.c + m.e
            const y = p.x * m.b + p.y * m.d + m.f
            for (const b of boxes) if (x > b.r.left - 2 && x < b.r.right + 2 && y > b.r.top - 2 && y < b.r.bottom + 2) hits.push(`leader ${k} crosses ${b.name}`)
          }
        })
        // the plate body never touches its header: at least 6 px between the head's bottom and the body's first line
        const tight = [...document.querySelectorAll<HTMLElement>('.td-plate')].map((p) => {
          const h = p.querySelector('.td-plate-head')!.getBoundingClientRect()
          const b = p.querySelector('.td-plate-body')!.firstElementChild?.getBoundingClientRect()
          return { id: p.dataset.callout, gap: b ? Math.round(b.top - h.bottom) : 99 }
        }).filter((x) => x.gap < 6)
        return { hits: [...new Set(hits)], tight }
      })
      expect(r.hits, 'leaders over text').toEqual([])
      expect(r.tight, 'a plate body touches its header').toEqual([])
    })
  }

  test('desk: SIMULATED is printed once on the dial and its figure, and the page has no loose stamp', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await real(page, 0)
    const r = await page.evaluate(() => {
      const arc = document.querySelector<HTMLElement>('.td-spec-desk .td-arc')!
      return { dial: (arc.innerText.match(/SIMULATED/gi) ?? []).length, stamp: document.querySelectorAll('.td-stamp').length, odo: document.querySelector<HTMLElement>('.td-arc-centre')!.innerText }
    })
    expect(r.dial, 'SIMULATED on the dial and its figure').toBe(1)
    expect(r.stamp).toBe(0)
    expect(r.odo).not.toMatch(/SIMULATED/i)
  })

  for (const [i, name] of [[0, 'a full day'], [1, 'first run'], [2, 'nothing read yet']] as const) {
    test(`desk, ${name}: the minutes figure sits inside the open half ring, clear of the inner track`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await real(page, i)
      const r = await page.evaluate(() => {
        const arc = document.querySelector<SVGSVGElement>('.td-spec-desk .td-arc svg')!
        const done = document.querySelector<SVGPathElement>('.td-groove[data-track="done"]')!
        const o = document.querySelector<HTMLElement>('.td-arc-centre')!.getBoundingClientRect()
        const a = arc.getBoundingClientRect()
        const rad = Number(done.getAttribute('d')!.match(/A([\d.]+)/)![1])
        const half = Number(done.getAttribute('stroke-width')) / 2
        const cx = a.left + a.width / 2
        const cy = done.getBoundingClientRect().bottom - half // the groove's flat ends sit on the datum
        const corners = [[o.left, o.top], [o.right, o.top], [o.left, o.bottom], [o.right, o.bottom]]
        return { worst: Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy))), inner: rad - half, w: Math.round(o.width) }
      })
      expect(r.w, 'the figure is 132 px wide whatever it says').toBe(132)
      expect(r.worst, `corner of the figure ${Math.round(r.worst)} px from the centre, inner track at ${Math.round(r.inner)}`).toBeLessThan(r.inner - 4)
    })
  }

  for (const [i, name] of [[0, 'a full day'], [1, 'first run'], [2, 'nothing read yet']] as const) {
    test(`phone 390, ${name}: the page is about 1,400 px, nothing is cut at either edge, no word is broken per syllable`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openGallery(page, 'light')
      const { states } = await pickEntry(page, 'L04')
      await showState(page, i, states.length)
      await page.locator('.td[data-form="phone"]').waitFor()
      await page.waitForTimeout(250)
      const r = await page.evaluate(() => {
        const td = document.querySelector<HTMLElement>('.td')!
        // a text container that holds one word must be one line high: a name is never broken mid-word
        const broken = [...td.querySelectorAll<HTMLElement>('.td-spine-what, .td-key-name, .td-plate-label, .ps-label, .lr-class-name, .td-mono, .td-more')].filter((e) => {
          const lh = parseFloat(getComputedStyle(e).lineHeight) || 16
          const text = (e.textContent ?? '').trim()
          return e.getBoundingClientRect().height > 0 && !/\s/.test(text) && e.getBoundingClientRect().height > lh * 1.5
        }).map((e) => (e.textContent ?? '').trim())
        const clipped = [...td.querySelectorAll<HTMLElement>('.td-spine-what, .td-key-name, .td-plate-label, .td-num, .td-key-n')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e.textContent ?? '').trim())
        const spec = td.querySelector<HTMLElement>('.td-spec')!.getBoundingClientRect()
        const out = [...td.querySelectorAll<SVGElement>('.td-spec svg')].filter((s) => { const b = s.getBoundingClientRect(); return b.left < spec.left - 1 || b.right > spec.right + 1 }).length
        return { h: td.scrollHeight, broken, clipped, out, docX: document.documentElement.scrollWidth - document.documentElement.clientWidth }
      })
      expect(r.broken, 'words broken per syllable').toEqual([])
      expect(r.clipped, 'words wider than their box').toEqual([])
      expect(r.out, 'drawings cut at the well edge').toBe(0)
      expect(r.docX).toBeLessThanOrEqual(0)
      expect(r.h, `the phone page is ${r.h} px tall`).toBeLessThanOrEqual(1400)
    })
  }

  test('phone 390: 44 px targets on the folded rows, the agenda key, the fold and the keys', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openGallery(page, 'light')
    const { states } = await pickEntry(page, 'L04')
    await showState(page, 0, states.length)
    await page.locator('.td[data-form="phone"]').waitFor()
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.td .lr-rowkey, .td .ps-open, .td .td-more, .td .ww-fold-btn, .td .td-key, .td .td-start')].map((e) => ({ c: e.className, r: e.getBoundingClientRect() })).filter((x) => x.r.height < 43.5 || x.r.width < 43.5).map((x) => `${x.c} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`))
    expect(small).toEqual([])
  })

  test('desk: the Proof rail is an instrument: ring, three figures each with lamp and word, whole inside its rail, nothing under 11 px', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await real(page, 0)
    const r = await page.evaluate(() => {
      const ps = document.querySelector<HTMLElement>('.ps')!
      const o = ps.getBoundingClientRect()
      const figs = [...ps.querySelectorAll<HTMLElement>('.ps-figs li')]
      const sizes = [...ps.querySelectorAll<HTMLElement>('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))
      return {
        w: Math.round(o.width), figs: figs.length, words: figs.map((f) => f.querySelector('.lw-w')?.textContent), ring: !!ps.querySelector('.ps-ring'),
        out: figs.filter((f) => { const b = f.getBoundingClientRect(); return b.bottom > o.bottom || b.right > o.right + 1 || b.left < o.left - 1 }).length,
        wide: figs.filter((f) => f.scrollWidth > f.clientWidth + 1).length, min: Math.min(...sizes),
      }
    })
    expect(r.w).toBe(96)
    expect(r.figs).toBe(3)
    expect(r.ring).toBe(true)
    expect(r.words).toEqual(['SIMULATED', 'SIMULATED', 'PLANNED'])
    expect(r.out).toBe(0)
    expect(r.wide, 'a figure wider than the rail').toBe(0)
    expect(r.min).toBeGreaterThanOrEqual(11)
  })
})
