// In-page measurement library for the jury bench. Plain JavaScript on purpose: the spec evaluates this file's text in
// the page, so no transpiler helper (such as esbuild's __name) can leak into it. Installs window.__bn.
(() => {
  const OPEN = new URLSearchParams(location.search).get('open') || ''
  const OPEN_OWNER = { Drawer: 'kit/Drawer', Sheet: 'kit/Drawer', Popover: 'kit/Popover', RetroDialog: 'kit/RetroDialog', RetroDialogDestructive: 'kit/RetroDialog' }

  const INTERACTIVE =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="switch"], [role="radio"], [role="slider"], [role="tab"], [role="option"], [role="combobox"], [tabindex]:not([tabindex="-1"])'

  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (s) => {
    if (!s || s === 'transparent' || s === 'none') return [0, 0, 0, 0]
    cx.clearRect(0, 0, 1, 1)
    cx.fillStyle = '#010203'
    cx.fillStyle = s
    cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const over = (top, bot) => {
    const a = top[3]
    return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), a + bot[3] * (1 - a)]
  }
  const lum = (c) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => {
    const x = lum(a)
    const y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  const owner = (el) => {
    const b = el.closest('[data-bench]')
    if (b) return b.dataset.bench
    if (el.closest('.ww-toasts')) return 'kit/Toast'
    if (el.closest('.ww-portal, .k-portal')) return OPEN_OWNER[OPEN] || 'portal'
    return 'page'
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    if (el.closest('[inert]')) return false
    return el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : true
  }

  // In an overlay run only the open overlay's portal is in scope (the page behind it is inert).
  const inScope = (el) => (OPEN ? !!el.closest('.ww-portal, .k-portal') : true)

  const interactive = () => [...document.querySelectorAll(INTERACTIVE)].filter((e) => inScope(e) && visible(e))
  const idOf = (() => {
    let n = 0
    return (el) => {
      if (!el.dataset.bnId) el.dataset.bnId = String(++n)
      return el.dataset.bnId
    }
  })()
  const describe = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    const cls = (el.getAttribute('class') || '').split(' ')[0]
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}${cls ? '.' + cls : ''} "${t}"`
  }
  const worse = (map, key, score, text) => {
    const cur = map[key]
    if (!cur) map[key] = { score, text, count: 1 }
    else {
      cur.count++
      if (score < cur.score) {
        cur.score = score
        cur.text = text
      }
    }
  }

  // ---- (a) edge and focus indicator
  const edgeOf = (el, cs) => {
    if (el.tagName === 'A' && /underline/.test(cs.textDecorationLine)) return 'underline'
    if (el.tagName === 'INPUT' && ['range', 'checkbox', 'radio'].includes(el.type) && cs.appearance !== 'none') return 'native'
    for (const s of ['top', 'right', 'bottom', 'left']) {
      if (parseFloat(cs['border-' + s + '-width']) >= 1 && cs['border-' + s + '-style'] !== 'none' && cs['border-' + s + '-style'] !== 'hidden' && rgba(cs['border-' + s + '-color'])[3] > 0) return 'border'
    }
    if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') return 'outline'
    // a container edge one or two levels up counts (spec 7.7 rule 3: a control gets an edge, a container a hairline)
    let p = el.parentElement
    for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
      const pc = getComputedStyle(p)
      for (const s of ['top', 'right', 'bottom', 'left']) {
        if (parseFloat(pc['border-' + s + '-width']) >= 1 && pc['border-' + s + '-style'] !== 'none' && rgba(pc['border-' + s + '-color'])[3] > 0) return 'container'
      }
    }
    return null
  }
  const focusRing = (el) => {
    el.focus({ preventScroll: true })
    const chain = [el]
    let p = el.parentElement
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) chain.push(p)
    for (const e of chain) {
      if (e !== el && !e.matches(':focus-within')) continue
      const cs = getComputedStyle(e)
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && rgba(cs.outlineColor)[3] > 0) return { ok: true, w: parseFloat(cs.outlineWidth), on: e === el ? 'self' : 'ancestor' }
    }
    return { ok: false, w: 0, on: 'none' }
  }
  const scanEdges = () => {
    const out = {}
    for (const el of interactive()) {
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const cs = getComputedStyle(el)
      const o = owner(el)
      const edge = edgeOf(el, cs)
      if (!edge) worse(out, o + '|edge', 0, `no border, outline or underline: ${describe(el)}`)
      const ring = focusRing(el)
      if (!ring.ok) worse(out, o + '|focus', 0, `outline none on focus: ${describe(el)}`)
      el.blur()
    }
    return out
  }

  // ---- (b) hit area, with elementFromPoint probes for ::after extensions
  const hits = (el, h) => h === el || el.contains(h) || (h && h.closest && h.closest('label') && h.closest('label').contains(el))
  const reach = (el, r, side) => {
    let k = 0
    const mx = r.left + r.width / 2
    const my = r.top + r.height / 2
    for (; k < 40; k++) {
      const d = k + 1
      const x = side === 'l' ? r.left - d + 0.5 : side === 'r' ? r.right + d - 0.5 : mx
      const y = side === 't' ? r.top - d + 0.5 : side === 'b' ? r.bottom + d - 0.5 : my
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) break
      if (!hits(el, document.elementFromPoint(x, y))) break
    }
    return k
  }
  const scanHits = () => {
    const out = {}
    for (const el of interactive()) {
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r = el.getBoundingClientRect()
      let w = r.width
      let h = r.height
      let via = ''
      if (w < 44 || h < 44) {
        const e = { l: reach(el, r, 'l'), r: reach(el, r, 'r'), t: reach(el, r, 't'), b: reach(el, r, 'b') }
        w += e.l + e.r
        h += e.t + e.b
        if (e.l + e.r + e.t + e.b > 0) via = ` (box ${r.width.toFixed(0)}x${r.height.toFixed(0)} plus probes l${e.l} r${e.r} t${e.t} b${e.b})`
      }
      if (w < 43.5 || h < 43.5) worse(out, owner(el) + '|hit', Math.min(w, h), `${w.toFixed(1)}x${h.toFixed(1)} px effective${via}: ${describe(el)}`)
    }
    return out
  }

  // ---- (c) Tab reach
  const roleGroup = (el) => el.closest('[role="radiogroup"], [role="tablist"], [role="listbox"], [role="toolbar"], [role="group"]')
  const tabPrep = () => {
    window.__bnSeen = new Set()
    addEventListener('focusin', (e) => e.target && e.target.dataset && e.target.dataset.bnId && window.__bnSeen.add(e.target.dataset.bnId))
    const els = interactive()
    els.forEach(idOf)
    ;(document.activeElement || document.body).blur?.()
    return els.length
  }
  const tabResult = () => {
    const out = {}
    const seen = window.__bnSeen
    for (const el of interactive()) {
      const o = owner(el)
      const id = idOf(el)
      const reached = seen.has(id)
      const aria = el.getAttribute('aria-disabled') === 'true'
      if (!reached) {
        const g = roleGroup(el)
        const rover = el.getAttribute('tabindex') === '-1' && g && [...g.querySelectorAll(INTERACTIVE)].some((m) => seen.has(idOf(m)))
        if (!rover) worse(out, o + '|tab', 0, `${aria ? 'aria-disabled control ' : ''}not reached by Tab: ${describe(el)}`)
      }
      if (el.hasAttribute('disabled') && !el.closest('[data-form="disabled"]')) worse(out, o + '|tab', 0, `uses the disabled attribute, so it cannot take focus: ${describe(el)}`)
    }
    return out
  }

  // ---- (d) motion
  const anims = () => {
    const out = {}
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running') continue
      const t = a.effect && a.effect.target
      const o = t && t.closest ? owner(t) : 'page'
      worse(out, o + '|motion', 0, `running ${a.constructor.name} ${a.animationName || a.transitionProperty || ''} on ${t && t.tagName ? t.tagName.toLowerCase() + '.' + (t.getAttribute('class') || '').split(' ')[0] : '?'}`)
    }
    return out
  }
  const mutationWindow = (ms) =>
    new Promise((res) => {
      const out = {}
      const mo = new MutationObserver((list) => {
        for (const m of list) {
          const n = m.target.nodeType === 1 ? m.target : m.target.parentElement
          if (!n || !n.closest) continue
          worse(out, owner(n) + '|churn', 0, `DOM ${m.type} ${m.attributeName || ''} on ${n.tagName.toLowerCase()}.${(n.getAttribute('class') || '').split(' ')[0]}`)
        }
      })
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
      setTimeout(() => {
        mo.disconnect()
        res(out)
      }, ms)
    })

  // ---- (f) contrast
  const backdrop = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y)
    let i = stack.indexOf(el)
    if (i < 0) i = 0
    const layers = []
    let image = false
    for (; i < stack.length; i++) {
      const e = stack[i]
      const cs = getComputedStyle(e)
      let c = null
      if (e instanceof SVGElement) {
        if (/^(rect|circle|path|polygon|ellipse|line)$/.test(e.tagName) && cs.fill !== 'none') {
          c = rgba(cs.fill)
          c[3] *= parseFloat(cs.fillOpacity) * parseFloat(cs.opacity)
        }
      } else {
        if (cs.backgroundImage !== 'none' && rgba(cs.backgroundColor)[3] < 1) image = true
        c = rgba(cs.backgroundColor)
        c[3] *= parseFloat(cs.opacity)
      }
      if (c && c[3] > 0) {
        layers.push(c)
        if (c[3] >= 0.999) break
      }
    }
    let base = [255, 255, 255, 1]
    if (!layers.length || layers[layers.length - 1][3] < 0.999) base = rgba(getComputedStyle(document.documentElement).backgroundColor)[3] > 0 ? rgba(getComputedStyle(document.documentElement).backgroundColor) : [255, 255, 255, 1]
    let acc = base
    for (let k = layers.length - 1; k >= 0; k--) acc = over(layers[k], acc)
    return { colour: acc, image }
  }
  const effOpacity = (el) => {
    let o = 1
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) o *= parseFloat(getComputedStyle(p).opacity)
    return o
  }
  const scanContrast = () => {
    const out = {}
    const skipped = { image: 0, hidden: 0 }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let node
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue
      const el = node.parentElement
      if (!el || /^(SCRIPT|STYLE|OPTION|TITLE)$/.test(el.tagName) || !inScope(el)) continue
      range.selectNodeContents(node)
      const rc = range.getBoundingClientRect()
      if (rc.width < 2 || rc.height < 2 || !visible(el.closest('svg') ? el.closest('svg') : el)) {
        skipped.hidden++
        continue
      }
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const r2 = (range.selectNodeContents(node), range.getBoundingClientRect())
      const cs = getComputedStyle(el)
      const svg = el instanceof SVGElement
      const fg = rgba(svg ? cs.fill : cs.color)
      fg[3] *= effOpacity(el)
      const bd = backdrop(el, r2.left + r2.width / 2, r2.top + r2.height / 2)
      if (bd.image) {
        skipped.image++
        continue
      }
      const comp = over(fg, bd.colour)
      let fs = parseFloat(cs.fontSize)
      if (svg && el.ownerSVGElement) {
        const vb = el.ownerSVGElement.viewBox.baseVal
        if (vb && vb.width) fs *= el.ownerSVGElement.getBoundingClientRect().width / vb.width
      }
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const large = fs >= 24 || (fs >= 18.66 && bold)
      const need = large ? 3 : 4.5
      const rt = ratio(comp, bd.colour)
      if (rt < need) worse(out, owner(el) + '|contrast', rt - need, `${rt.toFixed(2)}:1 needs ${need}:1 for "${node.nodeValue.trim().slice(0, 24)}" at ${fs.toFixed(1)}px (${el.tagName.toLowerCase()}.${(el.getAttribute('class') || '').split(' ')[0]})`)
    }
    // UI edges: a control's boundary needs 3:1 against what is around it (WCAG 1.4.11), by border or by fill, not shadow
    for (const el of interactive()) {
      if (el.tagName === 'INPUT' && ['range', 'checkbox', 'radio'].includes(el.type)) continue
      el.scrollIntoView({ block: 'center', inline: 'center' })
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const outside = backdrop(el.parentElement || el, Math.max(0, r.left - 3), r.top + r.height / 2).colour
      let best = 0
      const own = over(rgba(cs.backgroundColor), outside)
      best = Math.max(best, ratio(own, outside))
      for (const s of ['top', 'right', 'bottom', 'left']) {
        if (parseFloat(cs['border-' + s + '-width']) >= 1 && cs['border-' + s + '-style'] !== 'none') best = Math.max(best, ratio(over(rgba(cs['border-' + s + '-color']), outside), outside))
      }
      let p = el.parentElement
      for (let i = 0; i < 2 && p && best < 3; i++, p = p.parentElement) {
        const pc = getComputedStyle(p)
        const po = backdrop(p.parentElement || p, Math.max(0, p.getBoundingClientRect().left - 3), p.getBoundingClientRect().top + 2).colour
        for (const s of ['top', 'right', 'bottom', 'left']) {
          if (parseFloat(pc['border-' + s + '-width']) >= 1 && pc['border-' + s + '-style'] !== 'none') best = Math.max(best, ratio(over(rgba(pc['border-' + s + '-color']), po), po))
        }
      }
      if (best < 3) worse(out, owner(el) + '|edge-contrast', best - 3, `edge ${best.toFixed(2)}:1 needs 3:1: ${describe(el)}`)
    }
    return { out, skipped }
  }

  // ---- (a2) / (e) glyph signatures and pixel difference between screenshots (data URLs)
  const glyphSets = () => {
    const pick = (sel) => [...document.querySelectorAll(sel)]
    return {
      'lamp/LampGlyph': pick('[data-bench="lamp/LampGlyph"] svg.lamp-glyph'),
      'kit/Lamp': pick('[data-bench="kit/Lamp"] [data-form="glyph only"] svg'),
      'art/StateMark': pick('[data-bench="art/ArtTable"] [data-form="marks and tags"] svg.art-mark'),
    }
  }
  const signatures = () => {
    const out = {}
    const sets = glyphSets()
    for (const k of Object.keys(sets)) out[k] = sets[k].map((s) => s.innerHTML.replace(/\s+/g, ' ').trim())
    return out
  }
  const pixelDiff = async (urlA, urlB) => {
    const load = (u) =>
      new Promise((res, rej) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = rej
        i.src = u
      })
    const [a, b] = await Promise.all([load(urlA), load(urlB)])
    const w = Math.max(a.width, b.width)
    const h = Math.max(a.height, b.height)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    const da = (g.clearRect(0, 0, w, h), g.drawImage(a, 0, 0), g.getImageData(0, 0, w, h).data)
    const db = (g.clearRect(0, 0, w, h), g.drawImage(b, 0, 0), g.getImageData(0, 0, w, h).data)
    let diff = 0
    let ink = 0
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 40) diff++
      if (da[i] < 128) ink++
    }
    return diff / (w * h)
  }

  window.__bn = {
    OPEN, INTERACTIVE, interactive, owner, scanEdges, scanHits, tabPrep, tabResult, anims, mutationWindow, scanContrast, signatures, pixelDiff, glyphSets,
    count: () => interactive().length,
    sections: () => [...document.querySelectorAll('[data-bench]')].map((e) => e.dataset.bench),
  }
})()
