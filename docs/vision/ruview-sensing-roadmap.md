# 📡 RUVIEW & RUFIELD: 0-to-100 Spatial Intelligence Master Architectural Blueprint

**Project Codename:** RUVIEW / RUFIELD Spatial Intelligence Suite  
**Goal:** Build a 100% camera-free, contact-free, high-precision spatial intelligence operating system for your room and apartment using radio frequencies (Wi-Fi CSI) and 24GHz mmWave radar (HLK-LD2450).  
**Hardware Strategy:** Extremely budget-optimized (< ₹1,000 Total Hardware Cost) using ESP32-S3 + HLK-LD2450, completely eliminating the need for expensive ₹17,000 TI chips while rendering live 3D visual avatars and floorplan meshes!

---

## 🏗️ 1. Complete System Architecture & Data Flow

```mermaid
flowcard
subgraph Hardware Layer ("< ₹1,000 Budget Hardware")
    ESP32["ESP32-S3 Microcontroller (~₹400)<br>Captures 5GHz Wi-Fi CSI<br>(56 Subcarriers)"]
    RADAR["HLK-LD2450 24GHz Radar (~₹500)<br>Captures 2D (X, Y) Coordinates & Velocity"]
    ROUTER["5GHz Wi-Fi Router (Owned)<br>RF Signal Transmitter"]
end

subgraph Simulation & Edge Signal Processing Layer
    SIM["ruview_simulator.py<br>10Hz Synthetic CSI & UART Generator"]
    PARSER["ruview_parser.py<br>Phase Sanitizer & UART Hex Frame Unpacker"]
    SAN["Phase Sanitization:<br>$\angle \hat{H}_k = \angle H_k - (a \cdot k + b)$"]
end

subgraph Spatial Fusion & AI Engine Layer
    FUSION["Sensor Fusion Engine<br>Pelvic Root (Radar) + 17 COCO Keypoints (CSI)"]
    OPENCLAW["OpenClaw Agent Core<br>Token-Dense Prompting & Dual Trigger Reactor"]
    MEMORY["Yaadash Spatial Memory<br>Qdrant Payload Range + GraphRAG Temporal Nodes"]
end

subgraph Visual WebGL & Automation Output Layer
    THREE["Three.js 3D WebGL Canvas<br>$4 \times 4$ Extrinsic Matrix Transformation $T_{s \to w}$"]
    WORKSTATION["Workstation Live Monitoring UI<br>Perspective 3D + Top-Down Blueprint Heatmap"]
    MCP["FastMCP Hardware Driver<br>Relays (Lights/Fans) & Servo Actuators"]
end

ESP32 --> PARSER
RADAR --> PARSER
SIM -.-> PARSER
ROUTER --> ESP32
PARSER --> SAN
SAN --> FUSION
FUSION --> OPENCLAW
FUSION --> THREE
OPENCLAW --> MEMORY
OPENCLAW --> MCP
THREE --> WORKSTATION
```

---

## 🔬 2. Deep Technical Breakdown by Layer

### Layer A: Wi-Fi CSI Signal Processing & Vital Signs Physics (`RuView`)
1. **Raw Subcarrier Parsing (ESP32-S3)**:
   - ESP32-S3 extracts 56 subcarriers in 20 MHz (HT20) mode delivered in 112-byte payloads formatted as signed `int8` pairs $[Q_k, I_k]$.
   - Complex Channel Frequency Response: $H_k = I_k + j \cdot Q_k$. Amplitude $A_k = \sqrt{I_k^2 + Q_k^2}$, Phase $\phi_k = \arctan2(Q_k, I_k)$.
2. **Phase Sanitization Math**:
   - Mitigates Carrier Frequency Offset (CFO) and Sampling Frequency Offset (SFO) using linear regression across subcarriers:
     $$\angle \hat{H}_k = \angle H_k - (a \cdot k + b)$$
     where $a = \frac{\angle H_N - \angle H_1}{k_N - k_1}$ and $b = \frac{1}{N} \sum_{i=1}^N \angle H_i$.
3. **5GHz / 5.8GHz Vital Sign Physics**:
   - Chest displacement phase sensitivity: $\Delta \phi(t) = \frac{4\pi \cdot d(t)}{\lambda}$.
   - At 5.8 GHz ($\lambda = 5.17\text{ cm}$), a 5mm respiration shift creates a **$69.6^\circ$ phase shift** ($2.4\times$ more sensitive than 2.4GHz). Cardiac pulse micro-displacements (~0.3mm) produce **$4.2^\circ$ phase shifts**.

### Layer B: 24GHz mmWave Radar Protocol (`HLK-LD2450`)
1. **UART Protocol**: 256,000 baud rate, Little-Endian bit order.
2. **Frame Structure**:
   - Header: `AA FF 03 00` | Target 1 Payload (8 bytes) | Target 2 Payload (8 bytes) | Target 3 Payload (8 bytes) | Tail: `55 CC`.
