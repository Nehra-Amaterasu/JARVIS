"""Aankhen v2 — JARVIS's eyes, rebuilt honest.

WHY THIS EXISTS
---------------
aankhen_engine.py (v1) is a PUPPET: every value it reports is invented by
ruview_simulator — the "heart rate", the "17 COCO keypoints", the CSI spectrum.
Nothing is measured. Worse, it reports those invented values in the same shape
real data would take, so downstream code (and JARVIS's own voice) treats fiction
as fact.

v2 keeps the parts that are REAL and drops the parts that are not:

  KEPT (genuinely correct signal code, reused from ruview_parser.py):
    - LD2450 Bit-15 signed decode
    - radar -> world coordinate extrinsic transform

  DROPPED (physically impossible with the hardware in this project):
    - 17-keypoint COCO pose from a single Wi-Fi antenna. Pose estimation needs
      many spatially-diverse links; one ESP32 antenna cannot resolve a skeleton.
    - Heart rate / respiration from the LD2450. It is a POSITION TRACKER. It
      reports x, y, speed. It has no vital-signs output at all.

  ADDED (what the LD2450 can actually deliver, and it is genuinely useful):
    - presence / absence
    - moving vs still
    - position + zone occupancy
    - dwell time per zone

THE CORE RULE: every frame carries `source` = "hardware" or "simulation".
Simulated frames are never presented as measurements. If you did not plug a
sensor in, the data says so.
"""
import os
import time
import math
from dataclasses import dataclass, field, asdict

import ruview_parser  # reused: Bit-15 decode + world transform (verified correct)

# LD2450 frame constants (per HLK datasheet)
FRAME_HEADER = b"\xAA\xFF\x03\x00"
FRAME_FOOTER = b"\x55\xCC"
FRAME_LEN = 30
DEFAULT_BAUD = 256000  # LD2450 ships at 256000 8N1

# Movement threshold (m/s): below this the target is present but effectively still.
STILL_SPEED_M_S = 0.05


@dataclass
class Zone:
    """A named rectangular floor region, in metres, in world coordinates."""
    name: str
    x_min: float
    x_max: float
    y_min: float
    y_max: float

    def contains(self, x: float, y: float) -> bool:
        return self.x_min <= x <= self.x_max and self.y_min <= y <= self.y_max


# Default room layout. Override with your real measurements.
DEFAULT_ZONES = [
    Zone("Workstation", -1.5, 1.5, 0.0, 2.0),
    Zone("Bed",         -3.0, -1.5, 0.0, 3.0),
    Zone("Doorway",      1.5, 3.0, 0.0, 1.5),
]


@dataclass
class Target:
    """One tracked person. Distances in metres, speed in cm/s."""
    id: int
    x: float
    y: float
    speed: float
    distance: float = 0.0
    moving: bool = False
    zone: str = "Unknown"


@dataclass
class SpatialFrame:
    """One perception frame. `source` is never allowed to lie."""
    source: str                      # "hardware" | "simulation"
    timestamp: float
    present: bool
    target_count: int
    targets: list = field(default_factory=list)
    primary_zone: str = "None"
    dwell_seconds: float = 0.0
    motion_state: str = "absent"     # absent | still | moving
    # Explicitly declared so no consumer invents these later:
    vitals_available: bool = False
    pose_available: bool = False

    def to_dict(self):
        d = asdict(self)
        d["targets"] = [asdict(t) if not isinstance(t, dict) else t for t in self.targets]
        return d


class LD2450Reader:
    """Reads real 30-byte LD2450 frames from a serial port.

    Import of pyserial is lazy so this module still works in simulation mode on
    a machine with no serial library and no sensor.
    """

    def __init__(self, port: str, baud: int = DEFAULT_BAUD, timeout: float = 1.0):
        try:
            import serial  # pyserial
        except ImportError as e:
            raise ImportError(
                "pyserial is required for hardware mode: pip install pyserial"
            ) from e
        self.ser = serial.Serial(port, baud, timeout=timeout)
        self._buf = bytearray()

    def read_frame(self):
        """Block until one valid framed packet is found; return its raw bytes.

        Resynchronises on the header rather than assuming frame alignment —
        serial streams routinely start mid-frame.
        """
        while True:
            chunk = self.ser.read(64)
            if chunk:
                self._buf.extend(chunk)
            idx = self._buf.find(FRAME_HEADER)
            if idx == -1:
                if len(self._buf) > 4096:      # keep the tail, drop old garbage
                    del self._buf[:-1024]
                continue
            if len(self._buf) < idx + FRAME_LEN:
                continue
            frame = bytes(self._buf[idx:idx + FRAME_LEN])
            del self._buf[:idx + FRAME_LEN]
            if frame.endswith(FRAME_FOOTER):
                return frame
            # bad footer -> not a real frame, keep scanning

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass


