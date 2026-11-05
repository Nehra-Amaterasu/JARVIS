// JARVIS on the phone: pairing, the room (modes + the shared relays view), Aankhen's
// real numbers, and talking to JARVIS. No framework, no third-party script (the CSP
// allows same-origin script only). relays.js is loaded first and is also the wall
// box's own page (web_page.h), so the tiles behave the same in both places.
'use strict'

const $ = (id) => document.getElementById(id)
const H = { 'X-Jarvis-Phone': '1' }
let ws = null, backoff = 500, wsTimer = 0
let state = { limbs: null, core: null, turns: [], device: null, aankhen: null, boardPower: null }

async function call(path, { method = 'GET', body, raw, type } = {}) {
  const init = { method, headers: { ...H }, credentials: 'same-origin' }
  if (raw) { init.body = raw; init.headers['Content-Type'] = type }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
  const r = await fetch(path, init)
  let j = null
  try { j = await r.json() } catch { /* not json */ }
  if (!r.ok) {
    const e = new Error((j && (j.detail || j.error)) || r.statusText || 'failed')
    e.status = r.status
    throw e
  }
  return j
}

/* ------------------------------------------------------------ views */
function show(paired) {
  $('pairView').hidden = paired
  $('paired').hidden = !paired
  $('foot').hidden = !paired
}

function setLink(cls, text) {
  $('link').className = 'pill ' + cls
  $('linkText').textContent = text
}

function selectTab(name) {
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name))
  for (const t of ['room', 'aankhen', 'talk']) $('tab-' + t).hidden = t !== name
}

// "Relays only": the same app, just the relay tiles (what the board's own page shows).
function applyRelaysOnly(on) {
  $('tabs').hidden = on
  $('modesBox').hidden = on
  if (on) selectTab('room')
}

/* ------------------------------------------------------------ the room */
// A tile's state is the board's report (hardware_on), never the app's saved state.
function relayList(limbs) {
  return (limbs && limbs.devices ? limbs.devices : []).map((d) => ({
    id: d.id, name: d.name, kind: d.kind,
    on: d.link === 'virtual' ? null : d.hardware_on,
    available: !(typeof d.channel === 'number' && d.channel < 0)
  }))
}

const panel = RelayPanel($('relays'), async (id, on) => {
  const r = await call(`/api/phone/limbs/${encodeURIComponent(id)}`, { method: 'POST', body: { action: on ? 'on' : 'off' } })
  if (r && r.limbs) { state.limbs = r.limbs; renderLimbs() }
})

function renderLimbs() {
  const v = state.limbs
  if (!v) return
  panel.update(relayList(v))
  const box = $('scenes')
  box.textContent = ''
  for (const s of v.scenes || []) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = s.name
    b.title = s.detail || ''
    b.addEventListener('click', () => scene(s.id))
    box.append(b)
  }
  $('modeName').textContent = v.last_mode ? 'Mode: ' + v.last_mode : ''
}

async function scene(id) {
  $('err').textContent = ''
  try {
    const r = await call(`/api/phone/scene/${encodeURIComponent(id)}`, { method: 'POST' })
    state.limbs = r.limbs
    renderLimbs()
  } catch (e) { fail(e) }
}

/* ------------------------------------------------------------ power-safe mode */
// Shown only while the board's own STATUS says "safe". Leaving it switches nothing on:
// the relays stay off until he taps them.
function renderPower() {
  const p = state.boardPower
  const safe = !!(p && p.power === 'safe')
  $('powerSafe').hidden = !safe
  if (!safe) return
  $('powerWhy').textContent = 'Reason: ' + (p.why || 'repeated brownouts') +
    (p.brownouts != null ? ` · brownouts since power-on: ${p.brownouts}` : '')
}

async function leavePowerSafe() {
  if (!confirm('The supply browned out twice. Leave power-safe mode anyway? No relay switches on by itself.')) return
  $('powerBtn').disabled = true; $('powerErr').textContent = ''
  try {
    await call('/api/phone/power/normal', { method: 'POST' })
    await refresh()
  } catch (e) {
    if (e.status === 401) fail(e)
    else $('powerErr').textContent = e.message
  } finally { $('powerBtn').disabled = false }
}

/* ------------------------------------------------------------ Aankhen */
// Only what the hub reports. A simulated source says so; presence is a guess until a
// held-out day has passed, so it is labelled "predicting".
function renderAankhen() {
  const a = state.aankhen
  const dl = $('aankhen')
  dl.textContent = ''
  const add = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k
    const dd = document.createElement('dd'); dd.textContent = v
    dl.append(dt, dd)
  }
  if (!a || !a.source) {
    $('aankhenNote').textContent = 'No sensor data: the hub is not running or the board is not streaming.'
    return
  }
  add('Source', a.source === 'hardware' ? 'the wall box (measured)' : a.source + ' (not measured)')
  if (a.guess) add('Predicting', a.guess)
  if (a.motion) add('Motion', a.motion)
  if (a.link) {
    if (a.link.frames_ok != null) add('Frames', String(a.link.frames_ok))
    if (a.link.loss_ratio != null) add('Loss', (a.link.loss_ratio * 100).toFixed(1) + ' %')
  }
  $('aankhenNote').textContent = a.source === 'hardware' ? '' : 'Simulated data is never a measurement.'
}

