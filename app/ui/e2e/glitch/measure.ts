// The in-page measurement of the glitch sweep (QG1). One string, run with page.evaluate, so it has no imports and
// no build step. It reads geometry only; nothing here changes the page.
export interface Finding { kind: string; where: string; detail: string }

export const MEASURE_SCRIPT = `(() => {
  const out = []
  const root = document.querySelector('[data-shell="v2"]') || document.body
  const vw = innerWidth
  const canvas = document.querySelector('.s2-canvas')
  const cr = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, right: vw, bottom: innerHeight }
  // the part of an element the person can see: its box cut by every clipping ancestor (a scrolled-away control is not a glitch)
  const shown = (el) => {
    let r = el.getBoundingClientRect()
    let l = r.left, t = r.top, rr = r.right, b = r.bottom
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect()
        if (cs.overflowX !== 'visible') { l = Math.max(l, ar.left); rr = Math.min(rr, ar.right) }
        if (cs.overflowY !== 'visible') { t = Math.max(t, ar.top); b = Math.min(b, ar.bottom) }
      }
    }
    return { l, t, r: rr, b, w: rr - l, h: b - t }
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.01) return false
    if (cs.clip !== 'auto' && /rect\(0px, 0px, 0px, 0px\)|rect\(1px, 1px, 1px, 1px\)/.test(cs.clip)) return false
    if (/sr-only|vh-sr|visually-hidden/.test(typeof el.className === 'string' ? el.className : '')) return false
    const s = shown(el)
    return s.w >= 1 && s.h >= 1
  }
  const name = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''
    const t = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 26)
    return el.tagName.toLowerCase() + (c ? '.' + c : '') + (t ? ' "' + t + '"' : '')
  }
  const docOverflow = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
  if (docOverflow > 1) out.push({ kind: 'document-overflow', detail: docOverflow + ' px wider than the window' })
  if (document.documentElement.scrollHeight > innerHeight + 1) out.push({ kind: 'document-scroll', detail: (document.documentElement.scrollHeight - innerHeight) + ' px taller than the window' })

  // interactive elements
  const controls = [...root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="slider"], [tabindex="0"]')].filter(visible)
  const boxes = controls.map((el) => { const s = shown(el); return { el, r: { left: s.l, top: s.t, right: s.r, bottom: s.b, width: s.w, height: s.h } } })
  for (const { el, r } of boxes) {
    if (el.closest('[aria-hidden="true"]') || el.disabled && false) continue
    // the size is the control's own box; a control half scrolled out of a strip is not a small control
    const full = el.getBoundingClientRect()
    const small = (full.width < 43.5 || full.height < 43.5)
    // a native checkbox or radio inside a label that is 44 px counts through the label
    const lab = el.closest('label')
    const lr = lab ? lab.getBoundingClientRect() : null
    if (small && !(lr && lr.width >= 43.5 && lr.height >= 43.5) && !(el.parentElement && el.parentElement.getBoundingClientRect().height >= 43.5 && el.tagName === 'INPUT' && el.type === 'range'))
      out.push({ kind: 'target-under-44', detail: name(el) + ' ' + Math.round(full.width) + 'x' + Math.round(full.height) })
    if (r.right > vw + 1 || r.left < -1) out.push({ kind: 'control-outside-window', detail: name(el) + ' x ' + Math.round(r.left) + '..' + Math.round(r.right) })
  }
  // overlap: two controls whose boxes intersect by more than 4 px both ways, and neither contains the other
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
    const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
    if (w > 4 && h > 4) {
      // a label and its own input are one control
      if (a.el.closest('label') && a.el.closest('label') === b.el.closest('label')) continue
      out.push({ kind: 'controls-overlap', detail: name(a.el) + ' over ' + name(b.el) + ' (' + Math.round(w) + 'x' + Math.round(h) + ')' })
    }
  }
  // text clipped or pill-wrapped
  const textEls = [...root.querySelectorAll('button, a, label, span, p, li, h1, h2, h3, h4, td, th, dt, dd, div')].filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim().length > 0)
  for (const el of textEls) {
    const cs = getComputedStyle(el)
    const fs = parseFloat(cs.fontSize)
    if (fs < 10.95) out.push({ kind: 'text-under-11px', detail: name(el) + ' ' + fs + 'px' })
    const clipX = (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1
    if (clipX && cs.textOverflow !== 'ellipsis') out.push({ kind: 'text-clipped', detail: name(el) + ' scroll ' + el.scrollWidth + ' > client ' + el.clientWidth })
    if (clipX && cs.textOverflow === 'ellipsis') out.push({ kind: 'text-ellipsis', detail: name(el) + ' is cut with an ellipsis (' + el.scrollWidth + ' > ' + el.clientWidth + ')' })
    const pill = el.closest('button, [role="tab"], [class*="pill"], [class*="chip"], [class*="badge"]')
    if (pill && cs.whiteSpace !== 'pre-line') {
      const rg = document.createRange(); rg.selectNodeContents(el)
      const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 3)))
      if (tops.size >= 2) out.push({ kind: 'pill-wraps', detail: name(pill) + ' wraps to ' + tops.size + ' lines' })
    }
  }
  // a scrolling box inside a rail or a card (the owner's rule: no inner scrollbar)
  for (const el of root.querySelectorAll('*')) {
    if (el === canvas || el.matches('.s2-palette-list, textarea, select, [role="listbox"], [role="log"], [data-scroll-ok]')) continue
    const cs = getComputedStyle(el)
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && visible(el))
      out.push({ kind: 'inner-scroll', detail: name(el) + ' scrolls ' + (el.scrollHeight - el.clientHeight) + ' px' })
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2 && visible(el))
      out.push({ kind: 'inner-scroll-x', detail: name(el) + ' scrolls sideways ' + (el.scrollWidth - el.clientWidth) + ' px' })
  }
  // chrome that ought to be single
  for (const sel of ['.s2-title', '.s2-rail', '.s2-canvas']) {
    const n = document.querySelectorAll(sel).length
    if (n > 1) out.push({ kind: 'duplicate-chrome', detail: sel + ' x' + n })
  }
  if (document.querySelectorAll('.s2-scrim').length && !document.querySelector('[role="dialog"],[role="alertdialog"],[data-overlay]'))
    out.push({ kind: 'stuck-scrim', detail: 'a scrim with no dialog' })
  return { findings: out, docOverflow }
})()`
