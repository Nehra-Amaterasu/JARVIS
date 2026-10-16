// Aankhen ESP32-S3 firmware v3 — the eyes' sensor board.
//
// What it does, and nothing more:
//   1. Joins the home Wi-Fi as a station and pings the router at 500 Hz, so the
//      router's replies give a steady stream of Wi-Fi CSI captures (link 1).
//   2. Captures CSI (legacy LTF only, 64 bins = 128 bytes), keeps only packets FROM
//      the router that decoded cleanly, and forwards the raw buffer.
//   3. Link 2, when a phone asks for it at /beacon: pings that phone and overhears its
//      replies on their way to the router, a second radio path across the room. Its
//      captures travel as their own frame type (AK_CSI_LINK), never mixed into link 1's.
//   4. Forwards HLK-LD2450 radar frames byte-for-byte, should one ever be fitted
//      (none is planned; without one, nothing is sent).
//   5. Reports its health once a second, over USB and at http://<board>/status.
//   6. Switches the room relays (a table of up to 8 in config.h) when JARVIS asks: over
//      the same USB cable (COMMAND frames, CRC-checked), over the Wi-Fi link (the same
//      COMMAND frames inside HMAC-signed, replay-checked UDP), over MQTT with a broker
//      login, or over HTTP with a token. Never without one. Every STATUS frame reports
//      the relays' actual states, and a command is answered with one at once.
//   7. Takes new firmware over Wi-Fi (ArduinoOTA, password from secrets.h), so a board
//      powered from the switchboard, with no USB cable, can still be updated.
//   8. (3.5.0) Streams the same frames to JARVIS over Wi-Fi when the laptop opens an
//      authenticated session (WI-FI LINK below), several frames per datagram, and
//      answers to aankhen.local (mDNS).
// Everything goes to the laptop as CRC-checked binary frames over native USB (see
// aankhen_protocol.h), and, with a session, over Wi-Fi as well. The laptop does all the
// maths, so a recording made today can be re-analysed by tomorrow's algorithm.
//
// Removed from v2, deliberately:
//   - the open fallback access point (anyone nearby could join the board that
//     switches mains power),
//   - unauthenticated /relay/... URLs,
//   - "presence" computed on the board from "a packet was heard",
//   - JSON at 115,200 baud, which physically could not carry 100 Hz CSI.
//
// Board settings and wiring: README.md in this folder.

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <esp_wifi.h>
#include <esp_timer.h>
#include <esp_random.h>
#include "ping/ping_sock.h"
#include "mqtt_client.h"
#include "lwip/etharp.h"
#include "lwip/tcpip.h"
#include "lwip/sockets.h"
#include "mbedtls/md.h"

#include "aankhen_protocol.h"
#include "config.h"    // wiring (tracked)
#include "beacon_page.h"
// RECEIVER GAIN. The ESP32-S3 sets its receive gain per packet, almost at random
// (Portner et al., IEEE IoT-J 2026), and the CSI amplitudes carry it. Without
// knowing it the host must divide every packet by its own median, which also
// throws away most of what a person does to the signal (aankhen/rf.py measured
// 90-99 % of a walker's). Espressif's esp_csi_gain_ctrl reads that gain from the
// packet and computes the compensation; with it, CSI goes out as AK_CSI_GAIN frames
// and the host undoes the gain exactly. Without it, plain AK_CSI frames as before.
// It is vendored in libraries/esp_csi_gain_ctrl (README.md, section 3) and switched by
// AK_GAIN_LIB in config.h. An explicit switch, not __has_include: arduino-cli adds a
// library only for an #include it cannot otherwise resolve, and __has_include never
// asks, so the old probe stayed 0 even with the library installed (seen 2026-10-13: a
// build with it on the library path was byte-identical to one without).
#if AK_GAIN_LIB
#include <esp_csi_gain_ctrl.h>   // not found? compile with --libraries aankhen/firmware/libraries
#define AK_GAIN_CTRL 1
#else
#define AK_GAIN_CTRL 0
#endif
#define GAIN_BASELINE_PACKETS 100   // Espressif's example records the first 100
#include "secrets.h"   // gitignored; copy secrets.example.h

