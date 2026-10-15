// JARVIS limbs: Arduino Uno driving a 2-channel relay board (HL-52S, Songle SRD-05VDC).
//
// Wiring (no breadboard needed, jumpers go straight into the Uno's headers):
//   relay VCC -> Uno 5V      relay GND -> Uno GND
//   relay IN1 -> Uno D4 (light)   relay IN2 -> Uno D5 (fan)
//   keep the yellow jumper on the relay board's VCC-JDVCC pins.
//
// Serial, 115200 baud, one command per line:
//   light on | light off | light toggle
//   fan on   | fan off   | fan toggle
//   all off  | status    | help
//   scan     (clicks D2..D13 one by one, to find where a wire is plugged)
// Every reply is one JSON line, e.g. {"light":true,"fan":false}

const uint8_t PIN_LIGHT = 4;
const uint8_t PIN_FAN = 5;
const bool ACTIVE_LOW = true;              // HL-52S: IN pulled LOW = relay ON
const unsigned long MIN_SWITCH_MS = 250;   // ignore faster flips, saves the relay contacts

struct Relay {
  const char *name;
  uint8_t pin;
  bool on;
  unsigned long lastSwitch;
};

Relay relays[] = {
  {"light", PIN_LIGHT, false, 0},
  {"fan", PIN_FAN, false, 0},
};
const uint8_t RELAY_COUNT = sizeof(relays) / sizeof(relays[0]);

char line[48];
uint8_t lineLen = 0;

uint8_t levelFor(bool on) {
  return (on != ACTIVE_LOW) ? HIGH : LOW;
}

void writeRelay(Relay &r, bool on) {
  digitalWrite(r.pin, levelFor(on));
  r.on = on;
  r.lastSwitch = millis();
}

void printStatus() {
  Serial.print('{');
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    if (i) Serial.print(',');
    Serial.print('"');
    Serial.print(relays[i].name);
    Serial.print("\":");
    Serial.print(relays[i].on ? "true" : "false");
  }
  Serial.println('}');
}

void printError(const char *msg) {
  Serial.print("{\"error\":\"");
  Serial.print(msg);
  Serial.println("\"}");
}

Relay *findRelay(const char *name) {
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    if (strcmp(relays[i].name, name) == 0) return &relays[i];
  }
  return nullptr;
}

// Pulses each free pin LOW for 1 s so a relay wired to it clicks. The relay pins are skipped
// because they are already known; D0/D1 are the USB serial link and are never touched.
void scanPins() {
  Serial.println("{\"scan\":\"start\",\"note\":\"listen for a click; the pin printed just before it is your wire\"}");
  for (uint8_t pin = 2; pin <= 13; pin++) {
    bool isRelay = false;
    for (uint8_t i = 0; i < RELAY_COUNT; i++) if (relays[i].pin == pin) isRelay = true;
    if (isRelay) continue;
    Serial.print("{\"scan_pin\":");
    Serial.print(pin);
    Serial.println('}');
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
    delay(1000);
    pinMode(pin, INPUT);   // back to floating, which the relay board reads as OFF
    delay(400);
  }
  Serial.println("{\"scan\":\"done\"}");
}

void handle(char *cmd) {
  for (char *p = cmd; *p; p++) *p = tolower(*p);
  char *word1 = strtok(cmd, " \t");
  char *word2 = strtok(nullptr, " \t");
  if (!word1) return;

  if (strcmp(word1, "status") == 0) { printStatus(); return; }
  if (strcmp(word1, "help") == 0) {
    Serial.println("{\"help\":\"light|fan on|off|toggle, all off, status, scan\"}");
    return;
  }
  if (strcmp(word1, "scan") == 0) { scanPins(); printStatus(); return; }
  if (strcmp(word1, "all") == 0 && word2 && strcmp(word2, "off") == 0) {
    for (uint8_t i = 0; i < RELAY_COUNT; i++) writeRelay(relays[i], false);
    printStatus();
    return;
  }

  Relay *r = findRelay(word1);
  if (!r) { printError("unknown device"); return; }
  if (!word2) { printError("say on, off or toggle"); return; }

  bool target;
  if (strcmp(word2, "on") == 0) target = true;
  else if (strcmp(word2, "off") == 0) target = false;
  else if (strcmp(word2, "toggle") == 0) target = !r->on;
  else { printError("say on, off or toggle"); return; }

  if (target != r->on && millis() - r->lastSwitch < MIN_SWITCH_MS) {
    printError("too fast, wait a moment");
    return;
  }
  if (target != r->on) writeRelay(*r, target);
  printStatus();
}

void setup() {
  // Set the OFF level before the pin becomes an output, so a relay never blips on at boot.
  for (uint8_t i = 0; i < RELAY_COUNT; i++) {
    digitalWrite(relays[i].pin, levelFor(false));
    pinMode(relays[i].pin, OUTPUT);
    relays[i].on = false;
  }
  Serial.begin(115200);
  Serial.println("{\"board\":\"jarvis-uno-relay\",\"version\":\"1.0.0\",\"pins\":{\"light\":4,\"fan\":5}}");
  printStatus();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (lineLen) {
        line[lineLen] = '\0';
        handle(line);
        lineLen = 0;
      }
    } else if (lineLen < sizeof(line) - 1) {
      line[lineLen++] = c;
    }
  }
}