class AankhenV2:
    """Spatial perception engine. Hardware when available, honest sim otherwise."""

    def __init__(self, port: str = None, zones=None, sensor_height_m: float = 2.2,
                 pitch_deg: float = 15.0):
        self.zones = zones or DEFAULT_ZONES
        self.sensor_height = sensor_height_m
        self.pitch_deg = pitch_deg
        self.parser = ruview_parser.LD2450RadarParser()

        self.reader = None
        self.source = "simulation"
        if port:
            self.reader = LD2450Reader(port)
            self.source = "hardware"

        self._sim = None
        if self.source == "simulation":
            import ruview_simulator
            self._sim = ruview_simulator.RUVIEWSpatialSimulator()

        self._zone_entered_at = None
        self._current_zone = "None"

    # --- helpers ---------------------------------------------------------
    def _zone_for(self, x: float, y: float) -> str:
        for z in self.zones:
            if z.contains(x, y):
                return z.name
        return "Unknown"

    def _parse_targets(self, frame_hex: str):
        parsed = self.parser.parse_hex_frame(frame_hex)
        if parsed.get("status") == "error":
            return []
        out = []
        for t in parsed.get("targets", []):
            # ruview_parser already converts to metres / m-per-second (verified).
            x = float(t.get("x_meters", 0) or 0)
            y = float(t.get("y_meters", 0) or 0)
            spd = float(t.get("velocity_m_s", 0) or 0)
            if x == 0 and y == 0:      # empty target slot
                continue
            out.append(Target(
                id=int(t.get("target_id", 0)),
                x=round(x, 3),
                y=round(y, 3),
                speed=round(spd, 2),
                distance=round(math.hypot(x, y), 3),
                moving=abs(spd) >= STILL_SPEED_M_S,
                zone=self._zone_for(x, y),
            ))
        return out

    # --- main loop -------------------------------------------------------
    def read(self) -> SpatialFrame:
        """Produce one perception frame, tagged with its true source."""
        now = time.time()

        if self.source == "hardware":
            raw = self.reader.read_frame()
            targets = self._parse_targets(raw.hex())
        else:
            self._sim.time_elapsed += 0.1
            raw = self._sim.generate_ld2450_hex_frame()
            targets = self._parse_targets(raw.hex())

        present = len(targets) > 0
        if present:
            primary = max(targets, key=lambda t: (t.moving, -t.distance))
            zone = primary.zone
            motion = "moving" if any(t.moving for t in targets) else "still"
        else:
            zone, motion = "None", "absent"

        # dwell tracking
        if zone != self._current_zone:
            self._current_zone = zone
            self._zone_entered_at = now if present else None
        dwell = (now - self._zone_entered_at) if self._zone_entered_at else 0.0

        return SpatialFrame(
            source=self.source,
            timestamp=now,
            present=present,
            target_count=len(targets),
            targets=targets,
            primary_zone=zone,
            dwell_seconds=round(dwell, 1),
            motion_state=motion,
            vitals_available=False,   # LD2450 cannot measure vitals. Ever.
            pose_available=False,     # single-antenna pose is not physically possible.
        )

    def close(self):
        if self.reader:
            self.reader.close()


def describe_for_jarvis(frame: SpatialFrame) -> str:
    """Compact natural-language context line for the LLM prompt.

    Marked [SIMULATED] when not from hardware, so JARVIS never states invented
    sensor data as fact.
    """
    tag = "" if frame.source == "hardware" else "[SIMULATED] "
    if not frame.present:
        return f"{tag}Room appears empty."
    mins = frame.dwell_seconds / 60.0
    return (f"{tag}{frame.target_count} person(s) detected. Primary zone: "
            f"{frame.primary_zone}, {frame.motion_state}, there ~{mins:.1f} min.")


if __name__ == "__main__":
    port = os.environ.get("LD2450_PORT")  # e.g. set LD2450_PORT=COM5
    print("=" * 62)
    print("  AANKHEN v2 — spatial perception (presence/motion/zone only)")
    print("=" * 62)
    if port:
        print(f"Mode: HARDWARE on {port}")
    else:
        print("Mode: SIMULATION (no LD2450_PORT set) — frames are labelled as such.")
        print("      Set LD2450_PORT=COM5 to read a real sensor.")

    eng = AankhenV2(port=port)
    try:
        for i in range(5):
            f = eng.read()
            print(f"[{i+1}] src={f.source:10s} present={f.present} "
                  f"n={f.target_count} zone={f.primary_zone:12s} "
                  f"motion={f.motion_state}")
            print("     ->", describe_for_jarvis(f))
            time.sleep(0.1)
    finally:
        eng.close()
    print("\nNOTE: vitals_available=False and pose_available=False are permanent")
    print("for this sensor. Heart-rate/respiration need CSI + ML (Pulse-Fi class")
    print("work); skeleton pose needs many antenna links, not one.")