// FIRMWARE OVER WI-FI. Once the board is powered from the switchboard (a 5 V supply
// behind the relays), USB is gone and this is the only way new firmware reaches it.
// ArduinoOTA (built into the Arduino-ESP32 core) listens on UDP 3232 for espota.py or
// the IDE's network port. It is compiled in only with OTA_PASS_VALUE in secrets.h: an
// open OTA port would let anyone on the Wi-Fi replace the code that switches mains.
// The core (3.3.x) answers a PBKDF2-HMAC-SHA256 challenge, so the password itself never
// crosses the air.
// A struct, not a free function: the Arduino builder inserts its generated prototypes
// before the first free function, and they name types (CsiItem, Relay) defined below.
struct AkText {
  static constexpr bool same(const char *a, const char *b) { return *a == *b && (*a == 0 || same(a + 1, b + 1)); }
  static constexpr bool hexChar(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
  static constexpr bool hex(const char *s) { return *s == 0 || (hexChar(*s) && hex(s + 1)); }
};
#ifdef OTA_PASS_VALUE
#include <ArduinoOTA.h>
#define OTA_ENABLED 1
static_assert(sizeof(OTA_PASS_VALUE) - 1 >= 12, "OTA_PASS_VALUE (secrets.h) must be at least 12 characters");
static_assert(!AkText::same(OTA_PASS_VALUE, "paste-a-long-random-ota-password"),
              "OTA_PASS_VALUE (secrets.h) is still the example's placeholder: make your own");
#else
#define OTA_ENABLED 0
#warning "OTA_PASS_VALUE is not set in secrets.h: firmware updates over Wi-Fi are disabled."
#endif
#define OTA_HOSTNAME "aankhen"       // mDNS: aankhen.local; the IDE lists the board as aankhen at <ip>

// THE WI-FI LINK (3.5.0; WI-FI LINK below). Compiled in only with LINK_KEY_VALUE in
// secrets.h, the 32-byte key JARVIS made, as 64 hex characters: every datagram either
// way carries an HMAC-SHA256 tag under it (or under the session key derived from it), so
// nobody else on the Wi-Fi can read a command into the relays or replay one.
#ifdef LINK_KEY_VALUE
#define LINK_ENABLED 1
static_assert(sizeof(LINK_KEY_VALUE) - 1 == 64, "LINK_KEY_VALUE (secrets.h) must be 64 hex characters: copy the line the JARVIS app shows");
static_assert(AkText::hex(LINK_KEY_VALUE), "LINK_KEY_VALUE (secrets.h) must be hex: copy the line the JARVIS app shows");
#else
#define LINK_ENABLED 0
#warning "LINK_KEY_VALUE is not set in secrets.h: the Wi-Fi link to JARVIS is off (USB only)."
#endif

// ------------------------------------------------------------------ config
#define FW_VERSION "aankhen-3.5.0"
#define STATUS_MAX 1000                 // the STATUS JSON's buffer: under the host's 1024-byte limit
// CSI_RATE_HZ (router pings = CSI captures per second) lives in config.h, where the app's
// firmware form can set it. The ping interval is 1000 / CSI_RATE_HZ whole milliseconds.
static_assert(CSI_RATE_HZ >= 100 && CSI_RATE_HZ <= 500 && 1000 % CSI_RATE_HZ == 0,
              "CSI_RATE_HZ (config.h) must be 100, 125, 200, 250 or 500");
#define CSI_QUEUE_DEPTH 160       // ~0.3 s of slack at 500 Hz if the USB host stalls
// Automatic CSI scaling. The host divides every packet by its own median amplitude,
// so the absolute scale is irrelevant to the detector; automatic scaling keeps the
// int8 samples using their full range, i.e. less quantisation noise.
#define CSI_MANUAL_SCALE 0
// Link 2 (the phone). BEACON_PING_HZ, and what its airtime costs the house: config.h.
#define BEACON_PING_TIMEOUT_MS 100  // an awake phone answers in ~3-30 ms. A reply lost on the air then
                                    // costs 0.1 s of link 2, under the host's 0.25 s gap limit (csi.py),
                                    // so the stream is bridged, not broken. A phone that dozed off or
                                    // left gets at most 10 pings a second until BEACON_LOST_MS
#define BEACON_LOST_MS 6000         // the page beats every 1.5 s: 4 missed beats (screen locked, page
                                    // closed, phone gone) end link 2: no more pings, promiscuous
                                    // receive off, and another phone may register
#define BEACON_CSI_MAX_HZ (2 * BEACON_PING_HZ)  // every frame the phone sends is a capture, not only the
                                    // ping replies: an app update downloading in the background sends
                                    // ~1,000 TCP ACKs a second, which would crowd link 1 off the USB
                                    // link. Two per ping: the reply, and room for one other frame
#define BEACON_QUEUE_DEPTH 64       // ~0.3 s at the 200 Hz cap, the same slack as link 1's queue
static_assert(BEACON_PING_HZ >= 1 && BEACON_PING_HZ <= 500, "BEACON_PING_HZ (config.h) must be 1..500");
static_assert(BEACON_ENABLED == 0 || BEACON_ENABLED == 1, "BEACON_ENABLED (config.h) must be 0 or 1");

// Relays (mains). The table (names and pins) is RELAY_TABLE in config.h; -1 disables one.
struct Relay { const char *name; int pin; bool on; };
static Relay RELAYS[] = { RELAY_TABLE };

#ifndef RELAY_TOKEN_VALUE
#warning "RELAY_TOKEN_VALUE is not set in secrets.h: HTTP relay control is disabled."
#endif

// RELAYS ACROSS A FIRMWARE UPDATE. An OTA update ends in ESP.restart(), and setup() turns
// every relay off: the room light would go dark at every update and stay dark until
// JARVIS next switched it (over Wi-Fi nothing re-sends the room's state). So the relays'
// states are written to RTC memory just before that restart, which keeps its contents
// through a software reset (not a power cut), and setup() restores them only when the
// reset reason is a software restart AND this marker is present. A power-on, a brownout
// or a crash still starts with everything off. The load sees ~1 s of off while the chip
// reboots.
#define RELAY_KEEP_MAGIC 0xA4E1B007u
RTC_NOINIT_ATTR static uint32_t relayKeepMagic;
RTC_NOINIT_ATTR static uint8_t relayKeepBits;

// ------------------------------------------------------------------ state
static AkWriter ak(Serial);
static SemaphoreHandle_t txLock;
static QueueHandle_t csiQueue;
static uint8_t routerBssid[6];
static volatile bool haveBssid = false;
static volatile uint32_t csiCaptured = 0, csiDropped = 0, csiRejected = 0;
static uint32_t radarFrames = 0, radarBad = 0;
static esp_ping_handle_t pingHandle = nullptr;
static esp_mqtt_client_handle_t mqtt = nullptr;
static volatile bool mqttUp = false;
static WebServer http(80);
static bool httpEnabled = false;   // relay control over HTTP (STATUS "http"); needs RELAY_TOKEN_VALUE
static bool webUp = false;         // the server itself: always on, for /beacon and /status
static bool otaUp = false;         // ArduinoOTA is listening (STATUS "ota")
static int8_t otaLastTenth = -1;   // progress, logged every 10 %
static bool mdnsUp = false;        // aankhen.local answers (STATUS "mdns")

// The Wi-Fi link's state (WI-FI LINK below). Sessions are touched by loop() only; the
// batch and the socket's sends belong to txLock, like the USB writer.
struct LinkSession {
  bool up;
  uint32_t id;
  uint8_t key[32];       // the session key, derived from the link key and both nonces
  uint32_t ip;           // the laptop (lwIP byte order) and its UDP port: the only peer
  uint16_t port;
  uint64_t tx, rx;       // the last counter sent / accepted
  uint32_t lastMs, createdMs;
};
static LinkSession linkLive = {}, linkPending = {};
static int linkSock = -1;
static uint8_t linkKey[32];
static char linkKeyFp[9] = "";
static uint32_t linkDgrams = 0, linkCmds = 0, linkBad = 0, linkReplays = 0, linkSendFail = 0, linkSessions = 0;

struct CsiItem {
  ak_csi_link_head_t head;    // link id + metadata + gain, contiguous: one write sends them
  uint64_t ts;
  uint8_t buf[128];
};
static uint32_t gainRecorded = 0;   // packets in the gain baseline so far

// Link 2 (design: LINK 2 below). Shared with the Wi-Fi task, hence volatile.
static QueueHandle_t linkQueue;     // the phone's captures: a queue of their own, so they never crowd link 1's
static uint8_t ownMac[6];           // this board's station MAC
static volatile bool promisc = false;      // promiscuous receive on: link 1 also checks the destination
static uint32_t beaconIp = 0;              // the registered phone (lwIP byte order); 0 = none
static uint32_t beaconBeatMs = 0;          // its page's last beat (millis)
static uint32_t beaconArpMs = 0, beaconPingTryMs = 0;
static esp_ping_handle_t beaconPing = nullptr;
static volatile uint32_t beaconGen = 0;    // registration number: late ping callbacks for an earlier phone are ignored
// The phone's MAC, double-buffered: the Wi-Fi task compares against beaconMacs[beaconMacSlot]
// while loop() writes the OTHER slot and then flips the index with a single byte store.
static uint8_t beaconMacs[2][6];
static volatile int8_t beaconMacSlot = -1; // -1: not known, and no frame is taken as link 2
static volatile uint32_t beaconPingsOk = 0, beaconCaptured = 0, beaconDropped = 0, beaconRejected = 0;
static volatile int8_t beaconRssi = 0;
static volatile bool beaconHeard = false;  // a capture since it registered (else STATUS "rssi": null)
static int64_t beaconLastUs = 0;           // Wi-Fi task only: when the last capture was taken (BEACON_CSI_MAX_HZ)
// LINK-1 GUARD. In promiscuous receive link 1 keeps only frames whose dmac is this board.
// The IDF headers document dmac but promise nothing about it in promiscuous CSI; were it
// left zero, link 1 would go dark for as long as a phone is registered. So link 1's rate
// is watched: below half of what it was before promiscuous receive, 3 s running, and
// promiscuous receive goes off for this registration (STATUS beacon "fallback": true).
// Link 1 never pays for link 2.
#define LINK1_GUARD_FRACTION 0.5f
#define LINK1_GUARD_S 3
static float link1HzBefore = 0;            // csi_hz when promiscuous receive went on
static uint32_t link1GuardCount = 0, link1GuardMs = 0;
static uint8_t link1LowSeconds = 0;
static bool beaconFallback = false;

// Captures per second from a counter, over elapsed time, not "per call": a command's
// immediate confirmation also sends a status, and a per-call count would split one
// second's packets across two reports.
struct RateEma {
  uint32_t lastCount = 0, lastMs = 0;
  float hz = 0;
  void update(uint32_t count, uint32_t nowMs) {
    if (lastMs && nowMs - lastMs >= 200) {
      float inst = (count - lastCount) * 1000.0f / (nowMs - lastMs);
      hz = hz == 0 ? inst : 0.7f * hz + 0.3f * inst;
      lastCount = count;
      lastMs = nowMs;
    } else if (!lastMs) {
      lastCount = count;
      lastMs = nowMs;
    }
  }
};
static RateEma csiRate, beaconRate;

static void logf(const char *fmt, ...) {
  char line[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(line, sizeof(line), fmt, ap);
  va_end(ap);
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(20))) {
    ak.text(AK_LOG, line);
    xSemaphoreGive(txLock);
  }
}

// ------------------------------------------------------------------ CSI
// Copies one capture out of the driver's record, which is freed when the callback returns.
static void IRAM_ATTR fillItem(CsiItem &item, wifi_csi_info_t *info, uint8_t link, int64_t ts) {
  item.ts = ts;
  item.head.link = link;
  item.head.mg.meta.rssi = info->rx_ctrl.rssi;
  item.head.mg.meta.noise_floor = info->rx_ctrl.noise_floor;
  item.head.mg.meta.channel = info->rx_ctrl.channel;
  item.head.mg.meta.secondary_channel = info->rx_ctrl.secondary_channel;
  item.head.mg.meta.sig_mode = info->rx_ctrl.sig_mode;
  item.head.mg.meta.cwb = info->rx_ctrl.cwb;
  item.head.mg.meta.stbc = info->rx_ctrl.stbc;
  item.head.mg.meta.first_word_invalid = info->first_word_invalid ? 1 : 0;
  memcpy(item.head.mg.meta.mac, info->mac, 6);
  uint16_t n = info->len > sizeof(item.buf) ? sizeof(item.buf) : info->len;
  item.head.mg.meta.csi_len = n;
#if AK_GAIN_CTRL
  esp_csi_gain_ctrl_get_rx_gain(&info->rx_ctrl, &item.head.mg.gain.agc_gain, &item.head.mg.gain.fft_gain);
#else
  item.head.mg.gain.agc_gain = 0;
  item.head.mg.gain.fft_gain = 0;
#endif
  item.head.mg.gain.comp_cdb = AK_GAIN_UNKNOWN;
  memcpy(item.buf, info->buf, n);
}

// Link 2: one of the phone's frames, overheard.
static void IRAM_ATTR onPhoneCsi(wifi_csi_info_t *info) {
  if (info->rx_ctrl.rx_state != 0) {                     // failed decode = garbage CSI
    beaconRejected++;
    return;
  }
  int64_t now = esp_timer_get_time();
  if (now - beaconLastUs < 1000000 / BEACON_CSI_MAX_HZ) return;   // capped (BEACON_CSI_MAX_HZ), not lost
  beaconLastUs = now;
  CsiItem item;
  fillItem(item, info, AK_LINK_PHONE, now);
  beaconRssi = info->rx_ctrl.rssi;
  beaconHeard = true;
  if (xQueueSendFromISR(linkQueue, &item, nullptr) == pdTRUE) beaconCaptured++;
  else beaconDropped++;                                  // counted, reported, never silent
}

