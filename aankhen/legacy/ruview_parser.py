"""Production-Grade RUVIEW Spatial Telemetry & Signal Sanitization Parser (v2.0).

Executes:
1. ESP32-S3 Wi-Fi CSI Linear Phase Sanitization & Unwrapping:
   angle_hat_H_k = angle_H_k - (a * k + b)
2. HLK-LD2450 Custom Bit-15 Signed Binary Frame Unpacking:
   If Bit 15 == 1 => val = raw - 32768
   If Bit 15 == 0 => val = -raw
3. Transformation of raw RF telemetry into normalized SpatialStateEvent objects.
"""
import math
import struct
import numpy as np

class CSIStreamParser:
    def __init__(self, subcarrier_count: int = 56):
        self.subcarrier_count = subcarrier_count

    def parse_and_sanitize_csi(self, raw_int8_payload: list) -> dict:
        """Parses 112-byte signed int8 payload and applies linear phase sanitization."""
        if len(raw_int8_payload) < self.subcarrier_count * 2:
            return {"status": "error", "message": "Incomplete CSI payload"}

        data = np.array(raw_int8_payload, dtype=np.int8)
        csi_matrix = data.reshape(-1, 2)
        
        imag = csi_matrix[:, 0].astype(float)
        real = csi_matrix[:, 1].astype(float)
        
        # Calculate raw amplitude & wrapped phase
        amplitude = np.sqrt(real**2 + imag**2)
        wrapped_phase = np.arctan2(imag, real)
        
        # 1. Phase Unwrapping
        unwrapped_phase = np.unwrap(wrapped_phase)
        
        # 2. Linear Phase Sanitization: angle_hat = angle - (a*k + b)
        k_indices = np.arange(len(unwrapped_phase))
        if len(k_indices) > 1:
            slope_a = (unwrapped_phase[-1] - unwrapped_phase[0]) / (k_indices[-1] - k_indices[0])
            intercept_b = np.mean(unwrapped_phase)
            sanitized_phase = unwrapped_phase - (slope_a * k_indices + intercept_b)
        else:
            sanitized_phase = unwrapped_phase

        return {
            "subcarrier_count": len(amplitude),
            "mean_amplitude": float(np.mean(amplitude)),
            "sanitized_phase_rad": sanitized_phase.tolist(),
            "amplitude_spectrum": amplitude.tolist()
        }

class LD2450RadarParser:
    """Parser for HLK-LD2450 24GHz mmWave radar custom Bit-15 binary protocol."""
    
    @staticmethod
    def decode_bit15_signed(raw_u16: int) -> int:
        """Decodes HLK-LD2450 custom Bit-15 sign flag encoding."""
        # Bit 15 (0x8000) is sign bit: 1 = Positive, 0 = Negative
        if (raw_u16 & 0x8000) != 0:
            return (raw_u16 & 0x7FFF)
        else:
            return -(raw_u16 & 0x7FFF)

    def parse_hex_frame(self, hex_string: str) -> dict:
        """Parses a 30-byte HLK-LD2450 hex frame (AA FF 03 00 ... 55 CC)."""
        raw_bytes = bytes.fromhex(hex_string)
        if len(raw_bytes) < 26:
            return {"status": "error", "message": "Invalid frame length"}

        # Validate header AA FF 03 00
        if raw_bytes[0:4] != b"\xAA\xFF\x03\x00":
            return {"status": "error", "message": "Invalid header bytes"}

        targets = []
        # Parse 3 targets (8 bytes each, starting at offset 4)
        for t_idx in range(3):
            offset = 4 + (t_idx * 8)
            if offset + 8 > len(raw_bytes):
                break
                
            chunk = raw_bytes[offset:offset+8]
            x_raw, y_raw, speed_raw, resolution = struct.unpack("<HHHH", chunk)
            
            x_mm = self.decode_bit15_signed(x_raw & 0xFFFF)
            y_mm = self.decode_bit15_signed(y_raw & 0xFFFF)
            speed_cm_s = self.decode_bit15_signed(speed_raw & 0xFFFF)
            
            if x_mm != 0 or y_mm != 0:
                targets.append({
                    "target_id": t_idx + 1,
                    "x_meters": round(x_mm / 1000.0, 3),
                    "y_meters": round(y_mm / 1000.0, 3),
                    "velocity_m_s": round(speed_cm_s / 100.0, 2),
                    "distance_resolution_mm": resolution
                })

        return {
            "status": "success",
            "active_targets_count": len(targets),
            "targets": targets
        }

def transform_radar_to_world_coordinates(
    x_r: float, y_r: float, 
    x_sensor: float = 0.0, y_sensor: float = 0.0, z_sensor: float = 2.2, 
    pitch_deg: float = 15.0, yaw_deg: float = 0.0
) -> dict:
    """Applies 4x4 Extrinsic Homogeneous Transformation Matrix to convert radar (X, Y) to 3D world floorplan space."""
    pitch_rad = math.radians(pitch_deg)
    yaw_rad = math.radians(yaw_deg)
    
    # Sensor space coordinates
    p_sensor = np.array([x_r, y_r, 0.0, 1.0])
    
    # Rotation Z (Yaw) * Rotation X (Pitch)
    c_y, s_y = math.cos(yaw_rad), math.sin(yaw_rad)
    c_p, s_p = math.cos(pitch_rad), math.sin(pitch_rad)
    
    R_yaw = np.array([
        [c_y, -s_y, 0, 0],
        [s_y,  c_y, 0, 0],
        [  0,    0, 1, 0],
        [  0,    0, 0, 1]
    ])
    
    R_pitch = np.array([
        [1,    0,     0, 0],
        [0,  c_p,  -s_p, 0],
        [0,  s_p,   c_p, 0],
        [0,    0,     0, 1]
    ])
    
    T_trans = np.array([
        [1, 0, 0, x_sensor],
        [0, 1, 0, y_sensor],
        [0, 0, 1, z_sensor],
        [0, 0, 0, 1]
    ])
    
    T_extrinsic = T_trans @ R_yaw @ R_pitch
    p_world = T_extrinsic @ p_sensor
    
    return {
        "x_world": round(float(p_world[0]), 3),
        "y_world": round(float(p_world[1]), 3),
        "z_world": round(max(0.0, float(p_world[2])), 3)
    }

if __name__ == "__main__":
    print("Testing RUVIEW Parser Suite...")
    csi_parser = CSIStreamParser(56)
    mock_payload = [random.randint(-50, 50) for _ in range(112)]
    csi_res = csi_parser.parse_and_sanitize_csi(mock_payload)
    print(f"CSI Sanitization Test: Mean Amplitude = {csi_res['mean_amplitude']:.2f}")

    radar_parser = LD2450RadarParser()
    mock_hex = "aaff03000e03b1861000400100000000000000000000000055cc"
    radar_res = radar_parser.parse_hex_frame(mock_hex)
    print(f"LD2450 Radar Hex Parser Test: Targets Found = {radar_res['active_targets_count']}")
