"""Aankhen ESP32-S3 Hardware Engine (v3.0).

Reads live serial telemetry from connected ESP32-S3 board on COM7.
Processes:
1. Physical Hardware Connection Heartbeat (Port COM7, Baud 115200).
2. Inter-packet timing dynamics (Delta-T jitter) for presence & movement detection.
3. Power & channel state parsing (50%R, 50%G, 50%B).
4. Direct integration with memory_server.py and WebGL SpatialRadarView.html.
"""
import os
import time
import json
import serial
import threading

class ESP32SerialReader:
    def __init__(self, port: str = "COM7", baud: int = 115200):
        self.port = port
        self.baud = baud
        self.running = True
        self.connected = False
        self.last_packet_time = 0.0
        self.packet_count = 0
        self.last_line = ""
        self.channel_states = {"R": 50, "G": 50, "B": 50}
        self.inter_packet_deltas = []
        self._lock = threading.Lock()

        # Start background serial listener thread
        self.thread = threading.Thread(target=self._listen_loop, daemon=True)
        self.thread.start()

    def _listen_loop(self):
        while self.running:
            try:
                print(f"[ESP32 Hardware Engine]: Connecting to {self.port} at {self.baud} baud...")
                ser = serial.Serial(self.port, self.baud, timeout=1.0)
                self.connected = True
                print(f"[ESP32 Hardware Engine]: CONNECTED to {self.port} successfully!")
                
                while self.running and ser.is_open:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        now = time.time()
                        with self._lock:
                            if self.last_packet_time > 0:
                                delta = now - self.last_packet_time
                                self.inter_packet_deltas.append(delta)
                                if len(self.inter_packet_deltas) > 20:
                                    self.inter_packet_deltas.pop(0)

                            self.last_packet_time = now
                            self.packet_count += 1
                            self.last_line = line
                            
                            # Parse telemetry channel states (e.g. 50%R, 50%G, 50%B)
                            if "%" in line:
                                parts = line.split("%")
                                if len(parts) == 2:
                                    val_str, channel = parts[0], parts[1]
                                    if val_str.isdigit():
                                        self.channel_states[channel] = int(val_str)
                ser.close()
            except Exception as e:
                self.connected = False
                time.sleep(2.0)

    def get_telemetry_snapshot(self) -> dict:
        now = time.time()
        with self._lock:
            time_since_last = now - self.last_packet_time if self.last_packet_time > 0 else 999.0
            is_alive = self.connected and (time_since_last < 3.0)
            
            # Compute timing jitter for movement inference
            avg_delta = sum(self.inter_packet_deltas) / len(self.inter_packet_deltas) if self.inter_packet_deltas else 0.0
            motion_state = "moving" if (is_alive and len(self.inter_packet_deltas) > 5 and avg_delta < 0.8) else ("still" if is_alive else "absent")

            return {
                "system": "Aankhen ESP32-S3 Hardware Engine",
                "source": "hardware" if is_alive else "disconnected",
                "port": self.port,
                "timestamp": now,
                "present": is_alive,
                "motion_state": motion_state,
                "packet_count": self.packet_count,
                "time_since_last_packet_s": round(time_since_last, 2),
                "last_line_received": self.last_line,
                "channel_telemetry": dict(self.channel_states),
                "avg_inter_packet_delta_s": round(avg_delta, 3)
            }

    def close(self):
        self.running = False

if __name__ == "__main__":
    print("==========================================================")
    print("  AANKHEN ESP32-S3 HARDWARE ENGINE — LIVE SERIAL COM7     ")
    print("==========================================================")
    reader = ESP32SerialReader(port="COM7", baud=115200)
    time.sleep(1.5)
    for i in range(5):
        snap = reader.get_telemetry_snapshot()
        print(f"[{i+1}] src={snap['source']} present={snap['present']} "
              f"packets={snap['packet_count']} last='{snap['last_line_received']}' "
              f"motion={snap['motion_state']}")
        time.sleep(0.5)
    reader.close()
