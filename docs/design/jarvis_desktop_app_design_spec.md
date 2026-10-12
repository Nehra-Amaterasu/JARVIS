# Design & Engineering Specification: JARVIS Desktop Application ("Jarvis the Application")

**Framework:** Vite + React (or Next.js)  
**Backend API:** FastAPI `memory_server.py` (`http://127.0.0.1:8000`) & WebSocket `ws://localhost:8765`  

---

## 🎨 1. Aesthetic Imperative & Hardware Rules

### CRITICAL HARDWARE CONSTRAINT
Above all else, the UI/UX must be lightweight. If heavy graphics choke the 6GB VRAM RTX 4050 GPU or system RAM, JARVIS will fail at spatial intelligence and fast inference. **Keep it simple, clean, and highly artistic without heavy render cost.**

### Visual Design Tokens
- **Theme:** Dark cosmic glassmorphic theme (`#080911` to `#0d0f1d`).
- **Panels:** Frosted translucent glass (`rgba(15, 23, 42, 0.45)` with `backdrop-filter: blur(20px)` and 1px borders `rgba(255, 255, 255, 0.12)`).
- **Typography:** Inter, Outfit, or Google Fonts modern sans-serif.
- **Micro-Animations:** Smooth GPU-accelerated CSS transitions for hover, focus, and state changes.

---

## 🖥️ 2. Screen & Tab Architecture

### 1. Command & Voice Hub (`/chat`)
- Central JARVIS Siri-inspired pulsating gradient orb (electric blue transitioning to amber gold) encircled by 2-3 concentric animated rings that pulse in sync with speech audio levels.
- Real-time audio frequency visualizer bar.
- Live transcription stream & response message log.

### 2. Spider-Web Memory Graph (`/memory-graph`)
- **2D Interactive Force-Directed Network (`2d-force-graph` or `D3.js`):**
  - *Hardware Constraint Constraint:* 2D is explicitly chosen over 3D WebGL for the graph to protect the 6GB VRAM RTX 4050 GPU limit.
  - Visualizes all 130,000+ nodes and 790,000+ edges as a spider web. Strongly related memories cluster into tight "thought webs".
  - Clickable nodes opening an inspector panel showing 22D cognitive profile metadata, vector chunks, and graph edges.

### 3. Asset Gallery (`/gallery`)
- Visual grid of all ingested documents, notes, Excel sheets (`SPARK_org_system_v2.xlsx`), audio files (ID3 metadata tags), and image OCR snippets.

### 4. Aankhen 3D Spatial Radar Tab (`/spatial`)
- Embeds [SpatialRadarView.html](../../aankhen/legacy/SpatialRadarView.html) or renders a Three.js WebGL canvas displaying 3D floorplans, live human target avatars, 17 COCO keypoint joint lines, posture states, gestures (`WAVING_HAND`), and vitals.

### 5. FastMCP Hardware Manager (`/plugins`)
- Toggle dashboard for local FastMCP tools (`mcp_hardware_server.py`), room lighting, fans, servos, and subagents.

---

## 🧪 3. API Integration Contract

- **Query Second Brain:** `POST http://127.0.0.1:8000/query` (`{"query": "text", "top_k": 5}`)
- **Ingest Document:** `POST http://127.0.0.1:8000/ingest_document` (`{"file_path": "path"}`)
- **Aankhen Telemetry:** `GET http://127.0.0.1:8000/aankhen/telemetry` or WebSocket `ws://localhost:8765`