3. **Custom Bit-15 Signed Decoding**:
   - X, Y, and Speed are 16-bit integers where Bit 15 is the sign indicator:
     $$\text{If Bit 15} = 1 \implies \text{Value} = \text{Raw} - 32768 \quad (\text{Positive mm})$$
     $$\text{If Bit 15} = 0 \implies \text{Value} = 0 - \text{Raw} \quad (\text{Negative mm})$$

### Layer C: 3D Visual Mapping & Transformation Mathematics
1. **3D WebGL vs 2D Canvas Strategy**:
   - Uses a hybrid **WebGL perspective 3D viewport + 2D top-down orthographic blueprint canvas** with FOV frustums and heatmaps.
2. **$4 \times 4$ Homogeneous Extrinsic Transformation Matrix ($T_{s \to w}$)**:
   - Converts 2D radar coordinates $(x_r, y_r, 0)$ into 3D world floorplan space $(X_w, Y_w, Z_w)$:
     $$\begin{bmatrix} X_w \\ Y_w \\ Z_w \\ 1 \end{bmatrix} = \begin{bmatrix} R_{11} & R_{12} & R_{13} & X_{sensor} \\ R_{21} & R_{22} & R_{23} & Y_{sensor} \\ R_{31} & R_{32} & R_{33} & Z_{sensor} \\ 0 & 0 & 0 & 1 \end{bmatrix} \begin{bmatrix} x_r \\ y_r \\ 0 \\ 1 \end{bmatrix}$$
   - $R = R_z(\psi_y) \cdot R_x(\theta_p) \cdot R_y(\phi_r)$ incorporates pitch $\theta_p$ (downward mounting angle), yaw $\psi_y$, and height $Z_{sensor}$.
3. **Sensor Fusion**:
   - Radar provides high-accuracy 20Hz pelvic root positioning $(X_w, Y_w)$, while RuView Wi-Fi CSI provides 17 COCO joint angle rotations for camera-free avatar animation.

### Layer D: OpenClaw Agent Triggers & Spatial Memory
1. **Token-Dense Prompt Formatting**:
   - Compresses 100Hz telemetry into dynamic delta context headers: `[SPATIAL STATE]: User=Present | Zone=Workstation | Posture=Sitting | Motion=0.04m/s | Respiration=18RPM | HeartRate=74BPM`.
2. **Dual-Reactor Trigger Loops**:
   - **Prolonged Sitting Rule**: If `Zone=Workstation` and `Posture=Sitting` for $>45\text{ mins} \implies$ trigger proactive posture/stretch prompt.
   - **Absence Power Rule**: If `User=Absent` for $>5\text{ mins} \implies$ invoke `FastMCP.control_relay_channel(1, "off")` to turn off room lights.
3. **Spatial Memory in Qdrant & GraphRAG**:
   - Every spatial state event is stored with temporal validity bounds (`valid_from`, `valid_to`).

---

## 🛠️ 3. Implementation Step Roadmap (0 to 100)

### Phase 1: 100% Simulation Pipeline (Immediate Execution)
- **`ruview_simulator.py`**: Upgrade to generate synthetic 56-subcarrier `int8` CSI matrices, Bit-15 signed LD2450 UART packets, and 17 COCO keypoint streams at 10Hz over WebSockets (`ws://localhost:8765`).
- **`ruview_parser.py`**: Implement phase sanitization and binary frame unpacking.

### Phase 2: Spatial Radar API & Sensor Fusion (`memory_server.py`)
- Expose `/spatial/telemetry` and WebSocket proxy endpoint in `memory_server.py`.
- Integrate spatial state events with temporal payload filters in Qdrant and NetworkX GraphRAG.

### Phase 3: WebGL 3D Floorplan & Workstation Monitoring UI
- Build `SpatialRadarView.jsx` (Three.js WebGL canvas) allowing floorplan CAD mesh upload (GLTF/OBJ/SVG), sensor placement setup $(X_{sensor}, Y_{sensor}, Z_{sensor}, \theta_p)$, and live 3D avatar rendering.

### Phase 4: Hardware Deployment (Upon ESP32-S3 & Radar Arrival)
- Flash ESP32-S3 with `RuView` `esp-csi` firmware.
- Connect HLK-LD2450 to ESP32-S3 GPIO UART TX/RX pins (256,000 baud). Plug and play!

---

## 🧪 4. Automated & Manual Verification Plan

### Automated Tests
1. Run `ruview_simulator.py` + `ruview_parser.py` test suite to verify 10Hz data streaming without frame drops.
2. Verify $4 \times 4$ transformation matrix calculations in Python (`test_spatial_matrix.py`).

### Manual Verification
1. Upload room floorplan mesh and verify target avatar movement across simulated room boundaries.
2. Test proactive FastMCP agent actions (e.g. lighting toggles) triggered by simulated spatial state changes.
