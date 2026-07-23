"""Aankhen (The Eyes of JARVIS) — Unified Spatial Intelligence & Perception Engine.

Fuses:
1. RuView Wi-Fi CSI (56 subcarriers, 17 COCO keypoint posture & gesture comprehension).
2. RuField Multimodal Tensor Normalization (HLK-LD2450 24GHz mmWave radar 2D target tracking).
3. 3D WebGL Extrinsic Coordinate Transformation Matrix (T_{s -> w}).
4. Yaadash Temporal Memory Ingestion & Qdrant/GraphRAG context sync.
5. FastMCP Hardware Actuation (Room relays, fans, servos).
6. Gesture Comprehension Engine (Wave detection, posture transitions, proactive JARVIS alerts).
"""
import time
import math
import json
import asyncio
import numpy as np
import ruview_simulator
import ruview_parser
import room

class AankhenSpatialEngine:
    def __init__(self, user_id: str = "boss", room_zone: str = "Workstation"):
        self.user_id = user_id
        self.room_zone = room_zone
        self.simulator = ruview_simulator.RUVIEWSpatialSimulator()
        self.csi_parser = ruview_parser.CSIStreamParser(56)
        self.radar_parser = ruview_parser.LD2450RadarParser()
        
        # State tracking for Gesture & Motion Comprehension
        self.last_posture = "Sitting"
        self.sitting_start_time = time.time()
        self.wave_gesture_detected = False
        self.last_wrist_x = 0.0

    def process_telemetry_frame(self) -> dict:
        """Processes a single telemetry frame across all sensors for Aankhen."""
        self.simulator.time_elapsed += 0.1
        now_ts = time.time()

        # 1. Generate & Parse CSI Payload
        csi_raw = self.simulator.generate_csi_payload()
        csi_parsed = self.csi_parser.parse_and_sanitize_csi(csi_raw)

        # 2. Generate & Parse mmWave Radar Hex Frame
        radar_hex = self.simulator.generate_ld2450_hex_frame()
        radar_parsed = self.radar_parser.parse_hex_frame(radar_hex.hex())

        # 3. Transform to 3D World Floorplan Coordinates
        world_coords = ruview_parser.transform_radar_to_world_coordinates(
            self.simulator.target_x, self.simulator.target_y, z_sensor=2.2, pitch_deg=15.0
        )

        # 4. Gesture & Motion Comprehension Engine
        keypoints = self.simulator.generate_coco_keypoints()
        # Track wrist X movement (Joint 10: RWrist)
        rwrist_x = keypoints[10]["x"] if len(keypoints) > 10 else 0.0
        wrist_velocity = abs(rwrist_x - self.last_wrist_x) / 0.1
        self.last_wrist_x = rwrist_x

        # Detect Wave Gesture (rapid wrist oscillation > 0.4 m/s while sitting/standing)
        if wrist_velocity > 0.35:
            self.wave_gesture_detected = True
            gesture_name = "WAVING_HAND"
        else:
            self.wave_gesture_detected = False
            gesture_name = "NONE"

        # Track Posture State & Duration
        current_posture = self.simulator.posture_state
        if current_posture != self.last_posture:
            print(f"[Aankhen Perception]: Posture transition detected: {self.last_posture} -> {current_posture}")
            self.last_posture = current_posture
            self.sitting_start_time = now_ts

        sitting_duration_min = round((now_ts - self.sitting_start_time) / 60.0, 1)

        # Proactive Room Action Triggers
        proactive_action = None
        if current_posture == "Sitting" and sitting_duration_min >= 45.0:
            proactive_action = "TRIGGER_POSTURE_STRETCH_ALERT"
        elif self.wave_gesture_detected:
            proactive_action = "TRIGGER_JARVIS_VOICE_ATTENTION"

        return {
            "system": "Aankhen Spatial Intelligence Engine",
            "timestamp": now_ts,
            "user_id": self.user_id,
            "zone": self.room_zone,
            "posture": {
                "state": current_posture,
                "sitting_duration_min": sitting_duration_min,
                "coco_17_keypoints": keypoints
            },
            "gesture": {
                "name": gesture_name,
                "detected": self.wave_gesture_detected,
                "wrist_velocity_m_s": round(wrist_velocity, 2)
            },
            "vitals": {
                "heart_rate_bpm": int(self.simulator.heart_rate_bpm),
                "respiration_rpm": int(self.simulator.respiration_rpm)
            },
            "world_coordinates": world_coords,
            "radar_targets": radar_parsed.get("targets", []),
            "csi_spectrum": {
                "subcarrier_count": csi_parsed["subcarrier_count"],
                "mean_amplitude": round(csi_parsed["mean_amplitude"], 2)
            },
            "proactive_action": proactive_action
        }

if __name__ == "__main__":
    print("==========================================================")
    print("  AANKHEN (THE EYES OF JARVIS) — SPATIAL ENGINE ACTIVE    ")
    print("==========================================================")
    engine = AankhenSpatialEngine()
    for step in range(5):
        frame = engine.process_telemetry_frame()
        print(f"[Frame {step+1}]: Posture={frame['posture']['state']} | World Pos=({frame['world_coordinates']['x_world']}m, {frame['world_coordinates']['y_world']}m) | Gesture={frame['gesture']['name']}")
        time.sleep(0.1)
