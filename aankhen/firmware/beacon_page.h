// The /beacon page: what the phone that becomes link 2 shows (firmware.ino, LINK 2).
//
// Plain HTML and JavaScript with no external resources: the board has no internet to
// offer, and a page that loads nothing else behaves the same on Android Chrome and iOS
// Safari. It:
//   - registers the phone and re-registers it every 1.5 s (POST /beacon/beat). The
//     beats also keep the phone's Wi-Fi out of power save, and the board stops pinging
//     a phone whose beats stop (BEACON_LOST_MS, 6 s);
//   - keeps the screen on with the Screen Wake Lock API where the browser offers it.
//     Browsers offer it only to https pages ([SecureContext]) and the board serves
//     plain http, so on most phones the page asks for the phone's own setting instead;
//   - releases the board the moment it is closed (POST /beacon/bye);
//   - is black, which an OLED phone barely lights, and drifts by up to 7 px over ten
//     minutes, so hours of the same picture do not burn into the screen.
// The rate shown is the board's own count of link-2 captures per second; "Link on"
// needs 80 % of the ping rate, the share of real samples the host's human-band test
// asks of a window (motion.py HBE_MIN_REAL).
#pragma once

static const char BEACON_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<title>Aankhen &middot; second link</title>
<style>
:root{--fg:#cfd8dc;--dim:#5f6b70;--on:#4fd1c5;--wait:#d9a85b;--off:#5f6b70}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;color:var(--fg)}
body{display:flex;align-items:center;justify-content:center;overflow:hidden;
 padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));
 font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 -webkit-text-size-adjust:100%;-webkit-user-select:none;user-select:none}
.on{--c:var(--on)}.wait{--c:var(--wait)}.off{--c:var(--off)}
main{width:100%;max-width:360px;text-align:center;animation:drift 600s linear infinite}
#name{color:var(--dim);font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:40px}
.ring{width:132px;height:132px;margin:0 auto 34px;border-radius:50%;border:1px solid var(--c);
 display:flex;align-items:center;justify-content:center;transition:border-color 1s}
.dot{width:10px;height:10px;border-radius:50%;background:var(--c);transition:background 1s}
.on .ring{animation:breathe 6s ease-in-out infinite}
#rate{font-size:64px;font-weight:200;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
#unit{color:var(--dim);font-size:12px;letter-spacing:.16em;text-transform:uppercase;margin-top:10px}
#state{font-size:20px;margin-top:32px}
#note{color:var(--dim);font-size:14px;margin-top:8px;min-height:4.4em}
#hint{color:var(--dim);font-size:12.5px;line-height:1.6;margin-top:28px}
#band{color:var(--dim);font-size:12px;line-height:1.55;margin-top:10px;opacity:.8}
@keyframes breathe{0%,100%{transform:scale(1);box-shadow:0 0 22px -8px var(--on)}
 50%{transform:scale(1.035);box-shadow:0 0 40px -8px var(--on)}}
@keyframes drift{0%,100%{transform:translate(0,0)}25%{transform:translate(7px,-5px)}
 50%{transform:translate(-6px,6px)}75%{transform:translate(5px,7px)}}
@media (prefers-reduced-motion:reduce){.on .ring{animation:none}}
</style></head>
<body class="off">
<main>
<div id="name">Aankhen &middot; second link</div>
<div class="ring"><div class="dot"></div></div>
<div id="rate">&ndash;</div>
<div id="unit">packets / s</div>
<div id="state">Connecting&hellip;</div>
<div id="note">&nbsp;</div>
<p id="hint">Keep this page open, the phone plugged in and lying still in its spot.</p>
<p id="band">Aankhen hears only Wi-Fi 4 (802.11n) on 2.4 GHz: the router&rsquo;s 2.4 GHz band must run in Wi-Fi 4 mode, or this phone must join a 2.4 GHz-only b/g/n network.</p>
</main>
<script>
(function () {
  var BEAT_MS = 1500, body = document.body;
  var lock = null, timer = 0, inflight = false, pings = -1, quiet = 0;
  function $(id) { return document.getElementById(id); }
  function set(cls, state, note, rate) {
    body.className = cls;
    $('state').textContent = state;
    $('note').textContent = note || ' ';
    $('rate').textContent = rate == null ? '–' : String(rate);
  }
  function render(j) {
    if (!j) { pings = -1; quiet = 0; set('off', 'Can’t reach Aankhen', 'Is this phone on the home Wi-Fi? Trying again…', null); return; }
    if (j.role === 'busy') { pings = -1; quiet = 0; set('off', 'Another phone is the second link', 'This one takes over a few seconds after that page is closed.', null); return; }
    var rate = Math.round(j.rate_hz || 0), want = j.ping_hz || 100;
    var answered = pings >= 0 && j.pings_ok > pings;
    pings = j.pings_ok;
    if (j.fallback) { quiet = 0; set('off', 'Paused to protect link 1', 'Listening for this phone slowed the router link, so Aankhen stopped. Reload this page to try again.', null); return; }
    if (!j.mac_known) { quiet = 0; set('wait', 'Starting…', 'Finding this phone on the Wi-Fi.', null); return; }
    if (rate >= 0.8 * want) { quiet = 0; set('on', 'Link on', 'Aankhen hears this phone.', rate); return; }
    if (rate > 0) { quiet = 0; set('wait', 'Link weak', 'Heard ' + rate + ' of ' + want + ' a second. Keep this page in front; the phone may be saving power.', rate); return; }
    if (answered && !quiet) quiet = Date.now();
    if (quiet && Date.now() - quiet > 5000) {
      set('wait', 'Answering, but not heard', 'This phone answers but Aankhen hears nothing. Aankhen reads only Wi-Fi 4 (802.11b/g/n) on 2.4 GHz: set the router’s 2.4 GHz band to Wi-Fi 4 (802.11n) mode, or put this phone on a 2.4 GHz-only b/g/n network. A Wi-Fi 6 or 7 phone on 5 GHz, or on Wi-Fi 6/7 at 2.4 GHz, cannot be heard.', 0);
    } else {
      set('wait', 'Listening…', 'Waiting for this phone’s first packets.', 0);
    }
  }
  function beat() {
    if (inflight) return;
    inflight = true;
    clearTimeout(timer);
    var ctl = window.AbortController ? new AbortController() : null;
    var guard = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
    function next() { clearTimeout(guard); inflight = false; timer = setTimeout(beat, BEAT_MS); }
    fetch('/beacon/beat', { method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { render(j); }, function () { render(null); })
      .then(next, next);
  }
  function hint(held) {
    $('hint').textContent = held
      ? 'Screen stays on while this page is open. Keep the phone plugged in and lying still in its spot.'
      : 'Keep this page open, the phone plugged in and lying still in its spot. This browser cannot hold the screen on for an http page: turn on Stay awake (Android, Developer options) or set Auto-Lock to Never (iPhone).';
  }
  function awake() {
    if (!('wakeLock' in navigator)) { hint(false); return; }
    if (lock) { hint(true); return; }
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { lock = null; });
      hint(true);
    }, function () { hint(false); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { awake(); beat(); } });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { awake(); beat(); } });
  window.addEventListener('pagehide', function () { if (navigator.sendBeacon) navigator.sendBeacon('/beacon/bye'); });
  document.addEventListener('click', awake);
  awake();
  beat();
})();
</script>
</body></html>)HTML";
