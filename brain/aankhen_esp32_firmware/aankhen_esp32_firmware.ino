// Aankhen ESP32-S3 firmware v3 — the eyes' sensor board.
//
// What it does, and nothing more:
//   1. Joins the home Wi-Fi as a station and pings the router at 100 Hz, so the
//      router's replies give a steady stream of Wi-Fi CSI captures.
//   2. Captures CSI (legacy LTF only, 64 bins = 128 bytes), keeps only packets FROM
//      the router that decoded cleanly, and forwards the raw buffer.
//   3. Forwards every HLK-LD2450 radar frame byte-for-byte.
//   4. Reports its health once a second.
//   5. Switches the room relays when JARVIS asks over MQTT — or over HTTP with a
//      token. Never without one.
// Everything goes to the laptop as CRC-checked binary frames over native USB (see
// aankhen_protocol.h). The laptop does all the maths, so a recording made today can
// be re-analysed by tomorrow's algorithm.
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
#include <esp_wifi.h>
#include <esp_timer.h>
#include "ping/ping_sock.h"
#include "mqtt_client.h"

#include "aankhen_protocol.h"
#include "secrets.h"   // gitignored; copy secrets.example.h

// ------------------------------------------------------------------ config
#define FW_VERSION "aankhen-3.0.0"
#define CSI_RATE_HZ 100           // router pings per second = CSI captures per second
#define CSI_QUEUE_DEPTH 48        // ~0.5 s of slack if the USB host stalls
#define RADAR_RX_PIN 18           // ESP32 RX  <- LD2450 TX
#define RADAR_TX_PIN 17           // ESP32 TX  -> LD2450 RX
#define RADAR_BAUD 256000
// Automatic CSI scaling. The host divides every packet by its own median amplitude,
// so the absolute scale is irrelevant to the detector; automatic scaling keeps the
// int8 samples using their full range, i.e. less quantisation noise.
#define CSI_MANUAL_SCALE 0

// Relays (mains). Leave a pin at -1 until it is wired and checked.
struct Relay { const char *name; int pin; bool active_low; };
static Relay RELAYS[] = {
  {"light", -1, true},
  {"fan", -1, true},
};

#ifndef RELAY_TOKEN_VALUE
#warning "RELAY_TOKEN_VALUE is not set in secrets.h: HTTP relay control is disabled."
#endif

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
static bool httpEnabled = false;

struct CsiItem {
  ak_csi_meta_t meta;
  uint64_t ts;
  uint8_t buf[128];
};

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
// Runs in the Wi-Fi task: copy and get out. No allocation, no printing.
static void IRAM_ATTR onCsi(void *ctx, wifi_csi_info_t *info) {
  if (!info || !info->buf || !haveBssid) return;
  if (memcmp(info->mac, routerBssid, 6) != 0) return;   // only the router's replies
  if (info->rx_ctrl.rx_state != 0) {                     // failed decode = garbage CSI
    csiRejected++;
    return;
  }
  CsiItem item;
  item.ts = esp_timer_get_time();
  item.meta.rssi = info->rx_ctrl.rssi;
  item.meta.noise_floor = info->rx_ctrl.noise_floor;
  item.meta.channel = info->rx_ctrl.channel;
  item.meta.secondary_channel = info->rx_ctrl.secondary_channel;
  item.meta.sig_mode = info->rx_ctrl.sig_mode;
  item.meta.cwb = info->rx_ctrl.cwb;
  item.meta.stbc = info->rx_ctrl.stbc;
  item.meta.first_word_invalid = info->first_word_invalid ? 1 : 0;
  memcpy(item.meta.mac, info->mac, 6);
  uint16_t n = info->len > sizeof(item.buf) ? sizeof(item.buf) : info->len;
  item.meta.csi_len = n;
  memcpy(item.buf, info->buf, n);
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
  if (r.pin < 0) return;
  digitalWrite(r.pin, (on ^ r.active_low) ? HIGH : LOW);
}

static Relay *findRelay(const char *name) {
  for (auto &r : RELAYS)
    if (strcmp(r.name, name) == 0) return &r;
  return nullptr;
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

static void startMqtt() {
#ifdef MQTT_URI_VALUE
  esp_mqtt_client_config_t cfg = {};
  cfg.broker.address.uri = MQTT_URI_VALUE;
#ifdef MQTT_USER_VALUE
  cfg.credentials.username = MQTT_USER_VALUE;
  cfg.credentials.authentication.password = MQTT_PASS_VALUE;
#endif
  mqtt = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, onMqtt, nullptr);
  esp_mqtt_client_start(mqtt);
#endif
}

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