// Runs in the Wi-Fi task: copy and get out. No allocation, no printing.
static void IRAM_ATTR onCsi(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf) return;
  // The phone first. In promiscuous receive this callback hears every frame on the
  // channel, the neighbours' included: theirs cost two 6-byte compares, each of which
  // stops at the first byte that differs.
  int8_t slot = beaconMacSlot;
  if (slot >= 0 && memcmp(info->mac, beaconMacs[slot], 6) == 0) {
    onPhoneCsi(info);
    return;
  }
  if (!haveBssid || memcmp(info->mac, routerBssid, 6) != 0) return;   // only the router's replies
  // ...and, in promiscuous receive, only the router's frames addressed to this board or
  // to everyone: exactly what the radio passed before. Not its traffic to the rest of
  // the house, whose rate follows whatever the family is streaming.
  if (promisc && memcmp(info->dmac, ownMac, 6) != 0 && !(info->dmac[0] & 0x01)) return;
  if (info->rx_ctrl.rx_state != 0) {                     // failed decode = garbage CSI
    csiRejected++;
    return;
  }
  CsiItem item;
  fillItem(item, info, AK_LINK_ROUTER, esp_timer_get_time());
  if (xQueueSendFromISR(csiQueue, &item, nullptr) == pdTRUE) csiCaptured++;
  else csiDropped++;                                     // counted, reported, never silent
}

static void startCsi() {
  wifi_csi_config_t cfg = {};
  cfg.lltf_en = true;            // legacy LTF only: every packet is 64 bins / 128 bytes,
  cfg.htltf_en = false;          // whatever PHY format the router replies with
  cfg.stbc_htltf2_en = false;
  cfg.ltf_merge_en = true;
  cfg.channel_filter_en = true;
  cfg.manu_scale = CSI_MANUAL_SCALE;
  cfg.shift = 0;
  ESP_ERROR_CHECK(esp_wifi_set_csi_config(&cfg));
  ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(&onCsi, nullptr));
  ESP_ERROR_CHECK(esp_wifi_set_csi(true));
}

// Sends one queued capture. Link 1 exactly as before: AK_CSI_GAIN with the gain library,
// else AK_CSI. Link 2 always as AK_CSI_LINK, gain block included.
static void sendCsi(CsiItem &item) {
  bool router = item.head.link == AK_LINK_ROUTER;
#if AK_GAIN_CTRL
  // Baseline first (the median gain of the first packets), then every packet's
  // compensation against it. Done here, not in the Wi-Fi callback, to keep that short.
  // Only the router's packets set the baseline; the phone's are compensated against the
  // same one, so both links' amplitudes are on one scale.
  if (gainRecorded < GAIN_BASELINE_PACKETS) {
    if (router) {
      esp_csi_gain_ctrl_record_rx_gain(item.head.mg.gain.agc_gain, item.head.mg.gain.fft_gain);
      gainRecorded++;
    }
  } else {
    float comp = 1.0f;
    if (esp_csi_gain_ctrl_get_gain_compensation(&comp, item.head.mg.gain.agc_gain, item.head.mg.gain.fft_gain) == ESP_OK
        && comp > 0.0f) {
      item.head.mg.gain.comp_cdb = (int16_t)lroundf(2000.0f * log10f(comp));
    }
  }
#endif
  if (!router) {
    ak.frame(AK_CSI_LINK, item.ts, (const uint8_t *)&item.head, sizeof(item.head), item.buf,
             item.head.mg.meta.csi_len);
    return;
  }
#if AK_GAIN_CTRL
  ak.frame(AK_CSI_GAIN, item.ts, (const uint8_t *)&item.head.mg, sizeof(item.head.mg), item.buf,
           item.head.mg.meta.csi_len);
#else
  ak.frame(AK_CSI, item.ts, (const uint8_t *)&item.head.mg.meta, sizeof(item.head.mg.meta), item.buf,
           item.head.mg.meta.csi_len);
#endif
}

static void drainCsi(QueueHandle_t q, int burst) {
  CsiItem item;
  while (burst-- > 0 && xQueueReceive(q, &item, 0) == pdTRUE) {
    if (xSemaphoreTake(txLock, pdMS_TO_TICKS(10))) {
      sendCsi(item);
      xSemaphoreGive(txLock);
    }
  }
}

// Traffic generator: ICMP echo to the gateway. Each reply is one CSI capture.
static void startPing() {
  if (pingHandle) {
    esp_ping_stop(pingHandle);
    esp_ping_delete_session(pingHandle);
    pingHandle = nullptr;
  }
  esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
  IPAddress gw = WiFi.gatewayIP();
  cfg.target_addr.type = IPADDR_TYPE_V4;
  cfg.target_addr.u_addr.ip4.addr = (uint32_t)gw;
  cfg.count = ESP_PING_COUNT_INFINITE;
  cfg.interval_ms = 1000 / CSI_RATE_HZ;
  cfg.timeout_ms = 1000;
  cfg.data_size = 1;
  cfg.task_stack_size = 3072;
  esp_ping_callbacks_t cbs = {};
  if (esp_ping_new_session(&cfg, &cbs, &pingHandle) == ESP_OK) esp_ping_start(pingHandle);
  else logf("ping session failed");
}

// ------------------------------------------------------------------ LINK 2: your phone
// WHY. The router -> board path (link 1) sees the room along one line; someone who does
// not cross it barely changes it. A phone left at a fixed spot is a second transmitter:
// the board measures how the room changes the phone's signal on its way to the board,
// a second path from another angle. Nothing to install: the phone opens
// http://<board>/beacon, which registers it and keeps its Wi-Fi awake (beacon_page.h).
//
// HOW THE BOARD HEARS IT. The board pings the phone (BEACON_PING_HZ, config.h). The
// phone sends each reply to the router, not to the board, and the radio drops frames
// addressed to someone else unless promiscuous receive is on. It is on only while a
// phone is registered and its MAC known, and the board stays connected as a station
// throughout: one radio, one channel, the router's. So the phone must be on the home
// Wi-Fi's 2.4 GHz band. A phone hotspot is another network on another channel:
// following it would take the board off the router, and link 1 with it.
//
// WHICH FRAMES ARE THE PHONE'S. A CSI record carries its transmitter's MAC. The phone's
// comes from lwIP's ARP table, which has it once the phone's page has loaded (the phone
// asked who the board is) or the first ping has gone out, and it is looked up again
// every 2 s: a phone that changes its private address is followed, not silently lost.
//
// ONE PHONE AT A TIME: two would interleave two transmitters under one link id. A second
// page is told "busy" until the first stops beating. The board only ever pings the
// address a request came from (a TCP connection's source cannot be forged on the LAN),
// so /beacon cannot aim pings at anything else.

// lwIP's ARP table belongs to the tcpip thread. This core (esp32s3-libs 3.3.12) is built
// with CONFIG_LWIP_TCPIP_CORE_LOCKING=y and CONFIG_LWIP_CHECK_THREAD_SAFETY=y: another
// task may call into lwIP only while it holds the core lock, as the core's own
// esp32-hal-time.c does. etharp_find_addr returns a pointer INTO the table, which the
// tcpip thread may rewrite as soon as the lock is released: copy it out under the lock.
#if !CONFIG_LWIP_TCPIP_CORE_LOCKING
#error "link 2 reads lwIP's ARP table under the TCPIP core lock, and this core is built without one"
#endif
static bool arpLookup(uint32_t ip, uint8_t mac[6]) {
  ip4_addr_t want;
  want.addr = ip;
  struct eth_addr *eth = nullptr;
  const ip4_addr_t *at = nullptr;
  bool found = false;
  LOCK_TCPIP_CORE();
  if (etharp_find_addr(nullptr, &want, &eth, &at) >= 0 && eth) {   // nullptr: any netif; the station is the only one
    memcpy(mac, eth->addr, 6);
    found = true;
  }
  UNLOCK_TCPIP_CORE();
  return found;
}

static void setPromiscuous(bool on) {
  if (on == promisc) return;
  if (on) {
    link1HzBefore = csiRate.hz;   // the guard's reference (LINK-1 GUARD)
    link1GuardCount = csiCaptured;
    link1GuardMs = millis();
    link1LowSeconds = 0;
    promisc = true;               // first: link 1 checks the destination before a foreign frame can arrive
    // Data frames only: the phone's replies are data frames, and the neighbours' beacons
    // and control frames (hundreds a second on a busy channel) never reach the driver's
    // CSI path. Whether this mask also gates CSI is not documented; if it costs link 1
    // anything that matters, the LINK-1 GUARD turns promiscuous receive off.
    wifi_promiscuous_filter_t f = {};
    f.filter_mask = WIFI_PROMIS_FILTER_MASK_DATA;
    esp_wifi_set_promiscuous_filter(&f);
    if (esp_wifi_set_promiscuous(true) != ESP_OK) {
      promisc = false;
      logf("link 2: promiscuous receive refused");
    }
  } else {
    esp_wifi_set_promiscuous(false);
    promisc = false;              // last: until it is off, foreign frames may still arrive
  }
}

