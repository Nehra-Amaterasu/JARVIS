# Public Wi-Fi CSI datasets for Aankhen: what exists, what transfers, what to use

Research date: 2026-10-12. Read-only desk research. Nothing was downloaded or installed.

The target setup is one ESP32-S3 receiving from a home router on 2.4 GHz channel 11, HT20. The firmware captures the LLTF only: 64 bins, int8 I/Q with the imaginary part first, at about 100 packets/s from pinging the router. The host keeps 51 subcarriers (-26..-1 and +2..+26) and uses amplitude only. There is no AGC/FFT gain compensation, and a ceiling fan often runs at full speed near the link. The goals are to detect motion and characterise it (still, typing, waving, walking, lying), to locate the person (zone level or better), and to measure breathing. We have only a few minutes of labelled data from our own room.

Notation: "[verified]" means the value comes from the dataset page, paper or API at the cited URL. "[not stated]" means the source does not give it. "[inference]" marks my own reasoning or arithmetic.

---

## 0. Short answer

1. **Datasets closest to our setup**
   - **ESPectre's recorded corpus.** It covers 5 ESP32 chips including the S3. Each file is 64-bin HT20 data, int8 Q/I with Q first, at about 100 pps from a ping. AGC is left on, and the rooms are real homes. Labels are empty, static presence and motion. The code is GPL-3.0, but the data license is not stated.
   - **WiGesture, WiFall and WiCount** (CUHK-SZ). These use an ESP32-S3 receiver and, for WiGesture, a home router as the transmitter. They have 52 subcarriers at 100 Hz and are 87 MB, 83 MB and 25 MB on Hugging Face. They are not gated, and no license is stated.
   - **Wallhack1.8k** (TU Wien). It uses ESP32-S3 boards at 100 Hz and ships raw CSV with 52 L-LTF subcarriers. It is 136 MB, CC BY 4.0 with a "non-commercial research only" clause.
   - **Runner-up: SHD-HAR** (Monash). It uses 4× ESP32-S3 boards and has 10 activities including waving, clapping, hand-rubbing and standing. It is 6.2 GB under CC BY 4.0. However, it was recorded at 40 MHz with 166 bins, so the LLTF part has to be extracted.
2. **Cross-environment and cross-hardware transfer is poor without target-room data.**
   - In CSI-Bench, HAR accuracy falls from 88% in-distribution to about 55% cross-environment and 62% cross-device.
   - On ESP32-S3, line-of-sight to through-wall transfer of a 3-class model falls to 36–37%, which is about chance. Moving to a different antenna on the same chip gives 30–36%.
   - The ESP32-S2 study found a 52% relative accuracy loss only 10 minutes after training.
   - What helps most: a few labelled target samples (1–5 per class, or about 15 s per class), normalisation that cancels gain changes, and distribution alignment such as MMD. Augmentation helps but inconsistently (up to +22 points). Large-scale pretraining helps modestly (+2–16 points).
3. **Rules without training data:**
   - **Realistic:** empty vs. present-still vs. moving, after a calibration in the empty room *with the fan running*.
   - **Plausible:** walking vs. in-place motion, using speed or ACF features.
   - **Realistic when the person is still:** breathing rate, but it has blind spots and fan contamination.
   - **Not realistic:** typing vs. waving. This needs a small few-shot classifier.
   - **Lying:** no public method classifies it without training. Infer it from "still + breathing + bed zone".
   - **Location:** needs per-room labelled fingerprints, and static fingerprints drift within days.
4. **Minimum per-room labelled data reported in published work after pretraining:** 1 shot (one 1-s window per class), 5 shots, or about 15 s per class. My recommendation for our setup is 2–5 min per class, spread over at least 3 sessions on different days, with the fan both on and off. Add about 10 min of empty room per fan speed, and about 1–2 min per location zone.

---

## 1. What "compatible" means for us

