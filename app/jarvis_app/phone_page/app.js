// JARVIS on the phone. Served by the laptop (app/jarvis_app/routes_phone.py); no libraries.
// The phone's credential is an HttpOnly cookie set at pairing: this script never sees it.
// Every call that changes something carries X-Jarvis-Phone: 1 (the server's CSRF check).
'use strict'

const $ = (id) => document.getElementById(id)
const H = { 'X-Jarvis-Phone': '1' }
let ws = null, backoff = 500, wsTimer = 0
let state = { limbs: null, core: null, turns: [], device: null }
const busy = new Set()

async function call(path, { method = 'GET', body, raw, type } = {}) {
  const init = { method, headers: { ...H }, credentials: 'same-origin' }
  if (raw) { init.body = raw; init.headers['Content-Type'] = type }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json' }
  const r = await fetch(path, init)
  let j = null
  try { j = await r.json() } catch { /* not JSON */ }
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
  $('roomView').hidden = !paired
  $('talkView').hidden = !paired
  $('foot').hidden = !paired
}

function setLink(on, text) {
  $('link').className = 'pill ' + (on ? 'live' : 'fault')
  $('linkText').textContent = text
}

function renderLimbs() {
  const v = state.limbs
  if (!v) return
  const tiles = $('tiles')
  tiles.textContent = ''
  for (const d of v.devices) {
    const b = document.createElement('button')
    const on = !!d.state.on
    b.className = 'tile' + (on ? ' on' : '')
    b.setAttribute('aria-pressed', String(on))
    b.setAttribute('aria-busy', String(busy.has(d.id)))
    const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name
    const big = document.createElement('span'); big.className = 'big'; big.textContent = busy.has(d.id) ? '…' : (on ? 'ON' : 'OFF')
    const sub = document.createElement('span'); sub.className = 'sub'
    if (d.link === 'usb') {
      sub.textContent = d.confirmed ? 'confirmed by the board' : 'board has not confirmed'
      sub.classList.add(d.confirmed ? 'ok' : 'bad')
    } else {
      sub.textContent = 'no relay board: app only'
      sub.classList.add('bad')
    }
    b.append(name, big, sub)
    b.onclick = () => toggle(d.id, !on)
    tiles.append(b)
  }
  const sc = $('scenes')
  sc.textContent = ''
  for (const s of v.scenes) {
    const c = document.createElement('button')
    c.className = 'chip'; c.textContent = s.name; c.title = s.detail
    c.onclick = () => scene(s.id)
    sc.append(c)
  }
  $('hardware').textContent = v.hardware || ''
}

const STATE_TEXT = { offline: 'asleep', booting: 'waking', sleeping: 'listening for "Jarvis"', idle: 'ready',
  listening: 'listening', transcribing: 'hearing', thinking: 'thinking', replying: 'replying', speaking: 'speaking', followup: 'listening' }

function renderCore() {
  const c = state.core
  if (!c) return
  const live = c.running
  $('coreState').className = 'pill ' + (live ? 'live' : '')
  $('coreState').lastElementChild.textContent = (live ? (c.mode === 'voice' ? 'voice · ' : 'text · ') : '') + (STATE_TEXT[c.state] || c.state)
  $('wake').hidden = live
  const micOk = window.isSecureContext && !!(navigator.mediaDevices && window.MediaRecorder)
  $('mic').disabled = !micOk
  const note = $('micNote')
  if (!micOk) {
    note.hidden = false
    note.textContent = 'Mic needs a secure page (https). Open JARVIS through its https address (Tailscale or a certificate: see Connect, Phone on the laptop). Typing works here.'
  } else if (live && c.mode !== 'voice') {
    note.hidden = false
    note.textContent = 'He is in text mode: no Whisper to hear with. Type, or wake him in voice mode.'
  } else {
    note.hidden = true
  }
}

