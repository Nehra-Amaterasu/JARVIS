/* Well Wisher on the phone (routes_phone_ww.py). One payload, four kinds of tap. The server
 * answers every tap with the refreshed payload, so the page never keeps its own state. */
'use strict'
const $ = (id) => document.getElementById(id)
const H = { 'X-Jarvis-Phone': '1' }
let D = null
let paperId = null

async function call(path, body) {
  const init = { method: body ? 'POST' : 'GET', headers: { ...H }, credentials: 'same-origin' }
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
  const r = await fetch(path, init)
  let j = null
  try { j = await r.json() } catch { /* not json */ }
  if (!r.ok) { const e = new Error((j && (j.detail || j.error)) || r.statusText || 'failed'); e.status = r.status; throw e }
  return j
}

const NEXT = { none: 'learned', learned: 'solid', solid: 'none' }
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
const pct = (x) => `${Math.round((x || 0) * 100)}%`
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)

function setLink(cls, text) { $('link').className = 'pill ' + cls; $('linkText').textContent = text }
function fail(e) { $('err').textContent = e && e.message ? e.message : String(e) }

async function load() {
  try {
    D = await call('/api/phone/ww/today' + (paperId ? '?paper=' + encodeURIComponent(paperId) : ''))
    $('err').textContent = ''
    render()
    setLink('live', 'LIVE')
  } catch (e) {
    if (e.status === 401) { $('unpaired').hidden = false; $('main').hidden = true; setLink('fault', 'NOT PAIRED'); return }
    setLink('fault', 'OFFLINE'); fail(e)
  }
}

async function tap(path, body) {
  try {
    D = await call(path, { ...body, paper: paperId })
    $('err').textContent = ''
    render()
  } catch (e) { fail(e); load() }
}

function render() {
  $('main').hidden = false; $('unpaired').hidden = true
  $('say').textContent = D.say
  renderPaper(); renderBlocks(); renderClasses(); renderCounters()
}

function renderPaper() {
  const p = D.paper
  paperId = p ? p.id : null
  const chips = $('paperChips'); chips.replaceChildren()
  for (const x of D.papers) {
    const b = el('button', 'btn sm' + (p && x.id === p.id ? ' on' : ''), `${x.title}${x.days_left ? ` · ${x.days_left} d` : ' · today'}`)
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p && x.id === p.id))
    b.addEventListener('click', () => { paperId = x.id; load() })
    chips.appendChild(b)
  }
  const topics = $('topics'); topics.replaceChildren()
  if (!p) { $('paperWhen').textContent = ''; $('covText').textContent = 'No paper ahead. Enter the date sheet on the laptop.'; $('covBar').style.width = '0'; $('minutesRow').hidden = true; return }
  $('paperWhen').textContent = `${p.approx ? '~' : ''}${p.date}${p.start ? ' · ' + p.start : ''}`
  $('covBar').style.width = pct(p.coverage)
  const c = p.counts || { none: 0, learned: 0, solid: 0 }
  $('covText').textContent = p.topics.length ? `${pct(p.coverage)} by your taps · ${c.solid} solid, ${c.learned} learned, ${c.none} to do. Tap a topic to move it.` : 'No unit list for this paper yet.'
  for (const t of p.topics) {
    const b = el('button', 'btn ' + t.state); b.type = 'button'
    b.appendChild(el('em', '', `U${t.unit}`)); b.appendChild(document.createTextNode(t.topic))
    b.title = `${t.state} → ${NEXT[t.state]}`
    b.addEventListener('click', () => tap('/api/phone/ww/topic', { subject: p.subject, key: t.key, state: NEXT[t.state] }))
    topics.appendChild(b)
  }
  $('minutesRow').hidden = false
}

function renderBlocks() {
  const ul = $('blocks'); ul.replaceChildren()
  if (!D.blocks.length) { ul.appendChild(el('li', 'muted', 'Nothing planned today.')); return }
  for (const s of D.blocks) {
    const li = el('li')
    li.appendChild(el('span', 'lbl', s.label)); li.appendChild(el('span', 'mono muted', hm(s.minutes)))
    for (const b of s.blocks) {
      const f = b.focus.map((x) => x.title).join(' · ')
      li.appendChild(el('span', 'focus', `${b.title} (${hm(b.minutes)})${f ? ': ' + f : ''}`))
    }
    ul.appendChild(li)
  }
}

function renderClasses() {
  const r = D.rule || {}
  $('rule').textContent = r.threshold ? `${Math.round(r.threshold * 100)}%${r.confirmed ? '' : ' assumed'}` : ''
  const ul = $('classes'); ul.replaceChildren()
  if (!D.classes.length) ul.appendChild(el('li', 'muted', D.attendance.length ? 'No classes today.' : 'No timetable yet.'))
  for (const c of D.classes) {
    const li = el('li', c.status || '')
    li.appendChild(el('span', 'when', c.start))
    li.appendChild(el('span', 'name', c.name + (c.kind === 'lab' ? ' (lab)' : '')))
    const taps = el('span', 'taps')
    for (const [s, label] of [['present', '✓'], ['absent', '✗'], ['cancelled', '–']]) {
      const b = el('button', 'btn sm' + (c.status === s ? ' on' : ''), label); b.type = 'button'
      b.setAttribute('aria-label', `${c.name} ${s}`); b.setAttribute('aria-pressed', String(c.status === s))
      b.addEventListener('click', () => tap('/api/phone/ww/class', { slot: c.id, status: c.status === s ? 'clear' : s }))
      taps.appendChild(b)
    }
    li.appendChild(taps); ul.appendChild(li)
  }
  const tb = $('margin').tBodies[0]; tb.replaceChildren()
  for (const row of D.attendance) {
    const tr = el('tr', row.need ? 'low' : '')
    tr.appendChild(el('td', '', row.name))
    const m = !row.held ? 'no class tapped' : row.need ? `${row.need} in a row to reach the line` : row.can_miss ? `${row.can_miss} of margin` : 'at the line'
    tr.appendChild(el('td', '', `${row.attended}/${row.held} · ${m}`))
    tb.appendChild(tr)
  }
}

function renderCounters() {
  const ul = $('counters'); ul.replaceChildren()
  if (!D.counters.length) ul.appendChild(el('li', 'muted', 'No counters set up.'))
  for (const c of D.counters) {
    const li = el('li')
    li.appendChild(el('span', '', c.name))
    const ctl = el('span', 'ctl')
    const minus = el('button', 'btn sm', '−'); minus.type = 'button'; minus.setAttribute('aria-label', `${c.name} minus one`)
    const plus = el('button', 'btn sm', '+'); plus.type = 'button'; plus.setAttribute('aria-label', `${c.name} plus one`)
    minus.addEventListener('click', () => tap('/api/phone/ww/count', { id: c.id, delta: -1 }))
    plus.addEventListener('click', () => tap('/api/phone/ww/count', { id: c.id, delta: 1 }))
    ctl.appendChild(minus); ctl.appendChild(el('b', '', String(c.today ?? 0))); ctl.appendChild(plus)
    li.appendChild(ctl); ul.appendChild(li)
  }
}

function boot() {
  for (const b of document.querySelectorAll('#minutesRow [data-min]')) {
    b.addEventListener('click', () => { if (D && D.paper) tap('/api/phone/ww/minutes', { subject: D.paper.subject, minutes: Number(b.dataset.min) }) })
  }
  load()
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load() })
}
boot()
