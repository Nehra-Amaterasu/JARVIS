/*
 * AANKHEN ESP32-S3 Wi-Fi Sensing & Human Presence Firmware (v4.0)
 * 
 * Hardware: ESP32-S3 (Standalone)
 * Wi-Fi credentials: see secrets.h (gitignored) / secrets.example.h
 * 
 * Features:
 * 1. Connects to the configured 2.4 GHz Wi-Fi network.
 * 2. Enables Wi-Fi Promiscuous Mode to capture raw RF packets and measure RSSI/CSI signal perturbations.
 * 3. Computes Real-Time Motion Index (0 - 100%) and Presence State (PRESENT / ABSENT).
 * 4. Hosts a WebSocket / HTTP Server broadcasting JSON telemetry packets at 10Hz.
 * 5. Prints clean, real-time diagnostic logs over USB Serial (115200 baud).
 */

#include <WiFi.h>
#include <WiFiClient.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <esp_wifi.h>

// --- Wi-Fi Configuration ---
#include "secrets.h"   // WIFI_SSID_VALUE, WIFI_PASS_VALUE, AP_* (gitignored)
const char* WIFI_SSID = WIFI_SSID_VALUE;
const char* WIFI_PASS = WIFI_PASS_VALUE;

// --- Network Servers ---
WebServer server(80);
WebSocketsServer webSocket = WebSocketsServer(81);

// --- Sensing Variables ---
volatile int packetCount = 0;
volatile int lastRSSI = -60;
float rssiVariance = 0.0;
float motionIndex = 0.0; // 0.0 to 100.0%
bool presenceDetected = false;
unsigned long lastPacketTime = 0;
unsigned long lastLogTime = 0;

// --- Wi-Fi Promiscuous Packet Sniffer Callback ---
void IRAM_ATTR wifiSnifferCallback(void* buf, wifi_promiscuous_pkt_type_t type) {
    wifi_promiscuous_pkt_t* pkt = (wifi_promiscuous_pkt_t*)buf;
    int currentRSSI = pkt->rx_ctrl.rssi;
    
    packetCount++;
    lastPacketTime = millis();

    // Compute RSSI variance (RF multipath perturbation caused by human body movement)
    float diff = abs(currentRSSI - lastRSSI);
    rssiVariance = (rssiVariance * 0.85) + (diff * 0.15);
    lastRSSI = currentRSSI;
}

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n========================================================");
    Serial.println("  AANKHEN ESP32-S3 WI-FI SENSING FIRMWARE INITIALIZING  ");
    Serial.println("========================================================");

    // 1. Connect to Wi-Fi
    Serial.printf("[Wi-Fi]: Connecting to SSID: %s ...\n", WIFI_SSID);
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[Wi-Fi]: CONNECTED SUCCESSFULLY!");
        Serial.printf("[Wi-Fi]: ESP32-S3 IP Address: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[Wi-Fi]: Wi-Fi AP not reached, starting Standalone Sensing AP mode...");
        WiFi.softAP(AP_SSID_VALUE, AP_PASS_VALUE);
        Serial.printf("[Wi-Fi]: SoftAP IP Addre ss: %s\n", WiFi.softAPIP().toString().c_str());
    }

    // 2. Enable Wi-Fi Promiscuous Sniffer for RF Body Sensing
    wifi_promiscuous_filter_t filter = { .filter_mask = WIFI_PROMIS_FILTER_MASK_ALL };
    esp_wifi_set_promiscuous_filter(&filter);
    esp_wifi_set_promiscuous_rx_cb(&wifiSnifferCallback);
    esp_wifi_set_promiscuous(true);
    Serial.println("[RF Sensing]: Wi-Fi Promiscuous Body Motion Sniffer ENABLED!");

    // 3. Start WebSockets & HTTP Server
    webSocket.begin();
    webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
        if (type == WStype_CONNECTED) {
            Serial.printf("[WebSocket]: Client #%u connected!\n", num);
        }
    });

    // --- Relay GPIO Setup ---
    pinMode(16, OUTPUT); // Relay 1 (e.g., l6 Pink COB)
    pinMode(15, OUTPUT); // Relay 2 (e.g., l5 Warm COB)
    digitalWrite(16, HIGH); // Default OFF (Active Low Relay)
    digitalWrite(15, HIGH); // Default OFF (Active Low Relay)

    server.on("/", []() {
        server.send(200, "text/html", "<h1>Aankhen ESP32-S3 Wi-Fi Sensing & Hardware Control Active</h1>");
    });

    // --- REST API for Relay 1 (GPIO 16) ---
    server.on("/relay/1/on", []() {
        digitalWrite(16, LOW); // Turn Relay ON
        Serial.println("[JARVIS COMMAND]: Relay 1 (Pink COB) turned ON via HTTP");
        server.send(200, "application/json", "{\"status\":\"success\", \"relay\":1, \"state\":\"on\"}");
    });
    server.on("/relay/1/off", []() {
        digitalWrite(16, HIGH); // Turn Relay OFF
        Serial.println("[JARVIS COMMAND]: Relay 1 (Pink COB) turned OFF via HTTP");
        server.send(200, "application/json", "{\"status\":\"success\", \"relay\":1, \"state\":\"off\"}");
    });

    // --- REST API for Relay 2 (GPIO 15) ---
    server.on("/relay/2/on", []() {
        digitalWrite(15, LOW); // Turn Relay ON
        Serial.println("[JARVIS COMMAND]: Relay 2 (Warm COB) turned ON via HTTP");
        server.send(200, "application/json", "{\"status\":\"success\", \"relay\":2, \"state\":\"on\"}");
    });
    server.on("/relay/2/off", []() {
        digitalWrite(15, HIGH); // Turn Relay OFF
        Serial.println("[JARVIS COMMAND]: Relay 2 (Warm COB) turned OFF via HTTP");
        server.send(200, "application/json", "{\"status\":\"success\", \"relay\":2, \"state\":\"off\"}");
    });
    server.begin();
    Serial.println("[WebSocket]: Listening for live UI connections on port 81");
}

void loop() {
    server.handleClient();
    webSocket.loop();

    unsigned long now = millis();

    // Update Motion Index & Presence state at 10Hz (every 100ms)
    if (now - lastLogTime >= 100) {
        lastLogTime = now;

        // Motion Index computed from RSSI variance and packet rate
        motionIndex = constrain(rssiVariance * 18.0, 0.0, 100.0);
        presenceDetected = (motionIndex > 12.0) || ((now - lastPacketTime) < 1500);

        // Broadcast JSON Telemetry over WebSocket (Port 81)
        StaticJsonDocument<256> doc;
        doc["system"] = "Aankhen ESP32-S3 Hardware";
        doc["source"] = "wifi_hardware";
        doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
        doc["rssi"] = lastRSSI;
        doc["motion_index"] = round(motionIndex);
        doc["presence"] = presenceDetected;
        doc["packet_rate_hz"] = packetCount * 10;
        doc["timestamp_ms"] = now;

        String jsonString;
        serializeJson(doc, jsonString);
        webSocket.broadcastTXT(jsonString);

        // Print real-time log over USB Serial
        Serial.printf("[AANKHEN LOG]: Presence: %s | Motion: %3.0f%% | RSSI: %d dBm | IP: %s\n",
                      presenceDetected ? "PRESENT" : "ABSENT ",
                      motionIndex,
                      lastRSSI,
                      doc["ip"].as<const char*>());

        packetCount = 0;
    }
}
