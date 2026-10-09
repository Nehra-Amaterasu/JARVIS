// Copy this file to secrets.h and fill it in. secrets.h is gitignored, so none of
// this ever reaches the repository.
#pragma once

// Wi-Fi: the ESP32-S3 is 2.4 GHz only. The router you join is the CSI transmitter.
#define WIFI_SSID_VALUE "your-2.4GHz-network"
#define WIFI_PASS_VALUE "your-wifi-password"

// Relay control over HTTP needs a long random token (>= 16 characters). Leave it
// commented out and HTTP relay control stays disabled. Make one with:
//   python -c "import secrets; print(secrets.token_urlsafe(24))"
// #define RELAY_TOKEN_VALUE "paste-a-long-random-token-here"

// Relay control from JARVIS over MQTT (room.py publishes on jarvis/room/<device>).
// Point it at the laptop running Mosquitto.
// #define MQTT_URI_VALUE  "mqtt://192.168.1.10:1883"
// #define MQTT_USER_VALUE "aankhen"
// #define MQTT_PASS_VALUE "mqtt-password"
