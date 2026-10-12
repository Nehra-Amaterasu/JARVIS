# yaadash/legacy/

The first generation of JARVIS's memory code, kept for reference.
**Nothing here is imported by the running system** — verified by tracing the import
graph from every entry point (`core/jarvis.py`, `yaadash/refresh_memory.py`, the
ingest scripts, the app).

Why it was replaced (full detail in [`docs/DECISIONS.md`](../../docs/DECISIONS.md)):

| Module(s) | Problem | Replaced by |
|---|---|---|
| `yaadash_core.py`, `memory_server.py`, `graphrag_engine.py` | needed a separate server on :8000; called an 8B model to extract facts on every save; put a 130k-node graph on the voice hot path | `yaadash_v2.py` (embedded LanceDB) |
| `ingest_memory.py` | imported a module that did not exist, so it never ran | `ingest_v2.py`, `ingest_instagram.py` |
| `deep_vault_graph_miner.py`, `deep_cognitive_extractor.py`, `universal_vault_ingestor.py`, `map_user_vaults.py`, `target_vaults.json` | built a 130k-node graph that was ~95% noise (filesystem dumps, repeated sentences) | archive + people + beliefs |
| `dream_state_worker.py`, `night_cycle.py` | background consolidation over the noisy graph | `refresh_memory.py` |
| `ingest_*_ground_truths.py`, `ingest_agent_transcripts.py`, `mine_agent_transcripts.py`, `ingest_multimodal.py` | hardcoded "facts", schema bugs, silent skips | `ingest_identity.py` + belief store |
| `inspect_second_brain.py`, `visual_information_extractor.py` | tooling for the old stack | — |
| `test_second_brain.py`, `test_yaadash_100.py` | scripts against the old :8000 server, no assertions | `app/tests/test_memory_facts.py` |

These files are not maintained and may not run. Their old data (the Qdrant store
and graph) sits in `data/archive/`.