static void learnPhoneMac() {
  uint8_t mac[6];
  if (!arpLookup(beaconIp, mac)) return;                 // not resolved yet: the next look
  int8_t slot = beaconMacSlot;
  if (slot >= 0 && memcmp(mac, beaconMacs[slot], 6) == 0) return;
  int8_t next = slot == 0 ? 1 : 0;
  memcpy(beaconMacs[next], mac, 6);
  __sync_synchronize();                                  // the bytes land before the index that points at them
  beaconMacSlot = next;
  if (!beaconFallback) setPromiscuous(true);
  logf("link 2: phone %s (%s address); overhearing it", slot < 0 ? "found" : "changed its MAC",
       (mac[0] & 0x02) ? "a private, randomised" : "its factory");
}

static void onPhonePingOk(esp_ping_handle_t, void *gen) {
  if ((uint32_t)(uintptr_t)gen == beaconGen) beaconPingsOk++;   // a late reply to an earlier phone is not this one's
}

static void startPhonePing() {
  esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
  cfg.target_addr.type = IPADDR_TYPE_V4;
  cfg.target_addr.u_addr.ip4.addr = beaconIp;
  cfg.count = ESP_PING_COUNT_INFINITE;
  cfg.interval_ms = 1000 / BEACON_PING_HZ;
  cfg.timeout_ms = BEACON_PING_TIMEOUT_MS;
  cfg.data_size = 1;
  cfg.task_stack_size = 3072;
  esp_ping_callbacks_t cbs = {};
  cbs.cb_args = (void *)(uintptr_t)beaconGen;
  cbs.on_ping_success = onPhonePingOk;
  if (esp_ping_new_session(&cfg, &cbs, &beaconPing) == ESP_OK) {
    esp_ping_start(beaconPing);
  } else {
    beaconPing = nullptr;
    logf("link 2: ping session failed; trying again in 1 s");
  }
}

static void resetPhoneCounters() {
  beaconPingsOk = 0;
  beaconCaptured = 0;
  beaconDropped = 0;
  beaconRejected = 0;
  beaconHeard = false;
  beaconRate = RateEma();
  beaconFallback = false;
}

// LINK-1 GUARD, once a second while promiscuous receive is on.
static void guardLink1(uint32_t now) {
  if (!promisc || link1HzBefore < 20.0f || now - link1GuardMs < 1000) return;
  uint32_t cap = csiCaptured;
  float hz = (cap - link1GuardCount) * 1000.0f / (now - link1GuardMs);
  link1GuardCount = cap;
  link1GuardMs = now;
  link1LowSeconds = hz < LINK1_GUARD_FRACTION * link1HzBefore ? link1LowSeconds + 1 : 0;
  if (link1LowSeconds >= LINK1_GUARD_S) {
    setPromiscuous(false);
    beaconFallback = true;
    logf("link 2: link 1 fell to %.0f Hz from %.0f Hz in promiscuous receive; turned it off", hz, link1HzBefore);
  }
}

static void dropPhone(const char *why) {
  if (!beaconIp) return;
  beaconMacSlot = -1;                                    // the Wi-Fi task takes none of its frames from now
  setPromiscuous(false);
  if (beaconPing) {
    // The ping task finishes its current ping (<= BEACON_PING_TIMEOUT_MS) and then frees
    // itself; a callback it still makes carries the old beaconGen and is ignored.
    esp_ping_stop(beaconPing);
    esp_ping_delete_session(beaconPing);
    beaconPing = nullptr;
  }
  beaconIp = 0;
  resetPhoneCounters();
  logf("link 2: phone released (%s)", why);
}

static void registerPhone(uint32_t ip) {
  dropPhone("replaced by a new registration");
  beaconGen++;
  beaconIp = ip;
  resetPhoneCounters();
  beaconArpMs = 0;                                       // look its MAC up straight away
  beaconPingTryMs = 0;
  logf("link 2: phone %s registered", IPAddress(ip).toString().c_str());
}

static void phoneTick(uint32_t now) {
  if (!beaconIp) return;
  if (WiFi.status() != WL_CONNECTED) {
    dropPhone("Wi-Fi lost");
    return;
  }
  if (now - beaconBeatMs > BEACON_LOST_MS) {
    dropPhone("its page stopped beating");
    return;
  }
  if (!beaconPing && now - beaconPingTryMs >= 1000) {
    beaconPingTryMs = now;
    startPhonePing();
  }
  if (now - beaconArpMs >= (beaconMacSlot < 0 ? 100u : 2000u)) {
    beaconArpMs = now;
    learnPhoneMac();
  }
  guardLink1(now);
}

// ------------------------------------------------------------------ radar
static uint8_t rbuf[30];
static size_t rlen = 0;

static void pumpRadar() {
  static const uint8_t HDR[4] = {0xAA, 0xFF, 0x03, 0x00};
  while (Serial1.available()) {
    uint8_t b = Serial1.read();
    if (rlen < 4) {                                   // hunting for the header
      if (b == HDR[rlen]) rbuf[rlen++] = b;
      else rlen = (b == HDR[0]) ? (rbuf[0] = b, 1) : 0;
      continue;
    }
    rbuf[rlen++] = b;
    if (rlen == sizeof(rbuf)) {
      if (rbuf[28] == 0x55 && rbuf[29] == 0xCC) {
        radarFrames++;
        if (xSemaphoreTake(txLock, pdMS_TO_TICKS(10))) {
          ak.frame(AK_RADAR, esp_timer_get_time(), rbuf, sizeof(rbuf));
          xSemaphoreGive(txLock);
        }
      } else {
        radarBad++;
      }
      rlen = 0;
    }
  }
}

// ------------------------------------------------------------------ relays
static void setRelay(Relay &r, bool on) {
  if (r.pin < 0) return;                   // not wired: stays off, and STATUS says null
  r.on = on;
  digitalWrite(r.pin, (on ^ (bool)RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

// Initialise a relay pin with NO glitch: set the "off" level on the pin latch
// first, then make it an output. pinMode() before digitalWrite() would drive the
// pin low for a moment — on an active-low module that is a brief "ON" of a mains
// load at every boot.
static void initRelay(Relay &r) {
  r.on = false;
  if (r.pin < 0) return;
  digitalWrite(r.pin, RELAY_ACTIVE_LOW ? HIGH : LOW);
  pinMode(r.pin, OUTPUT);
  setRelay(r, false);
}

static Relay *findRelay(const char *name) {
  for (auto &r : RELAYS)
    if (strcmp(r.name, name) == 0) return &r;
  return nullptr;
}

static const size_t RELAY_COUNT = sizeof(RELAYS) / sizeof(RELAYS[0]);
static_assert(sizeof(RELAYS) / sizeof(RELAYS[0]) <= 8, "relayKeepBits holds 8 relays");

// Just before an OTA restart (RELAYS ACROSS A FIRMWARE UPDATE).
static void keepRelaysForRestart() {
  uint8_t bits = 0;
  for (size_t i = 0; i < RELAY_COUNT; i++)
    if (RELAYS[i].on) bits |= (uint8_t)(1u << i);
  relayKeepBits = bits;
  relayKeepMagic = RELAY_KEEP_MAGIC;
}

// At boot: everything off, then, after a software restart that left the marker, the
// states it left. The marker is cleared first, so it is used once.
static const char *bootRelays() {
  bool keep = esp_reset_reason() == ESP_RST_SW && relayKeepMagic == RELAY_KEEP_MAGIC;
  uint8_t bits = relayKeepBits;
  relayKeepMagic = 0;
  for (size_t i = 0; i < RELAY_COUNT; i++) {
    initRelay(RELAYS[i]);
    if (keep && (bits & (1u << i))) setRelay(RELAYS[i], true);
  }
  return keep ? "restored after a firmware update" : "all off";
}

// Why the chip last started, for STATUS "reset". A brownout here, after a relay clicked,
// means the 5 V supply sags under the relay coil: give the module its own 5 V feed.
static const char *resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_EXT: return "reset-pin";
    case ESP_RST_USB: return "usb";
    default: return "other";
  }
}

// MQTT: room.py publishes {"on": true, "level": 80} on jarvis/room/<device>.
// The relay switches on/off; "level" needs a dimmer and is ignored here.
static void onMqtt(void *, esp_event_base_t, int32_t id, void *data) {
  auto *e = (esp_mqtt_event_handle_t)data;
  if (id == MQTT_EVENT_CONNECTED) {
    mqttUp = true;
    esp_mqtt_client_subscribe(mqtt, "jarvis/room/+", 1);
  } else if (id == MQTT_EVENT_DISCONNECTED) {
    mqttUp = false;
  } else if (id == MQTT_EVENT_DATA) {
    char topic[64] = {0};
    int tn = e->topic_len < 63 ? e->topic_len : 63;
    memcpy(topic, e->topic, tn);
    const char *dev = strrchr(topic, '/');
    Relay *r = dev ? findRelay(dev + 1) : nullptr;
    if (!r) return;
    bool on = memmem(e->data, e->data_len, "\"on\": true", 10) || memmem(e->data, e->data_len, "\"on\":true", 9);
    setRelay(*r, on);
    logf("mqtt: %s -> %s", r->name, on ? "on" : "off");
  }
}

// A broker anyone on the Wi-Fi can publish to would be an unauthenticated relay switch:
// 3.5.0 subscribes only with a broker login (MQTT_USER_VALUE). JARVIS itself no longer
// publishes there (2026-10-15); the Wi-Fi link replaces it.
#if defined(MQTT_URI_VALUE) && !defined(MQTT_USER_VALUE)
#warning "MQTT_URI_VALUE without MQTT_USER_VALUE: MQTT relay control is disabled (no unauthenticated relay path)."
#endif
static void startMqtt() {
#if defined(MQTT_URI_VALUE) && defined(MQTT_USER_VALUE)
  esp_mqtt_client_config_t cfg = {};
  cfg.broker.address.uri = MQTT_URI_VALUE;
  cfg.credentials.username = MQTT_USER_VALUE;
  cfg.credentials.authentication.password = MQTT_PASS_VALUE;
  mqtt = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, onMqtt, nullptr);
  esp_mqtt_client_start(mqtt);
#endif
}

