/* Well Wisher on the phone (routes_phone_ww.py): the left column of the laptop window, alone (plan 4.14).
 *
 * Two halves. The first is buildLeft(): a line-for-line copy of app/ui/src/ww/left/model.ts, the window's view-model.
 * The phone cannot import the Vite build, so it carries its own copy and left.test.tsx runs BOTH on the same
 * fixtures and compares the output, so a change to one that is not made to the other fails a test.
 * The second half draws that model into ww.html (sections L1 to L4, same ids, same order) and sends the taps.
 * The server answers every tap with the refreshed payload; the page changes at once and takes the change back
 * (with the server's reason) if the tap is refused. */
'use strict'

// ============================================================ the view-model (copy of model.ts)
const LEFT_SECTION_IDS = ['L1', 'L2', 'L3', 'L4']
const PRESETS = [25, 50, 90]
const has = (x) => typeof x === 'number' && Number.isFinite(x)
const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`)
const dayWord = (n) => `${n} ${n === 1 ? 'day' : 'days'}`
const whenWord = (days) => (!has(days) ? 'date unknown' : days <= 0 ? 'today' : `in ${days} d`)
const bucketOf = (kind) => (kind === 'cie' ? 'cie' : kind === 'end_sem' || kind === 'backlog' ? 'end' : 'other')

function upcoming(papers) {
  return (papers || [])
    .filter((p) => has(p.days_left) && p.days_left >= 0)
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.start || '').localeCompare(b.start || '') : a.date < b.date ? -1 : 1))
}

const MAX_ROWS = 3

function buildL1(raw) {
  const variant = raw.season.left_top
  if (variant === 'horizon') {
    const h = raw.horizon
    const d = h ? h.deadline : null
    const headline = d
      ? `${d.org}${d.programme ? ` ${d.programme}` : ''} ${has(d.days_left) ? `in ${d.days_left} d` : 'date unknown'}`
      : h ? 'No application date ahead.' : 'Nothing read yet for the horizon.'
    return { id: 'L1', variant, title: 'Horizon', headline, counts: null, rows: [], more: 0, tentative: false, step: h ? h.first_step : null, rung: h ? h.rung : null }
  }
  const ahead = upcoming(raw.papers)
  const first = ahead[0]
  const rest = ahead.slice(1)
  const counts = ahead.length ? ahead.reduce((c, p) => ({ ...c, [bucketOf(p.kind)]: c[bucketOf(p.kind)] + 1 }), { cie: 0, end: 0, other: 0 }) : null
  return {
    id: 'L1', variant, title: 'Countdown',
    headline: first ? `Next: ${first.title} ${whenWord(first.days_left)}` : raw.papers === null ? 'Date sheet not read yet.' : 'No dated paper ahead.',
    counts,
    rows: rest.slice(0, MAX_ROWS).map((p) => ({ id: p.id, title: p.title, days_left: p.days_left, when: whenWord(p.days_left) })),
    more: Math.max(0, rest.length - MAX_ROWS),
    tentative: ahead.some((p) => p.approx),
    step: null, rung: null,
  }
}

function buildL2(raw) {
  const d = raw.day
  const welcome = d && has(d.idle_days) && d.idle_days > 0 ? `Back after ${dayWord(d.idle_days)}.${d.slipped ? ` ${d.slipped} slipped, none lost.` : ''}` : null
  const n = raw.now
  const meta = d && has(d.done) && has(d.total) && d.total > 0 ? `${d.done} of ${d.total} done` : null
  if (raw.season.now_card === 'close_the_day') {
    const logged = d ? d.logged_minutes : undefined
    return {
      id: 'L2', variant: 'close', title: 'Close the day',
      sentence: has(logged) ? (logged > 0 ? `Moved today: ${hm(logged)} logged.` : 'Nothing logged today yet.') : 'Today’s minutes are not read yet.',
      why: null, kind: null, minutes: null, welcome, logged: null, meta,
      kept: 'Not done: kept, not lost.', tomorrow: d ? d.tomorrow : null, presets: PRESETS,
    }
  }
  return {
    id: 'L2', variant: 'now', title: 'Now',
    sentence: n ? `${n.title}, ${hm(n.minutes)}.` : 'Nothing planned yet. Enter the date sheet to get a first step.',
    why: n ? (n.why == null ? null : n.why) : null,
    kind: n ? n.kind : null, minutes: n ? n.minutes : null, welcome,
    logged: d && has(d.logged_minutes) && d.logged_minutes > 0 ? `Logged today: ${hm(d.logged_minutes)}` : null,
    meta, kept: null, tomorrow: null, presets: PRESETS,
  }
}

function buildL3(raw) {
  const rows = (raw.classes || []).map((c) => ({ id: c.id, when: c.start, name: c.name, lab: c.kind === 'lab', status: c.status || null }))
  return {
    id: 'L3', title: 'Classes today', rows,
    empty: rows.length ? null : raw.classes === null ? 'Classes not read yet.' : 'No classes today, or no timetable yet.',
  }
}

function buildL4(raw) {
  const tiles = (raw.counters || []).map((c) => ({ id: c.id, name: c.name, value: has(c.today) ? c.today : null }))
  return { id: 'L4', title: 'Counters', tiles, empty: tiles.length ? null : raw.counters === null ? 'Counters not read yet.' : 'No counters set up.' }
}

function buildLeft(raw) {
  return { ids: LEFT_SECTION_IDS, l1: buildL1(raw), l2: buildL2(raw), l3: buildL3(raw), l4: buildL4(raw) }
}

// ============================================================ phone payload -> raw input
/**
 * What the phone route sends today (routes_phone_ww.today_view) does not carry the director's step 1, the
 * horizon, minutes logged or tomorrow's block. Where the route sends `now`, `horizon`, `logged_minutes`,
 * `tomorrow` or `idle_days`, they are used as they are; where it does not, Now falls back to the first
 * block of today's study plan (said so in the sentence's source below) and the rest stay null, which the
 * model turns into words. Nothing here is invented.
 */
function rawOf(D) {
  const season = D.season && D.season.left_top ? D.season : { left_top: 'horizon', now_card: 'now' }
  let now = D.now || null
  if (!now) {
    const slot = (D.blocks || []).find((s) => s.blocks && s.blocks.length)
    const b = slot ? slot.blocks[0] : null
    now = b ? { kind: 'study', title: `${b.title}${b.focus && b.focus[0] ? `: ${b.focus[0].title}` : ''}`, minutes: b.minutes, why: null, paper: b.paper } : null
  }
  return {
    season,
    papers: Array.isArray(D.papers) ? D.papers : null,
    now,
    horizon: D.horizon || null,
    day: { done: null, total: null, logged_minutes: has(D.logged_minutes) ? D.logged_minutes : null, tomorrow: D.tomorrow || null, idle_days: has(D.idle_days) ? D.idle_days : null, slipped: 0 },
    classes: Array.isArray(D.classes) ? D.classes.map((c) => ({ id: c.id, start: c.start, name: c.name, kind: c.kind, status: c.status || null })) : null,
    counters: Array.isArray(D.counters) ? D.counters : null,
  }
}

if (typeof window !== 'undefined') window.WWLeft = { buildLeft, rawOf, LEFT_SECTION_IDS }

// ============================================================ the page
if (typeof document !== 'undefined' && document.getElementById('main')) {
  const $ = (id) => document.getElementById(id)
  const H = { 'X-Jarvis-Phone': '1' }
  let D = null
  let paperId = null
  let lastCount = null

  const NEXT = { none: 'learned', learned: 'solid', solid: 'none' }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const pct = (x) => (has(x) ? `${Math.round(x * 100)}%` : '–')
  const say = (node, text) => { node.textContent = text || ''; node.hidden = !text }

  async function call(path, body) {
    const init = { method: body ? 'POST' : 'GET', headers: { ...H }, credentials: 'same-origin' }
    if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
    const r = await fetch(path, init)
    let j = null
    try { j = await r.json() } catch { /* not json */ }
    if (!r.ok) { const e = new Error((j && (j.detail || j.error)) || r.statusText || 'failed'); e.status = r.status; throw e }
    return j
  }

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

  /** The page changes first; a refused tap puts the old payload back and says why. */
  async function tap(path, body, optimistic) {
    const before = D
    if (optimistic) { D = optimistic(JSON.parse(JSON.stringify(D))); render() }
    try {
      D = await call(path, { ...body, paper: paperId })
      $('err').textContent = ''
      render()
      return true
    } catch (e) { D = before; render(); fail(e); return false }
  }

  function render() {
    $('main').hidden = false; $('unpaired').hidden = true
    const m = buildLeft(rawOf(D))
    renderL1(m.l1); renderL2(m.l2); renderL3(m.l3); renderL4(m.l4)
    renderTopics()
  }

  function renderL1(m) {
    $('h-L1').textContent = m.title
    $('l1Head').textContent = m.headline
    say($('l1Counts'), m.counts ? `CIE ${m.counts.cie} · End ${m.counts.end} · Other ${m.counts.other}` : '')
    const ul = $('l1Rows'); ul.replaceChildren(); ul.hidden = !m.rows.length
    for (const r of m.rows) {
      const li = el('li'); li.appendChild(el('span', '', r.title)); li.appendChild(el('span', 'muted small', r.when)); ul.appendChild(li)
    }
    say($('l1More'), m.more > 0 ? `+${m.more} more` : '')
    say($('l1Note'), m.tentative ? 'Dates tentative until the circular.' : '')
    say($('l1Step'), m.step ? `First step: ${m.step}` : '')
    say($('l1Rung'), m.rung ? `Goal this week: ${m.rung}` : '')
  }

  function renderL2(m) {
    $('h-L2').textContent = m.title
    say($('l2Welcome'), m.welcome)
    $('l2Say').textContent = m.sentence
    say($('l2Meta'), m.meta)
    say($('l2Logged'), m.logged)
    say($('l2Kept'), m.kept)
    say($('l2Tomorrow'), m.variant === 'close' ? (m.tomorrow ? `Tomorrow first: ${m.tomorrow}` : 'Tomorrow has no block planned yet.') : '')
    $('start').hidden = !(m.variant === 'now' && m.kind)
    $('whyFold').hidden = !m.why
    $('l2Why').textContent = m.why || ''
    const subject = minutesSubject()
    for (const b of document.querySelectorAll('#minutesRow [data-min]')) b.disabled = !subject
    say($('minutesWhy'), subject ? '' : 'No paper to log minutes against. Enter the date sheet on the laptop.')
  }

  /** The subject a +25 / +50 / +90 tap is logged against: Now's paper, else the paper shown. */
  function minutesSubject() {
    const m = rawOf(D)
    const id = m.now && m.now.paper
    const p = (D.papers || []).find((x) => x.id === id) || D.paper
    return p ? p.subject : null
  }

  function renderL3(m) {
    const r = D.rule || {}
    $('rule').textContent = r.threshold ? `${Math.round(r.threshold * 100)}%${r.confirmed ? '' : ' assumed'}` : ''
    const ul = $('classes'); ul.replaceChildren()
    for (const c of m.rows) {
      const li = el('li', c.status || '')
      li.appendChild(el('span', 'name', c.name + (c.lab ? ' (lab)' : '')))
      li.appendChild(el('span', 'when', c.when))
      const taps = el('span', 'taps'); taps.setAttribute('role', 'group'); taps.setAttribute('aria-label', `${c.name} at ${c.when}`)
      for (const [s, label] of [['present', 'P'], ['absent', 'A'], ['cancelled', 'C']]) {
        const b = el('button', 'btn sm' + (c.status === s ? ' on' : ''), label); b.type = 'button'
        b.setAttribute('aria-label', `${c.name} at ${c.when}: ${c.status === s ? 'clear' : 'mark'} ${s}`)
        b.setAttribute('aria-pressed', String(c.status === s))
        b.addEventListener('click', () => {
          const next = c.status === s ? 'clear' : s
          tap('/api/phone/ww/class', { slot: c.id, status: next }, (d) => {
            for (const x of d.classes) if (x.id === c.id) x.status = next === 'clear' ? null : next
            return d
          })
        })
        taps.appendChild(b)
      }
      li.appendChild(taps); ul.appendChild(li)
    }
    say($('classesEmpty'), m.empty)
  }

  function renderL4(m) {
    const ul = $('counters'); ul.replaceChildren()
    for (const c of m.tiles) {
      const li = el('li')
      const b = el('button', 'ctr'); b.type = 'button'
      b.setAttribute('aria-label', `${c.name}: ${has(c.value) ? c.value + ' today' : 'not measured yet'}. Add one.`)
      b.appendChild(el('span', 'ctr-name', c.name))
      b.appendChild(el('b', '', has(c.value) ? String(c.value) : '–'))
      b.addEventListener('click', () => count(c.id, 1))
      li.appendChild(b); ul.appendChild(li)
    }
    ul.hidden = !m.tiles.length
    say($('countersEmpty'), m.empty)
    $('undo').hidden = !lastCount
  }

  function count(id, delta) {
    lastCount = delta === 1 ? id : null
    tap('/api/phone/ww/count', { id, delta }, (d) => {
      for (const x of d.counters) if (x.id === id) x.today = Math.max(0, (has(x.today) ? x.today : 0) + delta)
      return d
    })
  }

  // The old Study card, kept in a fold until chunk 7 moves topics to the laptop.
  function renderTopics() {
    const p = D.paper
    paperId = p ? p.id : null
    const chips = $('paperChips'); chips.replaceChildren()
    for (const x of D.papers) {
      const b = el('button', 'btn sm' + (p && x.id === p.id ? ' on' : ''), `${x.title}${has(x.days_left) ? (x.days_left ? ` · ${x.days_left} d` : ' · today') : ''}`)
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p && x.id === p.id))
      b.addEventListener('click', () => { paperId = x.id; load() })
      chips.appendChild(b)
    }
    const topics = $('topics'); topics.replaceChildren()
    if (!p) { $('paperWhen').textContent = ''; $('covText').textContent = 'No paper ahead. Enter the date sheet on the laptop.'; $('covBar').style.width = '0'; return }
    $('paperWhen').textContent = `${p.approx ? '~' : ''}${p.date}${p.start ? ' · ' + p.start : ''}`
    $('covBar').style.width = has(p.coverage) ? pct(p.coverage) : '0'
    const c = p.counts
    const tally = c && has(c.solid) && has(c.learned) && has(c.none) ? ` · ${c.solid} solid, ${c.learned} learned, ${c.none} to do` : ''
    $('covText').textContent = p.topics.length ? `${pct(p.coverage)} by your taps${tally}. Tap a topic to move it.` : 'No unit list for this paper yet.'
    for (const t of p.topics) {
      const b = el('button', 'btn ' + t.state); b.type = 'button'
      b.appendChild(el('em', '', `U${t.unit}`)); b.appendChild(document.createTextNode(t.topic))
      b.title = `${t.state} → ${NEXT[t.state]}`
      b.addEventListener('click', () => tap('/api/phone/ww/topic', { subject: p.subject, key: t.key, state: NEXT[t.state] }, (d) => {
        for (const x of d.paper.topics) if (x.key === t.key) x.state = NEXT[t.state]
        return d
      }))
      topics.appendChild(b)
    }
  }

  function boot() {
    for (const b of document.querySelectorAll('#minutesRow [data-min]')) {
      b.addEventListener('click', async () => {
        const subject = D && minutesSubject()
        const minutes = Number(b.dataset.min)
        // No optimistic number: the page shows no minutes total of its own, only the server's. The saved line
        // below is the confirmation, and a refusal leaves the page as it was with the server's reason.
        if (subject && (await tap('/api/phone/ww/minutes', { subject, minutes }))) say($('minutesWhy'), `Saved +${minutes} min.`)
      })
    }
    // Start: a study step opens that paper's topics (the one thing to do for a paper on a phone); any other
    // step puts the thumb on +25, since the phone has no timer to start.
    $('start').addEventListener('click', () => {
      const m = rawOf(D)
      if (m.now && m.now.paper && m.now.paper !== paperId) { paperId = m.now.paper; load() }
      if (m.now && m.now.kind === 'study') { $('studyFold').open = true; $('studyFold').scrollIntoView({ block: 'start' }) }
      else document.querySelector('#minutesRow [data-min]').focus()
    })
    $('undo').addEventListener('click', () => { if (lastCount) count(lastCount, -1) })
    load()
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load() })
  }
  boot()
}
