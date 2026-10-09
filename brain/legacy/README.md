# legacy/

The first generation of JARVIS's memory and perception code, kept for reference.
**Nothing here is imported by the running system** — verified by tracing the import
graph from every entry point (`jarvis.py`, `refresh_memory.py`, the ingest scripts).

Why it was replaced (full detail in [`docs/DECISIONS.md`](../../docs/DECISIONS.md)):

| Module(s) | Problem | Replaced by |
|---|---|---|
| `yaadash_core.py` | needed a separate server on :8000; called an 8B model to extract facts on every save | `yaadash_v2.py` |
| `ingest_memory.py` | imported a module that did not exist, so it never ran | `ingest_v2.py`, `ingest_instagram.py` |
| `deep_vault_graph_miner.py`, `deep_cognitive_extractor.py`, `universal_vault_ingestor.py`, `map_user_vaults.py` | built a 130k-node graph that was ~95% noise (filesystem dumps, repeated sentences) | archive + people + beliefs |
| `aankhen_engine.py` | simulator reporting invented vitals and pose as if measured | `aankhen_v2.py` and the ESP32 path |
| `dream_state_worker.py`, `night_cycle.py` | background consolidation over the noisy graph | `refresh_memory.py` |
| `ingest_*_ground_truths.py`, `ingest_agent_transcripts.py`, `mine_agent_transcripts.py`, `ingest_multimodal.py` | hardcoded "facts", schema bugs, silent skips | `ingest_identity.py` + belief store |
| `agent_ollama_backup.py` | stale copy of the agent | `agent.py` |
| `inspect_second_brain.py`, `intents.py`, `visual_information_extractor.py` | tooling for the old stack | — |

`graphrag_engine.py` is *not* here: `memory_server.py` still imports it.

These files are not maintained and may not run.
