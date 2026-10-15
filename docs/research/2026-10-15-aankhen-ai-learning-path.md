# Learning AI by training Aankhen yourself: a path from CSI to an on-device model

Date: 2026-10-15
Status: research + teaching document. No code was changed.

## The question

How can an ECE undergrad who knows basic Python learn to train the Aankhen Wi-Fi sensing model himself, working alongside Claude rather than leaving it to Claude, and finish with:

- (a) a clear step-by-step understanding of how a model for Aankhen is trained,
- (b) the model running **on the ESP32-S3 itself**, next to the CSI capture code,
- (c) "an agent that helps the CSI estimations",
- (d) a sensible answer on "OpenClaw or other things"?

## Short answer (what this document changes)

1. **The learning order is fixed:** data, then features, then model, then evaluation, then deployment. You only move on when the evaluation step is honest, which means **leave-one-day-out**. A model that is only tested on minutes from the same evening it was trained on tells you nothing.
2. **More days beat bigger models.** Published Wi-Fi sensing benchmarks lose 25 to 45 accuracy points when a model meets a new room, person or device. Pooling 1.3 million samples from 14 datasets recovered only a few of those points. The daily 26-minute drill is the most valuable part of the whole project.
3. **On-device is realistic.** A small int8 1D-CNN on a 51-subcarrier window is about 20 KB of weights and roughly 1.6 million multiply-accumulates. On the ESP32-S3 with Espressif's optimised kernels that should take about 10 to 50 ms, which is under 10% of the CPU at a 0.5 s hop. This is an estimate that you will measure in Lesson 6.
4. **Split of work:** the ESP32 does capture, feature extraction and a small classifier. The laptop keeps training, the belief/HMM filter, multi-day evaluation and the data bank.
5. **Agent:** a trained model maps numbers to labels. An LLM agent is the lab assistant around it: it runs the drill, checks data quality, proposes relabels, triggers retraining and explains results. It must never guess positions. **OpenClaw is not recommended** for this. It is a chat-app personal-assistant gateway with a serious 2026 security record. The existing JARVIS crew plus the local Qwen3-4B with a small, fixed tool list is the better fit.
6. **For the MS/VLSI story,** this is a complete TinyML pipeline from sensor to int8 silicon, and a multi-week, single-home ESP32-S3 CSI dataset could become a workshop paper.

---

## 1. The mental model

### 1.1 The five boxes

```
 raw CSI packets ──► features ──► model ──► evaluation ──► deployment
 (51 sc x ~250/s)    (numbers     (learns    (on days it     (laptop, then
                      per window)  a rule)    never saw)      ESP32-S3)
```

**Data.** Each Wi-Fi packet gives 51 usable complex numbers, one per subcarrier. Each number has an amplitude and a phase. At about 200 to 280 packets a second you get a 51-row "image" that scrolls in time. The drill attaches a label to every stretch of time, for example `zone=desk, activity=typing, fan=on`. The labels are the teacher. The model can never be more correct than they are.

**Features.** A model does not want 12,000 raw numbers every second. It wants a few dozen numbers per window (for example 2 s, hopping every 0.5 s) that describe how the channel moved. Examples are variance per subcarrier, energy in the 0.4 to 1 Hz band (breathing and small motion), energy in the 1 to 4 Hz band (walking), and how the change is spread across subcarriers. `aankhen/learn.py` already builds about 20 of these, such as `log_mvs`, `log_hbe` and four sub-band energies. A neural network can learn its own features from the raw window instead (Lesson 4).

**Model.** A function with adjustable knobs. Training turns the knobs until its outputs match the labels on the training data. Logistic regression has about 100 knobs, gradient boosting has a few thousand split thresholds, and a small CNN has about 20,000 weights.

**Evaluation.** This is the step beginners get wrong. If the 2-second windows of one evening are shuffled into "train" and "test", neighbouring windows land on both sides. They are almost identical, so the model looks brilliant. That is **leakage**. The honest test is:

