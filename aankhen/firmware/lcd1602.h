// A minimal driver for an HD44780 16x2 character LCD ("1602"), 4-bit, write-only.
// No library: six GPIOs (config.h, LCD_*_PIN), RW tied to GND on the display, so the
// display only ever listens and its 5 V never reaches the ESP32's 3.3 V pins. The
// HD44780 reads 2.2 V and up as a 1 at 5 V supply, so 3.3 V logic drives it directly.
// Timing follows the HD44780 datasheet (4-bit initialisation, figure 24): ~10 ms at
// begin(), then ~1.8 ms to rewrite a full row.
#pragma once
#include <Arduino.h>

class Lcd1602 {
 public:
  void begin() {
    const int pins[6] = {LCD_RS_PIN, LCD_E_PIN, LCD_D4_PIN, LCD_D5_PIN, LCD_D6_PIN, LCD_D7_PIN};
    for (int p : pins) {
      digitalWrite(p, LOW);
      pinMode(p, OUTPUT);
    }
    delay(50);                      // the controller needs >40 ms after VDD rises
    nibble(0x03); delayMicroseconds(4500);
    nibble(0x03); delayMicroseconds(4500);
    nibble(0x03); delayMicroseconds(150);
    nibble(0x02);                   // now in 4-bit mode
    command(0x28);                  // 4-bit bus, 2 lines, 5x8 font
    command(0x0C);                  // display on, cursor off, no blink
    command(0x06);                  // write left to right, no shift
    command(0x01);                  // clear
    delayMicroseconds(2000);
  }

  // Writes exactly 16 characters on row 0 or 1, padding with spaces.
  void row(uint8_t r, const char *text) {
    command(0x80 | (r ? 0x40 : 0x00));
    bool ended = false;
    for (int i = 0; i < 16; i++) {
      if (!ended && text[i] == 0) ended = true;
      send((uint8_t)(ended ? ' ' : text[i]), true);
    }
  }

 private:
  void pulse() {
    digitalWrite(LCD_E_PIN, HIGH);
    delayMicroseconds(1);
    digitalWrite(LCD_E_PIN, LOW);
    delayMicroseconds(50);          // most instructions take 37 us
  }
  void nibble(uint8_t n) {
    digitalWrite(LCD_D4_PIN, n & 1);
    digitalWrite(LCD_D5_PIN, (n >> 1) & 1);
    digitalWrite(LCD_D6_PIN, (n >> 2) & 1);
    digitalWrite(LCD_D7_PIN, (n >> 3) & 1);
    pulse();
  }
  void send(uint8_t v, bool data) {
    digitalWrite(LCD_RS_PIN, data ? HIGH : LOW);
    nibble(v >> 4);
    nibble(v & 0x0F);
  }
  void command(uint8_t c) { send(c, false); }
};