/* ------------------------------------------------------------ talking */
const STATE_TEXT = {
  offline: 'ASLEEP', booting: 'WAKING', sleeping: 'LISTENING', idle: 'READY', listening: 'LISTENING',
  transcribing: 'HEARING', thinking: 'THINKING', replying: 'REPLYING', speaking: 'SPEAKING', followup: 'LISTENING'
}

function renderCore() {
  const c = state.core
  if (!c) return
  $('coreState').className = 'pill ' + (c.running ? 'live' : '')
  $('coreState').lastElementChild.textContent = (c.running ? (c.mode === 'voice' ? 'VOICE · ' : 'TEXT · ') : '') +
    (STATE_TEXT[c.state] || String(c.state || '')).toUpperCase()
  $('wakePrompt').hidden = !!c.running
  $('mic').disabled = !(window.isSecureContext && navigator.mediaDevices && window.MediaRecorder)
}

function renderTurns() {
  const box = $('turns')
  box.textContent = ''
  if (!state.turns.length) {
    const e = document.createElement('div'); e.className = 'bubble note'; e.textContent = 'Nothing said yet.'
    box.append(e)
    return
  }
  for (const t of state.turns.slice(-30)) {
    const d = document.createElement('div')
    d.className = 'bubble ' + (t.role === 'you' ? 'you' : t.role === 'note' ? 'note' : 'jarvis')
    d.textContent = t.text || (t.done ? '' : '…')
    box.append(d)
  }
  box.scrollTop = box.scrollHeight
}

function upsertTurn(turn) {
  const i = state.turns.findIndex((t) => t.id === turn.id && t.role === turn.role)
  if (i >= 0) state.turns[i] = { ...state.turns[i], ...turn }
  else state.turns.push(turn)
}

function note(text) {
  state.turns.push({ id: 'n' + Date.now(), role: 'note', text, done: true })
  renderTurns()
}

async function send() {
  const text = $('msg').value.trim()
  if (!text) return
  $('send').disabled = true; $('err').textContent = ''
  try {
    await call('/api/phone/say', { method: 'POST', body: { text } })
    $('msg').value = ''
  } catch (e) { fail(e) } finally { $('send').disabled = false }
}

async function wake(mode) {
  try {
    const r = await call('/api/phone/core/start', { method: 'POST', body: { mode } })
    state.core = { ...state.core, ...r.core }
    renderCore()
  } catch (e) { fail(e) }
}

function fail(e) {
  if (e.status === 401) { show(false); setLink('fault', 'NOT PAIRED'); return }
  $('err').textContent = e.message
}

let rec = null, chunks = [], recStart = 0, recTimer = 0
function pickType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

async function micToggle() {
  if (rec) { rec.stop(); return }
  $('err').textContent = ''
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  } catch (e) { $('err').textContent = 'No microphone: ' + e.message; return }
  const type = pickType()
  rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined)
  chunks = []
  rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data) }
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop())
    clearInterval(recTimer); $('mic').classList.remove('rec'); $('recInfo').textContent = ''
    const mime = (rec.mimeType || type || 'audio/webm').split(';')[0]
    const blob = new Blob(chunks, { type: mime })
    rec = null
    if (Date.now() - recStart < 500 || blob.size < 200) return
    $('recInfo').textContent = 'sending…'
    try {
      await call('/api/phone/hear', { method: 'POST', raw: blob, type: mime })
      $('recInfo').textContent = 'JARVIS is listening to it…'
    } catch (e) { $('recInfo').textContent = ''; fail(e) }
  }
  rec.start()
  recStart = Date.now()
  $('mic').classList.add('rec')
  recTimer = setInterval(() => {
    const s = Math.round((Date.now() - recStart) / 1000)
    $('recInfo').textContent = `recording ${s} s`
    if (s >= 45 && rec) rec.stop()
  }, 250)
}

const spoken = new Set()
async function speakHere(turn) {
  if (!$('speakHere').checked || spoken.has(turn.id) || !turn.text || document.hidden) return
  spoken.add(turn.id)
  try {
    const r = await fetch('/api/phone/speech?text=' + encodeURIComponent(turn.text.slice(0, 600)), { headers: H })
    if (!r.ok) return
    const url = URL.createObjectURL(await r.blob())
    const a = new Audio(url)
    a.onended = () => URL.revokeObjectURL(url)
    await a.play()
  } catch { /* the text is on screen */ }
}

