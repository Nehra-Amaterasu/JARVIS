# Yaadash test audit (2026-10-25)

## Question
Do the Yaadash (memory) tests check the real rules, or do they pass by assuming things?
The rules: nothing personal gets into the public repo; recall returns the right memory;
corrections replace old facts (supersession) and duplicates merge; Keep/Wrong feedback
turns into the right memories; and the model never invents a memory or gives a friend's
fact to Aman.

## Method
- Ran `yaadash/tests` with `C:\Projects\JARVIS\.venv` Python and the real bge-small embedder.
- Added a labelled hallucination eval (`test_memory_eval.py`). It covers three invented
  chat sessions and a scripted model that also makes the usual 4B-model mistakes: a memory
  nobody said, a friend's fact written as his, and a fact taken from a misheard line.
  Questions go through `chat_memory.context_block`, the same block JARVIS reads.
- Read every guard in `learn_chats.py` (`misattributed`, `llm_candidates`) against the probes.

## Findings
1. **Loophole: a place name passed as "the other person".** `misattributed()` counted every
   capitalised entity in the line as someone the memory had to name. So from "My sister Tara
   is moving to Lisbon", the model's "He is moving to Lisbon" passed (Lisbon is in both) and
   was stored as Aman's move. Fix: the people in a line are the relation words plus the name
   right after them ("sister Tara"). Bare entities count only when the line has no relation
   word (for example "Kabir hates horror").
2. **Loophole the other way: Hinglish "bhai" read as a brother.** In "yaad rakhna bhai",
   "bhai" means "bro". The guard dropped his own gym fact as if it were his brother's, so
   "what did I tell you about the gym?" came back empty. Fix: strip "bhai/dost/yaar/bro/bhaiya"
   when they are used as a form of address (after a comma, or at the end of a clause).
   "Mera bhai Rohan ..." still counts as his brother.
3. **Dangling reference.** The test docstrings cited `docs/research/2026-10-23-test-audit-yaadash.md`,
   which was never written. They now point to this file.
4. **Privacy was not tested.** No test checked that memories, transcripts and flags stay
   out of git. Added two tests: every default store path (`data/yaadash/learned/memories.json`,
   `data/app/transcripts/*.jsonl`, `flags.jsonl`, `chat_turns.lance`) is git-ignored, and
   `git ls-files` tracks no memory, transcript or flag file. Both pass. `data/` is ignored.
5. **Keep/Wrong edge cases were not tested.** Added a test: Wrong with an empty correction
   stores no "the right answer was" memory, and Keep on a short receipt ("The light is on.")
   is not saved as a style example. It passes; the code already handled both.
6. **Slow tests.** The memory eval built its 3-session learn fixture twice. It is now one
   test, which saves about 4 s. The slowest test is still `test_library_eval` (17 s, study
   library, not chat memory). Its retrieval-latency loop is a measurement, so I left it alone.
7. **Machine note.** Pytest runs killed by a timeout left orphaned child Python processes
   (the venv launcher dies, the child keeps running). They starved later runs until I killed
   them. If a run hangs with no output, check `Get-Process python`.

## Numbers (hallucination eval, scripted model, bge-small)
| metric | before fix | after fix | floor |
|---|---|---|---|
| recall hit@1 (n=8) | 6/8 | 7/8 | 0.75 |
| recall hit@3 | 7/8 | 8/8 | 1.0 |
| false memory (n=10) | 1/10 | 0/10 | 0 |
| supersession (n=3) | 3/3 | 3/3 | 1.0 |
| invented memories stored | 1 | 0 | 0 |

The one hit@1 miss left is "which song did I love on the drive?": the answer is at rank 2.
The model is scripted, so these numbers measure the guards and retrieval, not the 4B
model's judgement. The live eval (`-m live`) re-measures on the real stores.

## Sources
- Code: `yaadash/learn_chats.py` (`misattributed`, `llm_candidates`), `yaadash/chat_memory.py`
  (`context_block`), `yaadash/yaadash_recall.py` (lexical rescue).
- Tests: `yaadash/tests/test_memory_eval.py`, `yaadash/tests/test_memory_audit.py`.
- Earlier notes: [2026-10-14-yaadash-feedback-loop.md](2026-10-14-yaadash-feedback-loop.md),
  [memory-feasibility.md](memory-feasibility.md).

## What it changed
- `misattributed()` now checks people (relation words and names), not places, and ignores vocative "bhai".
- New tests cover privacy, Keep/Wrong edge cases, places and vocatives; the eval floors are now enforced.
