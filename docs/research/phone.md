# Phone: running log (newest first)

Earlier phone notes: [2026-10-14-phone-access.md](2026-10-14-phone-access.md) (the second
listener, pairing, Tailscale).

## 2026-11-06: one phone app, a board page built from it, and mobile data through Cloudflare (plan WP3)

**Question.** How does one phone app control the wall box with the laptop on (full JARVIS),
on home Wi-Fi with the laptop off (board only), and over mobile data, without opening mains
switching to the internet or to any web page on the LAN?

**What was wrong (review of 6 Nov, Antigravity's uncommitted work).**
- `web_page.h` was a separate hand-written page holding the laptop's LAN address. It called the
  desktop API `/api/limbs` cross-origin (the desktop listener refuses that) and switched relays
  with `/relay?ch=..&on=..` and no token.
- The phone page drew invented sensor data: a "RADAR" tab, random CSI bars (`Math.random`),
  fixed "500 Hz", "HMAC-SHA256 OK" and "-72 dBm" text.
- Tiles were drawn from the app's saved state, and every tap sent a command.

**What was built.**
- `phone_page/relays.js` + `relays.css`: one relays-only view. The JARVIS app links it; the board's page
  inlines it (`jarvis_app/board_page.py` → `aankhen/firmware/web_page.h`, 13,707 B; a test
  fails if the header differs from the generator's output).
- Tap rules, run under Node in `test_board_page.py`:
  - 150 ms settle, then the last tap wins (5 taps in 200 ms → 1 command);
  - one command per relay in flight, and a tap made during it is sent afterwards;
  - taps that net out send nothing;
  - amber until the board's report matches, "not confirmed" after 6 s.
  - Found while testing: comparing a tap made during a flight with the board's stale report
    lost "on then off". The view now compares with the unconfirmed command (`sent`).
- The board page tries JARVIS with a `no-cors` request to `/api/health`, which reads nothing,
  so JARVIS needs no CORS. If it answers, the page opens `/phone`; otherwise it shows relays-only
  with the board token (localStorage, typed once per phone). It holds no addresses: the JARVIS
  address comes from `#jarvis=` or Settings.
- The board HTTP contract was sent to WP1, which owns firmware.ino:
  - POST-only `/relay` with `X-Aankhen-Token` (503 when no token is compiled in);
  - the reply carries `target` and `on`;
  - `/status` is full only with the token;
  - no CORS anywhere.
- Aankhen tab: only the hub's own fields (source, motion, the learned guess shown as
  "Predicting", frame count, loss). A non-hardware source is labelled "not measured".

**Cloudflare (sources below).**
- cloudflared can check the Access JWT itself: `originRequest.access.required/teamName/audTag`.
- `httpHostHeader` sets the Host sent to the origin. The docs do not say what the default is,
  so the generated config pins it to the tunnel name, which the phone allow-list matches.
- The Windows service reads `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`.
  Install it with `cloudflared service install`, then point `ImagePath` at the config.
- The free Zero Trust plan covers up to 50 users, and the One-time PIN (email code) login is
  built in. With OTP, write policies on emails, not IdP groups.
- JARVIS side:
  - a `tunnel` setting (https only, no port; `*.trycloudflare.com` refused);
  - the tunnel host joins the allow-list;
  - a tunnel-host request without `Cf-Access-Jwt-Assertion` gets 403, so a tunnel missing its
    Access policy fails closed;
  - the WebSocket gets the same check;
  - the generated `cloudflared_yml` targets `127.0.0.1:<phone port>` and refuses the desktop port.
- Owner steps: [../phone-cloudflare.md](../phone-cloudflare.md).

**Honest limit.** Over mobile data the board is reached through the laptop: laptop off +
mobile data = no control.

**Sources.**
- Origin parameters (httpHostHeader, access): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/
- Run as a service on Windows: https://developers.cloudflare.com/tunnel/advanced/local-management/as-a-service/windows/
- Free plan, 50 users: https://blog.cloudflare.com/teams-plans
- OTP and free plan, third-party summary (verify on Cloudflare's pricing page): https://costbench.com/software/business-vpn/cloudflare-zero-trust/free-plan/

**What it changed.** The phone page, `web_page.h` and the phone guard (phone.py) were rewritten;
the firmware routes are WP1's.
