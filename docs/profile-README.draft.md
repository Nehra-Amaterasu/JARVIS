<!--
DRAFT, not published. To publish, copy everything below this comment into README.md of
the Nehra-Amaterasu/Nehra-Amaterasu repository. Written 2026-10-25 to replace the
profile that listed an LD2450 radar (never bought) and called a 0.6 s text first token
a "first spoken word". Every number links back to JARVIS's docs; keep it that way.
-->

### Hi, I'm Amritanshu

Electronics & Communication Engineering undergraduate. I build systems where hardware,
signals and machine learning meet, and I measure things before I claim they work.

Heading toward **VLSI and digital design**, with a strong interest in running AI
efficiently on constrained hardware.

---

#### What I'm building

**[JARVIS](https://github.com/Nehra-Amaterasu/JARVIS)**: a local-first assistant that
runs on one laptop with a 6 GB GPU. No cloud LLM.

- **Voice and brain:** Whisper large-v3-turbo and Qwen3-4B-Instruct on the laptop.
  First token in **0.9 s** with the model kept resident (it was 22-97 s on a hybrid
  reasoning model that spent ~1,000 hidden tokens before every reply). First spoken
  word is still ~4 s median; that is the next thing to fix.
- **Memory:** 110k messages indexed for episodic recall with hybrid **BM25 + vector
  search** and Reciprocal Rank Fusion; **193/198** on a live fact audit; abstains
  instead of inventing a memory; learns facts and corrections from its own
  conversations.
- **People model:** tie-strength scoring checked against labelled data (**95 %
  precision@20**), including a case where the data refuted my own hypothesis.
- **Camera-free sensing:** ESP32-S3 Wi-Fi CSI on the real board sees a person moving
  (typing 6x, walking 9x the noise floor). It says "unsure" rather than guess:
  confidence floors and an out-of-range guard cut wrong answers shown on an unseen
  session from 61 % to 50 %. Multi-day labelled data, and the leave-one-day-out
  evaluation built for it, come next.
- **Real switches:** an Arduino Uno relay board switches the room's light and fan by
  voice, and JARVIS only says it is done when the board confirms. New ESP32 firmware
  adds an HMAC-signed, replay-checked UDP link for relays and sensing; it is flashed,
  and verifying it at home is in progress.
- **Always on:** a supervised voice core, a login watchdog, a resident brain and a
  rate-limited, hedged policy for speaking unprompted; private memory cut by 28 %.

Every decision is written up with the measurement behind it in the
[engineering log](https://github.com/Nehra-Amaterasu/JARVIS/blob/main/docs/DECISIONS.md)
and the [research notes](https://github.com/Nehra-Amaterasu/JARVIS/tree/main/docs/research).

---

#### Tools I work with

**Languages:** Python · C++ (Arduino / ESP32) · TypeScript
**ML and retrieval:** scikit-learn · PyTorch · sentence-transformers · LanceDB · BM25
**LLMs and speech:** Ollama · faster-whisper · local quantised models
**Apps:** FastAPI · React · three.js · WebSockets
**Hardware:** ESP32-S3 (Wi-Fi CSI) · Arduino Uno · relay modules · serial and UDP links
**Engineering:** Git · pytest · Vitest · benchmarking · reproducible environments

---

#### Currently

- Collecting labelled Wi-Fi sensing data across days, so the models are judged on days
  they never saw
- Verifying the ESP32's Wi-Fi link at home
- Building toward digital design and FPGA work

<!-- Profile last updated 2026-10 -->
