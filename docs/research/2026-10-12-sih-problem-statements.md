# Smart India Hackathon problem statements that fit JARVIS

Research date: 2026-10-12. Scope: SIH 2022, 2023, 2024 and 2025, plus the live SIH 2026 list because it is the current one.

---

## 0. Summary

**Top 4**

| # | Year / ID | Exact title | Organisation | Why it fits JARVIS |
|---|---|---|---|---|
| 1 | 2022 / **DR729** | Security Management System | AICTE | It asks for home security that is "not dependent on CCTV" and alerts residents when nobody is home. That matches camera-free Wi-Fi motion sensing plus relays and remote alerts. |
| 2 | 2022 / **DR704** (2024 / **SIH1524**, **SIH1525** are its newer sibling) | Energy Conservation with modern technology | AICTE | It asks for IoT usage reports and for appliances to "automatically turn off" when people leave. That matches CSI room occupancy plus the 12 relays and IR control of the AC. |
| 3 | 2024 / **SIH1778** | Innovative Gerontological Care Solutions: Designing the Future of Elderly Care Products | MSDE | It names fall detection, medication management, home automation and virtual companionship. That matches Hinglish voice, Yaadash memory, relays and an activity-rhythm alarm. |
| 4 | 2025 / **SIH25231** | Design and build a multimodel Retrieval-Augmented Generation (RAG) system leveraging a Large Language Model (LLM) for OFFLINE mode … | NTRO | It asks for offline RAG over PDF, DOC, images and voice, with citations. Yaadash is already a hybrid BM25 + vector retriever with an abstention gate, and Whisper and Qwen are already local. The student use is exam prep from your own notes and lectures. |

**Bottom line:** none of the 1,583 statements I parsed (2022–2026) is about LPG leaks, gas cylinders running out, overhead-tank overflow, power cuts, inverter batteries or mosquitoes (Section 2). The best household fits are three statements (security, energy, elder care) whose text matches what one ESP32-S3, a router, relays, IR and a Hinglish LLM can do. The best student fit is SIH25231.