// ------------------------------------------------------------------ HTTP
// Port 80 always serves /beacon (link 2). /relay exists only with RELAY_TOKEN_VALUE.
#ifdef RELAY_TOKEN_VALUE
// Constant-time comparison: response timing must not reveal how much of a guessed
// token was right.
static bool tokenOk() {
  String t = http.header("X-Aankhen-Token");
  const char *want = RELAY_TOKEN_VALUE;
  size_t n = strlen(want);
  if (t.length() != n || n < 16) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < n; i++) diff |= (uint8_t)t[i] ^ (uint8_t)want[i];
  return diff == 0;
}
#endif

// The requester's IPv4 address; 0 for IPv6, which the phone's ping cannot use.
static uint32_t clientIpv4() {
  IPAddress ip = http.client().remoteIP();
  return ip.type() == IPv4 ? (uint32_t)ip : 0;
}

static void onBeaconPage() {
  http.sendHeader("Cache-Control", "no-cache");
  http.send_P(200, "text/html; charset=utf-8", BEACON_HTML);
}

// POST /beacon/beat: registers the phone, or keeps it registered, and tells the page
// how the link is doing (beacon_page.h).
static void onBeat() {
  uint32_t ip = clientIpv4(), now = millis();
  http.sendHeader("Cache-Control", "no-store");
  if (!ip) {
    http.send(400, "application/json", "{\"error\":\"open the page at the board's IPv4 address\"}");
    return;
  }
  if (beaconIp && ip != beaconIp && now - beaconBeatMs <= BEACON_LOST_MS) {
    http.send(200, "application/json", "{\"role\":\"busy\"}");
    return;
  }
  if (ip != beaconIp) registerPhone(ip);
  beaconBeatMs = now;
  char rssi[8] = "null";
  if (beaconHeard) snprintf(rssi, sizeof(rssi), "%d", beaconRssi);
  char js[160];
  snprintf(js, sizeof(js),
           "{\"role\":\"beacon\",\"mac_known\":%s,\"pings_ok\":%lu,\"rate_hz\":%lu,\"rssi\":%s,\"ping_hz\":%d,\"fallback\":%s}",
           beaconMacSlot >= 0 ? "true" : "false", (unsigned long)beaconPingsOk,
           (unsigned long)(beaconRate.hz + 0.5f), rssi, BEACON_PING_HZ, beaconFallback ? "true" : "false");
  http.send(200, "application/json", js);
}

// POST /beacon/bye: the page was closed; free the board straight away.
static void onBye() {
  if (beaconIp && clientIpv4() == beaconIp) dropPhone("its page closed");
  http.send(204);
}

// GET /status: what the board is doing, for the JARVIS app when no USB cable connects
// them (the board behind the switchboard). With the relay token: the full STATUS JSON,
// relays included. Without it: only what tells you the board is alive and which
// firmware it runs. The relays' states say whether someone is home, so they stay
// behind the token like the switches themselves.
static void buildStatus(char *js, size_t jsLen);

static void onStatus() {
  http.sendHeader("Cache-Control", "no-store");
#ifdef RELAY_TOKEN_VALUE
  if (tokenOk()) {
    char js[STATUS_MAX];
    buildStatus(js, sizeof(js));
    http.send(200, "application/json", js);
    return;
  }
#endif
  char js[320];
  snprintf(js, sizeof(js),
           "{\"fw\":\"%s\",\"uptime_s\":%.1f,\"rssi\":%d,\"channel\":%d,\"csi_hz\":%lu,"
           "\"ota\":%s,\"http\":%s,\"reset\":\"%s\",\"beacon_enabled\":%s,\"link\":%s,\"mdns\":%s,\"full\":false}",
           FW_VERSION, esp_timer_get_time() / 1e6, WiFi.RSSI(), WiFi.channel(),
           (unsigned long)(csiRate.hz + 0.5f), otaUp ? "true" : "false", httpEnabled ? "true" : "false",
           resetReason(), BEACON_ENABLED ? "true" : "false", LINK_ENABLED ? "true" : "false",
           mdnsUp ? "\"" OTA_HOSTNAME ".local\"" : "null");
  http.send(200, "application/json", js);
}

static void startHttp() {
#ifdef RELAY_TOKEN_VALUE
  static const char *hdrs[] = {"X-Aankhen-Token"};
  http.collectHeaders(hdrs, 1);
#endif
  http.on("/status", HTTP_GET, onStatus);
#if BEACON_ENABLED
  http.on("/beacon", HTTP_GET, onBeaconPage);
  http.on("/beacon/beat", HTTP_POST, onBeat);
  http.on("/beacon/bye", HTTP_POST, onBye);
#else
  http.on("/beacon", HTTP_GET, []() {
    http.send(404, "text/plain", "link 2 is off on this board (BEACON_ENABLED 0 in config.h)");
  });
#endif
#ifdef RELAY_TOKEN_VALUE
  http.on("/relay", HTTP_POST, []() {
    if (!tokenOk()) { http.send(401, "application/json", "{\"error\":\"token\"}"); return; }
    Relay *r = findRelay(http.arg("ch").c_str());
    if (!r) { http.send(404, "application/json", "{\"error\":\"no such relay\"}"); return; }
    if (r->pin < 0) { http.send(409, "application/json", "{\"error\":\"relay not wired\"}"); return; }
    bool on = http.arg("on") == "1";
    setRelay(*r, on);
    http.send(200, "application/json", on ? "{\"on\":true}" : "{\"on\":false}");
  });
  httpEnabled = true;
#endif
  http.onNotFound([]() { http.send(404, "text/plain", "not found"); });
  http.begin();
  webUp = true;
}

// ------------------------------------------------------------------ USB commands
// Host -> device COMMAND frames (type 0x06) arrive on the same USB serial link the
// sensor data leaves on. Same framing, same CRC: a corrupted byte can never switch
// a relay. Payload is tiny JSON, e.g. {"relay":"light","on":true} or {"cmd":"status"}.
static void sendStatus();

static bool jsonBool(const char *js, const char *key, bool *out) {
  const char *k = strstr(js, key);
  if (!k) return false;
  const char *v = strchr(k + strlen(key), ':');
  if (!v) return false;
  while (*++v == ' ') {}
  if (strncmp(v, "true", 4) == 0) { *out = true; return true; }
  if (strncmp(v, "false", 5) == 0) { *out = false; return true; }
  return false;
}

static bool jsonString(const char *js, const char *key, char *out, size_t n) {
  const char *k = strstr(js, key);
  if (!k) return false;
  const char *v = strchr(k + strlen(key), ':');
  if (!v) return false;
  v = strchr(v, '"');
  if (!v) return false;
  const char *e = strchr(++v, '"');
  if (!e || (size_t)(e - v) >= n) return false;
  memcpy(out, v, e - v);
  out[e - v] = 0;
  return true;
}

static void handleCommand(const char *js) {
  char name[16];
  bool on;
  if (jsonString(js, "\"relay\"", name, sizeof(name)) && jsonBool(js, "\"on\"", &on)) {
    bool any = false;
    for (auto &r : RELAYS) {
      if (strcmp(name, "all") == 0 || strcmp(name, r.name) == 0) {
        setRelay(r, on);
        any = true;
      }
    }
    logf(any ? "relay %s -> %s" : "relay %s: unknown", name, on ? "on" : "off");
    sendStatus();                                    // immediate confirmation
  } else if (strstr(js, "\"status\"")) {
    sendStatus();
  } else {
    logf("command not understood");
  }
}

static uint8_t cmdBuf[16 + 256 + 2];
static size_t cmdLen = 0;

static void pumpCommands() {
  while (Serial.available()) {
    uint8_t b = Serial.read();
    if (cmdLen == 0 && b != 0xAA) continue;          // hunt for SYNC
    if (cmdLen == 1 && b != 0x55) { cmdLen = (b == 0xAA) ? 1 : 0; continue; }
    cmdBuf[cmdLen++] = b;
    if (cmdLen < sizeof(ak_header_t)) continue;
    const ak_header_t *h = (const ak_header_t *)cmdBuf;
    if (h->version != AK_PROTOCOL_VERSION || h->type != 0x06 || h->length > 256) {
      cmdLen = 0;                                    // not a command frame: resync
      continue;
    }
    size_t total = sizeof(ak_header_t) + h->length + 2;
    if (cmdLen < total) continue;
    uint16_t crc;
    memcpy(&crc, cmdBuf + sizeof(ak_header_t) + h->length, 2);
    if (ak_crc16(cmdBuf + 2, sizeof(ak_header_t) - 2 + h->length) == crc) {
      char js[257];
      memcpy(js, cmdBuf + sizeof(ak_header_t), h->length);
      js[h->length] = 0;
      handleCommand(js);
    } else {
      logf("command rejected: bad CRC");
    }
    cmdLen = 0;
  }
}