function renderTurns() {
  const box = $('turns')
  box.textContent = ''
  if (!state.turns.length) {
    const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing said yet.'
    box.append(e)
    return
  }
  for (const t of state.turns.slice(-30)) {
    const d = document.createElement('div')
    d.className = 'turn ' + (t.role === 'you' ? 'you' : t.role === 'note' ? 'note' : 'jarvis')
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

/* ------------------------------------------------------------ actions */
async function toggle(id, on) {
  busy.add(id); renderLimbs(); $('talkErr').textContent = ''
  try {
    const r = await call(`/api/phone/limbs/${id}`, { method: 'POST', body: { action: on ? 'on' : 'off' } })
    state.limbs = r.limbs
    const dev = r.limbs.devices.find((d) => d.id === id)
    if (dev && dev.link === 'usb' && r.result.delivered && r.result.delivered[id] === false) {
      $('talkErr').textContent = `The board did not confirm the ${id}: it shows what the board says.`
    }
  } catch (e) { fail(e) } finally { busy.delete(id); renderLimbs() }
}

async function scene(id) {
  try { state.limbs = (await call(`/api/phone/scene/${id}`, { method: 'POST' })).limbs; renderLimbs() } catch (e) { fail(e) }
}

async function send() {
  const text = $('msg').value.trim()
  if (!text) return
  $('send').disabled = true; $('talkErr').textContent = ''
  try {
    await call('/api/phone/say', { method: 'POST', body: { text } })
    $('msg').value = ''
    if (state.core && state.core.mode === 'voice' && state.core.state !== 'sleeping') note('He will answer once he finishes what he is doing.')
  } catch (e) { fail(e) } finally { $('send').disabled = false }
}

async function wake(mode) {
  try { state.core = { ...state.core, ...(await call('/api/phone/core/start', { method: 'POST', body: { mode } })).core }; renderCore() } catch (e) { fail(e) }
}

function fail(e) {
  if (e.status === 401) { show(false); setLink(false, 'not paired'); return }
  $('talkErr').textContent = e.message
}

/* ------------------------------------------------------------ mic: tap, talk, tap */
let rec = null, chunks = [], recStart = 0, recTimer = 0
function pickType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}
async function micToggle() {
  if (rec) { rec.stop(); return }
  $('talkErr').textContent = ''
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  } catch (e) { $('talkErr').textContent = 'No microphone: ' + e.message; return }
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
      $('recInfo').textContent = 'he is listening to it…'
    } catch (e) { $('recInfo').textContent = ''; fail(e) }
  }
  rec.start()
  recStart = Date.now()
  $('mic').classList.add('rec')
  recTimer = setInterval(() => {
    const s = Math.round((Date.now() - recStart) / 1000)
    $('recInfo').textContent = `recording ${s} s · tap to send`
    if (s >= 45 && rec) rec.stop()
  }, 250)
}

/* ------------------------------------------------------------ speech on the phone */
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
  } catch { /* no voice: the text is on screen */ }
}

/* ------------------------------------------------------------ live */
function connect() {
  clearTimeout(wsTimer)
  if (document.hidden) return                       // battery: no socket while the screen is off
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws/phone`)
  ws.onopen = () => { backoff = 500; setLink(true, 'live') }
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
      else if (!ev.heard) note('He heard nothing he could use. Try again, closer.')
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
      $('talkErr').textContent = ev.text
    }
  }
  ws.onclose = (e) => {
    ws = null
    if (e.code === 4403 || e.code === 4401) { refresh(); return }   // revoked or not paired
    setLink(false, 'reconnecting')
    wsTimer = setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, 15000)
  }
}

async function refresh() {
  try {
    const s = await call('/api/phone/state')
    state = { ...state, limbs: s.limbs, core: s.core, turns: s.turns || [], device: s.device }
    show(true)
    $('devName').textContent = s.device ? s.device.name : ''
    renderLimbs(); renderCore(); renderTurns()
    if (!ws) connect()
  } catch (e) {
    if (e.status === 401) { show(false); setLink(false, 'not paired') }
    else setLink(false, e.message)
  }
}

/* ------------------------------------------------------------ pairing */
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
    history.replaceState(null, '', location.pathname)   // the code never stays in the address bar
  }
  const ua = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/)
  $('pairName').value = (ua && ua[1].replace(/ Build.*/, '').trim()) || 'Phone'
  $('pairBtn').onclick = pair
  $('send').onclick = send
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
  $('mic').onclick = micToggle
  for (const b of document.querySelectorAll('[data-wake]')) b.onclick = () => wake(b.dataset.wake)
  try { $('speakHere').checked = localStorage.getItem('jarvis.speakHere') === '1' } catch { /* private mode */ }
  $('speakHere').onchange = () => { try { localStorage.setItem('jarvis.speakHere', $('speakHere').checked ? '1' : '0') } catch { /* */ } }
  $('unpair').onclick = async () => {
    if (!confirm('Forget this phone? You will need a new code from the laptop.')) return
    try { await call('/api/phone/unpair', { method: 'POST' }) } catch { /* */ }
    if (ws) ws.close()
    show(false); setLink(false, 'not paired')
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (ws) { ws.onclose = null; ws.close(); ws = null } clearTimeout(wsTimer) }
    else refresh()
  })
  refresh().then(() => { if (m && $('pairView').hidden === false && $('pairCode').value) pair() })
}
boot()
