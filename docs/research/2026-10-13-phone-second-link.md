# A phone as Aankhen's second Wi-Fi link (firmware 3.3.0)

2026-10-13. Status: built, compiled, host-tested; **not yet flashed or measured on hardware.**
Companion: `2026-10-13-audit-phone-link.md` (independent review of the same work).

## The idea

Aankhen senses with radio alone. Today it has one path: router → ESP32-S3 (link 1).
A person who does not cross that line barely changes it. A phone left at a fixed spot
on the home Wi-Fi is a second transmitter. The board pings it; the phone's replies go
phone → router, and the board, in promiscuous receive while still connected as a
station, overhears them. Each overheard reply is the CSI of the phone → board path:
link 2, a second viewpoint on the same room. Nothing is installed on the phone: it
opens `http://<board>/beacon`.

## Design

| Piece | Where | What |
|---|---|---|
| Registration page | `aankhen/firmware/beacon_page.h`, `GET /beacon` | Plain HTML/JS, no external resources. Beats `POST /beacon/beat` every 1.5 s (registers and keeps the phone's Wi-Fi out of power save), `POST /beacon/bye` on close, Screen Wake Lock where offered, black and drifting against OLED burn-in. Shows "Link on" and the board's packets/s. |
| Second ping | `firmware.ino`, `startPhonePing` | Second `esp_ping` session to the registered IP, `BEACON_PING_HZ` (config.h, 100), 100 ms timeout. |
| Phone MAC | `arpLookup` / `learnPhoneMac` | `etharp_find_addr` under `LOCK_TCPIP_CORE()`, copied out under the lock; every 100 ms until found, then every 2 s (follows private-address changes). Double-buffered so the Wi-Fi task never reads a half-written MAC. |
| Overhearing | `setPromiscuous`, `onCsi` | Promiscuous receive only while a phone is registered **and** its MAC is known, with a data-frames-only filter (`WIFI_PROMIS_FILTER_MASK_DATA`) so neighbours' beacons and control frames are not handed over. The callback checks the phone's MAC first; neighbours' data frames cost two 6-byte compares. |
| Link 1 unchanged | `onCsi` | With promiscuous on, link 1 keeps only router frames whose `dmac` is this board or a group address, i.e. what the radio passed before. **Guard:** if link 1's rate drops below 50 % of its pre-promiscuous value for 3 s, promiscuous receive goes off for that registration (`beacon.fallback`). |
| Isolation | separate `linkQueue`, cap `2 × BEACON_PING_HZ` | Link 2 cannot crowd link 1 out of the queue or the USB link (a phone's background download would otherwise add ~1,000 TCP-ACK captures/s). |
| One phone at a time | `onBeat` | A second page gets `"busy"` until the first stops beating for 6 s; two transmitters under one link id would poison training data. Only the requester's own TCP source IP is ever pinged. |
| Wire format | `aankhen_protocol.h`, `protocol.py` | New frame type `CSI_LINK = 0x08`. Payload: `link u8` + the 16-byte CSI metadata + the 4-byte gain block + the CSI buffer (header 21 bytes; max payload 661). Host class `CsiLinkPacket`, **not** a `CsiPacket` subclass. Protocol version unchanged (additive type, as `CSI_GAIN` was): a bump would make every older `.akr` unreadable. `AkWriter` sequence counters widened from 8 to 16 slots. |
| Status | STATUS JSON | `"beacon": {"ip","mac_known","pings_ok","rate_hz","rssi","dropped","rejected","fallback"}`. The board's `"ip"` was already there. |
| Host bank | `aankhen/links.py` | `LinkBank`: one `CsiConditioner` per link (same as link 1) plus motion.py's human-band energy every 0.25 s over 3 s; restarts a link on a new transmitter MAC or channel. Integration points are in its docstring. |

## Verified in the installed core (Arduino-ESP32 3.3.12, ESP-IDF v5.5.5)

- `wifi_csi_info_t` has `mac` ("source") and `dmac` ("destination") plus `hdr`
  (`esp_wifi/include/local/esp_wifi_types_native.h`).
- `esp_wifi_set_promiscuous`, `esp_wifi_get_mac`, and the CSI callback contract (the
  record is freed on return; runs in the Wi-Fi task) in `esp_wifi.h`.
- `sdkconfig`: `CONFIG_LWIP_TCPIP_CORE_LOCKING=y`, `CONFIG_LWIP_CHECK_THREAD_SAFETY=y`,
  `CONFIG_ESP_WIFI_CSI_ENABLED=y`, `CONFIG_FREERTOS_HZ=1000`.
- `LOCK_TCPIP_CORE()` in `lwip/port/include/lwipopts.h` marks the holder for the
  thread-safety checker; the core's own `esp32-hal-time.c` uses the same lock. The
  firmware `#error`s if a future core is built without core locking.
- `etharp_find_addr(netif, ip, &eth, &ip_ret)` in `lwip/etharp.h`; it returns a pointer
  into the table, hence the copy under the lock.
- `esp_ping` (`apps/ping/ping_sock.h`): callbacks with `cb_args`, `ESP_PING_COUNT_INFINITE`.
  A generation number in `cb_args` makes late callbacks for an earlier phone harmless.
- `NetworkServer` is dual-stack, but `NetworkClient::remoteIP()` unmaps IPv4-mapped
  addresses; IPv6 clients are refused (the ping is IPv4).
- The host decoder treats an unknown TYPE as a corrupted header (`bad_headers`,
  1-byte resync). **So the host must be updated before 3.3.0 is flashed.** The board
  sends no 0x08 until a phone registers.

Compile: `arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc --libraries
aankhen/firmware/libraries`. Size is in the final work report (~938 KB, 71 % of
1,310,720), against 918,729 B for 3.2.0, which had no gain library. The only warnings
are `-Wvolatile` on `++` of volatile counters, the existing pattern.

Found on the way (pre-existing, now fixed): `#if __has_include(<esp_csi_gain_ctrl.h>)`
never saw an installed Arduino library. arduino-cli finds libraries from missing-include
errors, and `__has_include` raises none; a stub library passed with `--libraries` left
the binary byte-identical. The probe is replaced by `AK_GAIN_LIB` in `config.h`.

Gain library: Espressif `esp_csi_gain_ctrl` 0.1.5 (Apache-2.0) is vendored in
`aankhen/firmware/libraries/esp_csi_gain_ctrl/`: the header, the ESP32-S3 / IDF 5.5
archive, LICENSE and ORIGIN.md with checksums. Its outside symbols resolve in this core
(`phy_force_rx_gain`, `phy_fft_scale_force` are in the core's `libphy.a`, which is
linked with `-lphy`). The build uses `--libraries aankhen/firmware/libraries`; the log
confirms "Using precompiled library ... esp32s3" and `-lesp_csi_gain_ctrl`.

## Risks

1. **`dmac` in promiscuous CSI is undocumented.** If it is not filled, link 1 would
   go dark while a phone is registered. The guard above turns promiscuous receive off
   after 3 s. Measure on hardware first.
2. **Wi-Fi 6/7.** The ESP32-S3 decodes only 802.11b/g/n. A Wi-Fi 6 or Wi-Fi 7 phone
   on a router that offers ax/be on 2.4 GHz sends HE/EHT frames the board cannot read:
   no link-2 CSI even on the right channel. Requirement, stated plainly on the page and
   in the README: the router's 2.4 GHz network runs in Wi-Fi 4 (802.11n) mode, or the
   phone joins a 2.4 GHz-only b/g/n network. Turning ax off on 2.4 GHz affects every
   device on that band.
3. **5 GHz / band steering / mesh nodes / guest networks.** The phone must share the
   board's 2.4 GHz network and channel, and the board must be able to reach it.
4. **Phone power save.** esp_ping is sequential: the real rate is 1000 / RTT, so
   `BEACON_PING_HZ` is a ceiling. A dozing phone gives 20-60 Hz, and below ~80 Hz the
   human-band test skips windows (`HBE_MIN_REAL`). Screen on and the 1.5 s beats keep
   most phones awake, but this is unmeasured.
5. **MAC randomisation.** Phones use private addresses, stable per network but
   rotated on some settings. The ARP lookup every 2 s follows a change, and the host
   restarts the link (new empty room). A new address that also brings a new IP is
   handled by the "busy then take over" rule within ~6 s. A Wi-Fi extender that
   rewrites client MACs would make link 2 the extender, not the phone.
6. **Airtime.** Four frames per ping; at 100 Hz about 6-10 % of the channel, on top of
   link 1's 15-25 % at 500 Hz. Shared by the whole house.
7. **Fan aliasing.** At ~100 Hz link 2 has about one packet per slot, so it lacks link
   1's slot averaging against a ceiling fan's aliases.
8. **CPU load and the data-only filter.** With promiscuous receive on, neighbours' data
   frames still reach the CSI callback; the rejection is cheap, but the driver's
   per-frame cost on a busy channel is unmeasured. The data-only filter is set; the
   headers do not say whether it also gates CSI. If it does, the router's management
   frames to the board (a few beacons a second against 500+ ping replies) leave link 1
   while a phone is registered. Any loss that matters trips the link-1 guard.
9. **Anyone on the LAN can register** (no token). They can only make the board ping
   themselves, and a live registration cannot be taken over.

## Not done (integration)

Engine, eyes view and UI are untouched (another engineer's files). The steps are in
the `aankhen/links.py` docstring: a `CsiLinkPacket` branch in `Engine.process` feeding a
`LinkBank`, link-2 liveness and summary in the status/frame messages, one `EyesBuffer`
per link, and a second `FeatureStream` for the learned models once sessions are
recorded with the phone in place.