/* ------------------------------------------------------------ live updates */
function connect() {
  clearTimeout(wsTimer)
  if (document.hidden) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws/phone`)
  ws.onopen = () => { backoff = 500; setLink('live', 'LIVE') }
  ws.onmessage = (m) => {
    let ev
    try { ev = JSON.parse(m.data) } catch { return }
    if (ev.kind === 'hello') {
      state = { ...state, limbs: ev.limbs, core: ev.core, turns: ev.turns || [], device: ev.device }
      renderLimbs(); renderCore(); renderTurns()
      return
    }
    if (ev.source === 'limbs' && ev.limbs) { state.limbs = ev.limbs; renderLimbs(); return }
    if (ev.source === 'phone' && ev.kind === 'heard') {
      $('recInfo').textContent = ''
      if (ev.error) note('Could not hear that: ' + ev.error)
      else if (!ev.heard) note('He heard nothing he could use.')
      return
    }
    if (ev.source !== 'core') return
    if (ev.kind === 'state') { state.core = { ...state.core, state: ev.state }; renderCore() }
    else if (ev.kind === 'turn' && ev.turn) {
      upsertTurn(ev.turn); renderTurns()
      if (ev.turn.role === 'jarvis' && ev.turn.done) speakHere(ev.turn)
    } else if (ev.kind === 'reply_chunk') {
      const t = state.turns.find((x) => x.id === ev.turn_id && x.role === 'jarvis')
      if (t) t.text = (t.text || '') + ev.chunk
      else state.turns.push({ id: ev.turn_id, role: 'jarvis', text: ev.chunk, done: false })
      renderTurns()
    } else if (['ready', 'starting', 'stopped', 'boot'].includes(ev.kind)) {
      refresh()
    } else if (ev.kind === 'error' && ev.text) {
      $('err').textContent = ev.text
    }
  }
  ws.onclose = (e) => {
    ws = null
    if (e.code === 4403 || e.code === 4401) { refresh(); return }
    setLink('fault', 'RECONNECTING')
    wsTimer = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, 15000)
  }
}

async function refresh() {
  try {
    const s = await call('/api/phone/state')
    state = { ...state, limbs: s.limbs, core: s.core, turns: s.turns || [], device: s.device, aankhen: s.aankhen,
      boardPower: s.board_power }
    show(true)
    $('devName').textContent = s.device ? s.device.name : 'Phone'
    renderLimbs(); renderCore(); renderTurns(); renderAankhen(); renderPower()
    if (!ws) connect()
  } catch (e) {
    if (e.status === 401) { show(false); setLink('fault', 'NOT PAIRED') }
    else setLink('fault', 'JARVIS OFFLINE')
  }
}

/* ------------------------------------------------------------ pairing and start */
async function pair() {
  $('pairErr').textContent = ''
  $('pairBtn').disabled = true
  try {
    await call('/api/phone/pair', { method: 'POST', body: { code: $('pairCode').value, name: $('pairName').value } })
    await refresh()
  } catch (e) { $('pairErr').textContent = e.message } finally { $('pairBtn').disabled = false }
}

function boot() {
  const m = location.hash.match(/pair=([A-Za-z0-9-]+)/)
  if (m) {
    $('pairCode').value = m[1]
    history.replaceState(null, '', location.pathname)
  }
  const ua = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)
  $('pairName').value = (ua && ua[1].replace(/ Build.*/, '').trim()) || 'Phone'
  $('pairBtn').addEventListener('click', pair)
  $('powerBtn').addEventListener('click', leavePowerSafe)
  $('send').addEventListener('click', send)
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
  $('mic').addEventListener('click', micToggle)
  for (const b of document.querySelectorAll('[data-wake]')) b.addEventListener('click', () => wake(b.dataset.wake))
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => selectTab(b.dataset.tab))

  const pref = (k) => { try { return localStorage.getItem(k) === '1' } catch { return false } }
  const save = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* private window */ } }
  $('speakHere').checked = pref('jarvis.speakHere')
  $('speakHere').addEventListener('change', () => save('jarvis.speakHere', $('speakHere').checked))
  $('relaysOnly').checked = pref('jarvis.relaysOnly')
  applyRelaysOnly($('relaysOnly').checked)
  $('relaysOnly').addEventListener('change', () => { save('jarvis.relaysOnly', $('relaysOnly').checked); applyRelaysOnly($('relaysOnly').checked) })

  $('unpair').addEventListener('click', async () => {
    if (!confirm('Unpair this phone? You will need a new code from the laptop to pair again.')) return
    try { await call('/api/phone/unpair', { method: 'POST' }) } catch { /* it is gone either way */ }
    if (ws) ws.close()
    show(false); setLink('fault', 'NOT PAIRED')
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ws) { ws.onclose = null; ws.close(); ws = null } clearTimeout(wsTimer) }
    else refresh()
  })

  refresh().then(() => { if (m && !$('pairView').hidden && $('pairCode').value) pair() })
}

boot()