**Timing:**
- SIH 2026 idea submission closed on 5 Oct 2026 for 240 of its 260 statements. Only SIH26241 to SIH26260 stay open until 20 Oct 2026, and none of those is a strong fit.
- SIH entry needs a 6-member team with at least one female member, nominated by your college SPOC ([SIH 2026 Guidelines](https://sih.gov.in/letters/2026/SIH%202026%20Guidelines.pdf)).
- So in practice these statements are useful as **problem framing and evaluation specs** for JARVIS features, or as the base for an entry in a later cycle or the Student Innovation category.

---

## 1. Method and how the IDs were checked

I downloaded the official problem-statement tables, parsed them and searched them by keyword. I did not rely on blog summaries.

| Year | Source | Statements parsed | Status |
|---|---|---|---|
| 2022 | Official page `sih.gov.in/sih2022PS`, now 404 live, read from the [Wayback snapshot of 19 Nov 2022](https://web.archive.org/web/20221119160320/https://www.sih.gov.in/sih2022PS) | 564 | Official. 2022 IDs are letter-prefixed (for example `DR729`), as printed in the page's "PS Number" column. |
| 2023 | Official page, [Wayback snapshot of 27 Nov 2023](https://web.archive.org/web/20231127180228/https://www.sih.gov.in/sih2023PS) | 234 (official total 239; SIH1350–1355, 1395–1401 and 1509 are missing from the snapshot) | Official |
| 2024 | Official spreadsheet [sih.gov.in/letters/SIH_PS_2024.xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx), with 246 rows, plus the [Wayback snapshot of sih2024PS](https://web.archive.org/web/20250114183819/https://www.sih.gov.in/sih2024PS) with 254 | 254. This matches the [Ministry of Education press release](https://education.gov.in/sites/upload_files/mhrd/files/PIB2083360.pdf) figure of 254 (186 software, 68 hardware). | Official |
| 2025 | The official page `sih.gov.in/sih2025PS` no longer serves the table, and Wayback only holds 403 pages. I used two independent GitHub scrapes of it: the [Debug-Aryan dataset](https://github.com/Debug-Aryan/sih-analytics-dashboard/blob/main/data/sih_2025_problem_statements_team_outcomes.csv) (271 IDs) and [shamblonaut/sihps problems.md](https://github.com/shamblonaut/sihps/blob/main/public/problems.md), which carries the descriptions. A college printout of the official page, the [DRIEMS PDF dated 31 Aug 2025](https://www.driems.ac.in/wp-content/uploads/2025/09/Smart-India-Hackathon_PROBLEM-STATEMENTS.pdf), matches SIH25001–SIH25020 exactly. | 271. This matches the official total of 271 (191 software, 80 hardware) reported by [KJSCE](https://kjsce.somaiya.edu/en/view-announcement/1043). | **Mirror-verified.** Two independent mirrors agree on every 2025 ID cited here. IDs above about SIH25101 are not in the DRIEMS print, so for those no official page was seen. |
| 2026 | Live official page [sih.gov.in/sih2026PS](https://sih.gov.in/sih2026PS) | 260 (182 software, 69 hardware, 9 with a blank category) | Official |

**Warning about reused IDs:** SIH reuses numbers across years. `SIH1524` is ISRO's DNS-filtering statement in 2023 and Godrej's appliance statement in 2024. Always cite a statement as year plus ID.

---

## 2. Negative findings

I searched every title and description across all five years for the following terms:

> `LPG`, `cooking gas`, `gas leak`, `cylinder`, `water tank`, `overhead tank`, `overflow`, `power cut`, `outage`, `inverter`, `UPS`, `mosquito`, `medicine reminder`

No statement targets a household's LPG safety, cylinder level, tank overflow, power cuts or inverter battery, or mosquitoes. The closest matches are these:
- Water statements are village- or utility-scale ([2026 SIH26255](https://sih.gov.in/sih2026PS) on household tap connections, SIH26254 on pipeline leak sensors, and Jal Shakti's 2024 grey-water and test-kit series).
- Medicine reminders appear only inside elder-care statements (2024 SIH1778, 2026 SIH26003).

If you want those household problems, the honest route is a **Student Innovation** entry, for example 2025 SIH25118 or 2026 SIH26219, both "Smart Automation", hardware (Section 7). There is no ministry statement to attach them to.

Attendance statements (2025 SIH25011, SIH25012 and SIH25016; 2026 SIH26245) all assume face recognition, QR codes, RFID or Bluetooth. Wi-Fi CSI cannot identify individuals, so those are a poor fit.

---

## 3. Shortlist (10)

"Ideas" is the number of ideas submitted at snapshot time. It is a rough measure of how crowded a statement is.

| # | Year | ID | Exact title | Organisation | Category / theme | Source | Ideas |
|---|---|---|---|---|---|---|---|
| 1 | 2022 | DR729 | Security Management System | All India Council for Technical Education (AICTE). | Software / Smart Education | [2022 page](https://web.archive.org/web/20221119160320/https://www.sih.gov.in/sih2022PS) | 51 |
| 2 | 2022 | DR704 | Energy Conservation with modern technology | All India Council for Technical Education (AICTE). | Software / Renewable / Sustainable Energy | [2022 page](https://web.archive.org/web/20221119160320/https://www.sih.gov.in/sih2022PS) | 87 |
| 3 | 2024 | SIH1778 | Innovative Gerontological Care Solutions: Designing the Future of Elderly Care Products | Ministry of Skill Development and Entrepreneurship (MSDE) | Hardware / MedTech / BioTech / HealthTech | [2024 xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx) | 153 |
| 4 | 2025 | SIH25231 | Design and build a multimodel Retrieval-Augmented Generation (RAG) system leveraging a Large Language Model (LLM) for OFFLINE mode that can ingest, index, and query diverse data formats such as DOC, PDF, Images and voice recordings within a unified semantic retrieval framework | National Technical Research Organisation (NTRO) | Software / Smart Automation | [mirror 1](https://github.com/Debug-Aryan/sih-analytics-dashboard/blob/main/data/sih_2025_problem_statements_team_outcomes.csv), [mirror 2](https://github.com/shamblonaut/sihps/blob/main/public/problems.md) | 391 |
| 5 | 2024 | SIH1524 (HW) / SIH1525 (SW) | Innovating for Sustainability: Driving Smart Resource Conservation (Energy & Water) in Home Appliances (Refrigerators, Air Conditioners, Washing Machines and Desert Air Coolers) | Godrej Appliances | Hardware and Software / Smart Resource Conservation | [2024 xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx) | 219 / 107 |
| 6 | 2026 | SIH26172 | Low Latency and Efficient Voice Activator for Edge Devices | Indian Space Research Organisation (ISRO) | Hardware / Smart Automation | [2026 page](https://sih.gov.in/sih2026PS) | closed 5 Oct 2026 |
| 7 | 2023 | SIH1393 | Water and Electricity Tracking App | Ministry of Environment | Software / Smart Automation | [2023 page](https://web.archive.org/web/20231127180228/https://www.sih.gov.in/sih2023PS) | 217 |
| 8 | 2022 | DA1066 | AI based interactive robot for elderly care | Department of Science & Technology (DoST), Ministry of Science and Technology. | Hardware / Robotics and Drones | [2022 page](https://web.archive.org/web/20221119160320/https://www.sih.gov.in/sih2022PS) | 52 |
| 9 | 2026 | SIH26003 | AI-Based Cognitive Gaming and Memory Assistance Platform for Elderly Dementia Patients in North Eastern Region (NER) | Ministry of Development of North Eastern Region (MDoNER) | Software / MedTech / BioTech / HealthTech | [2026 page](https://sih.gov.in/sih2026PS) | closed 5 Oct 2026 |
| 10 | 2024 | SIH1779 | Voice-Controlled Gaming Tools for Enhanced Learning in the Skill Ecosystem | Ministry of Skill Development and Entrepreneurship (MSDE) | Software / Toys & Games | [2024 xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx) | 96 |

### Fit matrix

Each statement is scored against the four JARVIS strengths, and against the hardware it would need beyond what you already own.

| # | Camera-free CSI | Hinglish local LLM | Relays / IR | Personal memory | New hardware needed | Main risk |
|---|---|---|---|---|---|---|
| 1 DR729 | **core** | alerts and summaries | deterrent lights, siren | event log | none (a second node is optional) | still intruder missed; coverage gaps |
| 2 DR704 | **core** | nudges and reports | **core** | household routines | none to estimate; one PZEM-004T to *prove* savings | wrongly switching off a still person |
| 3 SIH1778 | activity rhythm only | **core** | night light | **core** | none to demo; one node per elder's room for real use | CSI cannot detect falls |
| 4 SIH25231 | no | **core** | no | **core** (Yaadash) | none | 6 GB VRAM; OCR quality |
| 5 SIH1524/5 | occupancy | reports | **IR to the AC** | no | PZEM-004T to prove savings | brief is title-only; Godrej likely wants appliance-internal ideas |
| 6 SIH26172 | no | no (sits upstream of Whisper) | no | no | INMP441 I2S mic | must train a custom keyword, not "hey jarvis" |
| 7 SIH1393 | occupancy evidence | **core** (nudges) | evidence | habits | none for electricity; a flow meter for water | water use cannot be measured without a sensor |
| 8 DA1066 | activity | **core** | optional SG90 "head" | **core** | none | judges expect a robot body |
| 9 SIH26003 | no | voice (NER languages are a mismatch) | no | **core** | none | language mismatch; it is clinical |
| 10 SIH1779 | no | **core** | no | progress | none | vocational-skilling framing, not exam prep |

---

## 4. Top 4: solution sketches

Physical limits used throughout come from your own Aankhen research notes and `docs/design/aankhen-physics.md`. With one ESP32-S3 and the router:
- Motion detection reaches 87–99 % recall with about 1–3 % false positives once calibrated per room.
- A **still** person is detected only about 38 % of the time (12-day real-home study).
- One link gives no x/y position or zone.
- Breathing is lab-grade only: about 1 m from the line-of-sight link, with the subject still.
- Accuracy collapses across rooms and antennas, so each room needs recalibration.
- Heart rate, pose and identity are not available, and the README already disables them rather than faking them.

### 4.1 Security without cameras: 2022 DR729, "Security Management System" (AICTE)

**What the statement asks (paraphrased):** CCTV alone fails because intruders use blind zones or cut power to cameras. The statement asks for a robust system "not dependent on CCTV or any one technology" that "alerts the residents far away even when there is no one in the house".

**Reuses:**
- Aankhen: `motion.py` human-band-energy detector, `occupancy.py`, `fusion.py`, and the `learn.py` empty/outside/room classes that separate "family moving past the router" from "someone in my room".
- The Uno with 12 relay channels, to switch on lights as a deterrent.
- The speakers, for a spoken warning in Hinglish and a siren tone.
- The FastAPI app over Tailscale, so you can check from outside.
- The agent, for Hinglish incident summaries ("2:14 pm pe bedroom mein movement, 40 second tak").
- Yaadash, as the event log.

**New software:**
1. **Arming state.** Arm automatically when every family phone has been absent for more than 15 minutes. Phones can be tracked by pinging their static DHCP leases or watching Tailscale peer status. Use "last seen" rather than a single ping, because phones sleep their Wi-Fi radios and randomise MACs, so you will need to pin a per-network MAC on each phone. Add a manual "arm" voice command and app button.
2. **Alarm pipeline.** While armed: CSI motion over threshold, confirmed by k-of-n windows over about 5–10 s, then:
   - deterrent (lights relay on, spoken warning);
   - a phone push through a self-hosted notifier reached over Tailscale;
   - a stored 60-second CSI trace and the room-model output.
3. **Tamper heartbeat.** If ESP32 frames stop for more than 30 s, send a "sensor offline" alert.
4. **Daily self-test.** Each morning, compare live CSI against the empty-room baseline and flag drift (router channel change, moved furniture).

**Unavoidable hardware:** none.

Optional: a second CSI node. Your earlier buy list priced an ESP32-C3 SuperMini at about INR 240 (not re-checked today). Place it so that its link to the router crosses the main door or living-room path. One link only "sees" well near the ESP32-to-router path.

**How to show it works (a test a household can run):**

| Test | Procedure | Pass mark (suggested) |
|---|---|---|
| Walk test | Arm the system. A family member enters 30 times: 10 at normal pace, 10 creeping slowly, and 10 entering then standing still. Record detection and time from entry to phone alert. | 90 % or more for normal walking. Report creeping and standing separately; expect them to be poor. |
| Empty-house false alarms | Stay armed for at least 48 h with fans off, then 48 h with the ceiling fan on and curtains free. | 1 false alarm per day or fewer |
| Coverage map | Walk every room (living, kitchen, bathrooms, balcony). Mark which rooms trigger. | Publish the map; do not claim whole-home coverage. |
| Tamper | Pull the ESP32's USB, then the router's power. | ESP32 offline alert within 60 s. Router power loss = no internet alert (see limits). |

**Honest limits:**
- It is a **motion** detector. An intruder who stops moving drops to about 38 % detection.
- It cannot tell a thief from a relative, a maid or a pet. The arming state is doing all of that work.
- No head count and no location from one link.
- Through-wall motion from a neighbour or a fan can trigger it, so you must calibrate per room.
- If mains power is cut, the JioFiber router dies unless it is on the inverter. The laptop on battery can keep sensing but cannot alert anyone without internet.
- It is a complement to locks, not a certified alarm.
- Only arm it when everyone is out, so it is not monitoring family members without their knowledge.

### 4.2 Occupancy-aware energy saving: 2022 DR704, "Energy Conservation with modern technology" (AICTE)

The same build also answers 2024 SIH1524 (Hardware) and SIH1525 (Software) from Godrej Appliances: "Innovating for Sustainability: Driving Smart Resource Conservation (Energy & Water) in Home Appliances …".

**What DR704 asks:** a mobile or web app using IoT to make energy conservation easy, with daily, weekly and monthly usage reports. It also says "sensors can be installed so that when owners leave the house, appliances will automatically turn off".

Godrej's official entry is title-only: the 2024 spreadsheet and page repeat the title as the description. A [secondary write-up](https://engineersplanet.com/abstracts/innovating-for-sustainability-driving-smart-resource-conservation-in-home-appliances-hardware/) describes it as reducing energy and water use of refrigerators, ACs, washing machines and desert coolers.

**Reuses:**
- CSI per-room occupancy, including `learn.py` desk and bed classes.
- The Uno relays for lights L1–L8 and the fan. JARVIS knows each load's on/off state because it drives them.
- The 940 nm IR LED to the Voltas AC (off, or a higher setpoint) and the Samsung TV.
- The agent, for spoken nudges ("Kamra 20 minute se khaali hai — light band kar doon?").
- Yaadash, to learn household routines (who studies late, when the AC normally runs).
- App dashboards.

**New software:**
1. **Energy ledger.** For each load: nameplate watts × relay on-time, giving kWh, then INR at your DISCOM slab tariff (entered by hand). Daily, weekly and monthly reports, as DR704 asks.
2. **Empty-room waste detector.** A load is on while CSI says the room has been empty for more than N minutes. First a spoken or app nudge, then auto-off only after a long hold (20–30 min). Never auto-off in "bed" or "night" mode.
3. **AC policy.** When the room is empty for more than N minutes, send IR "off" (or a higher setpoint). Re-arm when motion returns.
4. **Bill reconciliation.** Each week, photograph the DISCOM meter. Read it by OCR or type it in, and compare estimated kWh with metered kWh so the ledger's error is visible.

**Unavoidable hardware:**
- **Estimation: none.**
- **To *prove* AC savings, one PZEM-004T v3 with a 100 A CT** is listed at about INR 570–800 on Robu ([listing](https://st.robu.in/product/peacefair-pzem-004t-100a-with-split-ct-ac-meter); prices may be stale). IR is one-way, so without a meter JARVIS cannot know whether the AC actually switched off.
- Its voltage terminals are mains-live: wire it with the MCB off and enclose it.
- If the Voltas split's IR codes are not in IRremoteESP8266 (your notes say only the 122LZF window AC protocol was verified), you will also need an IR receiver to learn the remote. A TSOP-type module is typically under INR 100; I did not verify that price.
- **Do not switch the AC or geyser through the SRD relays.** They are rated 7 A at 240 VAC resistive. Use them for lights and the fan only.

**How to show it works:**

| Test | Procedure | Metric |
|---|---|---|
| Randomised A/B | For 4 weeks, flip a coin each morning: automation ON or OFF. | Empty-room-ON minutes per day (from the CSI and relay logs), and kWh per day (meter photo at a fixed time, or PZEM). Report the mean difference with its spread, not one headline number. |
| False-off rate | Count every manual re-on, or "undo" command, within 2 minutes of an auto-off. | Fewer than 1 per day. Above that, the family will disable it. |
| Ledger accuracy | Compare nameplate estimates with PZEM or the meter over 2 weeks. | Percentage error, stated openly. |

**Honest limits:**
- **The money is in the AC, not the LEDs.** An AC draws on the order of a kilowatt; a downlight group draws tens of watts. Do not inflate lighting savings.
- People reading or sleeping quietly look "empty" to CSI (about 38 % still detection). That is why there is a long hold and a spoken check before any switch-off.
- Manual wall-switch use is invisible unless the planned 230 V sense inputs are wired.
- The fridge, washing machine and cooler are outside both relay and IR control, and CSI cannot measure appliance health. That makes the Godrej framing (appliance-internal efficiency) a weaker match than DR704.
- Water: nothing in the current kit measures water.

### 4.3 Elder care at home: 2024 SIH1778, "Innovative Gerontological Care Solutions: Designing the Future of Elderly Care Products" (MSDE)

**What it asks:** products covering mobility, health monitoring and **medication management**, **fall detection** and emergency response, **home automation**, **virtual companionship** and cognitive stimulation, all affordable and easy to use.

**Reuses:**
- Voice loop: wake word, Whisper large-v3-turbo, the Hinglish romaniser and TTS. Elderly users talk; they do not use apps.
- Yaadash: people and closeness model ("Bua ka phone aaya tha?"), routines, and a running log of what was said.
- The Mission game engine, for short memory and quiz games on family names and dates (cognitive stimulation).
- Relays for an automatic night light on the bedroom-to-bathroom path when there is motion at night. This is fall *prevention*.
- CSI motion counts per hour as an activity rhythm.
- The app over Tailscale as a family dashboard.

**New software:**
1. **Activity-rhythm alarm.** Learn 14 days of hourly motion per room. When the usual morning activity has not appeared within about 2 h of the normal wake time:
   - JARVIS first asks aloud ("Dadi, sab theek hai?");
   - if there is no spoken reply within 2 min, notify family.
2. **Medicine schedule.** Spoken reminder, then spoken confirmation ("haan, le li"), logged. If the dose is missed, a second reminder goes out, then a family notification.
3. **Companion conversation** with memory. Keep it short and on daily topics. Add a hard rule: no medical advice beyond "doctor ko call karein".
4. **Help phrase.** "JARVIS, madad" triggers an immediate family notification.

**Unavoidable hardware:**
- For a demo in your room: **none.**
- For real use, the elder's room needs its own CSI link (about INR 240 for an ESP32-C3, from your earlier list, not re-checked) and a mic and speaker there. An old Android phone running the app could serve as the mic and speaker, so nothing new is needed for that part. The laptop mic covers one room only.

**How to show it works:**

| Test | Procedure | Metric |
|---|---|---|
| False inactivity alerts | 14 days of normal life with the person's consent. | 1 per week or fewer |
| Missed-event drill | On 5 random mornings the person stays out of the room through the usual window. | The alert fires on all 5, with a stated latency. |
| Medication adherence | Compare voice-confirmed doses with a count of the pill strip at the end of the week. | % agreement |
| Speech recognition on older voices | 50 Hindi/Hinglish utterances from the user's parents. | WER. Expect it to be worse than on your own voice. |
| Audibility | Play a reminder at normal volume in each room. | Heard / not heard map |

**Honest limits:**
- **CSI cannot reliably detect a fall.** A fall is a burst of motion followed by stillness, and stillness looks the same as "left the room" when a still person is detected only about 38 % of the time.
- No heart rate, SpO₂ or breathing at a distance.
- The bathroom, where most falls happen, is probably outside link coverage.
- No identity: it learns the household's rhythm, not grandma's specifically.
- The statement says "products". A pure software and voice system may score lower than something physical.
- Edge-TTS needs internet. Use Kokoro offline as the fallback.
- It is not a medical device.
- Your household is parents and a sibling. A real evaluation needs an elderly user; your parents can pilot it.

### 4.4 Offline multimodal RAG for exam prep: 2025 SIH25231 (NTRO)

**What it asks:**
- Ingest DOCX and PDF, embed images, and transcribe audio.
- Index everything in a shared vector space.
- Answer natural-language queries with **numbered citations** back to the source.
- Link across formats (for example, an audio segment to a cited paragraph and a screenshot).
- Run **offline**.

**Reuses:**
- `yaadash_recall.py`: BM25 + LanceDB vectors (bge-small on CPU), Reciprocal Rank Fusion, and the abstention gate. This is already the retrieval core the statement describes.
- Whisper large-v3-turbo on the GPU, for timestamped lecture and voice-memo transcripts.
- Qwen3-4B through Ollama.
- The app's chat UI and spoken Hinglish queries.

**New software:**
- Ingestors: PDF and DOCX text with page numbers, plus OCR for scanned pages and photos of notes.
- Image embeddings (a CLIP/SigLIP-class model on CPU) stored in the same LanceDB table with a modality tag.
- Chunk-level citations: file, page, or audio timestamp.
- Cross-modal links: nearest-neighbour edges between an audio segment and a PDF chunk.
- An evaluation harness.
- Run ingestion as a batch job while the LLM is unloaded. The VRAM budget (LLM about 3.3 GB plus Whisper about 1 GB) has no room for a GPU vision model as well.

**Unavoidable hardware:** none.

**How to show it works:**
1. Build a test set **before** tuning: 60 questions on one semester course, covering 3 PDFs, 2 recorded lectures and about 20 photos of notes, each with a gold source. Add 10 questions the material cannot answer.
2. Report:
   - retrieval hit@5 for BM25-only, vector-only and hybrid;
   - answer correctness;
   - citation precision (does the cited chunk actually support the answer?);
   - abstention rate on the 10 unanswerable questions;
   - p50/p90 latency on the RTX 4050.
3. Household variant: the same pipeline over scanned bills, warranty cards and appliance manuals ("AC ki warranty kab tak hai?"). Local-only processing is a real advantage for documents like these.

**Honest limits:**
- A 4B model is weak on multi-step derivations and numerical problems.
- OCR of handwriting and of Devanagari is poor.
- CLIP-style embeddings are crude for circuit schematics and waveforms.
- Only one large model fits on the GPU at a time.
- NTRO's real use case (screenshots, call recordings, analyst work) is larger in scale. A personal-scale demo should say so.

---

## 5. Shortlist items 5–10: short notes

- **2024 SIH1524 / SIH1525 (Godrej):** same build as 4.2. The one specific hook is IR control of the AC plus occupancy. Weak point: the brief is title-only, and an appliance maker probably wants ideas inside the appliance (compressor, defrost, water reuse), not an external controller.
- **2026 SIH26172 (ISRO, Voice Activator):**
  - Requirements: a keyword-spotting model under 256 KB RAM, under 10 % CPU while idle, evaluated on "Raspberry Pi or ESP32", then streaming audio to a remote ASR. That remote ASR would be your laptop's Whisper.
  - It is the best *learning-hardware* fit for an ECE/VLSI student, and it moves wake-word detection off the laptop.
  - Catch 1: the statement **bans pre-trained assistant keywords**, so the current openWakeWord `hey_jarvis_v0.1` does not count. You would need to train a custom keyword such as "Suno Jarvis".
  - Catch 2: the S3 is busy with CSI at 100 Hz. Use a second board or time-slice, and validate the CPU budget.
  - Hardware: INMP441 I2S MEMS microphone, about INR 140–245 ([Zbotic](https://zbotic.in/product/inmp441-mems-omnidirectional-microphone-module-high-precision-snr-low-power-i2c-interface-supports-esp32/), [Probots](https://probots.co.in/inmp441-mems-high-precision-omnidirectional-microphone-module-i2s.html)).
  - Submission is closed for 2026.
- **2023 SIH1393 (Water and Electricity Tracking App):** asks for "behavioural nudges" towards a usage target. The ledger from 4.2 plus Hinglish nudges fits the electricity half. Water use cannot be measured without a flow sensor or meter readings, so be explicit that the water half would be manual entry.
- **2022 DA1066 (AI based interactive robot for elderly care):** "interact with elderly at home, monitor their problems and raise alarms for family members". It is a voice companion with memory, which JARVIS is. The judges expect a robot, though; 4 SG90 servos could make a minimal pan/tilt "head", but that is still a stretch.
- **2026 SIH26003 (Cognitive Gaming and Memory Assistance, dementia, NER):**
  - What it asks for that JARVIS has: memory games, reminders (medicines, hydration, appointments), a caregiver dashboard, offline mode and a voice interface.
  - What it asks for that JARVIS lacks: NER languages, which neither Whisper nor TTS handles well. Hindi/Hinglish is a mismatch.
  - It is clinical in nature.
  - Submission is closed.
- **2024 SIH1779 (Voice-Controlled Gaming Tools for Enhanced Learning):** Mission Germoney plus the voice loop is a direct fit for "voice-controlled learning modules … adaptive challenges". The statement is framed around vocational skilling (carpentry, welding, healthcare), not exam prep.

---

## 6. Flagged: these sound like a fit but need hardware or physics the project does not have

| Year / ID | Exact title (shortened only where marked …) | Organisation | Why it does not fit |
|---|---|---|---|
| 2026 / SIH26181 | A secure, AI-powered Personal Health Companion that delivers real-time, privacy-preserving health monitoring … on-device intelligence. | Qualcomm Inc | The on-device, privacy-first theme matches JARVIS, but it needs **heart rate, SpO₂, body temperature and sleep from a wearable or phone**. Wi-Fi CSI cannot give heart rate, and breathing only at lab distance. Closed. [2026 page](https://sih.gov.in/sih2026PS) |
| 2024 / SIH1580 | Wearable sensor with Artificial Intelligence for prevention of falls in elderly people | Ministry of Social Justice and Empowerment | It explicitly needs body-worn sensors (line of gravity relative to base of support). CSI cannot do this. [2024 xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx) |
| 2025 / SIH25214 | Development of Radar-Based Living Person Detection System for Use Under the Rubble | Ministry of Home Affairs (MHA) | It needs UWB or microwave radar penetrating **6–10 m of debris** and detecting heartbeat. The LD2450 and one Wi-Fi link are nowhere near that. [mirror](https://github.com/shamblonaut/sihps/blob/main/public/problems.md) |
| 2025 / SIH25213 | Integrated Wearable Device for Real-Time Monitoring of Vital Parameters, Gas Exposure, and Fatigue | Ministry of Home Affairs (MHA) | It needs vital-sign and gas sensors in a wearable. [mirror](https://github.com/shamblonaut/sihps/blob/main/public/problems.md) |
| 2025 / SIH25215 | Low-Cost Decentralized Smart Air Purification & Monitoring System for Delhi-NCR | AICTE | It is household air quality, but it needs PM2.5, PM10, CO, NOx, SOx and VOC sensors plus a purifier and filter build, and none is owned. JARVIS could only switch an existing purifier on via a relay or IR. [mirror](https://github.com/shamblonaut/sihps/blob/main/public/problems.md) |
| 2026 / SIH26255 | Development of a solution using AI and ML to monitor the functionality of FHTC in real time at both the Gram Panchayat and household levels … | Ministry of Jal Shakti (MoJS) | It is still **open until 20 Oct 2026** (44 of 500 ideas). But it is village-scale piped water (flow, pressure, quality sensors, IMIS sync), with nothing to reuse from JARVIS, and entry still needs SPOC nomination. [2026 page](https://sih.gov.in/sih2026PS) |
| 2022 / TK1052 | To develop a sytem Electronically detecting occupancy of beds in Hospitals | Government of Rajasthan | It is tempting because Aankhen has a "bed" class. But detecting a still person on one link is about 38 %, which is too unreliable for bed occupancy, and the setting is a hospital ward. [2022 page](https://web.archive.org/web/20221119160320/https://www.sih.gov.in/sih2022PS) |
| 2024 / SIH1606 | Micro-Doppler based Target Classification | Bharat Electronics Limited (BEL) | It is a good fit for your radar-DSP skills (drone vs bird from FMCW micro-Doppler data), but not household. Useful for an ECE portfolio only. [2024 xlsx](https://sih.gov.in/letters/SIH_PS_2024.xlsx) |

## 7. Also considered: lower fit, all real IDs

- **2025 SIH25104, "Language Agnostic Chatbot"** (Government of Rajasthan, Software, Smart Education): campus FAQ bot in Hindi, English and a local language. The local LLM fits, but it needs 5 regional languages and integration with a college website.
- **2025 SIH25092, "Development of a Digital Mental Health and Psychological Support System for Students in Higher Education"** (Government of Jammu and Kashmir): a student problem, but institution-scale and clinically sensitive.
- **2025 SIH25175, "MAITRI : An AI Assistant for Psychological & Physical Well-Being of Astronauts"** (ISRO): an offline companion that wants audio-*video* emotion detection, which needs a camera.
- **2025 SIH25226, "AI Tool for Early-Stage Dementia Detection"** (Ministry of Science and Technology): speech-based screening. It needs clinical validation, which you cannot provide.
- **2025 SIH25201, "IoT & AI-Enabled Skill Training Equipment monitoring"** (MSDE): lab-equipment health. It needs temperature, vibration and energy sensors per machine.
- **2023 SIH1299, "Developing an AI-powered energy management system for industrial commercial facilities to optimize energy consumption."** (Ministry of power): the same engine as 4.2, but industrial scale.
- **2022 DA1071, "Gaming Apps, etc. for the elderly"** (DST): cognitive games. It is software only, and the Mission engine fits.
- **Student Innovation (any idea, AICTE/MIC), "Smart Automation":**
  - 2024 SIH1540 (Hardware)
  - 2025 SIH25118 (Hardware) and SIH25135 (Software)
  - 2026 SIH26219 (Hardware) and SIH26202 (Software)

  This is the only route for LPG, tank-overflow or power-cut ideas. It is also the most crowded: SIH25118 hit the 500-idea cap.

---

## 8. What I did not verify

- I did not verify 2025 IDs against a live official page, because none exists now. I checked them against two independent mirrors and a dated printout for the first 20.
- The full official text for Godrej SIH1524 and SIH1525 is title-only, so the description in 4.2 relies on a secondary site.
- Component prices are from retailer listings that may be stale. The ESP32-C3 price comes from your earlier notes and was not re-checked.
- I made no claim that any of these statements would win, and I estimated no impact numbers.

Raw extracted tables and the parsing scripts are in the session scratchpad under `research/raw/` and `research/scripts/`. `all_ps.csv` has 1,575 rows: 2022 564, 2023 234, 2024 246 from the xlsx, 2025 271, 2026 260. I checked the 8 late-added 2024 statements (SIH1783–1790, all Madhya Pradesh Police) separately; none is relevant.
