"""Aankhen (आँखें, "eyes") — JARVIS's spatial sensing subsystem.

ESP32-S3 Wi-Fi CSI motion sensing, optional HLK-LD2450 radar tracking, sensor
fusion, a learned occupancy map, and a live 3D view of the room.

Every output is tagged with where it came from (`hardware`, `replay` or
`simulation`). Nothing simulated is ever presented as measured.
"""
__version__ = "3.0.0"
