# Phone access: JARVIS from the phone, served by the laptop (2026-10-14)

## Question

I want to use my phone (OnePlus Nord 5, Android, Chrome) to use JARVIS. JARVIS keeps
running on the laptop; the phone is a remote for it, anywhere in the house. From the
phone I want to tap or say "light on/off", talk to him, and see the tiles. How do I
serve that safely, how does the microphone work from a phone browser, and what is the
smallest set of installs?

## Answer in three lines

1. **Now, no installs:** switch on Connect, Phone. The laptop also serves `/phone` on the home Wi-Fi (port 8778). Pair by QR, then the light and fan tiles and typing work. One admin PowerShell line opens the firewall.
2. **For the microphone (and from outside the house):** Tailscale on the laptop and the Nord 5, HTTPS on in its admin console, `tailscale serve --bg --https=443 http://127.0.0.1:8778`. That gives a real certificate on `https://<laptop>.<tailnet>.ts.net`, so Chrome gives the page the mic, with no CA to install on the phone.
3. **Avoid** self-signed certificates, mkcert on Android and the `unsafely-treat-insecure-origin-as-secure` flag for daily use. Each one either keeps showing a warning, depends on untrusted-CA behaviour I could not confirm, or is a developer switch that is easy to forget.

## Findings

### 1. Serving on the LAN without opening the house

