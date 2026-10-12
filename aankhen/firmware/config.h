// Board wiring for the Aankhen ESP32-S3. Tracked in git (no secrets here —
// those live in secrets.h). Change these to match how YOUR board is wired.
#pragma once

// ---- LD2450 radar (UART1) ----------------------------------------------------
#define RADAR_RX_PIN 18           // ESP32 RX  <- LD2450 TX
#define RADAR_TX_PIN 17           // ESP32 TX  -> LD2450 RX
#define RADAR_BAUD 256000

// ---- Relays ------------------------------------------------------------------
// Typical 5 V relay modules with an optocoupler switch ON when the input is pulled
// LOW ("active low"). If yours clicks ON at boot and OFF when told "on", flip this.
#define RELAY_ACTIVE_LOW 1
// GPIO 4 and 5 are free general-purpose pins on the ESP32-S3-DevKitC-1 (not strapping
// pins, not USB, not flash/PSRAM). Set a pin to -1 to disable that relay entirely.
#define RELAY_LIGHT_PIN 4
#define RELAY_FAN_PIN 5