// ------------------------------------------------------------------ WI-FI LINK
// WHY. In the box beside the switchboard the board has no USB cable: its frames must
// cross the home Wi-Fi, and a relay that switches mains must not obey anybody else on it.
//
// THE PROTOCOL (the Python side, and the reasoning, is aankhen/netlink.py). Every datagram:
// "AKN1" | kind u8 | flags u8 | length u16 | session u32 | counter u64 | payload | tag[16],
// tag = the first 16 bytes of HMAC-SHA256 over everything before it.
//   HELLO     laptop -> board, under the link key: the laptop's 16-byte nonce. The board
//             makes a PENDING session (3 s to live) and answers
//   WELCOME   board -> laptop, under the link key: the laptop's nonce, the board's nonce,
//             FW_VERSION. Both sides now derive the session key
//             HMAC(link key, "AKN1 session" | session | laptop nonce | board nonce).
//   READY     laptop -> board, session key, counter 1: the session goes live, replacing any
//             other (the newest laptop wins), and the board streams to that IP and port
//   DATA      board -> laptop, session key, counter 1, 2, ...: whole AK frames, batched
//   CMD       laptop -> board, session key: one AK COMMAND frame, exactly as on USB. The
//             board answers with a STATUS frame, sent at once
//   KEEPALIVE laptop -> board, session key, every second; 10 s without one ends the session
//   BYE       laptop -> board, session key: the session ends now
// Laptop -> board counters must rise: a datagram whose counter is not above the last one
// accepted is a replay, and is dropped. A replayed HELLO only makes a pending session that
// nobody can finish without the key. Nothing unverified is ever answered.
//
// WHAT A SESSION ENDING DOES: the board stops streaming, nothing more. The relays keep
// their state when Wi-Fi or the laptop goes away; the wall switches work regardless.
//
// USB AND WI-FI TOGETHER. Both are always on: frames go to the USB port (dropped when no
// program reads it) and, with a session, to the laptop over Wi-Fi. Both take commands;
// a USB command needs the cable, a Wi-Fi one the key. The app talks over one link at a
// time (USB when the board is on USB), so they never contend in practice, and each
// command's STATUS shows the relays as they are, whichever link switched them.
#define LINK_HDR 20
#define LINK_TAG 16
#define LINK_DGRAM_MAX 1392                     // < 1400 B: one 802.11 frame with UDP/IP on top
#define LINK_PAYLOAD_MAX (LINK_DGRAM_MAX - LINK_HDR - LINK_TAG)
#define LINK_PENDING_MS 3000
#define LINK_TIMEOUT_MS 10000
#define LINK_HELLO_GAP_MS 50                    // at most 20 HELLOs a second are even checked
enum : uint8_t { LK_HELLO = 1, LK_WELCOME, LK_READY, LK_DATA, LK_CMD, LK_KEEPALIVE, LK_BYE };

#pragma pack(push, 1)
struct LinkHdr {
  char magic[4];
  uint8_t kind;
  uint8_t flags;
  uint16_t length;
  uint32_t session;
  uint64_t counter;
};
#pragma pack(pop)
static_assert(sizeof(LinkHdr) == LINK_HDR, "link header must be 20 bytes (netlink.py HDR_FMT <4sBBHIQ)");
static_assert(AK_FRAME_MAX <= LINK_PAYLOAD_MAX, "a whole frame must fit one datagram");

static uint8_t linkBatch[LINK_DGRAM_MAX];       // DATA, built in place: header | frames | tag
static size_t linkBatchLen = 0;                 // frame bytes in it
static uint32_t linkBatchMs = 0;

static void hmacSha256(const uint8_t *key, const uint8_t *a, size_t na, const uint8_t *b, size_t nb, uint8_t out[32]) {
  mbedtls_md_context_t c;
  mbedtls_md_init(&c);
  if (mbedtls_md_setup(&c, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1) == 0) {
    mbedtls_md_hmac_starts(&c, key, 32);
    if (na) mbedtls_md_hmac_update(&c, a, na);
    if (nb) mbedtls_md_hmac_update(&c, b, nb);
    mbedtls_md_hmac_finish(&c, out);
  } else {
    memset(out, 0, 32);
  }
  mbedtls_md_free(&c);
}

// The tag at the end of a datagram, checked in constant time.
static bool linkTagOk(const uint8_t *key, const uint8_t *d, size_t n) {
  uint8_t want[32];
  hmacSha256(key, d, n - LINK_TAG, nullptr, 0, want);
  uint8_t diff = 0;
  for (int i = 0; i < LINK_TAG; i++) diff |= want[i] ^ d[n - LINK_TAG + i];
  return diff == 0;
}

// Header and tag around `n` payload bytes already at d + LINK_HDR, then out. txLock held.
static bool linkSendRaw(uint8_t *d, uint8_t kind, uint32_t session, uint64_t counter, size_t n,
                        const uint8_t *key, uint32_t ip, uint16_t port) {
  LinkHdr h;
  memcpy(h.magic, "AKN1", 4);
  h.kind = kind;
  h.flags = 0;
  h.length = (uint16_t)n;
  h.session = session;
  h.counter = counter;
  memcpy(d, &h, LINK_HDR);
  uint8_t tag[32];
  hmacSha256(key, d, LINK_HDR + n, nullptr, 0, tag);
  memcpy(d + LINK_HDR + n, tag, LINK_TAG);
  struct sockaddr_in to = {};
  to.sin_family = AF_INET;
  to.sin_port = htons(port);
  to.sin_addr.s_addr = ip;
  int len = LINK_HDR + n + LINK_TAG;
  if (sendto(linkSock, d, len, MSG_DONTWAIT, (struct sockaddr *)&to, sizeof(to)) != len) {
    linkSendFail++;                             // lwIP out of buffers: the host counts the frames' seq gap
    return false;
  }
  return true;
}

// The batch out as one DATA datagram. txLock held.
static void linkFlush() {
  if (!linkBatchLen) return;
  if (linkLive.up && linkSock >= 0) {
    linkLive.tx++;
    if (linkSendRaw(linkBatch, LK_DATA, linkLive.id, linkLive.tx, linkBatchLen, linkLive.key, linkLive.ip, linkLive.port))
      linkDgrams++;
  }
  linkBatchLen = 0;
}

// AkWriter's tee: every finished frame joins the batch. txLock held (AkWriter's rule).
static void linkOffer(const uint8_t *f, size_t n) {
  if (!linkLive.up) return;
  if (linkBatchLen + n > LINK_PAYLOAD_MAX) linkFlush();
  if (!linkBatchLen) linkBatchMs = millis();
  memcpy(linkBatch + LINK_HDR + linkBatchLen, f, n);
  linkBatchLen += n;
}

static void linkFlushNow() {
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(20))) {
    linkFlush();
    xSemaphoreGive(txLock);
  }
}

static void linkEnd(const char *why) {
  if (!linkLive.up) return;
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(50))) {
    linkFlush();
    linkLive.up = false;
    linkBatchLen = 0;
    xSemaphoreGive(txLock);
  } else {
    linkLive.up = false;
  }
  logf("link: session ended (%s); relays unchanged", why);
}

static void linkOnHello(const uint8_t *d, size_t n, uint32_t ip, uint16_t port, uint32_t now) {
  static uint32_t lastHelloMs = 0;
  const LinkHdr *h = (const LinkHdr *)d;
  if (h->length != 16 || h->session != 0) { linkBad++; return; }
  if (lastHelloMs && now - lastHelloMs < LINK_HELLO_GAP_MS) return;   // before the HMAC: cheap to refuse
  lastHelloMs = now;
  if (!linkTagOk(linkKey, d, n)) { linkBad++; return; }
  const uint8_t *hostNonce = d + LINK_HDR;
  uint8_t boardNonce[16];
  esp_fill_random(boardNonce, sizeof(boardNonce));
  uint32_t id;
  do { id = esp_random(); } while (id == 0 || id == linkLive.id);
  uint8_t msg[12 + 4 + 16 + 16];
  memcpy(msg, "AKN1 session", 12);
  memcpy(msg + 12, &id, 4);
  memcpy(msg + 16, hostNonce, 16);
  memcpy(msg + 32, boardNonce, 16);
  LinkSession p = {};
  hmacSha256(linkKey, msg, sizeof(msg), nullptr, 0, p.key);
  p.up = true;
  p.id = id;
  p.ip = ip;
  p.port = port;
  p.createdMs = now;
  p.lastMs = now;
  static uint8_t out[LINK_HDR + 32 + 32 + LINK_TAG];
  size_t fwn = strlen(FW_VERSION) > 31 ? 31 : strlen(FW_VERSION);
  memcpy(out + LINK_HDR, hostNonce, 16);
  memcpy(out + LINK_HDR + 16, boardNonce, 16);
  memcpy(out + LINK_HDR + 32, FW_VERSION, fwn);
  linkPending = p;
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(20))) {
    linkSendRaw(out, LK_WELCOME, id, 0, 32 + fwn, linkKey, ip, port);
    xSemaphoreGive(txLock);
  }
}

