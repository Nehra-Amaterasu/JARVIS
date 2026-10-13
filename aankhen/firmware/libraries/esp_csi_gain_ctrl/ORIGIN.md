# Origin of this vendored library

- Package: `espressif/esp_csi_gain_ctrl` **0.1.5**, ESP Component Registry
  (source repository: https://github.com/espressif/esp-csi). Licence: Apache-2.0,
  `LICENSE` here, unmodified.
- Registry archive: 376,319 bytes, sha256
  `db6a8b2d2496423b82f30b082a99f0f05ee4b940b65e35e39038b3227c719616`.
- Taken from it, unmodified:
  - `include/esp_csi_gain_ctrl.h` → `src/esp_csi_gain_ctrl.h`
    (sha256 `a54aff498d6b740fd5a5a7eab971e09ec15dbcf2ec9c74bded950589880fe164`)
  - `5.5/esp32s3/libesp_csi_gain_ctrl.a` → `src/esp32s3/libesp_csi_gain_ctrl.a`
    (sha256 `acfa3767e5356bc2782ddd7c1b8cf40979ff3ced784dca0da03d927811618b87`)
- Only the ESP32-S3 / ESP-IDF 5.5 build is kept: the Arduino-ESP32 core 3.3.x is IDF
  5.5, and an archive built for another IDF version does not link.
- Closed source: the archive is a single object (`esp_csi_gain_ctrl.c.obj`). Its outside
  references are libc/libm, `esp_log`, and `phy_force_rx_gain` / `phy_fft_scale_force`
  from the core's `libphy.a`, which defines both (presumably for the forced-gain mode,
  which Aankhen does not call).
- `library.properties` is ours (Arduino's precompiled-library format), not Espressif's.