| Property | Aankhen | Why it matters |
|---|---|---|
| Band / bandwidth | 2.4 GHz, HT20, channel 11 | The 2.4 GHz wavelength (about 12.5 cm) sets the Doppler-to-speed scale. 5 GHz datasets have half the wavelength [inference]. |
| Subcarriers | LLTF, 51 of 52 used | Datasets with 52 LLTF bins map almost 1:1 onto ours. HT-LTF (56) and 30-, 114- or 234-subcarrier NIC data do not. |
| Antennas | 1 (ESP32-S3 has one antenna per device; see the [WiFall card](https://huggingface.co/datasets/RS2002/WiFall/blob/refs%2Fpr%2F1/README.md)) | No CSI ratio between two antennas, so FarSense-style phase recovery is unavailable. FarSense needs two antennas ([arXiv 1907.03994](https://arxiv.org/pdf/1907.03994)). |
| Rate | about 100 pps | WiGesture, WiFall, Wallhack1.8k and ESPectre all run at about 100 Hz. Most NIC datasets run at 1000–1600 Hz. |
| Feature | Amplitude only | Amplitude is invariant to I/Q order, so "imag first" vs "real first" does not matter for |H| [inference]. |
| Gain | No compensation | Espressif's `esp_csi_gain_ctrl` exists precisely to compensate AGC/FFT gain changes ([component README](https://components.espressif.com/components/espressif/esp_csi_gain_ctrl/versions/0.1.5/readme)). Without it, use scale-invariant features (Section 3). |

---

## 2. Dataset catalogue

### 2a. ESP32-family datasets (priority)

Column notes: Size is the download size. "Open" means a direct download with no account, as far as the page shows.

| # | Dataset (year) | Chip / link | Band / BW / subcarriers / rate | Rooms, subjects | Labels | Size, format | License, access |
|---|---|---|---|---|---|---|---|
| E1 | **ESPectre corpus** (2026, ongoing) | ESP32-S3, C3, C5, C6, classic ESP32; single link to the AP | HT20, 64 bins, nominal 100 pps (observed about 92–108) | bedroom, living room, hobby room (vacation home excluded); 1 contributor | `empty`, `static_presence`, `motion` | ≥109 recordings of 90 s to 10 min; `.npz` with int8 Q/I interleaved; repo is 417 MB in total | Code GPL-3.0; data license not stated; open on GitHub |
| E2 | **WiGesture** (2024) | ESP32-S3 receiver with external antenna; **home Wi-Fi router transmitter**; 1.5 m apart | 2.4 GHz, 52 sc, 100 Hz; average packet loss 14.5% | 1 cluttered conference room; 8 people | 6 gestures: left-right, forward-backward, up-down, clockwise circle, **clap, wave**; also person ID | 87.3 MB (zip of CSV) | License not stated; Hugging Face, not gated |
| E3 | **WiFall** (2024/25) | ESP32-S3, 1 transmitter and several receivers | 2.4 GHz, 20 MHz, 52 sc, about 100 Hz | 1 meeting room; 10 people | fall, jump, sit, stand, **walk**; person ID | 83.4 MB; CSV, 60 s per file | License not stated; HF, not gated |
| E4 | **WiCount** (2024/25) | ESP32-S3 | (same family as WiFall) | meeting room | people count 0–3 | 25.4 MB | License not stated; HF, not gated |
| E5 | **Wallhack1.8k** (2024) | 2 × ESP32-S3-DevKitC-1 over ESP-NOW; biquad (BQ) and PIFA+reflector antennas | 2.4 GHz, **52 L-LTF sc** (+56 optional HT-LTF), 100 Hz | LoS and through-wall NLoS across 5 rooms (18 m office) | no presence / **walking** / **walking + arm-waving** | 136.4 MB; 1,806 spectrograms + **raw CSV** | CC BY 4.0 plus "non-commercial research only"; open on Zenodo |
| E6 | **TU Wien ICVS-2023 through-wall** | ESP32 (biquad directional antenna) | 100 Hz, 400-packet windows | LoS: 1 room; NLoS: 5 rooms; 1 person | Presence *per room* (0–5); activity (none / walk / walk+wave) | 14.8 MB; **PNG spectrograms only** | CC BY 4.0 plus non-commercial; open |
| E7 | **HALOC** (2024) | ESP32-S3-DevKitC-1, directional antennas | 52 sc, about 100 Hz (implied by "351 packets ≈ 3.51 s") | 1 hallway | **3D position (x,y,z) per packet** | 29.9 MB; 6 CSV sequences | CC BY 4.0 plus non-commercial; open |
| E8 | **SHD-HAR** (Wong et al., 2024) | 4 × ESP32-S3-DevKitC-1 = 2 links (front and side) | ch 11, **40 MHz**, 166 sc (LLTF + HT-LTF + STBC-HT-LTF stored), about 60–90 pps (derived from 300–450 packets per 5 s) [inference] | 1 lab (5×8 m); 6 people | empty, **standing, waving**, punch, push-pull, **clap, rub hand**, jump, squat, twist; about 1,200 × 5 s samples per activity | 6.2 GB; CSV (raw and amplitude) | CC BY 4.0; open on Zenodo |
| E9 | **Lim & Ong ESP32 RF-HAR** (2024) | **D-Link AX3000 router transmitter**, ESP32 receiver | ch 11 (40 MHz configured), 52 sc + RSSI; rate not stated | 1 lab (8.3×5.6 m) in 3 setups (2 LoS, 1 NLoS behind a wooden wall); 8 people | jumping jack, squat, hand swing, **walk toward Rx, walk toward Tx**, bouncing a ball, jogging in place, forward bend, **sit down on chair, standing**; 20 trials each | 112.8 MB; 4,800 CSV files | CC BY 4.0; Mendeley (no login stated) |
| E10 | **CSI-Bench** (NeurIPS 2025) | 16 device types; ESP32-S3 (64 sc @ 20 MHz) and ESP8266 plugs are a **minority**; most data is NXP, Qualcomm, MediaTek or Broadcom | 2.4 and 5 GHz; 100 Hz (30 Hz for breathing) | **26 homes and offices; 35 users; 461 h** | fall; breathing during sleep (with **11,400 fan-interfered samples**); room-level localization; **motion source (human, pet, robot, fan)**; multi-task HAR (walk, run, jump, seated breathing, **wave**), user ID, proximity | **81.5 GB**; HDF5 / MAT | **CC BY-NC-ND 4.0**; Kaggle (download normally needs a free Kaggle account; not checked for this record) |
| E11 | **"Less is More" ESP32-C3 mesh** (2026) | 9 × ESP32-C3, 72 links | 52 sc, about 10 Hz per link | 1 residence (5×4 m); 300 h | presence, activity (classes not listed), occupancy count; semi-automatic labels | 45.7 GB posted (2 weekly tarballs) | CC BY 4.0; open on Zenodo |
| E12 | **UJI multi-day / temporal-stability** (2024/25) | ESP32-S2, passive sniffing | 2.4 GHz | 3-floor home (21 reference points, 2 days) + 30 m² lab recorded for over 3 weeks (5.77 M samples) | location reference points; occupancy context | 711 MB | CC BY-NC 4.0; open on Zenodo |
| E13 | **Edinburgh respiration validity** (Alzaabi et al.) | ESP32 + esp32-csi-tool | transmitter at 120 pps | 3×3 m room, 3 m LoS | **breathing 12–28 BPM, belt ground truth at 100 Hz**; 30 repeat readings at 14 BPM | 64.8 MB | **IEEE DataPort subscription** |
| E14 | **Edinburgh sleep disturbances** (2024) | 2 × ESP32-DevKitC-VE, PCB antennas | 120 pps | bedroom lab, 1.6 m link; **1 subject** | supine breathing at 12 BPM, apnoea, **posture changes (supine/left/right)**, leg restlessness, sit-up; **belt ground truth** | 10.8 MB | **Subscription** |
| E15 | **WiStride** (2025) | ESP32 + Hernandez ESP32-CSI-Tool | 2.4 GHz, 64 sc | 1 room; 25 people | walking / turning / stationary | 188.7 MB | **Subscription** |
| E16 | **IIT-BHU multi-human HAR** (2024) | ESP32 NodeMCU + ESP32-CSI-Toolkit | not stated | 1 room; 80+ volunteers; 1–3 people at once | 6 activities (not named) | 270.8 MB | **Subscription** |
| E17 | **WiSDOM** (IIT Madras, 2024/25) | ESP32 (details partly unverified) | not stated | indoors and outdoors, several locations | empty, standing, sitting, sit-up-down, jumping, walking (per location) | Google Drive | License not stated |

Sources for each row:

- **E1 ESPectre**
  - Repo and dataset description: [github.com/francescopace/espectre](https://github.com/francescopace/espectre)
  - Catalog (chips, 64 sc, HT20, pps, rooms, roles): [data/dataset_info.json](https://raw.githubusercontent.com/francescopace/espectre/main/data/dataset_info.json)
  - File format (`.npz`, int8 Q/I interleaved, AGC on, ≥10 recordings × 30–60 s per label): [docs/ML_DATA_COLLECTION.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/ML_DATA_COLLECTION.md)
  - Size and license (417 MB repo, GPL-3.0): [GitHub API](https://api.github.com/repos/francescopace/espectre)
  - LTF profiles (`lltf20`/`ht20`/`vht20`) and the compact LLTF layout from -26 to +26 with DC at bin 32: [docs/CSI.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/CSI.md)
- **E2 WiGesture**
  - Hardware, gestures, room, packet loss: [arXiv 2403.12400 (HTML)](https://arxiv.org/html/2403.12400)
  - Size and gating: [HF API](https://huggingface.co/api/datasets/RS2002/WiGesture?full=true)
  - Hosting links: [CSI-BERT repo](https://github.com/RS2002/CSI-BERT)
- **E3 WiFall:** [HF card](https://huggingface.co/datasets/RS2002/WiFall/blob/refs%2Fpr%2F1/README.md) and [HF API](https://huggingface.co/api/datasets/RS2002/WiFall?full=true)
- **E4 WiCount:** [HF API](https://huggingface.co/api/datasets/RS2002/WiCount?full=true); the listing of all RS2002 datasets (no license tags) is [here](https://huggingface.co/api/datasets?author=RS2002)
- **E5 Wallhack1.8k:** [Zenodo 13950918](https://zenodo.org/records/13950918); hardware (ESP32-S3-DevKitC-1, ESP-NOW, 100 Hz): [arXiv 2401.00964](https://arxiv.org/html/2401.00964v1)
- **E6 TU Wien ICVS-2023:** [Zenodo 8021099](https://zenodo.org/records/8021099)
- **E7 HALOC:** [Zenodo 10715595](https://zenodo.org/records/10715595) and [HALOC loader](https://github.com/StrohmayerJ/HALOC)
- **E8 SHD-HAR:** [paper full text (Europe PMC)](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11268129/fullTextXML) and [Zenodo 11201414](https://zenodo.org/records/11201414)
- **E9 Lim & Ong:**
  - Paper: [full text (Europe PMC)](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11615535/fullTextXML)
  - Dataset page: [Mendeley x4x5xttvwt](https://data.mendeley.com/datasets/x4x5xttvwt/1)
  - File size: [Mendeley file API](https://data.mendeley.com/public-api/datasets/x4x5xttvwt/files?folder_id=root&version=1)
- **E10 CSI-Bench:**
  - Paper: [arXiv 2505.21866v2](https://arxiv.org/html/2505.21866v2)
  - License and size: [Kaggle API metadata](https://www.kaggle.com/api/v1/datasets/view/guozhenjennzhu/csi-bench)
  - Venue: [NeurIPS 2025 page](https://proceedings.neurips.cc/paper_files/paper/2025/hash/f7c68372b3d39e8d7a093eb2edaaad87-Abstract-Datasets_and_Benchmarks_Track.html)
- **E11 ESP32-C3 mesh:** [Zenodo 18486250](https://zenodo.org/record/18486250)
- **E12 UJI multi-day:** [Zenodo 14212401](https://zenodo.org/records/14212401)
- **E13 Edinburgh respiration:** [IEEE DataPort](https://ieee-dataport.org/documents/respiration-rate-measurement-validity-and-repeatability-ubiquitous-non-contact-wi-fi)
- **E14 Edinburgh sleep:** [IEEE DataPort](https://ieee-dataport.org/documents/wi-fi-csi-sensing-sleep-disturbances-care-older-people)
- **E15 WiStride:** [IEEE DataPort](https://ieee-dataport.org/documents/wistride-csi-based-gait-dataset-indoor-walking-subjects)
- **E16 IIT-BHU multi-human HAR:** [IEEE DataPort](https://ieee-dataport.org/documents/channel-state-information-dataset-multi-human-activity-recognition-indoor-environments)
- **E17 WiSDOM:** [project page](http://cse.iitm.ac.in/~sense/wisdom) and [GitHub](https://github.com/senselab-iitm/wisdom). The activity list comes from a search snippet of the [artifact PDF](https://sense.cse.iitm.ac.in/wisdom/docs/artifact.pdf), which I could not parse, so treat it as unverified.

Notes on specific ESP32 candidates the brief named:

- **Steven Hernandez ESP32-CSI-Tool.** This is a collection tool, not a dataset. I found **no dataset released by Hernandez himself**. Datasets built with the tool include WiStride, the Edinburgh sets, IIT-BHU and a knife-activity set ([WiStride page](https://ieee-dataport.org/documents/wistride-csi-based-gait-dataset-indoor-walking-subjects), [knife set](https://ieee-dataport.org/documents/wifi-csi-and-rssi-data-six-basic-knife-activities-cooking-chopping-cubing-french-cutting)).
- **"CSI-HAR" and "eHealth" are not ESP32 sets.**
  - eHealth CSI (Galdino et al., IEEE Access 2023) uses a Raspberry Pi 4B with Nexmon on 5 GHz channel 36 at 80 MHz. It has 234 subcarriers sampled at about 7.4 Hz, 118 participants, 17 positions or activities, and smartwatch heart rate. Breathing labels are absent, and access is on request ([PulseFi arXiv 2510.24744](https://arxiv.org/html/2510.24744), [Ulima record](https://cris.ulima.edu.pe/en/publications/ehealth-csi-a-wi-fi-csi-dataset-of-human-activities/)).
  - The "CSI-HAR" sets I found (Moshiri 2021; Schäfer et al. 2021, with EMPTY/LYING/SIT/SIT-DOWN/STAND/STAND-UP/WALK/FALL) are also Raspberry Pi or Asus routers running Nexmon ([search summary pointing to app11198860 and PMC8587955](https://pmc.ncbi.nlm.nih.gov/articles/PMC8587955)). **I could not verify any ESP32 "CSI-HAR" dataset.**
- **"EHUCOUGH": no dataset by this name could be found.** The closest name is **EHUNAM** (University of the Basque Country, Scientific Data 2025), which is not ESP32 (see 2b). For breathing, the ESP32 sets with ground truth are E13 and E14, and both require a subscription.
- **PulseFi's own ESP32 data** (2 × ESP32 at 80 Hz, 64 sc, 7 people, pulse-oximeter ground truth) has no stated public release ([arXiv 2510.24744](https://arxiv.org/html/2510.24744)).

### 2b. Non-ESP32 benchmarks (checked for completeness)

| Dataset | Hardware | Band / BW / sc / rate | Rooms, subjects | Labels | Size | License, access |
|---|---|---|---|---|---|---|
| **MM-Fi** (NeurIPS 2023) | TP-Link N750 + Atheros CSI Tool, 1 Tx × 3 Rx antennas | 5 GHz, 40 MHz, 114 sc; 1000 Hz raw, 100 Hz released | 4 environments; 40 subjects | 27 actions incl. **waving (left/right)**, raising hands, picking up, kicking, jumping, bowing; plus pose | not verified | **CC BY-NC 4.0**; Google Drive or Baidu (RGB needs a request form) |
| **NTU-Fi HAR / HumanID** (SenseFi) | Atheros (TP-Link N750) | 5 GHz, 40 MHz, 114 sc, 3 antennas; samples 3×114×500 | not verified | HAR: box, circle, clean, fall, run, walk (936/264). HumanID: 14 subjects' gait (546/294) | not verified | Repo MIT; data license not stated; Google Drive |
| **UT-HAR** (2017) | Intel 5300 (802.11n CSI Tool) | 30 sc × 3 antennas; 1000 Hz per AutoFi, but sources conflict | 1 room | lie down, fall, walk, pickup, run, sit down, stand up (3977/996) | about 4 GB | Repo GPL-3.0; data license not stated; Google Drive |
| **Widar3.0** (MobiSys 2019) | Commodity NICs, 1 Tx + **6 receivers** | (not verified here) | 75 "domains" | 258K gesture instances, 8,620 min; DFS and BVP features | BVP.zip 384 MB; CSI tens of GB (not verified) | License not stated; IEEE DataPort open access (login), Tsinghua or Baidu mirrors |
| **SignFi** (2018) | 802.11n CSI Tool (Intel 5300), appears 3×3 | 30 sc | lab and home; 1–5 users | 276 / 150 sign gestures | 6.1 GB (4 × .mat) | Custom non-commercial terms of use; Box |
| **WiAR** | Intel 5300, 3 antennas | 30 Hz | 10 volunteers (3 in repo) | 16 activities incl. arm waves, clap, walk, sit down, squat | not stated | License not stated; GitHub |
| **OPERAnet** (Sci Data 2022) | 3 × NUC with Intel 5300, 3×3 | 5 GHz ch 149, 30 sc, **1600 Hz** | 2 offices; 6 people | sit, stand, walk, **lie down**, stand from floor, rotate, empty; **UWB xy localization ground truth** | Wi-Fi CSI part: 36.5 + 34.4 GB | **CC0**; figshare, open |
| **EHUNAM** (Sci Data 2025) | Raspberry Pi 4 Nexmon (BCM43455c0) + Atheros | 2.4 and 5 GHz, 20/80 MHz, 56–241 sc | 8 environments; 21 people | walk, jump, stand, sit, sit-down/get-up, fall, empty; people count; machine activity | 77.7 GB | CC BY 4.0; figshare, open |
| **Alsaify et al. 2020** | Intel 5300, 1 Tx × 3 Rx | – | 3 environments (2 LoS, 1 NLoS); 30 subjects | 5 experiments × 20 trials | not stated | CC BY 4.0; Mendeley |
| **Cominelli et al. "Exposing the CSI"** | 802.11ax | up to 160 MHz | 3 environments; 3 people | 12 activities | about 80 GB | release stated; URL and license not found |

Sources for each row:

- **MM-Fi**
  - License, subjects, RGB request form: [project page](https://ntu-aiot-lab.github.io/mm-fi)
  - Action list and download hosts: [GitHub](https://github.com/ybhbingo/MMFi_dataset)
  - Hardware: [arXiv 2305.10345](https://arxiv.org/pdf/2305.10345), [arXiv 2410.16303](https://arxiv.org/pdf/2410.16303), [arXiv 2511.18792](https://arxiv.org/pdf/2511.18792)
- **NTU-Fi:** [SenseFi benchmark repo](https://github.com/xyanchen/WiFi-CSI-Sensing-Benchmark) and [arXiv 2207.07859](https://arxiv.org/pdf/2207.07859)
- **UT-HAR:** [original repo](https://github.com/ermongroup/Wifi_Activity_Recognition), [SenseFi repo](https://github.com/xyanchen/WiFi-CSI-Sensing-Benchmark), [AutoFi arXiv 2205.01629](https://arxiv.org/pdf/2205.01629)
- **Widar3.0:** [project page](http://tns.thss.tsinghua.edu.cn/widar3.0/) and [IEEE DataPort](https://ieee-dataport.org/open-access/widar-30-wifi-based-activity-recognition-dataset)
- **SignFi:** [GitHub](https://github.com/yongsen/SignFi)
- **WiAR:** [GitHub](https://github.com/linteresa/WiAR)
- **OPERAnet:** [paper (Europe PMC)](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC9349197/fullTextXML), [figshare wificsi1](https://api.figshare.com/v2/articles/16578428), [figshare wificsi2](https://api.figshare.com/v2/articles/16578431)
- **EHUNAM:** [paper (Europe PMC)](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12711874/fullTextXML) and [figshare API](https://api.figshare.com/v2/articles/28541225)
- **Alsaify et al. 2020:** [Mendeley v38wjmz6f6](https://data.mendeley.com/datasets/v38wjmz6f6/1)
- **Exposing the CSI:** [arXiv 2302.00992](https://arxiv.org/abs/2302.00992)

**Verdict on non-ESP32 sets.** All of them use 5 GHz and/or multi-antenna NICs with 30, 114 or 234 subcarriers at 1000 Hz or more, often with phase. None demonstrates transfer to a single-antenna ESP32. Use them only for method ideas or offline evaluation. One exception is OPERAnet: it is CC0 and includes **lie-down** with **UWB location** ground truth, which is useful for designing a lying or location heuristic but not for training an ESP32 model.

---

## 3. Cross-environment and cross-hardware transfer: what the literature reports

### 3.1 How much accuracy drops

| Study | Hardware | Shift | Result |
|---|---|---|---|
| CSI-Bench (Transformer, multi-task) | mixed commodity devices | in-distribution → cross-device / cross-environment / cross-user | **HAR: 88.06% → 61.82 / 54.92 / 54.72%**. Proximity: 86.41% → about 30%. ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2)) |
| CSI-Bench fall task | incl. ESP32-S3 | difficulty tiers | ResNet18 F1 is about 97% Easy, 77% Medium (includes fan interference), and **68% Hard (includes low-quality ESP32 CSI)** ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2)) |
| Strohmayer & Kampel, AIAI 2024 | **ESP32-S3**, 100 Hz, 52 L-LTF sc, 3 classes (chance is 33%) | LoS → through-wall | **36–37.5%** baseline. Reverse direction: 53–65%. ([arXiv 2401.00964](https://arxiv.org/html/2401.00964v1)) |
| Same | ESP32-S3 | different antenna system, same scenario | **30–36%** baseline (about chance) ([arXiv 2401.00964](https://arxiv.org/html/2401.00964v1)) |
| KNN-MMD (TMC) | **ESP32-S3** (WiGesture, WiFall) | **cross-person**, same room | ResNet18 with no adaptation: gesture 80.8% → **40.8%**, action recognition 70.5% → **26.0%** ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)) |
| ReWiS | COTS multi-antenna | unseen environment | CNN drops by **more than 45%**; the few-shot ReWiS drops by less than 10% ([arXiv 2201.00869](https://arxiv.org/abs/2201.00869)) |
| CARM (CSI-speed model, as reported by a survey) | Intel 5300 | untrained place and person | **96.5% → about 80%** ([survey arXiv 1712.00146](https://arxiv.org/pdf/1712.00146)). I could not confirm the 80% figure in the CARM paper itself. |
| Matey-Sanz et al., IPIN 2023 | **ESP32-S2** | **same room, 10 minutes later** | **52% relative loss** in accuracy ([UJI/GEOTEC record](https://repositori.uji.es/xmlui/handle/10234/207262), [summary](https://geotec.uji.es/?p=5998)) |
| Brunello et al., IoT 2025 | ESP32-S2 | weeks, unchanged room | Tasks that depend on **static reflections (positioning) are severely affected**; HAR is less affected ([UJI portal](https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25), [dataset](https://zenodo.org/records/14212401)) |
| Portner et al., IEEE IoT-J 2026 | several COTS receivers (ESP32 not confirmed) | cross-receiver | Accuracy "sharply drops". The **dominant cause is AGC**, plus consistent subcarrier non-linearities ([arXiv 2605.26836](https://arxiv.org/abs/2605.26836)) |
| Widar3.0 | 1 Tx + 6 Rx | cross-domain gestures | 92.7% in-domain and 82.6–92.4% cross-domain with zero retraining. However, BVP needs **multiple receivers**, so it does not apply to one link ([search summary of MobiSys'19](https://ct.cswu.me/papers/mobisys19_widar3_paper.pdf), [project page: 6 receivers](http://tns.thss.tsinghua.edu.cn/widar3.0/)) |

### 3.2 What helps (strongest evidence first)

1. **A few labelled samples from the target domain.**
   - **KNN-MMD** (ESP32-S3) with **one labelled 1-s sample per class** reaches gesture 93.3%, people ID 81.8%, fall 77.6% and action 75.3%. Without adaptation the same tasks score 26–71% ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)).
   - **FewSense** with **5 shots** reaches 90.3 / 96.5 / 82.7% on SignFi, Widar and WiAR for novel classes in unseen domains ([arXiv 2203.02014](https://arxiv.org/abs/2203.02014)).
   - **SiMWiSense FREL** needs about **15 s of extra data per class**, giving up to +85% over a CNN and +20% over few-shot embedding learning ([arXiv 2304.00057](https://arxiv.org/abs/2304.00057)).
   - **ReWiS** loses less than 10% in an unseen environment from "a few new samples" ([arXiv 2201.00869](https://arxiv.org/abs/2201.00869)).
   - Caveat: KNN-MMD's domains are *people in the same room*, not new rooms.
2. **Normalisation that cancels receiver gain.** This is critical for us because we have no gain compensation.
   - Portner et al. show that a **gain-alignment** preprocessing step recovers "most of the lost accuracy (up to 75%)" across receivers ([arXiv 2605.26836](https://arxiv.org/abs/2605.26836)).
   - CSI-Bench uses amplitude only with **per-sample z-score** over the whole CSI matrix, and pads or clips subcarriers to a fixed count ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2)).
   - ESPectre keeps AGC on and uses **std/mean ("turbulence") and other ratio features**, which do not change when AGC scales every amplitude by the same factor ([ALGORITHMS.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/ALGORITHMS.md)).
3. **Augmentation, which helps without target data but inconsistently.**
   - On ESP32-S3, random circular rotation, random resized crop, random amplitude scaling and random contrast gave up to **+22.5 points** (36.4 → 58.9%, LoS→NLoS, biquad) and +21 points cross-antenna.
   - Some single augmentations *hurt*: resized crop cost −10.2 in one direction. "No single technique was universally effective" ([arXiv 2401.00964](https://arxiv.org/html/2401.00964v1)).
4. **Distribution alignment using unlabelled target data** (MMD, DANN, ADDA) gave only small zero-shot gains on ESP32-S3: action recognition 26 → 36–46%, gesture 41 → 41–48% ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)).
5. **Large-scale self-supervised pretraining.**
   - Pooling 14 datasets (1.3 M samples, 4 devices) improved zero-shot cross-domain accuracy by **only +2.2 to +15.7%**. Gains scale log-linearly with data, and bigger models helped only marginally ([arXiv 2511.18792](https://arxiv.org/abs/2511.18792)).
   - Contrastive SSL gave +17.7% macro-F1 and helped one-shot and few-shot settings ([arXiv 2104.09072](https://arxiv.org/abs/2104.09072)).
   - The WiLLM "universal CSI language" uses dataset-specific adapters and claims few-shot gains but gives no numbers in its abstract ([arXiv 2607.09727](https://arxiv.org/abs/2607.09727)).

---

## 4. Recommendations

### 4.1 The datasets most compatible with our setup, and how to use them

**#1 ESPectre corpus. Use it for priors, thresholds and evaluation of the rule layer.**
- **Why it fits best:**
  - Same chip family including the S3, ping-driven traffic to a home AP at about 100 pps, 64-bin HT20 int8 with Q first (the same byte order as our firmware), and AGC left on.
  - Real homes, with a sealed `holdout` role.
  - Its compact LLTF layout runs from -26 to +26 with DC at bin 32, so our 51 bins are a direct subset ([CSI.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/CSI.md), [ML_DATA_COLLECTION.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/ML_DATA_COLLECTION.md)).
- **How to use it:**
  - (a) Calibrate our still/motion and empty/static-presence features against its `empty` / `static_presence` / `motion` files.
  - (b) Measure our false-alarm rate on its long quiet `empty` recordings, which exist for exactly that purpose.
  - (c) Benchmark against its published S3 numbers. On normal Wi-Fi the S3 scores F1 99.2% (Lightweight) and 99.6% (High Accuracy), with an FP rate of 0.1–0.2% ([performance docs](https://github.com/francescopace/espectre/tree/main/docs/performance)).
- **Caveats:**
  - Check each file's capture profile, because LLTF and HT-LTF recordings are mixed.
  - There are no fan recordings that I could find.
  - The data license is unstated (the repo is GPL-3.0), so keep use personal and do not redistribute.

**#2 WiGesture + WiFall (+ WiCount). Use them to pretrain a small amplitude encoder, then adapt few-shot.**
- **Why:**
  - ESP32-S3 receiver, and **for WiGesture a home router as the transmitter**, like ours.
  - 2.4 GHz, 52 sc, 100 Hz.
  - Labels cover **waving and clapping** (in-place hand motion), and **walk, sit, stand** and fall ([arXiv 2403.12400](https://arxiv.org/html/2403.12400), [WiFall card](https://huggingface.co/datasets/RS2002/WiFall/blob/refs%2Fpr%2F1/README.md)).
  - Published ESP32-S3 few-shot baselines exist (KNN-MMD, CrossFi) ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)).
- **How to use them:**
  - Map 52 → 51 bins (drop +1).
  - Resample to a uniform 100 Hz, because WiGesture has 14.5% packet loss.
  - Apply per-window z-score.
  - Pretrain a tiny 1D-CNN or ResNet encoder on 1–2 s windows.
  - Freeze it and fit prototypes or KNN-MMD on our own windows.
- **Caveats:**
  - Single meeting or conference rooms, 1.5 m links, and an external antenna on the receiver.
  - **No license stated**, so use it for personal research only and ask the authors (zzhaock@connect.ust.hk per the card) before any redistribution.

**#3 Wallhack1.8k. Use it to test robustness and augmentation, and for walking vs. walking+waving.**
- **Why:** ESP32-S3, 100 Hz, raw CSV with 52 **L-LTF** sc, a LoS/NLoS split and two antenna types ([Zenodo 13950918](https://zenodo.org/records/13950918)).
- **How to use it:** Reproduce the cross-scenario and cross-antenna splits to check that our features and augmentations are not tuned to one geometry. Use the walk vs. walk+wave contrast as a check for "arm motion on top of walking".
- **Caveat:** CC BY 4.0 with an added non-commercial clause.

**Worth adding:**
- **SHD-HAR** (6.2 GB, CC BY 4.0). It is the only open ESP32-S3 set with **micro-movements** (rub hand, clap, wave) next to standing and empty. That makes it the nearest proxy for "typing-like" motion ([Zenodo 11201414](https://zenodo.org/records/11201414)). Caveat: 40 MHz with 166 bins, so the LLTF segment has to be extracted. I did not verify the column layout.
- **CSI-Bench** for evaluation and feature ideas only.
  - It is the only large set with **fan scenes**: about 200 min of fan motion in the motion-source task and 11,400 fan-interfered breathing samples.
  - Those tasks were recorded on NXP, Echo, Nest or Qualcomm devices, not ESP32.
  - The license is CC BY-NC-ND 4.0 and the download is 81.5 GB ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2), [Kaggle metadata](https://www.kaggle.com/api/v1/datasets/view/guozhenjennzhu/csi-bench)).

**For breathing ground truth:** the only ESP32 sets with a respiration belt are the two Edinburgh sets, and both need an IEEE DataPort subscription ([respiration](https://ieee-dataport.org/documents/respiration-rate-measurement-validity-and-repeatability-ubiquitous-non-contact-wi-fi), [sleep](https://ieee-dataport.org/documents/wi-fi-csi-sensing-sleep-disturbances-care-older-people)). A free alternative is to record our own reference, for example a phone accelerometer on the abdomen as VitalCSI did ([PMC12788229](https://pmc.ncbi.nlm.nih.gov/articles/PMC12788229)), or a metronome-paced protocol.

**For location:** no public ESP32 dataset will transfer zone labels to our room.
- Location fingerprints are inherently room-specific.
- Static-reflection features drift over days even when nothing in the room changes ([Brunello et al.](https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25)).
- HALOC and the UJI multi-day set show what to expect: regression along a hallway, and 21 reference points ([HALOC](https://zenodo.org/records/10715595), [UJI](https://zenodo.org/records/14212401)).

### 4.2 Are training-free or rule-based methods realistic for still / typing / waving / walking on one link?

| Distinction | Realistic without training? | Evidence |
|---|---|---|
| Empty vs. present vs. moving | **Yes**, with an empty-room calibration | **WiDetect** is a single-link, calibration-free statistical (ACF-based) detector: 99.68% detection with zero false alarms over more than 5 weeks in 3 buildings ([UbiComp'19 PDF](https://ct.cswu.me/papers/ubicomp19_widetect_paper.pdf)). **ESPectre** uses a fixed (not per-room-trained) model with AGC-invariant features: S3 F1 98.7–99.6% ([performance](https://github.com/francescopace/espectre/tree/main/docs/performance)). **Espressif esp-radar** calibrates "wander" (presence) and "jitter" (movement) thresholds in the empty room ([README](https://raw.githubusercontent.com/espressif/esp-csi/master/examples/esp-radar/console_test/README.md)). |
| Walking vs. in-place motion (waving or typing) | **Plausible** with speed or ACF features; expect per-room threshold tuning | **WiSpeed** estimates speed from the ACF of CSI power, calibration-free, with 4.85% MAPE for walking speed. But it used 1500 Hz, 40 MHz at 5.8 GHz and 2×3 antennas on an Intel 5300, and assumes rich scattering ([ar5iv 1712.00348](https://ar5iv.labs.arxiv.org/html/1712.00348)). At 2.4 GHz its v = 0.54λ/τ rule puts the 1 m/s walking peak near τ ≈ 67 ms, about 7 samples at 100 Hz, so our rate should resolve walking but with coarse resolution [inference]. **E-eyes** separates walking from in-place activity with one AP at more than 96% TPR and less than 1% FPR, but uses (semi-)supervised location profiles ([E-eyes PDF](https://www.winlab.rutgers.edu/~yychen/papers/E-eyes%20Device-free%20Location-oriented%20Activity%20Identification%20Using%20Fine-grained%20WiFi%20Signatures%20.pdf)). A **moving-variance threshold** rule for walking vs. in-place appears in a patent with no peer-reviewed accuracy ([US patent](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11778050)). |
| Waving vs. typing | **No.** Use few-shot supervised | Typing evidence is **WiKey**: 96.4% per-key and 93.5% for sentences, under tightly controlled single-user training. That falls to about 77.5% in a realistic scenario and needs many samples per key from each user ([WiKey PDF](https://courses.engr.illinois.edu/ece598hh/fa2016/papers/wikey.pdf), [Threatpost](https://threatpost.com/keystroke-recognition-uses-wi-fi-signals-to-snoop/120135)). No training-free method was found. With a fan running nearby, typing's tiny amplitude changes are likely to be swamped [inference]. |
| Breathing rate when still | **Yes, with caveats** | **SMARS** uses the ACF of CSI power on one commodity link: median error 0.47 bpm, 95th percentile 2.92 bpm, up to 10 m or through a wall ([TMC PDF](https://ct.cswu.me/papers/tmc19_smars.pdf)). **ESP32 validation**: the Edinburgh study reports Bland–Altman validity of [1.29, 1.06] BPM over 12–28 BPM; I could not confirm exactly what those bounds denote ([IEEE Access DOI 10.1109/ACCESS.2024.3349700](https://doaj.org/article/af6425956d774801bfa35efac1f160c1)). **Blind spots**: detectability depends on location and orientation relative to Fresnel zones ([Wang et al. UbiComp'16](https://www.doi.org/10.1145/2971648.2971744), [demo](https://researchportal.ip-paris.fr/en/publications/demoa-fresnel-diffraction-model-based-human-respiration-detection/)). The usual fix is a CSI ratio between two antennas, which the S3 cannot provide ([FarSense](https://arxiv.org/pdf/1907.03994)). **Fan**: a vital-sign patent reports that a fan in the room interferes with breathing CFRs, and that its state machine treats fan motion as "Motion" ([US 10735298](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10735298)). In CSI-Bench, overlapping fan motion defines the *Hard* breathing tier ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2)). |
| Lying | **Not as a posture classifier.** Infer it from rules | No training-free posture method was found. Practical rule: still + breathing detected + zone = bed [inference]. Datasets with lying labels are OPERAnet (Intel 5300, CC0), UT-HAR, and Edinburgh sleep (ESP32, subscription). |
| Fan vs. human | **Learnable, not shown training-free** | CSI-Bench motion-source recognition (human / pet / robot / fan) reaches 96–99.9% with supervised models, on NXP devices with oscillating fans ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2)). [inference] A ceiling fan is a stationary, strictly periodic rotor. Characterise its spectral lines from an empty-room recording at each fan speed, then notch them or use them as a "fan-on" baseline. This is untested. |

**Bottom line.** Use a physics/rule layer for presence, motion intensity, walking-speed or ACF decay, and breathing. That part needs no labels, but it must be **calibrated in the empty room with the fan in each state**. Put a **few-shot classifier** on top for fine-grained in-place classes (typing vs. waving) and for zones. This hybrid is consistent with the evidence above. A pure rule system for typing vs. waving is not supported by any source I found.

### 4.3 Minimum per-room labelled data after pretraining

| Source | Target data per class | Domain shift | Result |
|---|---|---|---|
| KNN-MMD | **1 × 1-s window** | new person, same room (ESP32-S3) | 75–93% ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)) |
| FewSense | **5 samples** | new domain or new classes | 82.7–96.5% ([arXiv 2203.02014](https://arxiv.org/abs/2203.02014)) |
| SiMWiSense FREL | **about 15 s** | new environment or subjects | up to 97% ([arXiv 2304.00057](https://arxiv.org/abs/2304.00057)) |
| ReWiS | "a few" | unseen environment | less than 10% drop ([arXiv 2201.00869](https://arxiv.org/abs/2201.00869)) |
| ESPectre data guidance | **≥10 recordings × 30–60 s per label**, varying position | building the training corpus | ([ML_DATA_COLLECTION.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/ML_DATA_COLLECTION.md)) |
| Strohmayer & Kampel | **0** (augmentation only) | new scenario or antenna | recovers only to about 50–69% on a 3-class task ([arXiv 2401.00964](https://arxiv.org/html/2401.00964v1)) |

**Recommendation for Aankhen** [inference built on the rows above plus the temporal-drift results]:
- **Per activity class (still, typing, waving, walking, lying):** 2–5 min in total, spread over **at least 3 sessions on different days**, covering fan off and fan at full speed, and varying where you stand or sit. The 1–5-shot papers did not test across days, and the ESP32-S2 study found a 52% relative loss after only 10 minutes ([UJI](https://repositori.uji.es/xmlui/handle/10234/207262)).
- **Per location zone:** 1–2 min of still and of moving inside each zone, re-recorded periodically. Static fingerprints drift ([Brunello et al.](https://portalcientific.uji.es/documentos/6844b0f9e2a55c4fb915bb25)).
- **Unlabelled background:** at least 10 min of empty room at each fan speed, for calibration and for MMD-style alignment.
- **Evaluation:** always test on a **different day** than training.

The current "few minutes" is enough for a 1–5-shot prototype classifier on top of a pretrained encoder. It is not enough to trust accuracy numbers until a separate-day test exists.

---

## 5. Integration notes for our pipeline

- **Subcarrier mapping.**
  - Wallhack1.8k stores L-LTF at indices 6–31 and 33–58 of a centred 64-bin layout, so dropping index 33 (+1) gives our 51 ([Zenodo 13950918](https://zenodo.org/records/13950918)).
  - ESPectre's compact LLTF runs from -26 to +26 with DC at bin 32 ([CSI.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/CSI.md)).
  - For WiFall/WiGesture's 52-value rows, confirm the order empirically (guard and DC positions in the mean amplitude profile) before mapping. The card does not state it ([WiFall card](https://huggingface.co/datasets/RS2002/WiFall/blob/refs%2Fpr%2F1/README.md)).
- **Rate and loss.** Resample every dataset to a uniform 100 Hz grid using timestamps, because WiGesture averages 14.5% packet loss ([arXiv 2403.12400](https://arxiv.org/html/2403.12400)).
- **Gain.** Without `esp_csi_gain_ctrl`, use ratio, z-score or std/mean features, or per-window gain alignment. Never use raw absolute amplitude levels as features ([esp_csi_gain_ctrl](https://components.espressif.com/components/espressif/esp_csi_gain_ctrl/versions/0.1.5/readme), [Portner et al.](https://arxiv.org/abs/2605.26836), [ESPectre ALGORITHMS.md](https://raw.githubusercontent.com/francescopace/espectre/main/docs/ALGORITHMS.md)).
- **SHD-HAR and Lim & Ong** used 40 MHz configurations. Lim & Ong still report 52 subcarriers, consistent with LLTF capture ([PMC11615535](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11615535/fullTextXML)). SHD-HAR's 166 bins include LLTF + HT-LTF + STBC-HT-LTF ([PMC11268129](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11268129/fullTextXML)).

---

## 6. Not verified, or conflicting

- **Licenses not stated:** WiGesture, WiFall and WiCount (no license tag on HF); ESPectre data (the repo is GPL-3.0); Widar3.0; NTU-Fi; UT-HAR data (the repo is GPL-3.0); WiAR; WiSDOM; WiStride; the Edinburgh sets.
- **Conflicting license terms:** Wallhack1.8k, HALOC and the ICVS-2023 set show CC BY 4.0 alongside a "non-commercial research only" clause. Treat them as non-commercial.
- **Sizes not found:** MM-Fi total size, NTU-Fi size, the size of ESPectre's `data/` folder alone, and the Widar3.0 CSI total (third-party summaries disagree).
- **UT-HAR sampling rate:** 1000 Hz per AutoFi vs. 100 Hz per TRIS-HAR ([AutoFi](https://arxiv.org/pdf/2205.01629), [TRIS-HAR](https://arxiv.org/pdf/2410.02334)).
- **CARM's "about 80% untrained"** comes only from a survey table ([arXiv 1712.00146](https://arxiv.org/pdf/1712.00146)).
- **Whether Portner et al. included ESP32** receivers is not stated in the abstract.
- **Kaggle login** for CSI-Bench was not checked; Kaggle normally requires a free account.
- **Not found at all:** "EHUCOUGH"; any ESP32 "CSI-HAR" or "eHealth" set (the sets with those names are Nexmon/Raspberry Pi); any dataset released by Steven Hernandez.
- **SHD-HAR:** the column layout inside the 166 bins (where the LLTF block sits) was not verified.
- **ESPectre:** whether the `motion` recordings include fan-on conditions. No fan is mentioned in the docs I read.