static void startHttp() {
  static const char *hdrs[] = {"X-Aankhen-Token"};
  http.collectHeaders(hdrs, 1);
  http.on("/relay", HTTP_POST, []() {
    if (!tokenOk()) { http.send(401, "application/json", "{\"error\":\"token\"}"); return; }
    Relay *r = findRelay(http.arg("ch").c_str());
    if (!r) { http.send(404, "application/json", "{\"error\":\"no such relay\"}"); return; }
    if (r->pin < 0) { http.send(409, "application/json", "{\"error\":\"relay not wired\"}"); return; }
    bool on = http.arg("on") == "1";
    setRelay(*r, on);
    http.send(200, "application/json", on ? "{\"on\":true}" : "{\"on\":false}");
  });
  http.onNotFound([]() { http.send(404, "text/plain", "not found"); });
  http.begin();
  httpEnabled = true;
}
#endif

// ------------------------------------------------------------------ status
static void sendStatus() {
  static uint32_t lastCaptured = 0;
  uint32_t cap = csiCaptured;
  uint32_t hz = cap - lastCaptured;                 // called once a second
  lastCaptured = cap;
  char js[420];
  snprintf(js, sizeof(js),
           "{\"fw\":\"%s\",\"uptime_s\":%.1f,\"wifi\":\"%s\",\"ip\":\"%s\",\"rssi\":%d,"
           "\"channel\":%d,\"csi_hz\":%lu,\"csi_dropped\":%lu,\"csi_rejected\":%lu,"
           "\"radar_frames\":%lu,\"radar_bad\":%lu,\"mqtt\":%s,\"http\":%s,"
           "\"heap_free\":%lu,\"crc_ok\":%s}",
           FW_VERSION, esp_timer_get_time() / 1e6,
           WiFi.status() == WL_CONNECTED ? "connected" : "connecting",
           WiFi.localIP().toString().c_str(), WiFi.RSSI(), WiFi.channel(),
           (unsigned long)hz, (unsigned long)csiDropped, (unsigned long)csiRejected,
           (unsigned long)radarFrames, (unsigned long)radarBad,
           mqttUp ? "true" : "false", httpEnabled ? "true" : "false",
           (unsigned long)ESP.getFreeHeap(), ak_crc_self_test() ? "true" : "false");
  if (xSemaphoreTake(txLock, pdMS_TO_TICKS(20))) {
    ak.text(AK_STATUS, js);
    xSemaphoreGive(txLock);
  }
}

// ------------------------------------------------------------------ Wi-Fi
static void connectWifi() {
  WiFi.mode(WIFI_STA);
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
  startPing();
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.setTxBufferSize(16384);
  Serial.begin(921600);            // native USB ignores the rate; a UART bridge needs it
  Serial.setTxTimeoutMs(0);        // never block when no host is reading: drop instead
  txLock = xSemaphoreCreateMutex();
  csiQueue = xQueueCreate(CSI_QUEUE_DEPTH, sizeof(CsiItem));
  delay(300);
  logf("%s booting, protocol v%d, crc self-test %s", FW_VERSION, AK_PROTOCOL_VERSION,
       ak_crc_self_test() ? "ok" : "FAILED");

  for (auto &r : RELAYS) {
    if (r.pin >= 0) {
      pinMode(r.pin, OUTPUT);
      setRelay(r, false);           // known state at boot: everything off
    }
  }
  Serial1.begin(RADAR_BAUD, SERIAL_8N1, RADAR_RX_PIN, RADAR_TX_PIN);

  connectWifi();
  startCsi();
  startMqtt();
#ifdef RELAY_TOKEN_VALUE
  startHttp();
#endif
}

void loop() {
  // CSI: drain the queue in bursts.
  CsiItem item;
  int burst = 0;
  while (burst++ < 16 && xQueueReceive(csiQueue, &item, 0) == pdTRUE) {
    if (xSemaphoreTake(txLock, pdMS_TO_TICKS(10))) {
      ak.frame(AK_CSI, item.ts, (const uint8_t *)&item.meta, sizeof(item.meta), item.buf, item.meta.csi_len);
      xSemaphoreGive(txLock);
    }
  }
  pumpRadar();
  if (httpEnabled) http.handleClient();

  static uint32_t lastStatus = 0, lastWifiTry = 0;
  uint32_t now = millis();
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
