# Recording Aankhen's data — baselines, the drill, and how labels become a model

_2026-10-26. A guide to do once and understand for good. Commands run from `C:\Projects\JARVIS` with the venv: `.venv\Scripts\python.exe -m aankhen ...`_

## 0. The one idea behind all of it
A model learns a **mapping**: signal pattern → where you are. It can only learn it from **labelled examples**: "this 2 s of signal = me at the desk". So recording is really two jobs at once:
1. capture the signal cleanly, and
2. know **exactly when** you were **where** — the label.

Get the label time wrong by a few seconds and the model is taught that walking-to-the-bed looks like sitting-at-the-desk. That is why the drill does the timing for you.

## 1. The empty-room baseline (5 minutes)
**What it is:** the room's Wi-Fi "fingerprint" with nobody in it. Every later window has this subtracted, so what's left is *what your body changed*. Like taring a kitchen scale before weighing.

**Why twice:** the ceiling fan's blades flicker the signal (~23 Hz), so "empty, fan off" and "empty, fan on" look different. Each needs its own reference.

**How:**
1. **Close the JARVIS app first.** `calibrate` opens the board's USB port (COM9) itself, and only one program can hold a port. (The drill is different: it records through the running app.)
2. Fan **off**. Start, then **leave the room and close the door**:
   ```
   .venv\Scripts\python.exe -m aankhen calibrate --seconds 120
   ```
3. Come back, fan **on** (your usual speed), start, leave again:
   ```
   .venv\Scripts\python.exe -m aankhen calibrate --seconds 120 --fan
   ```
4. Check: Aankhen → readiness card shows both baselines ✓.

**Rules that matter:** nobody in the room (pets count), door in its usual position, don't move furniture after. If something big moves later (bed, wardrobe), redo both.

