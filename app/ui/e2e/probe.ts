// The in-page measurement shared by the classic-pages spec (cp2) and the view sweep: geometry only, it changes nothing.
// One copy, so the two cannot drift: text under 11 px, targets under 44 px, sideways scroll, document overflow, labels that
// wrap past two lines, text cut with an ellipsis, and inner vertical scroll.
export interface Probe { small: string[]; targets: string[]; sideways: string[]; docOverflow: number; wraps: string[]; ellipsis: string[]; innerY: string[] }

/** The in-page measurement (geometry only; it changes nothing). Controls are judged on their own box, text on its computed size. */
export const PROBE = `(() => {
  const root = document.querySelector('.s2-page') || document.body
  const vis = (el) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.01) return false
    if (/sr-only|vh-sr|visually-hidden/.test(typeof el.className === 'string' ? el.className : '')) return false
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (a.matches('.s2-canvas, .s2-page, .ww-frame, .ww-centre, .page')) continue
      const c = getComputedStyle(a)
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); if (r.right < ar.left || r.left > ar.right || r.bottom < ar.top || r.top > ar.bottom) return false }
    }
    return true
  }
  const nm = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26)
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? ' "' + t + '"' : '')
  }
  const out = { small: [], targets: [], sideways: [], docOverflow: 0, wraps: [], ellipsis: [], innerY: [] }
  out.docOverflow = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
  for (const el of root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="slider"], [tabindex="0"]')) {
    if (!vis(el) || el.closest('[aria-hidden="true"]')) continue
    if (el.matches('svg *, [data-tree-node], .ww-tree-node')) continue
    const r = el.getBoundingClientRect()
    const lab = el.closest('label'); const lr = lab ? lab.getBoundingClientRect() : null
    const via = lr && lr.width >= 43.5 && lr.height >= 43.5 && el.tagName === 'INPUT'
    if ((r.width < 43.5 || r.height < 43.5) && !via) out.targets.push(nm(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  for (const el of root.querySelectorAll('*')) {
    // text made only of zero-width characters is a layout strut, not something to read: the maths renderer puts a
    // 1 px one inside every formula (span.vlist-s), which this probe reported as small text on the library page
    if (el.children.length === 0 && (el.textContent || '').replace(/[​-‍⁠﻿]/g, '').trim().length > 0 && vis(el)) {
      const cs = getComputedStyle(el); const fs = parseFloat(cs.fontSize)
      if (fs < 10.95) out.small.push(nm(el) + ' ' + fs + 'px')
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow === 'ellipsis') out.ellipsis.push(nm(el))
      if (cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) out.ellipsis.push(nm(el) + ' (line clamp)')
      const b = el.closest('button, [role="tab"], [role="radio"]')
      if (b && cs.whiteSpace !== 'pre-line') {
        const lh = parseFloat(cs.lineHeight) || fs * 1.3
        const rg = document.createRange(); rg.selectNodeContents(el)
        const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / (lh * 0.6))))
        if (tops.size > 2) out.wraps.push(nm(b) + ' ' + tops.size + ' lines')
      }
    }
    const cs = getComputedStyle(el)
    if (el.matches('.s2-canvas, textarea, select, [role="listbox"], [data-scroll-ok]')) continue
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && vis(el)) out.sideways.push(nm(el) + ' ' + (el.scrollWidth - el.clientWidth) + 'px')
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && vis(el)) out.innerY.push(nm(el) + ' ' + (el.scrollHeight - el.clientHeight) + 'px')
  }
  const cv = document.querySelector('.s2-canvas')
  if (cv && cv.scrollHeight > cv.clientHeight + 2) out.innerY.push('.s2-canvas ' + (cv.scrollHeight - cv.clientHeight) + 'px')
  return out
})()`
