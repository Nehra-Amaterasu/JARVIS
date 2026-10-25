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
4. Drill, day 1 … day 7.
5. `fingerprint evaluate` after day 3, again after day 7.