// A COMMAND frame inside a CMD datagram: the same checks as on USB, then the same handler.
static void linkOnCommand(const uint8_t *f, size_t n) {
  if (n < sizeof(ak_header_t) + 2) { linkBad++; return; }
  const ak_header_t *h = (const ak_header_t *)f;
  if (h->sync[0] != 0xAA || h->sync[1] != 0x55 || h->version != AK_PROTOCOL_VERSION || h->type != 0x06
      || h->length > 256 || sizeof(ak_header_t) + h->length + 2 != n) {
    linkBad++;
    return;
  }
  uint16_t crc;
  memcpy(&crc, f + sizeof(ak_header_t) + h->length, 2);
  if (ak_crc16(f + 2, sizeof(ak_header_t) - 2 + h->length) != crc) { linkBad++; return; }
  char js[257];
  memcpy(js, f + sizeof(ak_header_t), h->length);
  js[h->length] = 0;
  linkCmds++;
  handleCommand(js);                            // switches, logs, and sends a STATUS ...
  linkFlushNow();                               // ... which leaves now, not in 20 ms
}

static void linkHandle(const uint8_t *d, size_t n, uint32_t ip, uint16_t port) {
  uint32_t now = millis();
  if (n < LINK_HDR + LINK_TAG || n > LINK_DGRAM_MAX) { linkBad++; return; }
  const LinkHdr *h = (const LinkHdr *)d;
  if (memcmp(h->magic, "AKN1", 4) != 0 || h->length != n - LINK_HDR - LINK_TAG) { linkBad++; return; }
  if (h->kind == LK_HELLO) {
    linkOnHello(d, n, ip, port, now);
    return;
  }
  if (h->kind != LK_READY && h->kind != LK_CMD && h->kind != LK_KEEPALIVE && h->kind != LK_BYE) {
    linkBad++;                                  // WELCOME and DATA travel the other way
    return;
  }
  LinkSession *s = nullptr;
  if (h->kind == LK_READY && linkPending.up && h->session == linkPending.id) s = &linkPending;
  else if (h->kind != LK_READY && linkLive.up && h->session == linkLive.id) s = &linkLive;
  if (!s || ip != s->ip || port != s->port) { linkBad++; return; }
  if (!linkTagOk(s->key, d, n)) { linkBad++; return; }
  if (h->counter <= s->rx) { linkReplays++; return; }
  s->rx = h->counter;
  s->lastMs = now;
  if (s == &linkPending) {
    bool replaced = linkLive.up;
    if (xSemaphoreTake(txLock, pdMS_TO_TICKS(50))) {
      linkBatchLen = 0;
      linkLive = linkPending;
      linkLive.tx = 0;
      linkPending.up = false;
      xSemaphoreGive(txLock);
    } else {
      return;                                   // try again on the laptop's next READY
    }
    linkSessions++;
    logf("link: JARVIS at %s:%u, session %08lx%s; streaming", IPAddress(ip).toString().c_str(), port,
         (unsigned long)linkLive.id, replaced ? " (replaced the previous one)" : "");
    sendStatus();                               // the relays, first thing
    linkFlushNow();
    return;
  }
  if (h->kind == LK_BYE) {
    linkEnd("JARVIS said goodbye");
  } else if (h->kind == LK_CMD) {
    linkOnCommand(d + LINK_HDR, h->length);
  }
}

static uint8_t linkHex(char c) { return c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10; }

static void startLink() {
#if LINK_ENABLED
  if (linkSock >= 0) return;
  const char *hex = LINK_KEY_VALUE;
  for (int i = 0; i < 32; i++) linkKey[i] = (uint8_t)(linkHex(hex[2 * i]) << 4 | linkHex(hex[2 * i + 1]));
  // A fingerprint to show (the app shows its own): equal means the same key, without
  // either side ever printing the key. SHA-256("AKN1 fingerprint" | key), 4 bytes.
  uint8_t fp[32], msg[16 + 32];
  memcpy(msg, "AKN1 fingerprint", 16);
  memcpy(msg + 16, linkKey, 32);
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), msg, sizeof(msg), fp);
  snprintf(linkKeyFp, sizeof(linkKeyFp), "%02x%02x%02x%02x", fp[0], fp[1], fp[2], fp[3]);
  int s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (s < 0) {
    logf("link: no UDP socket (errno %d); USB only", errno);
    return;
  }
  struct sockaddr_in a = {};
  a.sin_family = AF_INET;
  a.sin_port = htons(LINK_PORT);
  a.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(s, (struct sockaddr *)&a, sizeof(a)) < 0) {
    logf("link: cannot bind UDP %d (errno %d); USB only", LINK_PORT, errno);
    closesocket(s);
    return;
  }
  linkSock = s;
  logf("link: listening on UDP %d (key %s)", LINK_PORT, linkKeyFp);
#endif
}

static void pumpLink() {
  if (linkSock < 0) return;
  static uint8_t in[LINK_DGRAM_MAX + 1];
  for (int i = 0; i < 4; i++) {
    struct sockaddr_in from = {};
    socklen_t fl = sizeof(from);
    int n = -1;
    if (xSemaphoreTake(txLock, pdMS_TO_TICKS(5))) {   // the socket's sends happen under it
      n = recvfrom(linkSock, in, sizeof(in), MSG_DONTWAIT, (struct sockaddr *)&from, &fl);
      xSemaphoreGive(txLock);
    }
    if (n <= 0) return;
    linkHandle(in, (size_t)n, from.sin_addr.s_addr, ntohs(from.sin_port));
  }
}

static void linkTick(uint32_t now) {
  if (linkPending.up && now - linkPending.createdMs > LINK_PENDING_MS) linkPending.up = false;
  if (linkLive.up && now - linkLive.lastMs > LINK_TIMEOUT_MS) linkEnd("no keepalive for 10 s");
  if (linkBatchLen && now - linkBatchMs >= LINK_FLUSH_MS) linkFlushNow();
}

static void startMdns() {
  if (mdnsUp) return;
  if (!MDNS.begin(OTA_HOSTNAME)) {
    logf("mdns: could not start; use the board's IP");
    return;
  }
  MDNS.addService("http", "tcp", 80);
#if LINK_ENABLED
  MDNS.addService("aankhen", "udp", LINK_PORT);
#endif
#if OTA_ENABLED
  MDNS.enableArduino(3232, true);              // what ArduinoOTA would have announced
#endif
  mdnsUp = true;
  logf("mdns: %s.local", OTA_HOSTNAME);
}

