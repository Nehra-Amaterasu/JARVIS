# core/legacy/

First-generation pieces of JARVIS's core, kept for reference. **Nothing here is
imported by the running system.**

| File | What it was | Replaced by |
|---|---|---|
| `agent_ollama_backup.py` | a stale copy of the agent | `core/agent.py` |
| `intents.py` | keyword intent matching for the old voice loop | `core/room.py` parser + the agent's tools |
| `requirements-v1.txt` | the first stack (ExLlamaV2, mem0, ChromaDB, Llama 8B) | `requirements/requirements.gpu.txt` |

Why the first stack was dropped (it spilled past the 6 GB GPU and caused minute-long
lags): [`docs/DECISIONS.md`](../../docs/DECISIONS.md).
