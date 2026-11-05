# JARVIS on the phone over mobile data: a Cloudflare named tunnel behind Access

What you get: the JARVIS phone app at `https://<name>.<your domain>/phone` from anywhere.
Cloudflare asks for your email and a one-time code first, then JARVIS asks for the phone's
pairing. The laptop must be on: the board is reached **through the laptop**, so laptop
off + mobile data = no control (on the home Wi-Fi the board's own page still works).

```
phone (mobile data) ─▶ Cloudflare Access (email + one-time code)
                     ─▶ tunnel ─▶ cloudflared on the laptop ─▶ 127.0.0.1:8778 (phone listener)
                                                               never :8777 (the desktop window)
```

## Why each piece (decided 6 Nov, plan WP3)
- **Named tunnel, not a quick tunnel:** a quick tunnel (`*.trycloudflare.com`) gets a new
  address every run and cannot have an Access policy. JARVIS refuses a quick-tunnel address.
- **Only port 8778:** the phone listener serves `/phone`, `/api/phone/*` and `/ws/phone`, nothing
  else (phone.py). 8777 is the desktop window with every route; the generated config can
  never point at it (a test checks this).
- **Access in front, pairing behind it:** two locks. Access stops strangers from reaching even
  the pairing page; the pairing cookie (HttpOnly, SameSite=Strict, Secure through the tunnel)
  says which phone it is and can be revoked from Connect → Phone.
- **Fails closed:** a request on the tunnel's hostname without Cloudflare's Access header is
  refused by JARVIS (403), so a tunnel left without an Access policy shows nothing.
  cloudflared also checks the header's signature (`originRequest.access` below).

## Steps (once, about 20 minutes)
You need a domain on Cloudflare (any cheap one; its DNS must be on Cloudflare).

1. **Install cloudflared** (Windows): `winget install --id Cloudflare.cloudflared`.
2. **Log in and make the tunnel** (PowerShell):
   ```
   cloudflared tunnel login
   cloudflared tunnel create jarvis
   cloudflared tunnel route dns jarvis jarvis.<your domain>
   ```
   `create` prints the tunnel ID and writes `%USERPROFILE%\.cloudflared\<ID>.json`.
3. **Access policy** (Cloudflare dashboard → Zero Trust; the free plan covers up to 50 users):
   - Settings → Authentication: the **One-time PIN** login method (built in).
   - Access → Applications → Add → Self-hosted: domain `jarvis.<your domain>`.
     Policy: Allow, Include → Emails → your email only. Session duration: e.g. 1 month.
   - Copy the application's **AUD tag**, and note your team name (`<team>.cloudflareaccess.com`).
4. **Tell JARVIS the address:** Connect → Phone → tunnel `https://jarvis.<your domain>`
   (or `PUT /api/remote {"tunnel": "https://jarvis.<your domain>"}`). Phone access must be on.
   The Phone panel's `cloudflared_yml` is now the config, with the right port filled in.
5. **Config for the service** (it runs as SYSTEM and reads the system profile, not yours):
   copy `<ID>.json` and `cert.pem` from `%USERPROFILE%\.cloudflared\` to
   `C:\Windows\System32\config\systemprofile\.cloudflared\`, and save `cloudflared_yml` there as
   `config.yml`, replacing `<TUNNEL-ID>`, `<team>` and the AUD tag. It looks like:
   ```yaml
   tunnel: <TUNNEL-ID>
   credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL-ID>.json
   ingress:
     - hostname: jarvis.<your domain>
       service: http://127.0.0.1:8778
       originRequest:
         httpHostHeader: jarvis.<your domain>
         access:
           required: true
           teamName: <team>
           audTag:
             - <application AUD tag>
     - service: http_status:404
   ```
   Check it: `cloudflared tunnel --config <that path> ingress validate`.
6. **Run it as a Windows service** (admin PowerShell):
   ```
   cloudflared.exe service install
   ```
   Then in `regedit`, `HKLM\SYSTEM\CurrentControlSet\Services\Cloudflared`, set `ImagePath` to
   `"C:\Program Files (x86)\cloudflared\cloudflared.exe" --config C:\Windows\System32\config\systemprofile\.cloudflared\config.yml tunnel run`
   (use the path winget installed it to), and `sc start cloudflared`. After a config change:
   `sc stop cloudflared` then `sc start cloudflared`.
7. **Pair the phone through the tunnel:** on the laptop, Connect → Phone → new code with the
   tunnel address selected; on the phone (mobile data), open the link, pass the email code,
   then the pairing code. Switch a relay: the tile goes amber, then cyan when the board confirms.

## The board's own page (home Wi-Fi, laptop off)
`http://<board address>/` serves a small page generated from the same app
(`python -m jarvis_app.board_page` → `aankhen/firmware/web_page.h`). If it can reach JARVIS
it opens the app; otherwise it shows **Relays only**, talking to the board with the relay
token (`RELAY_TOKEN_VALUE` in secrets.h, at least 16 characters, typed once per phone).
To make it find JARVIS, open it once as `http://<board address>/#jarvis=https://jarvis.<your domain>`
(or type the address under Settings). Add `#stay` to stay on the relays view.

## Honest limits
- Laptop off + mobile data: no control. The board is not on the internet, by design.
- The board page and its token travel as plain HTTP on the home Wi-Fi.
- Voice needs HTTPS: through the tunnel it works; on the LAN address only with a certificate.