| Concern | What the app does now | Why |
|---|---|---|
| Bind address | A **second** listener, only when switched on, on the laptop's private IPv4 addresses (RFC 1918 and Tailscale's 100.64/10) plus 127.0.0.1 for Tailscale Serve. Never 0.0.0.0. The desktop's 127.0.0.1 listener and its per-launch token are unchanged. | A public or VPN interface never gets the port. The desktop window keeps its own path. |
| Which listener a request came in on | Read from the socket (ASGI `scope["server"]`), never from a header. | A client can write any Host header but cannot change the socket it connected to. |
| Host check | The listener's own `ip:port` values, plus addresses he adds (his ts.net name). | Stops DNS rebinding, as on the desktop. |
| Peer check | Private, loopback or Tailscale peers only. | Defence in depth if a router forwards the port by mistake. |
| Routes | Only `/phone`, `/api/phone/*`, `/ws/phone` and `/api/health` exist on the phone listener. Everything else returns 404 there, even with the desktop token. | The memory archive (friends' messages), Mission data, Away mode and settings never reach the network. |
| Pairing | The desktop shows a QR code and an 8-character code (31-symbol alphabet with no 0/O/1/I/L, 31^8 ≈ 8.5e11). The code lasts 5 minutes and works once. It is burned after 5 wrong tries, and each address gets 6 tries a minute. | Brute force is pointless. |
| Per-device token | 256 random bits in an **HttpOnly, SameSite=Strict** cookie (`Secure` over https). Only its SHA-256 is stored, in `data/app/phone/devices.json` (git-ignored). At most 8 phones. | The page's JavaScript cannot read the token, and the file alone opens nothing. |
| Revocation | Connect, Phone, Remove. The next request gets a 401, and the phone's open WebSocket is closed with code 4401 at once. The phone can also "Forget this phone". | Tested both ways. |
| CSRF | SameSite=Strict, **plus** a required `X-Jarvis-Phone: 1` header on every change. A cross-site form cannot send that header without a CORS preflight, which is never granted. When the browser sends an Origin, it must name the same host. WebSockets need a same-host Origin (blocks cross-site WebSocket hijacking). | Chrome's Local Network Access prompt (from Chrome 138 opt-in, reported default around 142) is another layer on top, but it does not gate WebSockets yet, so the app does its own checks. |
| Rate limits | Per device: 240 calls a minute, 20 voice clips, 30 voice replies. Pairing: 6 tries a minute per address. Clips are capped at 8 MB. | |
| Page hardening | CSP `default-src 'self'`, no inline script, `frame-ancestors 'none'`, `no-referrer`, `nosniff`. The pairing code arrives in the URL **fragment** (never sent to a server) and is removed from the address bar. | |

### 2. The microphone problem

`getUserMedia()` is limited to **secure contexts**. A secure context is https, `file://` or localhost. On `http://192.168.x.x` Chrome leaves `navigator.mediaDevices` undefined (MDN; Chromium's "powerful features on insecure origins" list includes getUserMedia). So over plain LAN http the phone gets tiles and typing, but no mic. The page says so and disables the button.

| Option | Mic works? | Cost and caveats |
|---|---|---|
| **Tailscale Serve** (`tailscale serve --bg --https=443 http://127.0.0.1:8778`) | Yes. A real Let's Encrypt certificate for `<machine>.<tailnet>.ts.net`, so it is a secure context. | Install Tailscale on the laptop and the phone. Turn on HTTPS certificates for the tailnet (the CLI walks through it). Serve only proxies to `http://127.0.0.1:<port>` (documented), which is why the phone listener also binds loopback. `--bg` survives reboots. It is reachable from the tailnet only (Funnel would be public: not used). It works from **outside the house** too. The free Personal plan is enough. Battery reports vary from about 1 % over 10 days to 7-15 % a day; drain depends on traffic, and the default split tunnel is reported as unnoticeable. |
| `tailscale cert` → files → Connect "Use" (cert/key) | Yes, on `https://<name>.ts.net:8778`. | The same install. The certificate lasts 90 days and **I renew it myself** (`tailscale cert` again). Serve renews by itself, so Serve is better. |
| mkcert CA installed on Android | Probably. mkcert's README covers Android only for apps that opt in to user CAs. Whether stock Chrome trusts a user-installed CA is **not confirmed** by any source I found (reports conflict). | Install mkcert. Copy `rootCA.pem` to the phone. A CA whose private key lives on the laptop can sign any site for that phone, which is a real risk if the key leaks. Test on the Nord 5 before trusting it. |
| Self-signed certificate | Unreliable. After "Proceed anyway" the page counts as secure for some APIs, but features are neutered (a 2017 Chromium note on PaymentRequest). Service workers refuse to register. | A warning every time, and no proper install as an app. |
| `chrome://flags/#unsafely-treat-insecure-origin-as-secure` with `http://<laptop-ip>:8778` | Yes. | A developer flag, per origin, reset when the IP changes. Chromium documents the command-line form as needing root on Android; the flags page itself works without root. Fine for one test, not for daily use. |
| No mic: tap and type | n/a | What works today with no installs. |

### 3. Audio path: phone → laptop STT → reply

`MediaRecorder` with `audio/webm;codecs=opus` (checked with `isTypeSupported`, falling back to ogg and then mp4), 32 kb/s, tap to start and tap to send (45 s cap). The clip is POSTed to `/api/phone/hear` and written to `data/app/phone/inbox/<random>.webm`. The app sends JARVIS (the child process) `{"type":"hear","path":…}`. His **already loaded** Whisper large-v3-turbo transcribes it (faster-whisper decodes webm through PyAV, which is in the venv). Then `appio.queue_say(text)` puts the text in line exactly like a typed desktop message, and the file is deleted. No second Whisper is ever loaded (VRAM ceiling: 6 GB card). In text mode there is no Whisper, so the phone is told to type or wake him in voice mode.

The reply reaches the phone as the same `turn` and `reply_chunk` events the desktop sees. With "Speak his replies on this phone" checked, the phone fetches `/api/phone/speech?text=` (the chosen voice, made by the same `preview_audio` as Connect's voice preview) and plays it. In voice mode he **also** speaks on the laptop.

### 4. Latency over Wi-Fi

- Measured on loopback through the phone listener (virtual room): toggling a light **6.1 ms median, 7.2 ms p90**. `/api/phone/state` 3.7 ms. A home Wi-Fi hop adds a few milliseconds. With the Uno connected, the board's confirmation dominates (uno.py waits up to 1.5 s for the reply).
- A 5 s clip at 32 kb/s is about 20 KB, so the upload is negligible on Wi-Fi.
- Spoken turns are dominated by what already exists: his measured first-word latency is **4.12 s median, 8.09 s p90** (2026-10-13-connect-and-system.md). On the phone add the recording stop (the tap) plus Edge TTS synthesis of the **whole** reply when speaking on the phone (the laptop speaks sentence by sentence).
- The page is **21.8 KB** (index.html 8.6 KB + app.js 13.2 KB), with no libraries. The desktop QR is drawn server-side in 20 ms (pure Python, `app/jarvis_app/qr.py`: no QR package was installed and none was downloaded).

### 5. Battery (phone)

There is no polling. One WebSocket is open only while the page is visible: it closes on `visibilitychange` and the state is re-read when the page returns. Mic level events (12 Hz on the desktop) are **not** sent to the phone. The mic is open only between the two taps.

### 6. Install as an app (PWA)

The manifest has `name`, `start_url` `/phone`, `display: standalone`, and 192 and 512 px icons (from `app/assets/jarvis.png`). Chrome's install criteria need **https**, those manifest fields, and some engagement (a tap and 30 s on the page). Over Tailscale https it installs as an app. Over plain http, "Add to Home screen" makes a shortcut, which is enough for the tiles. No service worker: the page is useless offline, because the laptop is the server.

### 7. Windows Firewall (I run this; the app never touches system settings)

In an **admin** PowerShell, once:

```powershell
New-NetFirewallRule -DisplayName "JARVIS phone (TCP 8778)" -Direction Inbound -Protocol TCP -LocalPort 8778 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

- `-Profile Private`: the home Wi-Fi must be a *Private* network (`Get-NetConnectionProfile` shows it). On a Public network the rule does not apply, which is the point.
- `-RemoteAddress LocalSubnet`: only devices on the same subnet. Tailscale Serve does not need this rule, because it forwards on loopback.
- When the listener first binds a LAN address, Windows may also show its own "allow python.exe" dialog. Allow it for **Private** networks only, or Cancel and rely on the rule above.
- To remove it: `Remove-NetFirewallRule -DisplayName "JARVIS phone (TCP 8778)"`.

### 8. Laptop sleep

If the laptop sleeps, the phone cannot reach it. Over Tailscale the phone shows "reconnecting". The documented controls are mine to choose, and the app does not change them: `powercfg /change standby-timeout-ac 0` (never sleep on AC) and the lid-close action. On Modern Standby laptops, "network connectivity in standby" can be set to connected (`powercfg /a` shows which kind this laptop is).

## What I built (app, behind the switch)

- `app/jarvis_app/phone.py`: the switch (saved in `data/app/phone/config.json`; `JARVIS_PHONE=1/0` overrides it, `JARVIS_PHONE_PORT` moves the port), addresses, device store (hashed), pairing, rate limits, the guard, and the second uvicorn server on the app's own event loop with lifespan off (so it never boots the hub, the Uno or JARVIS a second time). A long-lived lifespan task owns the listener. A first version started it inside the PUT request, and the middleware's task group killed it once the response was sent: connections then timed out. Caught by the real-socket test.
- `app/jarvis_app/routes_phone.py`: the desktop `/api/remote*` routes, the phone page and its API, and `/ws/phone` (room, JARVIS's state and turns only).
- `app/jarvis_app/phone_page/`: the phone page, script, manifest and icons.
- `app/jarvis_app/qr.py`: a byte-mode, level-M QR encoder for versions 1-10. It is checked against the Thonky "HELLO WORLD" codewords, the format bits for M with masks 0 and 5, and the version 7 and 10 bits, and every test symbol is decoded back by an independent reader in the test.
- `server.py` middleware: the phone listener gets phone rules. `security.py`: the desktop sockets refuse the phone listener. `desktop.py`: the desktop port never takes the phone port.
- Core: `appio.queue_say`, plus a `hear` command in `jarvis.py` that uses the loaded Whisper.
- UI: Connect 05.4 Phone shows the switch, addresses, QR code and countdown, paired phones with Remove, the firewall line, the Tailscale line, extra addresses, and cert/key paths.

## Sources

- MDN, getUserMedia (secure contexts): https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Can I use, getUserMedia secure context: https://caniuse.com/mdn-api_mediadevices_getusermedia_secure_context_required
- Chromium, deprecating powerful features on insecure origins (flag, Android root note): https://www.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins
- SEPIA docs, treat a local IP as a secure origin: https://github.com/SEPIA-Framework/sepia-docs/wiki/Set-up-web-browser-to-treat-your-local-IP-as-secure-origin
- Tailscale Serve: https://tailscale.com/docs/features/tailscale-serve
- tailscale serve CLI (`--bg`, `--https`, loopback-only proxies, reset/status): https://tailscale.com/docs/reference/tailscale-cli/serve
- Tailscale cert / HTTPS walkthrough: https://docs.openwebui.com/reference/https/tailscale
- Tailscale pricing (Personal plan): https://tailscale.com/pricing/
- Battery reports (community, anecdotal): https://dbushell.com/2022/08/18/tailscale/
- mkcert README (Android, user roots): https://github.com/FiloSottile/mkcert
- Android trusted-certificate changes (Nougat): https://android-developers.googleblog.com/2016/07/changes-to-trusted-certificate.html
- Proceeding past certificate errors neuters APIs (W3C thread): https://lists.w3.org/Archives/Public/public-webpayments-specs/2017Dec/0125.html
- Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access
- web.dev install criteria: https://web.dev/articles/install-criteria
- MDN MediaRecorder.isTypeSupported: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
- New-NetFirewallRule: https://learn.microsoft.com/powershell/module/netsecurity/new-netfirewallrule
- Modern Standby network connectivity: https://www.elevenforum.com/t/enable-or-disable-modern-standby-network-connectivity-in-windows-11.3286/
- Disable sleep on AC (powercfg): https://level.io/library/scripts/script-windows-disable-sleep-on-ac-power
- Project Nayuki QR generator (algorithm reference): https://www.nayuki.io/page/qr-code-generator-library

## What it changed

The plan became: build the no-install path now (tiles and typing over LAN http, pairing, revocation) and make the mic one install away (Tailscale Serve). I dropped mkcert and self-signed certificates as the default path. Nothing touches the firewall or power settings; the exact commands are here and in the Connect card.
