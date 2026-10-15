# Research notes

One line per note (CLAUDE.md: research is never lost). Private notes live in
`data/notes/research/`, not here.

- [2026-10-12-agents-and-media.md](2026-10-12-agents-and-media.md): agents, skills, music, Obsidian, graph viz.
- [2026-10-12-csi-datasets.md](2026-10-12-csi-datasets.md): public Wi-Fi CSI datasets, what transfers to Aankhen.
- [2026-10-12-sih-problem-statements.md](2026-10-12-sih-problem-statements.md): Smart India Hackathon statements that fit JARVIS.
- [2026-10-13-audit-phone-link.md](2026-10-13-audit-phone-link.md): audit of link 2, the phone as a second transmitter.
- [2026-10-13-estimate-avatar.md](2026-10-13-estimate-avatar.md): the learned "where am I" drawn as a figure in the twin: spots from room.json, heat from the human band, 20 draw calls and no measurable frame cost.
- [2026-10-13-connect-and-system.md](2026-10-13-connect-and-system.md): which installed models can be the brain (tools, VRAM: 3.31 GB loaded from a 2.50 GB file), Edge and Kokoro voices, the four export pages and formats, and his real first-word latency (median 4.12 s, p90 8.09 s).
- [2026-10-13-csi-phase-vs-amplitude.md](2026-10-13-csi-phase-vs-amplitude.md): does sanitised phase carry more than amplitude.
- [2026-10-13-ota-flashing-and-relay-wiring.md](2026-10-13-ota-flashing-and-relay-wiring.md): firmware over Wi-Fi (ArduinoOTA, 998,101 bytes = 76 % of the app slot), safe relay GPIOs, 5 V supply and 3.3 V logic on relay modules.
- [2026-10-13-media-player.md](2026-10-13-media-player.md): the media player: YouTube's top result, Spotify search, his music folder; Windows media sessions read from PowerShell (Spotify publishes one; first reading 0.9-8.8 s, then <0.1 ms at 2.1 % of a core).
- [2026-10-13-phone-second-link.md](2026-10-13-phone-second-link.md): a phone as Aankhen's second Wi-Fi link.
- [2026-10-13-raw-stream-and-crew-speed.md](2026-10-13-raw-stream-and-crew-speed.md): the rolling 7-day raw CSI recorder (312 MB/day with phase) and the lock-free frame that took the movement tick from 19.5 to 0.5 ms and the stream from 6.1 to 10 Hz in the bench.
- [2026-10-13-wifi-sensing-limits-and-routes.md](2026-10-13-wifi-sensing-limits-and-routes.md): what one Wi-Fi link can see, and signal-only routes past it.
- [2026-10-13-world-model-and-channel-charting.md](2026-10-13-world-model-and-channel-charting.md): world model and channel charting on one link, tested.
- [2026-10-14-yaadash-feedback-loop.md](2026-10-14-yaadash-feedback-loop.md): what Yaadash is for and whether it works (chat probes 0/7, archive hit@2 3/10, "remember that" had never stored anything), the chat -> memory loop that fixes it (chat probes 5/7, off-topic 0/8, <= 250 tokens a turn), and when a QLoRA fine-tune of the 4B would be worth it.
- [2026-10-14-spatial-intelligence-brainstorm.md](2026-10-14-spatial-intelligence-brainstorm.md): how Aankhen can know where he is: five lenses plus an adversarial review, ranked to a Rs 0 backbone (free labels from his devices, semi-Markov belief, honest sets) and a gated experiment ladder before any board is bought.
- [2026-10-14-conversation-fixes.md](2026-10-14-conversation-fixes.md): nine fixes from the 10-14 transcript review: one verb per clause, honest fan speed, invented "playing now" turned into a real play, "play that", promise claims, whole-sentence long answers, name-only wake, short unsure transcripts dropped (core tests 389 -> 465).
- [2026-10-14-phone-access.md](2026-10-14-phone-access.md): JARVIS from the phone, served by the laptop. A second listener (off by default) with QR pairing, hashed per-device tokens and instant revoke. The mic needs https (Tailscale Serve recommended). Toggling a light measured 6.1 ms median through the phone listener; the page is 21.8 KB.
- [2026-10-14-uno-relay-integration.md](2026-10-14-uno-relay-integration.md): the Arduino Uno relay board as JARVIS's only switch for the light and fan: one owner of COM8, a switch counts only when the board's JSON reply confirms it, adopt the board's state on reconnect, Aankhen never probes an Uno.
- [2026-10-14-aankhen-data-protocol.md](2026-10-14-aankhen-data-protocol.md): why Aankhen says "bed"/"waving" (installed models are one 5-min session, 392 windows; on the other session they call away "bed" 100 % and still "waving" 54 %; live static shape up to 2x outside training; 3.4.0 packet gaps blanked HBE in 12-40 % of windows), a 26 min/day randomised drill protocol with fan on/off blocks, QC and leave-one-day-out against the 73 % kill rule, and gating for automatic lights (no Wi-Fi-only off).
- [2026-10-15-aankhen-ai-learning-path.md](2026-10-15-aankhen-ai-learning-path.md): teaching path for training Aankhen yourself: 8 hands-on lessons (heatmaps, features, leave-one-day-out, 1D-CNN, int8, ESP-DL on the ESP32-S3, results-only output, daily retraining), on-device budget (~20 KB, ~1.6M multiply-adds, est. 10-50 ms), agent-vs-model roles, OpenClaw rejected for a JARVIS crew role on the local Qwen3-4B, MS/VLSI tie-ins, a 7-day starter plan.
- [memory-feasibility.md](memory-feasibility.md): personal memory at N = 1.