- **Leave-one-day-out (LODO):** train on all days but one, test on the held-out day, and repeat for every day. Report the mean and the worst day.
- scikit-learn does this directly with `LeaveOneGroupOut`, using `groups = day` ([scikit-learn cross-validation guide](https://scikit-learn.org/stable/modules/cross_validation.html#leave-one-group-out)).

**Deployment.** Running the trained function somewhere useful: first on the laptop, live, then on the ESP32-S3 as int8 code.

### 1.2 Why more days beat bigger models for Wi-Fi sensing

A Wi-Fi channel is a fingerprint of the whole room: furniture, doors, the fan, humidity, where the phone or router sits, even how the chip's automatic gain control settled that day. The person is a small change on top of all that. So a model trained on one evening partly learns "that evening". The literature measures how badly this goes. Most of these numbers come from our 2026-10-12 dataset survey, which read the full papers:

| Study | Shift | What happened |
|---|---|---|
| CSI-Bench (NeurIPS 2025; 26 homes and offices, 35 users, 461 h) | in-distribution vs new device / new environment / new user | HAR **88.1% → 61.8 / 54.9 / 54.7%** ([arXiv 2505.21866](https://arxiv.org/html/2505.21866v2), via [our 10-12 survey](2026-10-12-csi-datasets.md)) |
| CSI-Bench fall task | difficulty tiers | ResNet18 F1 about 97% Easy, 77% Medium (fan interference) and **68% Hard (includes low-quality ESP32 CSI)** (same source) |
| KNN-MMD | new person, same room, **ESP32-S3** | gesture 80.8% → **40.8%**, activity 70.5% → **26.0%** without adaptation ([arXiv 2412.04783](https://arxiv.org/html/2412.04783v1)) |
| ReWiS | unseen environment | a plain CNN drops by **more than 45%**; few-shot ReWiS drops by less than 10% ([arXiv 2201.00869](https://arxiv.org/abs/2201.00869)) |
| ESP32-S2 study (UJI) | **10 minutes later**, same setup | 52% relative loss ([UJI repository](https://repositori.uji.es/xmlui/handle/10234/207262), via our 10-12 survey) |
| Pooled foundation-model study | 14 datasets, 1.3 M samples | zero-shot cross-domain gain of only **+2.2 to +15.7 points**; gains grow log-linearly with data, and bigger models helped only marginally ([arXiv 2511.18792](https://arxiv.org/abs/2511.18792)) |

What this means in practice:

- A bigger network trained on the same five minutes simply memorises those five minutes better.
- What closes the gap is **variety in the training data**: many days, fan on and off, doors open and shut, different clothes, different times of day. A few labelled minutes from the target conditions also help, which is what the few-shot papers rely on.
- The 26-minute daily drill is therefore the core of the project, not a chore around it. After 10 to 15 drill days you will have the scarcest thing in this field: one fixed home, many days, one cheap chip.

---

## 2. The curriculum: 8 lessons

Each lesson has a **goal**, **free reading**, an **exercise on your own Aankhen data**, and a **done when** check. The rule for working side by side with Claude: **you write the code first**, then Claude reviews it, explains what went wrong and suggests the next step. Ask Claude "why", not "do it".

Data note: the raw CSI and drill labels live in the git-ignored data folder (`data/aankhen/...`). They describe a home, so they never go into the public repository. Notebooks that load them can be committed if their outputs are cleared.

### Lesson 1: See the data

- **Goal:** know what a CSI window looks like when nobody is there, when you type, when you walk, and when the fan runs.
- **Read:**
  - fast.ai Practical Deep Learning, lesson 1, for the "get it working end to end first" mindset ([course.fast.ai](https://course.fast.ai/)).
  - The esp-csi `get-started/tools` parsing scripts, to see how Espressif reads CSI ([espressif/esp-csi](https://github.com/espressif/esp-csi)).
  - Our earlier note on amplitude vs phase ([2026-10-13-csi-phase-vs-amplitude.md](2026-10-13-csi-phase-vs-amplitude.md)).
- **Exercise:**
  1. Load one drill session with the existing decoder (`aankhen.protocol.decode_packet` / `StreamDecoder`) into a NumPy array of shape `(packets, 51)` of complex numbers.
  2. Plot an **amplitude heatmap** (time on x, subcarrier on y) with the drill labels as coloured bars on top.
  3. Plot **raw phase**, then phase after removing the linear slope across subcarriers. Notice that raw phase is mostly noise from the receiver clock.
  4. Overlay fan on vs fan off for an empty room and look for stripes at fixed frequencies.
- **Done when:** you can point at a plot and say "this is where I sat down".

### Lesson 2: Hand-made features and the simplest model

- **Goal:** turn windows into feature rows, and learn train/test splits, accuracy, and the confusion matrix.
- **Read:**
  - Andrew Ng's *Machine Learning Specialization*, course 1, weeks 1 to 3: linear and logistic regression. It can be audited free on Coursera ([coursera.org/specializations/machine-learning-introduction](https://www.coursera.org/specializations/machine-learning-introduction)).
  - scikit-learn "Getting started" and `LogisticRegression` ([scikit-learn.org](https://scikit-learn.org/stable/getting_started.html)).
- **Exercise:**
  1. Cut sessions into 2 s windows with a 0.5 s hop.
  2. Compute 5 to 10 features yourself, such as the mean and variance of amplitude per subcarrier (then averaged) and the energy in 0.4–1 Hz and 1–4 Hz after an FFT.
  3. Train `LogisticRegression` for **activity** (still / typing / moving / lying).
  4. Evaluate it **twice**: with a random shuffle split, and with "train on day 1, test on day 2". Write down both numbers. The gap between them is the lesson.
- **Done when:** you can explain why the shuffled score is a lie.

### Lesson 3: Gradient boosting and leave-one-day-out

- **Goal:** reproduce and understand what `aankhen/learn.py` already does, then evaluate it honestly.
- **Read:**
  - scikit-learn `HistGradientBoostingClassifier` ([user guide](https://scikit-learn.org/stable/modules/ensemble.html#histogram-based-gradient-boosting)) and the cross-validation chapter, especially `LeaveOneGroupOut` ([link](https://scikit-learn.org/stable/modules/cross_validation.html)).
  - StatQuest's gradient boosting videos, for intuition (free on YouTube).
- **Exercise:**
  1. Read `learn.py` top to bottom and list every feature in a table, writing in plain English what each one measures.
  2. Train HGB on your Lesson 2 features, then on `learn.py`'s features, using **LODO** across all drill days.
  3. Report per-class recall for **zone** (desk chair / bed lying / beside bed / balcony door / bathroom / empty) and **activity** separately, plus the **worst day**.
  4. Use `permutation_importance` to see which features carry the result.
- **Done when:** you have a LODO table that you trust, and you know which zone pair is most often confused.

### Lesson 4: A tiny 1D-CNN in PyTorch

- **Goal:** let a network learn its own features from the raw window, and learn the training loop: tensors, loss, optimiser, epochs, overfitting.
- **Read:**
  - PyTorch "Learn the Basics" ([pytorch.org/tutorials/beginner/basics](https://pytorch.org/tutorials/beginner/basics/intro.html)).
  - fast.ai lessons 2 to 4 ([course.fast.ai](https://course.fast.ai/)).
- **Exercise:**
  1. Input: amplitude windows of shape `51 × 128`, meaning 51 subcarriers as channels and 128 time steps. Downsample the 200–280 Hz stream to a fixed 64 Hz, so 128 steps is 2 s. Normalise each window with a z-score. That is what CSI-Bench does and it removes much of the day-to-day gain drift.
  2. Model, about 20 k parameters: `Conv1d(51→32,k5) → ReLU → MaxPool2 → Conv1d(32→32,k5) → ReLU → MaxPool2 → Conv1d(32→64,k3) → ReLU → GlobalAvgPool → Linear(64→zones)` plus a second `Linear(64→activities)` head. The training fits easily on the RTX 4050 (6 GB), and even on the CPU.
  3. Add augmentation: random amplitude scaling and random circular shift in time. On ESP32-S3 data, augmentation like this gave up to +22.5 points in a cross-scenario test (Wallhack1.8k, via [our 10-12 survey](2026-10-12-csi-datasets.md)).
  4. Compare it with HGB **under LODO**. Do not be surprised if HGB wins until you have about 10 days of data.
- **Done when:** you can draw the network's shapes layer by layer and explain why a CNN needs more days than HGB.

### Lesson 5: Quantise to int8 and measure the loss

- **Goal:** understand quantisation, which is turning float weights into 8-bit integers with a scale and zero-point. It is exactly the fixed-point arithmetic you will meet in VLSI.
- **Read:**
  - The PyTorch quantization overview ([pytorch.org/docs/stable/quantization.html](https://pytorch.org/docs/stable/quantization.html)).
  - The ESP-DL "how to quantize" tutorials and ESP-PPQ ([docs.espressif.com/projects/esp-dl](https://docs.espressif.com/projects/esp-dl/en/latest/)).
  - Warden & Situnayake, *TinyML* (O'Reilly, 2019), chapters on quantization and model optimisation. It is a paid book; the free equivalent is the HarvardX TinyML series on edX ([tinyml.seas.harvard.edu](https://tinyml.seas.harvard.edu/)).
- **Exercise:**
  1. Export the Lesson 4 model to ONNX.
  2. Quantise it with ESP-PPQ to the `.espdl` format (8-bit, w8a8), using about 200 calibration windows drawn from several different days.
  3. Run the quantised model in ESP-PPQ's simulator on the held-out day. Report float accuracy, int8 accuracy, and the difference. Expect the difference to be small, but measure it.
  4. Bonus: also try w8a16 (8-bit weights, 16-bit activations), which ESP-DL supports.
- **Done when:** you can show by hand how one weight maps to an int8 value and back.

### Lesson 6: Deploy to the ESP32-S3 and measure latency and RAM

- **Goal:** run inference on the chip, and learn memory maps, PSRAM, and timing.
- **Read:**
  - ESP-DL getting started ([docs](https://docs.espressif.com/projects/esp-dl/en/latest/getting_started/readme.html)). It needs ESP-IDF 5.3 or newer.
  - The esp-tflite-micro README for the alternative route ([github.com/espressif/esp-tflite-micro](https://github.com/espressif/esp-tflite-micro)).
  - Espressif's 2026 TFLite gesture-recognition walkthrough ([developer.espressif.com](https://developer.espressif.com/blog/2026/04/gesture-recognition-based-on-tflite/)).
- **Exercise:**
  1. First **check the board's memory** (section 3.1).
  2. In a **separate test firmware** (do not touch the production `firmware.ino` yet), load the `.espdl` model, feed it 100 windows recorded on the laptop, and compare its outputs with Python's int8 results bit for bit.
  3. Time `model->run()` with `esp_timer_get_time()`. Log `heap_caps_get_free_size(MALLOC_CAP_INTERNAL)` and `(MALLOC_CAP_SPIRAM)` before and after loading.
  4. Then run it **with Wi-Fi CSI capture active**, because the Wi-Fi stack takes RAM and CPU.
- **Done when:** you have a table of model size, peak RAM, latency, and latency with CSI running.

### Lesson 7: On-device inference that sends only results

- **Goal:** move from streaming raw CSI to the laptop to sending `{zone, activity, confidence}` every 0.5 s.
- **Read:**
  - The firmware's own `aankhen_protocol.h` and `README.md` (`aankhen/firmware/`).
  - FreeRTOS tasks and queues in the ESP-IDF docs ([docs.espressif.com/projects/esp-idf](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/freertos.html)).
- **Exercise:**
  1. Design: CSI callback → ring buffer (51 × 128 int16 is about 13 KB) → an inference task on core 1 every 0.5 s → a new small message type in the protocol.
  2. **Keep a raw-CSI mode switchable**, because the data bank and retraining still need raw packets.
  3. On the laptop, feed the device's softmax output into the **existing HMM/belief filter**. The device gives evidence; the laptop still decides.
  4. Compare the device and laptop outputs for a full drill run.
- **Done when:** the app shows the same answers with raw streaming turned off.

### Lesson 8: Continual learning and daily recalibration

- **Goal:** keep the model good as the room changes: furniture moves, seasons change, the fan breaks.
- **Read:**
  - Few-shot and adaptation papers from our survey: FewSense ([arXiv 2203.02014](https://arxiv.org/abs/2203.02014)), ReWiS ([arXiv 2201.00869](https://arxiv.org/abs/2201.00869)), and the AGC gain-alignment result ([arXiv 2605.26836](https://arxiv.org/abs/2605.26836)).
  - Chip Huyen, *Designing Machine Learning Systems*, the chapters on data distribution shift and continual learning. It is a paid book; her free [blog post on real-time ML / continual learning](https://huyenchip.com/2022/01/02/real-time-machine-learning-challenges-and-solutions.html) covers the core ideas.
- **Exercise:**
  1. Each drill day: append the data, retrain on the laptop, and run LODO on the **newest** day before adding it to training. That gives a "tomorrow" score.
  2. Plot the tomorrow score against the number of days in training. This is your learning curve and the main figure of any future paper.
  3. Try a **daily recalibration**: the first 2 minutes of the drill (empty room, fan off and on) set a per-day normalisation baseline. Measure whether it helps.
  4. Only push a new model to the ESP32 if it beats the current one on the last 3 held-out days. That is a simple **promotion gate**.
- **Done when:** the learning curve exists and the promotion rule runs automatically.

---

## 3. On-device feasibility on the ESP32-S3

### 3.1 How much memory you have, and how to check

- **The chip:** a dual-core Xtensa LX7 at up to 240 MHz, with **512 KB of internal SRAM** and 128-bit vector (PIE/SIMD) instructions that Espressif's NN and DSP libraries use ([ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf)). Part of that SRAM goes to Wi-Fi, FreeRTOS and your capture buffers.
- **PSRAM depends on the module.** The letters on the metal shield tell you: `N16R8` means 16 MB flash and 8 MB octal PSRAM; `N8` with no `R` means no PSRAM. Read the shield first ([CircuitDigest guide](https://circuitdigest.com/articles/how-to-Identify-esp32-flash-and-psram-size)). Our firmware notes already avoid the octal PSRAM pins 33–37 on N8R8/N16R8 modules ([2026-10-13-ota-flashing-and-relay-wiring.md](2026-10-13-ota-flashing-and-relay-wiring.md)), but which module the board actually has is not recorded.
- **Three ways to check:**
  1. Read the shield marking.
  2. Recent `esptool` versions print embedded flash and PSRAM in the chip description when they connect. Running `esptool --chip esp32s3 flash_id` shows the flash size. This is general knowledge, not verified against your esptool version.
  3. Most reliable: in a test sketch with PSRAM enabled (Arduino IDE: *Tools → PSRAM → OPI PSRAM*), print `ESP.getPsramSize()` and `ESP.getFreeHeap()`, or read the ESP-IDF boot log, which reports PSRAM found and its size. A forum thread shows that a wrong PSRAM setting can make an N16R8 report 2 MB or no PSRAM at all ([esp32.com thread](https://esp32.com/viewtopic.php?p=106148)).
- **Bottom line:** the model proposed here fits in internal SRAM even **without** PSRAM. PSRAM only matters if you later want bigger models or long on-device buffers.

### 3.2 The three toolchains

| | **ESP-DL** (Espressif) | **TensorFlow Lite Micro** (esp-tflite-micro + ESP-NN) | **Edge Impulse** |
|---|---|---|---|
| License / cost | MIT, free ([GitHub](https://github.com/espressif/esp-dl)) | Apache-2.0, free ([GitHub](https://github.com/espressif/esp-tflite-micro)) | Free Developer plan (3 private projects, GPU, 60-min training jobs); production deployment may need an Enterprise subscription, and sources disagree ([plans](https://www.edgeimpulse.com/plans), [announcement](https://edgeimpulse.com/blog/introducing-the-developer-plan/)) |
| Path from PyTorch | PyTorch → ONNX → **ESP-PPQ** → `.espdl` | PyTorch → ONNX → TF → `.tflite`, which is clumsier; easier if you train in Keras | Upload data in the browser; it trains and exports a C++ library |
| 1D-CNN support | Conv **1d/2d**, Max/Avg/GlobalAvgPool 1d, Gemm, ReLU, Softmax, LSTM, GRU, all int8 ([operator table](https://github.com/espressif/esp-dl/blob/master/operator_support_state.md)) | Conv1D is expressed as Conv2D with height 1; supported | Yes, through its own DSP and NN blocks |
| Quantisation | 8-bit, 16-bit, mixed w8a16 | int8 | int8 |
| Speed evidence | S3/P4-specific kernels; AutoQuant can measure latency on the device ([docs](https://docs.espressif.com/projects/esp-dl/en/latest/tutorials/auto_quantization/how_to_use_AutoQuant.html)) | person-detection `invoke()` on the S3: about **2300 ms → 47–54 ms** with ESP-NN at 240 MHz ([esp-tflite-micro README](https://github.com/espressif/esp-tflite-micro), [ESP-NN readme](https://components.espressif.com/components/espressif/esp-nn/versions/1.3.1/readme); read via search summary) | It hides the internals |
| Arduino core 3.3.x fit | Officially an ESP-IDF component (5.3+). Easiest as a separate ESP-IDF test project, or via Arduino-as-component | An Arduino port exists; ESP-IDF is the main path | The Arduino export historically tracked older ESP32 cores (forum report), so check it |
| **For learning** | **Recommended.** Native to the chip, PyTorch-friendly, and you see every step | Good second choice, with the most tutorials (TinyML book) | Fastest demo, but it hides exactly what you want to learn |

**Recommendation:** use ESP-DL for the real deployment. Read the TFLM chapters of the TinyML book for concepts. Skip Edge Impulse except perhaps for a one-evening comparison.

### 3.3 Budgets for the proposed model (estimates, to be measured)

Model from Lesson 4, with input 51 × 128:

| Item | Estimate | How it was worked out |
|---|---|---|
| Weights | about 20 k parameters, so about **20 KB int8** | 51·32·5 + 32·32·5 + 32·64·3 + heads |
| Compute | about **1.6 M MACs** per window | 128·32·51·5 + 64·32·32·5 + 32·64·32·3 |
| Activations (peak) | about 10–20 KB | input 6.5 KB int8 plus the largest layer |
| Input ring buffer | about 13 KB (int16) | 51 × 128 × 2 B |
| Latency | **about 10–50 ms** | The person-detection model is a few million MACs at about 50 ms on the S3, so about 1.6 M MACs is around 10–20 ms. Allow 2–3× for small 1D layers and Wi-Fi interrupts. **This is an estimate; Lesson 6 measures it.** |
| CPU share at a 0.5 s hop | under 10% of one core | 50 ms / 500 ms |

A budget rule to keep: **weights at most 100 KB, peak RAM at most 64 KB, latency at most 100 ms**. That leaves room for the Wi-Fi stack and the relay/web code already on the board.

### 3.4 Which features to compute on the device

- **Cheap and useful:** amplitude per subcarrier (a square root, or skip it and use |h|²), a running mean/variance per subcarrier for normalisation, and moving-variance motion scores like `log_mvs`.
- **FFT band energies:** ESP-DSP has assembly-optimised FFTs for the S3. A 1024-point complex float FFT takes about 98 k cycles, which is about **0.4 ms at 240 MHz** ([ESP-DSP benchmarks](https://docs.espressif.com/projects/esp-dsp/en/latest/esp-dsp-benchmarks.html); read via search summary). Doing an FFT for all 51 subcarriers every hop is affordable, but it is wasteful. Project onto the 4–6 smooth subcarrier patterns that `learn.py` already uses (`log_p0..p5`) and FFT only those.
- **Leave on the laptop:** phase sanitising experiments, the fan-line estimator, anything that needs many minutes of history.

### 3.5 What Espressif and others already run on the chip

- **esp-csi** ([GitHub](https://github.com/espressif/esp-csi)): `get-started` send/receive examples, `esp-radar/console_test` with presence/motion detection, and `esp-radar/wifi_sensing_demo` on the `esp_wifi_sensing` component, with on-site "training" (calibration). This is threshold/statistics-based. The README does not describe a neural network.
- **ESPectre** ([GitHub](https://github.com/sunbox/espectre), [ESP-IDF component](https://components.espressif.com/components/francescopace/espectre)): on-device CSI motion detection for ESPHome/Home Assistant using moving-variance segmentation and subcarrier selection, with **no ML**. Check its license before reusing code.
- **UABC thesis, "A system for human activity recognition using Wi-Fi CSI on embedded device":** a lightweight deep model on an ESP32, with **90.65% accuracy and 232 ms inference** ([repository](https://repositorioinstitucional.uabc.mx/items/9c1d7fdf-fcbc-4ce2-9ad2-553f00123dae)). *Read in search snippets only; the evaluation split is unknown.*
- **IIT Madras WiSDOM artifact:** ESP32 CSI HAR traces, TensorFlow training and compression scripts, and on-ESP32 energy measurements ([artifact PDF](https://sense.cse.iitm.ac.in/wisdom/docs/artifact.pdf)). *Snippet only.*
- **MicroBi-ConvLSTM (2026):** int8 HAR on an ESP32 through esp-tflite-micro, about 168 ms ([arXiv 2602.06523](https://arxiv.org/pdf/2602.06523)). *Snippet only, and it was not confirmed whether the input is CSI or IMU data.*

So on-ESP32 CSI classification has been done, but rarely, and with little evaluation across days. That gap is useful to you (section 5).

### 3.6 What stays where

| ESP32-S3 (device) | Laptop |
|---|---|
| CSI capture, ring buffer, normalisation | the data bank (7-day raw plus drill sessions) |
| feature extraction (variance, a few FFTs) | **training** (HGB, CNN), quantisation |
| small int8 classifier giving zone/activity probabilities | **belief / HMM filter** over time and rooms |
| a switchable raw-CSI mode for data collection | **multi-day LODO evaluation**, the promotion gate |
| relays and existing duties | the agent, explanations, the app UI |

---

## 4. "An agent that helps the CSI estimations"

### 4.1 Two very different things

- A **trained model** is a fixed function: 51 × 128 numbers in, `{desk: 0.82, bed: 0.05, ...}` out, in milliseconds, with the same answer every time. It knows nothing else.
- An **LLM agent** is a language model in a loop with tools. It reads text and numbers, reasons, calls functions (start drill, compute stats, retrain), and writes explanations. It is slow (seconds), approximate, and can be wrong in fluent sentences.

So the agent should **operate the lab**, not **be the sensor**.

### 4.2 Where an agent genuinely helps

1. **Running the drill:** speaking the prompts ("now sit at the desk and type"), timing each segment, recording the labels, and noticing when a segment was cut short.
2. **Checking data quality** after each session: packet rate (should be about 200–280/s), gaps, RSSI and AGC jumps, a stuck subcarrier, whether the fan state matches the fan's spectral lines, and whether the labels match coarse motion. For example, "lying still" with high motion energy is suspicious.
3. **Proposing relabels.** It proposes; you confirm. Example: "Segment 14:32–14:35 is labelled *still* but motion energy is 6× the still median. Mark it *moving* or drop it?"
4. **Triggering retraining** and running the LODO report and the promotion gate (Lesson 8).
5. **Explaining results:** "Balcony door and beside-bed are confused 31% of the time on day 6. Both sit on the same side of the link. More drill time at both would help."

### 4.3 Where it must not be used

- **Guessing positions or activities** from raw numbers or from "common sense" about the house. That is the trained model's job, and an LLM will produce confident nonsense.
- **Silently editing labels.** Every relabel needs a human yes, and the original label is kept.
- **Being in the real-time path** of the light/fan decisions.
- In line with the project rule, it must also never suggest a camera as ground truth. Labels come from the drill, not from video.

### 4.4 OpenClaw: what it is, and whether it fits

- **What it is:** an MIT-licensed, TypeScript, self-hosted personal-agent framework (formerly Clawdbot/Moltbot), launched in late November 2025 by Peter Steinberger. A long-running "gateway" connects a chosen LLM (Claude, GPT, Gemini, or local models through Ollama) to chat apps such as Telegram, Discord and WhatsApp. It can run tools, browse, keep files and run scheduled jobs, with a community "skills" marketplace called ClawHub ([operator.io explainer](https://operator.io/blog/what-is-openclaw), [neurohive history](https://neurohive.io/en/guides/openclaw-the-lobster-that-took-over-the-world-how-one-developer-built-the-most-popular-open-source-ai-agent-in-history/), [etcjournal](https://etcjournal.com/2026/03/15/openclaw-is-a-self-hosted-open-source-agentic-ai-framework-for-pcs/)). *These are secondary sources; the repository itself was not opened.*
- **Security record in 2026:**
  - CVE-2026-25253 (CVSS 8.8): one-click remote code execution through token theft in the Control UI, fixed in 2026.1.29.
  - The "ClawHavoc" malicious-skills supply-chain incident on ClawHub, with counts that vary by source from 341 to about 1,400.
  - Further authorisation-bypass and sandbox-escape reports, and vendor advisories against running it on ordinary personal machines.
  - Sources: [The Hacker News](https://thehackernews.com/search/label/WebSocket%20Security), [INCIBE CVE-2026-62225](https://www.incibe.es/incibe-cert/alerta-temprana/vulnerabilidades/cve-2026-62225), [BetterClaw roundup](https://betterclaw.io/blog/openclaw-security-2026). *Counts come from secondary reporting.*
- **Fit for Aankhen: poor.** It solves "talk to an assistant from my phone's chat app", which JARVIS already does. It would add a Node/TypeScript gateway, a second memory system, and an exposed attack surface on the same laptop that holds the home data bank and drives the relays.
- **Recommendation:** build the "Aankhen lab assistant" as **one more crew role inside JARVIS**, on the local Qwen3-4B that JARVIS already runs through Ollama (`core/agent.py`, `core/ollama_guard.py`). Give it a **small, fixed set of Python tools** and nothing else:
  - `drill_start(plan)`, `drill_status()`
  - `session_quality(session_id)`, which returns numbers, not opinions
  - `propose_relabel(session, t0, t1, new_label, reason)`, which only writes to a review queue that you approve in the app
  - `retrain()`, `lodo_report()`, `promote_if_better()`
  - `explain(report)`, which turns the JSON into a short spoken or written summary

  A 4B model is enough because the tools do the maths; the model only sequences them and writes English. Writing these tools yourself is also good learning (Lesson 8 plus one evening).

---

## 5. How this connects to the MS in Germany and the VLSI story

### 5.1 Why it is a VLSI story, not only an ML story

- **Quantisation is fixed-point design.** Choosing scales, zero-points, 8-bit vs 16-bit activations and accumulator widths is the same reasoning as sizing a datapath in RTL.
- **Profiling MACs, memory traffic and SRAM budgets** on the S3 is the software side of designing an accelerator. A natural stretch goal is to write the 1D-conv layer as a small **Verilog/SystemVerilog MAC-array** on an FPGA and compare cycles and energy with the S3's SIMD.
- **The whole chain:** RF channel (the physics in `rf.py`) → DSP (FFT, filtering) → ML → int8 silicon → system (RTOS, protocol). Few applicants can show all of it on hardware they built.

### 5.2 Portfolio project, and possibly a paper

- **Portfolio:** a public repository with code only (no home data), a short write-up, the learning-curve plot (tomorrow score against number of days), the device latency/RAM table, and a 1-minute demo video of the device sending only `{zone, activity, confidence}`.
- **Paper idea:** "*A multi-week, single-home ESP32-S3 CSI dataset for zone and activity sensing, with cross-day evaluation and on-device int8 inference.*"
  - Our 10-12 survey found ESP32 datasets to be short and lab-scripted, and found CSI-Bench to be mostly non-ESP32 hardware.
  - The cross-day learning curve, the fan on/off condition, and on-device numbers are the contribution.
  - Releasing such a dataset needs a privacy review first, since CSI reveals home routines. A safe route is to publish only features and labels with coarse time.
  - Realistic venues are a workshop or a datasets track. This is an idea, not a verified gap analysis.

### 5.3 Where this lands in Germany (verify current course lists in each university's catalogue)

- **TUM:** the Professorship of **AI Processor Design** (Prof. Hussam Amrouch) in the School of Computation, Information and Technology. It built a 7 nm AI chip, and TUM is setting up the **MACHT-AI** AI-chip design centre ([chair page](https://www.ce.cit.tum.de/en/aipro/team/hussam-amrouch/), [TUM press release](https://www.tum.de/en/news-and-events/all-news/press-releases/details/the-technical-university-of-munich-establishes-a-center-for-ai-chips)). The course list was not retrieved; check TUMonline.
- **RWTH Aachen:** the **Institute for Communication Technologies and Embedded Systems (ICE)**, Prof. Rainer Leupers. Its application areas include AI accelerators and wireless communications, which is exactly the RF + embedded + ML mix ([ice.rwth-aachen.de](https://www.ice.rwth-aachen.de)).
- **TU Dresden:** the Chair of **Highly-Parallel VLSI Systems and Neuro-Microelectronics** (Prof. Christian Mayr), home of SpiNNaker2/SpiNNcloud neuromorphic hardware ([TUD news](https://tu-dresden.de/ing/der-bereich/news/milestone-for-energy-efficient-ai-systems-tud-launches-spinncloud-supercomputer)).
- **TUHH (Hamburg), as a bonus:** a master's course **"TinyML: Embedded Machine Learning"** covering quantisation, pruning, NAS and distillation, with an MCU project ([tuhh.de/ncps/teaching/tinyml](https://www.tuhh.de/ncps/teaching/tinyml)).

In an SOP or interview, "I quantised and deployed my own CSI model to an ESP32-S3 and measured X ms / Y KB, and it degraded Z points across days until I fixed it with data" is concrete evidence of exactly what these groups work on.

---

## 6. First week (about 1 hour a day, next to the drill)

Assumption: the drill runs every day this week, so each day adds one labelled session.

| Day | What you do (about 60 min) | Output |
|---|---|---|
| **1** | Set up a `notebooks/` folder with outputs cleared and data paths pointing into the git-ignored data folder. Load today's drill session with the existing decoder. Print the packet count, duration and packets per second. Plot the amplitude heatmap with the label bars. | first plot; packets/s checked |
| **2** | Phase: raw vs slope-removed. Plot an empty room with the fan off vs on and find the fan stripes. Write 5 sentences in your own words about what you see. | 2 plots + notes |
| **3** | Windowing (2 s / 0.5 s hop). Compute 6 hand-made features. Make a `features.csv` with columns `day, t, zone, activity, fan, f1..f6`. | your first dataset table |
| **4** | Logistic regression for **activity**. Evaluate with a random split, then day 1 → day 3. Write down both numbers and explain the gap. | your first honest number |
| **5** | Read `learn.py` with Claude. Make the feature table in plain English. Run HGB on your features and on `learn.py`'s with LODO over the 4–5 days you have. | LODO table v0 |
| **6** | Confusion matrix for **zone**. Find the worst pair. Look at their heatmaps side by side and explain the physics (which side of the link, how close to the line between router and board). | "why it fails" note |
| **7** | Check the board's **memory** (shield marking plus a `getPsramSize()` test sketch). Write a one-page plan for Lesson 4 (the CNN) with the shapes from section 3.3. Commit the notebooks (code only) and a short progress note. | memory facts + CNN plan |

Rules for the week:

- You type the code. Claude reviews, explains, and points to docs.
- Every number you report says how it was split.
- No new model is trusted unless it was scored on a day it never saw.

---

## Sources

Benchmarks and generalisation:
- CSI-Bench, NeurIPS 2025 D&B: [arXiv 2505.21866](https://arxiv.org/html/2505.21866v2), [proceedings](https://proceedings.neurips.cc/paper_files/paper/2025/hash/f7c68372b3d39e8d7a093eb2edaaad87-Abstract-Datasets_and_Benchmarks_Track.html). The abstract was re-read today; the accuracy numbers come from [our 2026-10-12 survey](2026-10-12-csi-datasets.md), which read the HTML paper.
- KNN-MMD: [arXiv 2412.04783](https://arxiv.org/html/2412.04783v1). ReWiS: [arXiv 2201.00869](https://arxiv.org/abs/2201.00869). FewSense: [arXiv 2203.02014](https://arxiv.org/abs/2203.02014). Pooled-data study: [arXiv 2511.18792](https://arxiv.org/abs/2511.18792). AGC / cross-receiver: [arXiv 2605.26836](https://arxiv.org/abs/2605.26836). UJI ESP32-S2: [repository](https://repositori.uji.es/xmlui/handle/10234/207262). All via the 10-12 survey.

On-device tooling:
- ESP-DL: [GitHub](https://github.com/espressif/esp-dl), [operator support](https://github.com/espressif/esp-dl/blob/master/operator_support_state.md), [getting started](https://docs.espressif.com/projects/esp-dl/en/latest/getting_started/readme.html), [AutoQuant](https://docs.espressif.com/projects/esp-dl/en/latest/tutorials/auto_quantization/how_to_use_AutoQuant.html)
- esp-tflite-micro: [GitHub](https://github.com/espressif/esp-tflite-micro); ESP-NN: [readme](https://components.espressif.com/components/espressif/esp-nn/versions/1.3.1/readme) (search summary)
- ESP-DSP benchmarks: [docs](https://docs.espressif.com/projects/esp-dsp/en/latest/esp-dsp-benchmarks.html) (search summary)
- Espressif TFLite gesture blog: [link](https://developer.espressif.com/blog/2026/04/gesture-recognition-based-on-tflite/)
- Edge Impulse: [plans](https://www.edgeimpulse.com/plans), [Developer plan post](https://edgeimpulse.com/blog/introducing-the-developer-plan/), [ESP32 deployment](https://docs.edgeimpulse.com/hardware/deployments/run-cpp-espressif-esp32)
- ESP32-S3: [datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf); module and PSRAM checks: [CircuitDigest](https://circuitdigest.com/articles/how-to-Identify-esp32-flash-and-psram-size), [esp32.com thread](https://esp32.com/viewtopic.php?p=106148)

CSI on ESP32 projects:
- [espressif/esp-csi](https://github.com/espressif/esp-csi) (README read)
- [ESPectre](https://github.com/sunbox/espectre) (search summary)
- [UABC thesis](https://repositorioinstitucional.uabc.mx/items/9c1d7fdf-fcbc-4ce2-9ad2-553f00123dae) (snippet)
- [IITM WiSDOM artifact](https://sense.cse.iitm.ac.in/wisdom/docs/artifact.pdf) (snippet)
- [MicroBi-ConvLSTM](https://arxiv.org/pdf/2602.06523) (snippet)

Agents:
- OpenClaw: [operator.io](https://operator.io/blog/what-is-openclaw), [neurohive](https://neurohive.io/en/guides/openclaw-the-lobster-that-took-over-the-world-how-one-developer-built-the-most-popular-open-source-ai-agent-in-history/), [etcjournal](https://etcjournal.com/2026/03/15/openclaw-is-a-self-hosted-open-source-agentic-ai-framework-for-pcs/)
- Security: [The Hacker News](https://thehackernews.com/search/label/WebSocket%20Security), [INCIBE](https://www.incibe.es/incibe-cert/alerta-temprana/vulnerabilidades/cve-2026-62225), [BetterClaw](https://betterclaw.io/blog/openclaw-security-2026)
- All of these were read via search summaries.

Learning resources:
- [fast.ai](https://course.fast.ai/), [Ng ML Specialization](https://www.coursera.org/specializations/machine-learning-introduction), [scikit-learn](https://scikit-learn.org/stable/), [PyTorch tutorials](https://pytorch.org/tutorials/beginner/basics/intro.html), [PyTorch quantization](https://pytorch.org/docs/stable/quantization.html), [HarvardX TinyML](https://tinyml.seas.harvard.edu/)
- Warden & Situnayake, *TinyML* (O'Reilly, 2019)
- Chip Huyen, *Designing ML Systems* and her [blog](https://huyenchip.com/2022/01/02/real-time-machine-learning-challenges-and-solutions.html)
- These are well-known resources; the URLs are from general knowledge and were not re-fetched today.

Germany:
- [TUM AI Processor Design](https://www.ce.cit.tum.de/en/aipro/team/hussam-amrouch/), [TUM AI-chip centre](https://www.tum.de/en/news-and-events/all-news/press-releases/details/the-technical-university-of-munich-establishes-a-center-for-ai-chips), [RWTH ICE](https://www.ice.rwth-aachen.de), [TU Dresden SpiNNcloud](https://tu-dresden.de/ing/der-bereich/news/milestone-for-energy-efficient-ai-systems-tud-launches-spinncloud-supercomputer), [TUHH TinyML](https://www.tuhh.de/ncps/teaching/tinyml)
- All via search summaries; current course lists were not verified.

## Open items and honesty notes

- **Not measured:** all latency and RAM numbers in section 3.3 are estimates from MAC counts and the published person-detection benchmark. Lesson 6 replaces them with real numbers.
- **Unknown:** whether the board has PSRAM. Check it on Day 7.
- **Unknown:** whether ESP-DL builds cleanly inside the Arduino core 3.3.x project. The safe path is a separate ESP-IDF test firmware first.
- **Not opened directly:** the OpenClaw repository, the UABC, IITM and MicroBi papers, and the German course catalogues. Only search summaries were read.
