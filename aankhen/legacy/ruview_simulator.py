"""Production-Grade RUVIEW Spatial Engine Simulation Server (v2.0).

Generates synthetic, physically accurate telemetry streams mimicking:
1. ESP32-S3 Wi-Fi CSI (56-subcarrier int8 matrices with dynamic Doppler phase shifts).
2. HLK-LD2450 24GHz mmWave radar (Bit-15 custom signed int16 binary frames & target coordinates).
3. 17 COCO skeletal keypoint posture states (Sitting, Standing, Lying down).
4. Respiration & pulse physiological waveforms.

Runs as an asyncio WebSocket server on ws://localhost:8765 at 10 Hz.
"""
import time
import math
import random
import json
import struct
import asyncio
import websockets
import numpy as np

class RUVIEWSpatialSimulator:
    def __init__(self):
        self.running = True
        self.time_elapsed = 0.0
        self.target_x = 0.0
        self.target_y = 2.0
        self.target_z = 1.2
        self.posture_state = "Sitting"  # Sitting, Standing, Lying
        self.heart_rate_bpm = 74.0
        self.respiration_rpm = 18.0

    def generate_csi_payload(self) -> list:
        """Generates 112-byte signed int8 ESP32-S3 56-subcarrier CSI payload [imag_k, real_k]."""
        subcarrier_count = 56
        payload = []
        
        # Breathing & heartbeat phase shifts
        breath_phase = math.sin(self.time_elapsed * (2 * math.pi / 3.3)) * 0.4
        heart_phase = math.sin(self.time_elapsed * (2 * math.pi / 0.81)) * 0.1
        doppler_shift = breath_phase + heart_phase

        for k in range(subcarrier_count):
            # Base attenuation & subcarrier phase angle
            base_amp = 30.0 + 10.0 * math.cos(k * 0.15) + random.uniform(-2, 2)
            phase_angle = (k * 0.1) + doppler_shift + random.uniform(-0.05, 0.05)
            
            real = int(base_amp * math.cos(phase_angle))
            imag = int(base_amp * math.sin(phase_angle))
            
            # Clamp to int8 range [-128, 127]
            real = max(-128, min(127, real))
            imag = max(-128, min(127, imag))
            
            payload.append(imag)
            payload.append(real)

        return payload

    def generate_ld2450_hex_frame(self) -> bytes:
        """Synthesizes binary HLK-LD2450 UART frame using Bit-15 custom sign encoding."""
        # AA FF 03 00 (Header) + 3 targets (8 bytes each) + 55 CC (Tail)
        header = b"\xAA\xFF\x03\x00"
        tail = b"\x55\xCC"

        # Smooth target motion
        self.target_x += math.sin(self.time_elapsed * 0.3) * 0.05
        self.target_y += math.cos(self.time_elapsed * 0.2) * 0.03
        self.target_x = max(-2.5, min(2.5, self.target_x))
        self.target_y = max(0.5, min(5.0, self.target_y))

        def encode_bit15_signed(val_mm: int) -> int:
            """Bit 15 = 1 for positive (val + 32768), Bit 15 = 0 for negative (-val)."""
            if val_mm >= 0:
                return (val_mm + 32768) & 0xFFFF
            else:
                return (abs(val_mm)) & 0xFFFF

        x_raw = encode_bit15_signed(int(self.target_x * 1000))
        y_raw = encode_bit15_signed(int(self.target_y * 1000))
        speed_raw = encode_bit15_signed(int(math.sin(self.time_elapsed) * 10))
        resolution_raw = 100  # 100mm resolution

        # Target 1 payload (8 bytes: x, y, speed, resolution)
        t1_bytes = struct.pack("<HHHH", x_raw, y_raw, speed_raw, resolution_raw)
        
        # Empty targets 2 & 3
        empty_t = struct.pack("<HHHH", 0, 0, 0, 0)

        return header + t1_bytes + empty_t + empty_t + tail

    def generate_coco_keypoints(self) -> list:
        """Generates 17 COCO skeletal keypoint joint coordinates (x, y, z) in meters."""
        # 17 COCO Joints: 0:Nose, 1:LEye, 2:REye, 3:LEar, 4:REar, 5:LShoulder, 6:RShoulder,
        # 7:LElbow, 8:RElbow, 9:LWrist, 10:RWrist, 11:LHip, 12:RHip, 13:LKnee, 14:RKnee, 15:LAnkle, 16:RAnkle
        
        root_x, root_y, root_z = self.target_x, self.target_y, self.target_z
        keypoints = []

        if self.posture_state == "Sitting":
            # Joint offsets relative to pelvic root
            offsets = [
                (0.0, 0.0, 0.6),    # 0: Nose
                (-0.05, 0.0, 0.62), # 1: LEye
                (0.05, 0.0, 0.62),  # 2: REye
                (-0.1, 0.0, 0.6),   # 3: LEar
                (0.1, 0.0, 0.6),    # 4: REar
                (-0.2, 0.0, 0.45),  # 5: LShoulder
                (0.2, 0.0, 0.45),   # 6: RShoulder
                (-0.25, 0.2, 0.25), # 7: LElbow
                (0.25, 0.2, 0.25),  # 8: RElbow
                (-0.2, 0.35, 0.2),  # 9: LWrist
                (0.2, 0.35, 0.2),   # 10: RWrist
                (-0.15, 0.0, 0.0),  # 11: LHip
                (0.15, 0.0, 0.0),   # 12: RHip
                (-0.15, 0.4, -0.2), # 13: LKnee
                (0.15, 0.4, -0.2),  # 14: RKnee
                (-0.15, 0.4, -0.5), # 15: LAnkle
                (0.15, 0.4, -0.5)   # 16: RAnkle
            ]
        else:
            # Standing posture offsets
            offsets = [
                (0.0, 0.0, 0.85),
                (-0.05, 0.0, 0.87), (0.05, 0.0, 0.87),
                (-0.1, 0.0, 0.85), (0.1, 0.0, 0.85),
                (-0.22, 0.0, 0.65), (0.22, 0.0, 0.65),
                (-0.25, 0.0, 0.35), (0.25, 0.0, 0.35),
                (-0.25, 0.0, 0.1), (0.25, 0.0, 0.1),
                (-0.15, 0.0, 0.0), (0.15, 0.0, 0.0),
                (-0.15, 0.0, -0.45), (0.15, 0.0, -0.45),
                (-0.15, 0.0, -0.85), (0.15, 0.0, -0.85)
            ]

        for idx, (ox, oy, oz) in enumerate(offsets):
            keypoints.append({
                "joint_id": idx,
                "x": round(root_x + ox, 3),
                "y": round(root_y + oy, 3),
                "z": round(root_z + oz, 3),
                "confidence": round(0.92 + random.uniform(-0.05, 0.05), 2)
            })

        return keypoints

    async def stream_data(self, websocket):
        print("[RUVIEW Simulator]: Client connected to ws://localhost:8765")
        try:
            while self.running:
                self.time_elapsed += 0.1
                
                # Alternate posture states every 30 seconds
                if int(self.time_elapsed) % 60 < 30:
                    self.posture_state = "Sitting"
                    self.target_z = 1.1
                else:
                    self.posture_state = "Standing"
                    self.target_z = 1.75

                ld2450_hex = self.generate_ld2450_hex_frame()

                packet = {
                    "timestamp": time.time(),
                    "frame_index": int(self.time_elapsed * 10),
                    "csi_matrix": {
                        "subcarrier_count": 56,
                        "payload_bytes_hex": self.generate_csi_payload()
                    },
                    "ld2450_radar": {
                        "raw_hex_frame": ld2450_hex.hex(),
                        "target_x_m": round(self.target_x, 3),
                        "target_y_m": round(self.target_y, 3),
                        "target_z_m": round(self.target_z, 3),
                        "velocity_m_s": round(math.sin(self.time_elapsed) * 0.1, 2)
                    },
                    "posture": {
                        "state": self.posture_state,
                        "confidence": 0.96,
                        "coco_17_keypoints": self.generate_coco_keypoints()
                    },
                    "vitals": {
                        "heart_rate_bpm": int(self.heart_rate_bpm + random.uniform(-2, 2)),
                        "respiration_rpm": int(self.respiration_rpm + random.uniform(-1, 1)),
                        "chest_displacement_mm": round(math.sin(self.time_elapsed * (2 * math.pi / 3.3)) * 5.0, 2)
                    }
                }
                
                await websocket.send(json.dumps(packet))
                await asyncio.sleep(0.1)  # 10Hz output stream
        except websockets.exceptions.ConnectionClosed:
            print("[RUVIEW Simulator]: Client disconnected.")

async def main():
    simulator = RUVIEWSpatialSimulator()
    print("==================================================================")
    print("  RUVIEW SPATIAL SIMULATOR ACTIVE — STREAMING AT ws://localhost:8765")
    print("==================================================================")
    async with websockets.serve(simulator.stream_data, "localhost", 8765):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[RUVIEW Simulator]: Shutdown complete.")
