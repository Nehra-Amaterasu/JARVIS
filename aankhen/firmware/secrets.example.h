// Copy this file to secrets.h and fill it in. secrets.h is gitignored, so none of
// this ever reaches the repository.
#pragma once

// Wi-Fi: the ESP32-S3 is 2.4 GHz only. The router you join is the CSI transmitter.
#define WIFI_SSID_VALUE "your-2.4GHz-network"
#define WIFI_PASS_VALUE "your-wifi-password"
// Optional, 3.7.1: a second 2.4 GHz network the board falls back to while the first one is
// off (the room's router on a dead MCB). It returns to the first by itself (config.h).
// #define WIFI_SSID2_VALUE "house-2.4GHz-network"
// #define WIFI_PASS2_VALUE "house-wifi-password"

// Relay control over HTTP needs a long random token (>= 16 characters). Leave it
// commented out and HTTP relay control stays disabled. Make one with:
//   python -c "import secrets; print(secrets.token_urlsafe(24))"
// #define RELAY_TOKEN_VALUE "paste-a-long-random-token-here"

// Firmware updates over Wi-Fi (ArduinoOTA; README.md, "Flash over Wi-Fi"). Leave it
// commented out and OTA stays off: the board then takes new firmware over USB only.
// At least 12 characters, and not this placeholder (the build refuses both). Make one
// with the same command as the token above. The JARVIS app asks for it at each Wi-Fi
// flash and never stores it.
// #define OTA_PASS_VALUE "paste-a-long-random-ota-password"

// The Wi-Fi link to JARVIS (firmware 3.5.0; README.md, section 4c): sensor frames to the
// laptop and relay commands from it over UDP, every datagram signed with HMAC-SHA256
// under this key. The JARVIS app makes the key and shows you this exact line (Limbs ->
// Firmware -> Wi-Fi link -> "Show the secrets.h line"): 64 hex characters, 32 random
// bytes. Leave it commented out and the board talks over USB only.
// #define LINK_KEY_VALUE "the-64-hex-characters-the-jarvis-app-shows-you-go-here-000000000"

// Relay control from JARVIS over MQTT (room.py publishes on jarvis/room/<device>).
// Point it at the laptop running Mosquitto.
// #define MQTT_URI_VALUE  "mqtt://192.168.1.10:1883"
// #define MQTT_USER_VALUE "aankhen"
// #define MQTT_PASS_VALUE "mqtt-password"
