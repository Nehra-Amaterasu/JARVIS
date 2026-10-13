# Audit: link 2 (the phone as a second Wi-Fi transmitter), firmware 3.3.0

Date: 2026-10-13. Auditor: an independent reviewer agent, working read-only. Subject: the "link 2"
worker's firmware and host changes, compiled but **not flashed**.
Core checked: Arduino-ESP32 3.3.12 (esp32s3-libs 3.3.12, ESP-IDF v5.5.5).

## What was built (from the transcript and the working tree)

- `firmware.ino` (v3.3.0):
  - A `/beacon` page (`beacon_page.h`) records the phone's IP.
  - A second `esp_ping` session pings the phone at `BEACON_PING_HZ` 100 (`config.h`).
  - The board learns the phone's MAC from lwIP's ARP table under `LOCK_TCPIP_CORE`.
  - Promiscuous receive is on only while a phone is registered.
  - The CSI callback checks the phone's MAC first. Link 1 gains a filter that keeps only frames whose destination (`dmac`) is this board or a group address, and only while promiscuous receive is on.
  - Link 2 has its own queue and a capture cap of 2x the ping rate.
- New frame type `CSI_LINK = 0x08`: a link id byte plus a 20-byte meta-and-gain head, 21 bytes in all, followed by the CSI buffer. It is defined in both `aankhen_protocol.h` and `protocol.py`.
- Host:
  - `CsiLinkPacket` is deliberately not a `CsiPacket`.
  - `aankhen/links.py` is a per-link conditioning bank.
- Compile: OK. 932,765 B (71 %), against a 918,729 B baseline. Globals 47,056 B. The only warnings are the `-Wvolatile` kind the existing code already produces.

## Verdicts

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Promiscuous receive can run while connected as a station | TRUE | `esp_wifi_set_promiscuous(bool)` (esp_wifi.h:941) has no mode restriction. The code checks the return value and backs out. |
| 2 | The CSI callback fires for overheard frames not addressed to the board | TRUE in practice, UNVERIFIED on this board | The headers do not state it. Passive CSI sniffing is built on exactly this (promiscuous + CSI enabled). It needs proof on the real board. |
| 3 | `wifi_csi_info_t.mac` is the transmitter | TRUE (header says "source") | esp_wifi_types_native.h:119 `mac[6]` "source MAC address", :120 `dmac[6]` "destination". On the uplink, the phone is the transmitter. |
| 4 | `dmac` is filled in for promiscuous CSI | UNVERIFIED, and the main risk | If it reads as zeros, the new link-1 filter drops every router frame while a phone is registered. A runtime fallback has been requested. |
| 5 | The ARP lookup is thread-safe | TRUE | sdkconfig: `CONFIG_LWIP_TCPIP_CORE_LOCKING=y`, `CONFIG_LWIP_CHECK_THREAD_SAFETY=y`. The lookup runs from the loop task, not the tcpip thread, so it cannot deadlock. The MAC is copied out under the lock, and the code refuses to build without core locking. |
| 6 | The phone answers at 100 Hz | FALSE as a promise; it is a ceiling | `esp_ping` is sequential, so the real rate is about 1000 / round-trip ms. Phone power save buffers frames until the phone wakes. Expect 20-100 Hz, and lower on iPhones. The STATUS field `beacon.pings_ok` gives the real number. |
| 7 | MAC randomisation breaks it | FALSE | The MAC is learned at run time from ARP. A changed MAC is re-learned through a second slot. Per-network private addresses are stable. A rotating one costs a re-registration, not a failure. |
| 8 | Airtime cost | About 6-10 % of the channel for link 2, on top of link 1's 15-25 % | Each ping is 4 frames over the air (the worker's own estimate, which is sound). Video calls feel it first. |
| 9 | The old host is backward compatible | PARTLY | The old decoder sees 0x08 as a bad header and resyncs 1 byte at a time (protocol.py:409-411). It drops the frame, does not crash, and link-1 frames survive. `bytes_skipped` goes up, though. **The host must be updated before this firmware is flashed.** |
| 10 | The engine ignores `CsiLinkPacket` | TRUE by design | The engine dispatches on `isinstance(pkt, CsiPacket)`. The proving test (`test_links.py`) did not exist yet at audit time. See the test run below. |
| 11 | Compiled, and the sketch size | TRUE | 932,765 B (71 %). Not flashed. |
| 12 | It works when the phone is on 5 GHz | FALSE | The ESP32-S3 has a 2.4 GHz radio only. The beacon page detects "answering, but not heard" and says so. |
| 13 | It works with a Wi-Fi 6 phone on a Wi-Fi 6 router | FALSE, and unhandled | The S3 is 802.11b/g/n only. A phone's 2.4 GHz uplink sent as 802.11ax (HE) frames cannot be decoded, so no phone CSI. A fix to the page and README text has been requested. |