## 2. The daily drill (26 minutes, the real training data)
```
.venv\Scripts\python.exe -m aankhen drill
```
What happens, and why each part exists:
| Step | What you do | Why |
|---|---|---|
| Empty captures | leave the room ~1 min, fan off then on | today's own baseline: rooms drift day to day |
| A block is announced | JARVIS says e.g. "lie on the bed, still" | one (spot, activity, fan) at a time |
| You press Enter / say ready | then "5… go" | **this is your timestamp idea, automated**: the start and end time of each block are written to `labels.jsonl` |
| 50 s hold | stay in that spot doing that thing | the first 5 s are thrown away (you're still settling) |
| Confirm | ok / redo / bad / or type where you **really** were | the label is what you confirm, not what was asked: honest labels beat many labels |
| Random order, fan on and off | — | so the model can't cheat by learning "desk always comes 3rd" or "fan means bed" |

Free checks run on every block: while "typing" the keyboard must be busy; while "still" it must not; packet rate and signal strength must be sane. A failed block is repeated once at the end.

**Do it on 7 different days** (14 is better), at different times (morning, evening, night). Days are what teach the model to survive drift; one long session doesn't.

## 3. More precise labels — your ideas, sorted
| Idea | Verdict | Why |
|---|---|---|
| Timestamps per movement | ✅ already how the drill works | start/end per block, host clock, saved with the raw signal |
| Typing/mouse as automatic labels | ✅ built ("free teachers") | if the keyboard is busy you are at the desk; costs you nothing, every day |
| Phone on home Wi-Fi as a label | ✅ planned | phone gone = you're out: a free "empty" label |
| Light switch events as labels | ⚠️ weak | a voice/app command can come from the bed; it says you're *awake*, not *where* |
| Lights following your movement | ✅ but **after** the model passes | runs log-only for 7 days first; it may only switch 230 V once in-room accuracy ≥ 95 % on every held-out day |
| Fine movements (hand wave, sit-to-stand) | later | needs more data per movement and a time-series model; zones first |

## 4. From recordings to a model (what `fingerprint` does)
1. **Window:** cut the stream into 2 s pieces every 0.5 s (51 subcarriers × 50 time steps).
2. **Label by time:** a window gets the label of the block it ends in.
3. **Clean:** subtract today's empty-room level (same fan state).
4. **Two models, compared honestly:**
   - **kNN fingerprint** (your Shazam idea): summarise each window, find the 7 closest labelled windows, vote.
   - **CNN:** learns its own filters over time and subcarriers; ~19k weights so it can later run on the ESP32.
5. **Judge on a day it never saw** (leave-one-day-out):
   ```
   .venv\Scripts\python.exe -m aankhen fingerprint evaluate
   ```
   Prints, per held-out day, kNN % vs CNN % vs chance. With fewer than 3 days it says the numbers mean little — believe it.
6. **Train the winner on everything:**
   ```
   .venv\Scripts\python.exe -m aankhen fingerprint train
   ```

**Why "a day it never saw":** two windows half a second apart are near copies. Test on them and any model looks brilliant. The question that matters is "trained until yesterday, right today?".

## 5. Order of operations
1. Board placement: signal better than −70 dBm (Aankhen → board card).
2. Measure my room (centimetres, corner 0, sketch shows each line).
3. Both baselines (section 1).
4. Drill, day 1 … day 7: the scripted drill (section 2), the narrated drill (section 6), or both.
5. `fingerprint evaluate` after the first session (a 50/50 split), and after day 3 by held-out days.

## 6. The narrated drill: you choose the places, your voice is the label
_Added 2026-10-26._ You move however you like, stop in places, do things there and say each place out loud into your phone. The laptop records the Wi-Fi at the same time.

**Before you start (2 minutes)**
- The JARVIS app is running and the Aankhen tab is on the ESP32. The board card shows CSI flowing.
- Laptop volume is up. If headphones are the default output, the chirp still goes to the laptop speakers, and the command tells you where it is playing.
- Know the fan state; `--fan on` or `--fan off` sets the starting value. Saying "fan on" or "fan off" later changes it.

**Run it**
1. `.venv\Scripts\python.exe -m aankhen narrate record --fan off`
2. Start the phone's voice recorder, hold the phone near the laptop, press Enter. You hear two chirps.
3. Put the phone in your pocket. Move around, and each time you arrive somewhere, say the place first and then what you're doing:
   - "desk chair … typing", "standing at the desk", "on the bed … lying", "sitting on the bed";
   - "wardrobe", "bathroom door", "bathroom", "balcony door", "balcony", "room door";
   - "leaving the room" (you go out and the room is empty; this is the session's empty-room reference, so stay out about 2 minutes);
   - "pause" when you want a stretch ignored, for example while you look for something.
4. Hold each place at least 20–30 seconds. The first 5 s after you speak are thrown away (you're still settling), and so is the last 1 s before your next word. A place you stay at for 8 s gives almost nothing.
5. Vary the order and come back to the same place more than once. A second visit is the honest test of a model.
6. Back at the laptop: press Enter (the end chirp), then stop the phone recording.
7. Copy the audio file over, then run `.venv\Scripts\python.exe -m aankhen narrate label latest "<audio file>"`. Read the table; if Whisper misheard a word, fix that line in the session's `labels.jsonl`.
8. `.venv\Scripts\python.exe -m aankhen lesson1 <session folder>` shows whether your places really look different in the signal.
9. `.venv\Scripts\python.exe -m aankhen fingerprint evaluate --split half` trains on half and verifies on the other half (section 7).

**How the clock problem is solved.** The Wi-Fi frames carry the laptop's clock; the phone's recording has its own. The chirp is played at a moment the laptop writes down. Finding it in the audio (a matched filter, below) pins phone time to laptop time. The end chirp measures how fast the phone's clock runs (tens of parts per million, about 0.1–0.2 s an hour) and corrects it. Measured: three chirps on the real speaker matched their logged times to 1 ms.

## 7. How the kNN and the CNN map a signal to a place, and how they learn
**What goes in.** One window is 2 s of the cleaned signal: 51 subcarriers × 50 time steps, a small picture 51 tall and 50 wide. Each row is how strongly one frequency arrived; your body standing somewhere absorbs and reflects 2.4 GHz waves in its own way, so each place leaves its own pattern of brighter and darker rows. That pattern is the fingerprint.

**kNN, k-nearest neighbours: a lookup, no training**
1. Each window is squeezed into 102 numbers: each subcarrier's average level and how much it wobbled.
2. Each of the 102 is standardised (minus its mean, divided by its spread over the training windows), so no single subcarrier dominates just because its numbers are bigger.
3. The "model" is simply every training window with its label: the database.
4. **To predict**, measure the straight-line distance in 102-dimensional space from the new window to every stored window, take the 7 closest, and let them vote. Closer ones count more (weight = 1/distance).
5. **What it does well:** nothing to tune, strong as soon as there is one good session. **Where it breaks:** a day's drift moves every point, so yesterday's database stops matching. That's why every window has the same day's empty-room level subtracted first.

**CNN, a convolutional neural network: it learns which patterns matter**
1. **Layer 1:** 32 filters. Each one is 51 × 5 numbers (all subcarriers × 5 time steps) and slides along time; at each step it multiplies the window by its numbers and adds them up. A high result means "this filter's pattern is here". ReLU sets negatives to 0. MaxPool keeps the stronger of every two steps.
2. **Layer 2:** 64 filters that look at layer 1's 32 outputs, so they detect patterns of patterns.
3. **Global average:** each of the 64 is averaged over time, which gives 64 numbers: what is present, regardless of exactly when within the 2 s.
4. **Linear layer:** 64 → one score per place. Softmax turns the scores into probabilities that add to 1. **The prediction is the place with the highest probability**, and that probability is its confidence.
5. In total that's 18,948 numbers (weights), all random at the start.

**How it learns: backpropagation.** You described it right: question, prediction, see where it went wrong, correct, repeat.
1. **Question:** a batch of 64 training windows whose answers are known.
2. **Prediction:** the forward pass above gives a probability for each place.
3. **How wrong:** the loss, cross-entropy = −log(probability given to the right place). Right and sure: near 0. Pure guessing among 4 places: ln 4 = 1.386.
4. **Where it went wrong:** backpropagation uses the chain rule to compute, for every one of the 18,948 weights, how much the loss would change if that weight were nudged: the gradient.
5. **Correct:** the optimiser (Adam) moves every weight a small step against its gradient, downhill on the loss.
6. **Repeat:** all batches once is an epoch; it runs 30 epochs.
7. **The record you asked for.** With `--split half`, every epoch saves the loss, accuracy on the training half, accuracy on the verify half, and the gradient size per layer: how hard backprop pushed conv1, conv2 and the linear layer. It's saved as a picture and a JSON in `data/aankhen/models/cnn/reports/`.
   - Read it like this: the verify accuracy climbing with the train accuracy means it is learning; train near 100 % while verify stalls means memorising (overfitting).
   - Gradients shrinking towards zero mean it has stopped learning anything new.

**Against overfitting (your "no spillage"):**
- Each day is cleaned against its own empty room.
- Random level shifts and time shifts are added during training (augmentation), so a day's drift looks familiar.
- Dropout 30 % and weight decay keep weights small.
- **The split never tests on near-copies:** places visited twice train on one visit and verify on the other; a place visited once is cut in the middle with a 2 s gap.
- The real verdict stays "trained until yesterday, right today?": leave-one-day-out, from day 3.

**Your 50/50 rule, and its honest limit.** With one session, both halves come from the same evening, so the score is an upper bound: tomorrow will be lower. That's why the default switches to held-out days automatically once there are 3 days.

**Simulated data, later.** The physics simulator (`aankhen/rf.py`) can generate rooms and people. The plan that holds up is to pre-train the CNN on simulated rooms, then fine-tune it on yours, and report only scores on your real held-out days. Simulated accuracy is never shown as real. It becomes worth trying once real days show where the model is weak.
