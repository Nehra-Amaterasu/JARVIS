# core/legacy/

First-generation pieces of JARVIS's core, kept for reference. **Nothing here is
imported by the running system.**

| File | What it was | Replaced by |
|---|---|---|
| `agent_ollama_backup.py` | a stale copy of the agent | `core/agent.py` |
| `intents.py` | keyword intent matching for the old voice loop | `core/room.py` parser + the agent's tools |
| `mcp_client_bridge.py` | two LangChain tools (room control, scenes), bound only when the sentence held one of 16 exact phrases, returning a string with no source or status | `core/tools/` — one registry with tiers and receipts, and the honesty guard |
| `mcp_hardware_server.py` | a FastMCP server for room control; its telemetry tool returned invented vitals ("75 BPM / 18 RPM") when Aankhen was off, and it drove a servo that does not exist | a real MCP endpoint over the app's own tools (planned) |
| `requirements-v1.txt` | the first stack (ExLlamaV2, mem0, ChromaDB, Llama 8B) | `requirements/requirements.gpu.txt` |

Why the first stack was dropped (it spilled past the 6 GB GPU and caused minute-long
lags): [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
