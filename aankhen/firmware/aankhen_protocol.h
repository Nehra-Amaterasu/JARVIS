// Aankhen wire protocol — the C side of aankhen/protocol.py.
//
// Both files describe ONE contract; change them together and bump
// AK_PROTOCOL_VERSION when you do. Frame layout (little-endian):
//
//   offset size field
//   0      2    SYNC        0xAA 0x55
//   2      1    VERSION     AK_PROTOCOL_VERSION
//   3      1    TYPE        ak_type_t
//   4      2    LENGTH      payload bytes
//   6      2    SEQ         per-type counter, wraps at 65536 (host counts gaps)
//   8      8    TIMESTAMP   esp_timer_get_time(), microseconds since boot
//   16     N    PAYLOAD
//   16+N   2    CRC16       CRC-16/CCITT-FALSE over bytes [2 .. 16+N)
//
// The CSI payload is the 16-byte ak_csi_meta_t below followed by the raw CSI
// buffer, exactly as esp_wifi_set_csi_rx_cb delivered it (imaginary first, FFT bin
// order). The firmware does NO processing: a recording can be re-analysed with any
// future algorithm, and every conversion lives in one place (aankhen/csi.py).
#pragma once
#include <Arduino.h>

#define AK_PROTOCOL_VERSION 1
#define AK_MAX_CSI_BYTES 640          // matches MAX_PAYLOAD_BY_TYPE[CSI] - 16 on the host

typedef enum : uint8_t {
  AK_CSI = 0x01,     // one Wi-Fi CSI capture
  AK_RADAR = 0x02,   // one raw HLK-LD2450 frame (30 bytes), forwarded unmodified
  AK_STATUS = 0x03,  // 1 Hz device health, JSON text
  AK_LOG = 0x04,     // free-text log line (never plain prints: they'd break framing)
  AK_RSSI = 0x05,
  AK_CSI_GAIN = 0x07,  // a CSI capture plus the receiver gain it was taken with
} ak_type_t;

#pragma pack(push, 1)
typedef struct {
  uint8_t sync[2];
  uint8_t version;
  uint8_t type;
  uint16_t length;
  uint16_t seq;
  uint64_t timestamp_us;
} ak_header_t;

// Mirrors CSI_META_FMT = "<bbBBBBBB6sH" in protocol.py.
typedef struct {
  int8_t rssi;
  int8_t noise_floor;
  uint8_t channel;
  uint8_t secondary_channel;
  uint8_t sig_mode;
  uint8_t cwb;
  uint8_t stbc;
  uint8_t first_word_invalid;
  uint8_t mac[6];
  uint16_t csi_len;
} ak_csi_meta_t;

// Mirrors CSI_GAIN_FMT = "<Bbh" in protocol.py. In AK_CSI_GAIN frames it sits between
// the metadata and the CSI buffer. comp_cdb = 2000 * log10(compensation factor), the
// factor from esp_csi_gain_ctrl_get_gain_compensation; AK_GAIN_UNKNOWN while the
// gain baseline is still being recorded.
typedef struct {
  uint8_t agc_gain;
  int8_t fft_gain;
  int16_t comp_cdb;
} ak_csi_gain_t;

typedef struct {
  ak_csi_meta_t meta;
  ak_csi_gain_t gain;
} ak_csi_meta_gain_t;
#pragma pack(pop)

#define AK_GAIN_UNKNOWN (-32768)

static_assert(sizeof(ak_header_t) == 16, "header must be 16 bytes (HEADER_FMT <2sBBHHQ)");
static_assert(sizeof(ak_csi_meta_t) == 16, "CSI meta must be 16 bytes (CSI_META_FMT)");
static_assert(sizeof(ak_csi_gain_t) == 4, "gain block must be 4 bytes (CSI_GAIN_FMT)");
static_assert(sizeof(ak_csi_meta_gain_t) == 20, "meta + gain must be contiguous");

// CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xorout.
// Check value for "123456789" is 0x29B1 — the same vector the Python tests assert,
// and the firmware verifies it at boot (ak_crc_self_test).
static inline uint16_t ak_crc16(const uint8_t *data, size_t n, uint16_t crc = 0xFFFF) {
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)data[i] << 8;
    for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

static inline bool ak_crc_self_test() {
  const char *v = "123456789";
  return ak_crc16((const uint8_t *)v, 9) == 0x29B1;
}

// Writes whole frames to a Print (the USB serial port). One writer at a time: the
// caller holds the lock, so frames from different tasks never interleave.
class AkWriter {
 public:
  explicit AkWriter(Print &out) : out_(out) {}

  void frame(ak_type_t type, uint64_t ts_us, const uint8_t *p1, size_t n1,
             const uint8_t *p2 = nullptr, size_t n2 = 0) {
    ak_header_t h;
    h.sync[0] = 0xAA;
    h.sync[1] = 0x55;
    h.version = AK_PROTOCOL_VERSION;
    h.type = type;
    h.length = (uint16_t)(n1 + n2);
    h.seq = seq_[type & 0x07]++;
    h.timestamp_us = ts_us;
    const uint8_t *hb = (const uint8_t *)&h;
    uint16_t crc = ak_crc16(hb + 2, sizeof(h) - 2);
    crc = ak_crc16(p1, n1, crc);
    if (n2) crc = ak_crc16(p2, n2, crc);
    out_.write(hb, sizeof(h));
    out_.write(p1, n1);
    if (n2) out_.write(p2, n2);
    out_.write((const uint8_t *)&crc, 2);
  }

  void text(ak_type_t type, const char *s) {
    frame(type, esp_timer_get_time(), (const uint8_t *)s, strlen(s));
  }

 private:
  Print &out_;
  uint16_t seq_[8] = {0};
};