// ------------------------------------------------------------------ status
// The STATUS JSON, for the USB frame, the Wi-Fi link and GET /status with the token.
// Under 1024 bytes (protocol.py MAX_PAYLOAD_BY_TYPE[STATUS]): 3.5.0 at its longest with
// the default relay table (five relays, a phone, a session, every counter at 10 digits)
// is 872 bytes; the tests rebuild that worst case (aankhen/tests/test_netlink.py).
// STATUS_MAX: config above. A longer table that would not fit sends a short STATUS that
// still carries the relays, never a cut-off JSON.
static void buildStatus(char *js, size_t jsLen) {
  uint32_t nowMs = millis();
  csiRate.update(csiCaptured, nowMs);
  beaconRate.update(beaconCaptured, nowMs);
  uint32_t hz = (uint32_t)(csiRate.hz + 0.5f);
  char relays[200], pins[176];
  int rn = snprintf(relays, sizeof(relays), "{");
  int pn = snprintf(pins, sizeof(pins), "{");
  for (size_t i = 0; i < sizeof(RELAYS) / sizeof(RELAYS[0]); i++) {
    rn += snprintf(relays + rn, sizeof(relays) - rn, "%s\"%s\":%s", i ? "," : "", RELAYS[i].name,
                   RELAYS[i].pin < 0 ? "null" : (RELAYS[i].on ? "true" : "false"));
    pn += snprintf(pins + pn, sizeof(pins) - pn, "%s\"%s\":%d", i ? "," : "", RELAYS[i].name, RELAYS[i].pin);
  }
  snprintf(relays + rn, sizeof(relays) - rn, "}");
  snprintf(pins + pn, sizeof(pins) - pn, "}");
  // The Wi-Fi link: the key's fingerprint (never the key), the laptop it streams to, counts.
  char net[200];
#if LINK_ENABLED
  char peer[24] = "null";
  if (linkLive.up) snprintf(peer, sizeof(peer), "\"%s:%u\"", IPAddress(linkLive.ip).toString().c_str(), linkLive.port);
  snprintf(net, sizeof(net), "{\"key\":\"%s\",\"port\":%d,\"peer\":%s,\"dgrams\":%lu,\"cmds\":%lu,\"bad\":%lu,\"replays\":%lu,\"fail\":%lu}",
           linkKeyFp, LINK_PORT, peer, (unsigned long)linkDgrams, (unsigned long)linkCmds, (unsigned long)linkBad,
           (unsigned long)linkReplays, (unsigned long)linkSendFail);
#else
  snprintf(net, sizeof(net), "null");
#endif
  // Link 2, the phone's own numbers: the board's view of it, beside the host's (links.py).
  char phoneIp[20] = "null", rssi[8] = "null", beacon[200];
  if (beaconIp) snprintf(phoneIp, sizeof(phoneIp), "\"%s\"", IPAddress(beaconIp).toString().c_str());
  if (beaconIp && beaconHeard) snprintf(rssi, sizeof(rssi), "%d", beaconRssi);
  snprintf(beacon, sizeof(beacon),
           "{\"ip\":%s,\"mac_known\":%s,\"pings_ok\":%lu,\"rate_hz\":%lu,\"rssi\":%s,\"dropped\":%lu,\"rejected\":%lu,\"fallback\":%s}",
           phoneIp, beaconMacSlot >= 0 ? "true" : "false", (unsigned long)beaconPingsOk,
           (unsigned long)(beaconIp ? beaconRate.hz + 0.5f : 0.0f), rssi,
           (unsigned long)beaconDropped, (unsigned long)beaconRejected, beaconFallback ? "true" : "false");
  int n = snprintf(js, jsLen,
           "{\"fw\":\"%s\",\"uptime_s\":%.1f,\"relays\":%s,\"relay_pins\":%s,\"wifi\":\"%s\",\"ip\":\"%s\","
           "\"mdns\":%s,\"rssi\":%d,"
           "\"channel\":%d,\"csi_hz\":%lu,\"csi_dropped\":%lu,\"csi_rejected\":%lu,"
           "\"radar_frames\":%lu,\"radar_bad\":%lu,\"mqtt\":%s,\"http\":%s,"
           "\"heap_free\":%lu,\"crc_ok\":%s,\"gain\":\"%s\",\"ota\":%s,\"reset\":\"%s\","
           "\"beacon_enabled\":%s,\"beacon\":%s,\"net\":%s}",
           FW_VERSION, esp_timer_get_time() / 1e6, relays, pins,
           WiFi.status() == WL_CONNECTED ? "connected" : "connecting",
           WiFi.localIP().toString().c_str(), mdnsUp ? "\"" OTA_HOSTNAME ".local\"" : "null", WiFi.RSSI(), WiFi.channel(),
           (unsigned long)hz, (unsigned long)csiDropped, (unsigned long)csiRejected,
           (unsigned long)radarFrames, (unsigned long)radarBad,
           mqttUp ? "true" : "false", httpEnabled ? "true" : "false",
           (unsigned long)ESP.getFreeHeap(), ak_crc_self_test() ? "true" : "false",
           !AK_GAIN_CTRL ? "unavailable" : gainRecorded < GAIN_BASELINE_PACKETS ? "recording" : "compensated",
           otaUp ? "true" : "false", resetReason(), BEACON_ENABLED ? "true" : "false", beacon, net);
  if (n < 0 || (size_t)n >= jsLen) {
    snprintf(js, jsLen, "{\"fw\":\"%s\",\"relays\":%s,\"ip\":\"%s\",\"note\":\"STATUS too long: shorten the relay names\"}",
             FW_VERSION, relays, WiFi.localIP().toString().c_str());
  }
}

static void sendStatus() {
  char js[STATUS_MAX];
  buildStatus(js, sizeof(js));
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(20))) {
    ak.text(AK_STATUS, js);
    xSemaphoreGive(txLock);
  }
}

// ------------------------------------------------------------------ OTA
// ArduinoOTA.handle() runs the whole transfer inside loop() (~1 MB, 10-30 s), so loop()
// stops draining the CSI queues anyway. Sensing is paused for it on purpose: the 500 Hz
// router pings and the phone's would compete with the upload for the same airtime. If
// the update fails, sensing resumes; if it succeeds, the board restarts into the new
// firmware with the relays as they were (RELAYS ACROSS A FIRMWARE UPDATE).
static void dropPhone(const char *why);

static bool sensingPaused = false;

static void pauseSensing() {
  if (sensingPaused) return;
  sensingPaused = true;
  dropPhone("firmware update");
  if (pingHandle) esp_ping_stop(pingHandle);
  esp_wifi_set_csi(false);
}

// Only what pauseSensing() stopped: an error before the transfer began (a wrong
// password, no room for the image) never paused anything.
static void resumeSensing() {
  if (!sensingPaused) return;
  sensingPaused = false;
  esp_wifi_set_csi(true);
  if (pingHandle) esp_ping_start(pingHandle);
}

static void startOta() {
#if OTA_ENABLED
  if (otaUp) return;
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASS_VALUE);
  ArduinoOTA.setMdnsEnabled(false);            // startMdns() owns mDNS and announces OTA itself
  ArduinoOTA.onStart([]() {
    otaLastTenth = -1;
    pauseSensing();
    logf("ota: receiving new firmware; sensing paused");
  });
  ArduinoOTA.onProgress([](unsigned int done, unsigned int total) {
    int8_t tenth = total ? (int8_t)(10ull * done / total) : 0;
    if (tenth != otaLastTenth) {
      otaLastTenth = tenth;
      logf("ota: %d %%", tenth * 10);
    }
  });
  ArduinoOTA.onEnd([]() {
    keepRelaysForRestart();
    logf("ota: written and verified; restarting into it");
  });
  ArduinoOTA.onError([](ota_error_t e) {
    const char *why = e == OTA_AUTH_ERROR ? "wrong password" : e == OTA_BEGIN_ERROR ? "no room for the image"
                    : e == OTA_CONNECT_ERROR ? "could not connect back" : e == OTA_RECEIVE_ERROR ? "upload stalled"
                    : "image failed its check";
    logf("ota: failed (%s)%s", why, sensingPaused ? "; sensing resumes" : "");
    resumeSensing();
  });
  ArduinoOTA.begin();
  otaUp = true;
  logf("ota: listening on UDP 3232 as %s", OTA_HOSTNAME);
#endif
}

// ------------------------------------------------------------------ Wi-Fi
static void connectWifi() {
  WiFi.mode(WIFI_STA);
  esp_wifi_get_mac(WIFI_IF_STA, ownMac);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID_VALUE, WIFI_PASS_VALUE);
  logf("joining %s", WIFI_SSID_VALUE);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) delay(250);
  if (WiFi.status() != WL_CONNECTED) {
    logf("wifi: not connected yet, will keep trying (no access point fallback)");
    return;
  }
  esp_wifi_set_ps(WIFI_PS_NONE);                    // power save would starve CSI
  memcpy(routerBssid, WiFi.BSSID(), 6);
  haveBssid = true;
  logf("wifi: %s ch %d rssi %d bssid %02x:%02x:%02x:%02x:%02x:%02x", WiFi.localIP().toString().c_str(),
       WiFi.channel(), WiFi.RSSI(), routerBssid[0], routerBssid[1], routerBssid[2], routerBssid[3],
       routerBssid[4], routerBssid[5]);
#if BEACON_ENABLED
  logf("link 2: a phone on this Wi-Fi (2.4 GHz) can open http://%s/beacon", WiFi.localIP().toString().c_str());
#endif
  startPing();
  startOta();
  startMdns();
  startLink();
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.setTxBufferSize(16384);
  Serial.begin(921600);            // native USB ignores the rate; a UART bridge needs it
  Serial.setTxTimeoutMs(0);        // never block when no host is reading: drop instead
  txLock = xSemaphoreCreateMutex();
  ak.tee = linkOffer;              // every frame also joins the Wi-Fi batch (sent only with a session)
  csiQueue = xQueueCreate(CSI_QUEUE_DEPTH, sizeof(CsiItem));
  linkQueue = xQueueCreate(BEACON_QUEUE_DEPTH, sizeof(CsiItem));
  delay(300);
  logf("%s booting, protocol v%d, crc self-test %s", FW_VERSION, AK_PROTOCOL_VERSION,
       ak_crc_self_test() ? "ok" : "FAILED");

  const char *relaysAtBoot = bootRelays();   // everything off, unless an OTA restart kept them
  logf("reset: %s; relays %s", resetReason(), relaysAtBoot);
  Serial1.begin(RADAR_BAUD, SERIAL_8N1, RADAR_RX_PIN, RADAR_TX_PIN);

  connectWifi();
  startCsi();
  startMqtt();
  startHttp();
}

void loop() {
  // CSI: drain the queues in bursts. Link 1 first: it is what the engine runs on.
  drainCsi(csiQueue, 16);
  drainCsi(linkQueue, 8);
  pumpRadar();
  pumpCommands();
  pumpLink();
  if (webUp) http.handleClient();
#if OTA_ENABLED
  if (otaUp) ArduinoOTA.handle();
#endif

  static uint32_t lastStatus = 0, lastWifiTry = 0;
  uint32_t now = millis();
  phoneTick(now);                  // before any reconnect: a lost link drops the phone first
  linkTick(now);
  if (now - lastStatus >= 1000) {
    lastStatus = now;
    sendStatus();
  }
  if (WiFi.status() != WL_CONNECTED && now - lastWifiTry > 15000) {
    lastWifiTry = now;
    haveBssid = false;
    connectWifi();
  }
  delay(1);
}