## Value, judged honestly

The board's clock and the phone's are not synchronised, and there is one receive antenna. So a second link
adds **no coordinates, no range, and no angle**. Neither does phase across the two links. What it does add:

- A **second propagation path** through the room, with different geometry. Motion that link 1 barely sees
  (outside its Fresnel zone) can show up on link 2. This gives **better coverage** and **richer fingerprints**
  for the learned "where am I" models. More views make room-zone classification more separable.
- **Doppler-like motion energy from a second direction.** Amplitude dynamics per link are usable. Combining
  the two into one velocity vector is not possible without synchronisation.
- It depends on the phone staying put, plugged in, with the page open. Moving the phone invalidates any
  fingerprint trained with it.

## Three perspectives

- **CEO: worth flashing?** Yes, as an experiment, once the host update ships and the link-1 fallback is in. The
  upside is real: a second view for the learned models, at no hardware cost. Expect "helps the zone
  classifier" rather than "new capability".
- **Senior engineer: correct and safe?** Mostly. The locking is right, the queues are separate, every drop is
  counted, and the build is clean. Open points: an unproven assumption about `dmac` with no runtime guard;
  no promiscuous filter (`WIFI_PROMIS_FILTER_MASK_DATA`) to cut the neighbours' management traffic;
  `test_links.py` still pending.
- **Realist: works in a real home with a real phone?** Only if the phone is on **2.4 GHz** and **not sending
  802.11ax**. Many 2026 homes band-steer phones to 5 GHz and run Wi-Fi 6 on 2.4 GHz. The likeliest first
  result is "answering, but not heard". Expect an effective rate below 100 Hz.

## Steering sent to the worker (1 message)

1. Add a link-1 fallback: if link 1's capture rate falls below 50 % of its pre-promiscuous rate for 3 s, turn
   promiscuous receive off and report it in STATUS.
2. Add the Wi-Fi 6 (802.11ax on 2.4 GHz) cause to the "not heard" page text and to the README.
3. Set `WIFI_PROMIS_FILTER_MASK_DATA` before enabling promiscuous receive.
4. Write the README so that 100 Hz reads as a ceiling, not a rate (1000 / round-trip time, and power save).

## Safe to flash as is?

**Not yet.** It is unlikely to crash the board. The risk is a silent link-1 blackout while a phone is
registered, if `dmac` is not populated. Flash after the fallback in steering point 1 lands and the host
decoder knows 0x08. On first boot, watch link 1's rate in STATUS before and after opening `/beacon`.

## Test run

`python -m pytest aankhen/tests -q`: **271 passed** in 8 min 55 s. The baseline before these changes was 264.
`test_links.py` appeared during the run, after collection had started, so it may not be among the 271. The
test that proves the engine ignores `CsiLinkPacket` must be re-run once the worker finishes.

## Follow-up after the worker's reply (same day)

- **Link-1 guard: done and verified in the code.** `guardLink1()` (firmware.ino:443) runs once a second while
  promiscuous receive is on. It arms only if link 1 was running at 20 Hz or more before promiscuous receive
  was switched on. If link 1 then falls below 0.5x that rate for 3 consecutive seconds, it calls
  `setPromiscuous(false)` and sets `beaconFallback`. That flag stops promiscuous receive from being switched
  back on, and STATUS reports it. This closes the main risk: in the worst case link 1 is out for about 3 s,
  not for as long as the phone is registered.
- **Wi-Fi 6 text: done.** It is in the beacon page (`beacon_page.h:89`) and the README.
- **Promiscuous filter: declined, and the reason is sound.** The headers document the filter only for the
  promiscuous rx callback. A data-only mask could change what link 1 gets today. It is now a hardware
  experiment instead.
- **Tests:** the worker reports `test_links.py` (10 tests) plus 7 new protocol tests, 38/38 passing.
- **Pre-existing bug reported by the worker:** `__has_include` does not trigger arduino-cli library discovery,
  so `AK_GAIN_CTRL` is 0 even when the gain library is installed. Gain compensation is off on both links
  today.

**Revised verdict: safe to flash**, with two conditions. First, the updated host (which knows 0x08) runs
first. Second, on first boot, compare link 1's rate before and after opening `/beacon`, and check that
`beacon.fallback` stays false.
