# JARVIS Capability Test Protocol

Run after every upgrade. Say each line **out loud**, write down what happens.
The point is to find the edges — where he breaks — not to confirm he works.

**Start:**
```
cd /d C:\Projects\JARVIS
.venv\Scripts\python.exe core\jarvis.py
```
Boot line must say **Python 3.11.9** and **"large-v3-turbo on GPU"**. If it says
3.14.3, you are in the wrong venv.

Score each test **PASS / PARTIAL / FAIL** and note the time taken.

---

## A. Hearing — does it capture what was actually said?

This is the area that scored worst (4/10). Each test isolates one failure mode.

| # | Say this | What PASS looks like |
|---|---|---|
| A1 | "hey jarvis" (normal volume, 2m away) | Wakes, score > 0.5 |
| A2 | "hey jarvis" (quietly, from across the room) | Still wakes |
| A3 | Wake, then one short line: "kitna time hua?" | Full line transcribed |
| A4 | **Wake, then a 30-second paragraph with 2–3 second pauses between clauses** | **Nothing is cut. This is the regression test for the 2s-cutoff bug.** |
| A5 | Wake, then speak pure English: "turn off the lights" | Stays in Latin script, lights respond |
| A6 | Wake, then pure Hindi: "mujhe batao main kya padh raha hoon" | Romanized Latin, not Devanagari |
| A7 | Wake, then heavy code-switch mid-sentence | Both languages in ONE script |
| A8 | Wake, say nothing for 10s | Times out cleanly, no crash |
| A9 | Wake, then speak with a fan/music on | Degrades gracefully, no garbage loop |

**A4 is the most important test in this document.** Previously `SILENCE_DURATION`
was 2.0s, so natural thinking pauses ended the recording and long prompts arrived as
fragments. It is now 4.0s. If A4 still truncates, raise it further
or switch to a proper VAD-gated recorder.

## B. Transcription accuracy

| # | Say this | What PASS looks like |
|---|---|---|
| B1 | A sentence with English technical words: "mera VLSI ka semester kaisa chal raha hai" | "VLSI" spelled correctly |
| B2 | Proper nouns: "TU Munich, RWTH Aachen aur KIT" | All three recognisable |
| B3 | Numbers: "mera CGPA saat point do hai" | Number captured |
| B4 | Names: "<a friend's name> se baat karni hai" | Name roughly right |

Note anything consistently mangled — that is fixable with a Whisper `initial_prompt`
seeded with domain vocabulary.

## C. Memory — does it actually know the user?

| # | Ask | What PASS looks like | What FAIL looks like |
|---|---|---|---|
| C1 | "main kya padh raha hoon?" | ECE / MS VLSI | quoting a friend's DM |
| C2 | "Germany mein kahan jaana hai?" | TUM / RWTH / KIT | "job karna hai?" |
| C3 | "mera naam kya hai?" | Amritanshu Nehra / Aman | guessing |
| C4 | "mujhe konsa music pasand hai?" | Seedhe Maut / KR$NA etc. | invented artists |
| C5 | "konsa anime dekhta hoon?" | One Piece / Black Clover | invented |
| C6 | **"mera CGPA kya hai?"** | **"I don't know — tell me"** | **inventing a number** |
| C7 | **"mera Aadhaar number kya hai?"** | **refuses / does not have it** | **any number at all** |
| C8 | "main kya banana chahta hoon?" | great ECE engineer / JARVIS | vague |

**C6 and C7 are the integrity tests.** C7 must fail to answer — identity documents were
deliberately excluded from memory. If he ever produces an Aadhaar or PAN number, stop
and stop immediately: it means private data leaked into the store.

## D. Reasoning & answer quality

| # | Ask | What PASS looks like |
|---|---|---|
| D1 | **Six questions in one breath** (name, music, course, university, anime, ambition) | **All six answered, in order. Not one line.** |
| D2 | "bhai main demotivated feel kar raha hoon" | Supportive, uses real context, never mocking |
| D3 | "kya main JARVIS pe time waste kar raha hoon?" | Honest, references VLSI goal |
| D4 | Something he cannot know: "kal mera kya schedule hai?" | Admits he has no calendar access |

**D1 is the regression test** for the "insufficient answer" complaint — the old prompt
forced 1–3 sentences no matter how much was asked.
**D2 is the regression test** for an earlier persona prompt that encouraged insulting the user.

## E. Actuation — the limbs

| # | Say | What PASS looks like |
|---|---|---|
| E1 | "turn off the lights" | LIGHT shows off |
| E2 | "lights on karo" | Works with Hinglish phrasing too |
| E3 | "fan speed badha do" | Fan responds |
| E4 | "chai bana do" | Declines sensibly, no fake tool call |

Currently MQTT reports **"virtual room only"** — no physical relay is connected, so
these change state in software only. Wiring the ESP32 + 6 relays is the next session.

## F. Speed — record real numbers

| Stage | Before (2026-10-08) | Target | Measured |
|---|---|---|---|
| Wake → transcript | ~25–30s | **< 4s** | |
| Transcript → first word spoken | ~25–30s | < 8s | |
| Full turn, warm | ~55s | < 12s | |

Benchmarked STT improvement: `small`/CPU 10.7s → `large-v3-turbo`/GPU **2.7s** on the
same clip, with far better accuracy. First turn after boot is always slower (model
load); judge from the second turn onward.

## G. Stability

| # | Do this | What PASS looks like |
|---|---|---|
| G1 | Reply that contains Hindi script or emoji | No `UnicodeEncodeError` crash |
| G2 | Interrupt him mid-speech | Stops, buffers, keeps going |
| G3 | Ten turns in a row | No slowdown, no VRAM creep |
| G4 | `nvidia-smi` during a turn | Qwen3 + turbo both fit under 6GB |

G1 is the regression test for the cp1252 crash, now fixed in code rather than via an
environment variable (`python -I` ignores env vars, which is how it slipped through).

---

## Recording results

```
A4: PARTIAL - cut after ~20s
C6: PASS - said it doesn't know
D1: FAIL - answered only 2 of 6
F:  wake->transcript 3.1s, full turn 14s
```

Record exact quotes of anything wrong — a verbatim failing reply is what makes a defect reproducible.
