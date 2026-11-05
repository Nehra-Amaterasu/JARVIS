// Runs phone_page/relays.js under Node with a tiny fake DOM and fake timers, then prints
// what happened as JSON for test_board_page.py. Usage: node relays_harness.js <relays.js>
'use strict'
const fs = require('fs')
const vm = require('vm')

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.textContent = ''; this.disabled = false; this.style = { setProperty() {} }; this.listeners = {} }
  set textContent(v) { this._t = v; if (v === '') this.children = [] }
  get textContent() { return this._t }
  append(...c) { this.children.push(...c) }
  setAttribute(k, v) { this.attrs[k] = v }
  addEventListener(k, f) { this.listeners[k] = f }
}

let now = 0
let timers = []
let seq = 0
const ctx = {
  document: { createElement: (t) => new El(t) },
  Date: { now: () => now },
  setTimeout: (f, ms) => { const id = ++seq; timers.push({ id, at: now + ms, f }); return id },
  clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id) },
  setInterval: () => 0,
  Promise, console
}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8') + '\nthis.RelayPanel = RelayPanel', ctx)

async function advance(ms) {
  const end = now + ms
  for (;;) {
    timers.sort((a, b) => a.at - b.at)
    const t = timers[0]
    if (!t || t.at > end) break
    timers.shift(); now = t.at; t.f()
    await new Promise((r) => setImmediate(r))
  }
  now = end
  await new Promise((r) => setImmediate(r))
}

const tiles = (root) => Object.fromEntries(root.children.map((b) => [b.children[0].textContent, b.className.replace('relay ', '') + '|' + b.children[1].textContent]))

async function main() {
  const out = {}
  const sent = []
  let release = []                       // pending sends, resolved by the test
  const root = new El('div')
  const p = ctx.RelayPanel(root, (id, on) => { sent.push([id, on]); return new Promise((r) => release.push(r)) })
  p.update([{ id: 'light', name: 'light', on: false }, { id: 'fan', name: 'fan', on: false }, { id: 'light6', name: 'light6', on: null, available: false }])
  out.initial = tiles(root)

  // 1. Five taps inside the settle window: one command, the last tap's state (on).
  for (let i = 0; i < 5; i++) { p.tap('light'); await advance(40) }
  await advance(200)
  out.five_taps_sent = sent.slice()
  out.waiting = tiles(root).light
  // 2. A tap while that command is in flight is held, then sent when it returns.
  p.tap('light'); await advance(200)
  out.during_flight_sent = sent.length
  release.shift()(); await advance(10)
  out.after_release_sent = sent.slice()
  release.shift()(); await advance(10)
  // 3. The board confirms off (the last tap): tile settles, no longer amber.
  p.update([{ id: 'light', name: 'light', on: false }])
  out.confirmed = tiles(root).light
  // 4. Two taps that net to no change send nothing.
  sent.length = 0
  p.tap('fan'); await advance(50); p.tap('fan'); await advance(300)
  out.netted_sent = sent.length
  // 5. An unavailable channel ignores taps.
  p.tap('light6'); await advance(300)
  out.unavailable_sent = sent.length
  // 6. No confirmation within 6 s: says so instead of showing on.
  p.tap('fan'); await advance(200); release.shift()(); await advance(6500)
  p.update([{ id: 'fan', name: 'fan', on: false }])
  out.unconfirmed = tiles(root).fan
  // 7. A failed send shows the error, not a state.
  p.update([{ id: 'fan', name: 'fan', on: true }])
  const froot = new El('div')
  const failing = ctx.RelayPanel(froot, () => Promise.reject(new Error('token refused')))
  failing.update([{ id: 'light', name: 'light', on: false }])
  failing.tap('light'); await advance(300)
  out.failed = tiles(froot).light
  console.log(JSON.stringify(out))
}
main().catch((e) => { console.error(e); process.exit(1) })
