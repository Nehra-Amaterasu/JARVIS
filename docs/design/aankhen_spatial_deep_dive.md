# Aankhen (The Eyes of JARVIS) — Technical Deep Dive & System Architecture

**Engine Module:** `aankhen_engine.py`  
**Simulation Server:** `ruview_simulator.py` (`ws://localhost:8765` at 10Hz)  
**Signal Parser:** `ruview_parser.py`  
**WebGL 3D Visualizer:** [SpatialRadarView.html](../../aankhen/legacy/SpatialRadarView.html)  

---

## 1. Executive Summary

**Aankhen** is the camera-free Spatial Intelligence & Perception Subsystem of JARVIS. It provides real-time human tracking, 17 COCO skeletal posture recognition, gesture comprehension, vital sign monitoring (respiration & pulse), and 3D WebGL room floorplan visualization without requiring cameras or invasive optical sensors.

---

## 2. Hardware & Radio Sensing Stack

### A. ESP32-S3 Wi-Fi Channel State Information (CSI)
- **Subcarrier Matrix:** 56 subcarriers (HT20) stored as 112-byte signed `int8` arrays $[Q_k, I_k]$.
- **Linear Phase Sanitization:** Mitigates Carrier Frequency Offset (CFO) and Sampling Frequency Offset (SFO):
  $$\angle \hat{H}_k = \angle H_k - (a \cdot k + b)$$
  where $a = \frac{\angle H_N - \angle H_1}{k_N - k_1}$ and $b = \frac{1}{N} \sum_{i=1}^N \angle H_i$.
- **Vital Sign Physics:** At 5.8 GHz ($\lambda = 5.17\text{ cm}$), a 5mm chest respiration movement induces a $69.6^\circ$ phase shift:
  $$\Delta \phi = \frac{4\pi d}{\lambda}$$

### B. HLK-LD2450 24GHz mmWave Radar
- **Target Tracking:** 2D position $(X, Y)$ and radial velocity vectors at 20Hz update rate.
- **Custom Bit-15 Signed Binary Protocol:** HLK-LD2450 30-byte UART binary frames (`AA FF 03 00 ... 55 CC`) utilize custom **Bit-15 signed integer encoding**:
  $$\text{Value} = \begin{cases} \text{Raw} - 32768 & \text{if Bit 15 } = 1 \text{ (Positive mm)} \\ 0 - \text{Raw} & \text{if Bit 15 } = 0 \text{ (Negative mm)} \end{cases}$$

---

## 3. $4 \times 4$ Homogeneous Extrinsic Transformation Matrix ($T_{s \to w}$)

Converts 2D radar target coordinates $(x_r, y_r)$ into 3D world floorplan space $(X_w, Y_w, Z_w)$ incorporating sensor mounting height $Z_{sensor}$, pitch angle $\theta_p$, yaw $\psi_y$, and sensor translation $(X_{sensor}, Y_{sensor})$:

$$T_{s \to w} = \begin{bmatrix} 1 & 0 & 0 & X_{sensor} \\ 0 & 1 & 0 & Y_{sensor} \\ 0 & 0 & 1 & Z_{sensor} \\ 0 & 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} \cos\psi & -\sin\psi & 0 & 0 \\ \sin\psi & \cos\psi & 0 & 0 \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & \cos\theta & -\sin\theta & 0 \\ 0 & \sin\theta & \cos\theta & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix}$$

$$\begin{bmatrix} X_w \\ Y_w \\ Z_w \\ 1 \end{bmatrix} = T_{s \to w} \begin{bmatrix} x_r \\ y_r \\ 0 \\ 1 \end{bmatrix}$$

---

## 4. Posture & Gesture Comprehension Engine

### A. 17 COCO Skeletal Keypoint Posture States
Computes 3D joint coordinate vectors for 17 keypoint joints:
- `Sitting`: Lower pelvic root elevation $Z \approx 1.1\text{m}$, knee/hip $90^\circ$ joint flex.
- `Standing`: Pelvic root elevation $Z \approx 1.75\text{m}$, linear leg keypoint alignment.
- `Lying`: Pelvic root elevation $Z \le 0.4\text{m}$, horizontal torso axis.

### B. Gesture Recognition Engine
- Tracks right wrist (Joint 10) lateral velocity vector ($V_{wrist} = \frac{|\Delta X_{wrist}|}{\Delta t}$).
- **`WAVING_HAND` Gesture Trigger:** $V_{wrist} > 0.35\text{ m/s}$ while in Sitting or Standing state triggers immediate proactive voice attention from JARVIS.

---

## 5. WebGL 3D Visualizer Canvas (`SpatialRadarView.html`)

- Built with **Three.js** and **OrbitControls**.
- **Dark Glassmorphism Theme:** Frosted glass panels (`backdrop-filter: blur(16px)`), electric cyan room grid (5m x 5m), workstation desk mesh, and ceiling sensor node cone.
- **Dynamic Avatar Rendering:** Renders glowing 3D pelvic root spheres and 17 joint bone connection lines (`THREE.LineSegments`) driven by the 10Hz WebSocket feed (`ws://localhost:8765`).
- **Telemetry Cards:** Real-time display of Posture, Gesture, Heart Rate, Respiration Rate, and 3D floorplan coordinates $(X_w, Y_w, Z_w)$.
