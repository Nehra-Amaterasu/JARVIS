# Yaadash (memory): running log, newest first

Earlier dated notes stay where they are: [2026-10-14-yaadash-feedback-loop.md](2026-10-14-yaadash-feedback-loop.md)
(what it is for, the chat loop), [2026-10-25-yaadash-test-audit.md](2026-10-25-yaadash-test-audit.md) (the
hallucination eval), [memory-feasibility.md](memory-feasibility.md) (the design reasoning). Private numbers
live in `data/notes/research/`.

## 2026-10-28: the whole context, and every upgrade Yaadash needs

### Question
What is Yaadash today, measured, and what is the complete list of upgrades it needs, ordered so the
3 h/week exam-season budget (elder advice, 27 Oct) goes to the right ones first?

### Method
Read every module in `yaadash/` (9,313 lines incl. tests), the three hooks in `core/agent.py`, the app side
(`app/jarvis_app/memory.py`, `imports.py`, `routes_library.py`, `routes_galaxy.py`, `crew/agents/learner.py`),
the Yaadash tab, the decision records (DECISIONS 2026-08-31, 10-09 x2), the three research notes, NOW.md and the
master context. Counted the live stores read-only. Ran `yaadash/tests` with the real bge-small embedder.

### State in numbers (read-only, 28 Oct)
| Store | Rows | Note |
|---|---|---|
| `memories` table | 1,899 | instagram 929 · claude dev logs 739 (never retrieved) · voice_interaction 187 (written every turn, never read) · **authored 44** (the only rows in the prompt) |
| `beliefs` table | 18 | 14 confirmed, 3 outdated, 1 rejected, **0 unconfirmed**: the "Is this true?" card has been empty since 10-14 |
| archive | 109,819 msgs · 14,013 windows · 541 threads | built 10-09 from two Instagram exports dated 2026-07-26 |
| people | scored from the archive | last built 10-09; Instagram only |
| taste | 18 NMF topics over liked/saved captions | last built 10-09 |
| learned (chats) | 21 memories: 19 active, 2 superseded | 5 preference, 5 instruction, 4 correction, 3 don't, 2 fact, 1 exemplar, 1 callback; 2 Keep verdicts; 13 sessions read over 7 transcript days (578 turn lines) |
| `core_facts.md` | 94 lines | last edited 10-09; its REVIEW QUEUE section is still unanswered |
| tests | 186 passed, 1 skipped, 2 xfailed, 56 s | the xfails are the two known recall-gate gaps |

Last measured quality (not re-measured since): facts 193/198 (10-09); chat probes 5/7, off-topic leaks 0/8
(10-14); archive recall hit@2 3/10 (10-14, before the 10-23 lexical rescue); hallucination eval hit@3 8/8,
false memories 0/10 (10-25). Per-turn assembly median 0.29 s, max 0.89 s (10-14).

### Findings that are not in any earlier note
1. **The galaxy, the growth chart and the study Library panel are built but mounted nowhere.** `MemoryGalaxy.tsx`,
   `GrowthChart.tsx`, `LibraryPanel.tsx` exist with routes (`/api/galaxy`, `/api/library`) and tests, and no page
   imports them. The Yaadash tab shows search, beliefs, learned, reminders, people, taste only.
2. **The beliefs loop is idle.** `distill` (claims from his own messages) was never run; the 18 beliefs were all
   seeded from taste and people and all decided by 10-14. Nothing new has been asked since.
3. **Dead writes.** `store_interaction` still writes a `voice_interaction` row every turn (187, newest 25 Oct);
   nothing reads them, and they inflate the "memories" number on the tab.
4. **A mojibake section name in the store.** Two authored rows carry source `authored:HISTORY � true before, not
   n…` (an em-dash mangled on ingest), so they fall outside `_SECTION_ORDER` and sort last in the prompt.
5. **Three stores, three schemas, three review paths.** Confirmed facts (LanceDB `authored:*`), beliefs (LanceDB
   `beliefs`), learned chat memories (`learned/memories.json`) each have their own fields, confidence rules and
   verdict UI. A learned fact never becomes a belief or an authored fact.
6. **Instagram is the only ingested life source.** ChatGPT, Spotify and YouTube Music have readers
   (`ingest_exports.py`) and no importer; WhatsApp and Brave have nothing. Tie strength is therefore
   Instagram-only.
7. **Nothing schedules a refresh.** `refresh_memory.py` says "safe to schedule" and nothing does; the exports it
   reads are three months old.
8. `lancedb.table_names()` is deprecated at 3 call sites (recall, archive, galaxy).
9. `data/yaadash/learned_eval/` (554 KB) is the 10-14 eval leftover; the note said to delete it once the real
   store was trusted.

### The upgrade list
Ordered inside each group; the group letters are the priority. Each item says why and how it would be checked.
"≤20 min" marks what fits the freeze rule (bug-sized fixes only until 5 Nov 10:00).

**A. Built but not reaching him (quick, measurable)**
1. Mount the galaxy, growth chart and Library panel on the Yaadash tab as a lazy chunk (≤20 min each). Check:
   the tab shows them; UI tests still pass; first-load JS for Core unchanged.
2. Stop writing `voice_interaction` rows (the learned `chat_turns` index already holds every turn). Check: the
   count stays at 187 after a chat.
3. Re-ingest `core_facts.md` with the section name read as UTF-8 and the HISTORY rows ordered as past. Check: no
   `�` in any source string.
4. Run `yaadash_beliefs.py distill 400` once on his own archive messages, review the first 20 in the app, keep a
   count of kept/rejected in the private research file. Check: the "Is this true?" card is non-empty.
5. Delete `learned_eval/`. Edit the stale hardware fact in `core_facts.md` (his, not Claude's) and answer the
   REVIEW QUEUE section, then re-ingest.
6. Honest numbers on the tab: show 44 facts, 21 learned, 18 beliefs, not 1,899 "memories" (the 739 dev-log rows
   and 187 voice rows are not memories). Move the `claude` rows to their own table or delete them.
7. Fix the three `table_names()` deprecations before the next lancedb upgrade breaks recall.

**B. Recall quality (the measured gaps)**
8. Re-run the 10-14 archive probe set after the 10-23 lexical rescue. The README still quotes 3/10; the number
   after the rescue was never taken. Save it to the private note.
9. Close the two xfailed gate gaps: let BM25 evidence inside a *named person's* thread pass the 0.32 gate, and let
   a paraphrase through when vectors rank it first and coverage is high. Check: `test_control_queries` known-gap
   tests flip to pass, the 6 abstain queries still abstain.
10. Multilingual embeddings (`multilingual-e5-small`) for Hinglish and Devanagari: decided 10-09, never measured.
    bge-small is English-only, so Hindi queries lean on BM25 alone. Measure on the control-query harness before
    swapping; the archive re-embed is about 7 min on CPU.
11. Learned-memory matching is "one shared content word + distance ≤ 0.60". The two chat-probe misses were pure
    wording mismatches. Have the distiller write 2-3 alternative phrasings or keywords per memory at write time,
    so lexical matching has more surface; or add a small CPU cross-encoder reranker on the top 10. Check: chat
    probes 5/7 → 7/7 without raising off-topic leaks above 0/8.
12. Audit the episodic trigger (`is_episodic`) against the real transcripts: it fires on remember/yaad/when words;
    "what did <person> say about X" may never reach the archive.
13. Follow-ups were 7/11 grounded: search with the last two turns, not one, when the message is short.
14. Short-term memory is 6 exchanges with a 10-minute reset. Add a rolling session summary (the 4B summarises the
    turns that fall off the buffer, ≤80 words) so a long chat keeps its thread without a bigger prompt.

**C. The learning loop (chats → memory → him)**
15. Mishearing gate: the distiller once stored a misheard model name as a "correction". Carry Whisper's
    confidence (avg log-prob / no-speech probability) into the transcript line and refuse to distil low-confidence
    lines into facts or corrections.
16. One review queue: learned memories and beliefs in the same list, same verdict API, same card.
17. Spoken review: three "is this still true?" questions in a quiet moment (the crew's proactive-speech policy
    already has quiet hours and rate limits). Today review only happens if he opens the tab.
18. Voice retraction: "forget that" / "that's wrong" has no path. Today only Keep/Wrong in the app and belief
    verdicts exist. Needs a deterministic parser like `remember.py`, and an undo for a supersession.
19. A facts screen: list, edit, retire told facts and corrections. The prompt keeps the newest 40 told + 30
    corrections and silently drops the rest; nothing shows him the budget.
20. Re-verification: facts carry no "last confirmed". Ask again about anything older than N months, the way
    beliefs carry an era. Keep the answer as an era change, never a delete.
21. Measure the rule judge's false-supersede rate (it fires on a shared named entity when Ollama is down) and
    make "Wrong" on a superseding memory restore the old one.
22. The "good" flag by voice ("nice one", "exactly") → style exemplar. Today 1 exemplar exists; the fine-tune
    route needs 300+ and stays parked until then.
23. Learned preferences should reach Well Wisher's Life/Study engines (sleep, music, study hours he states by
    voice). That is the "assistant → well wisher" step the vision names.

**D. Importers (the sources the vision names: ChatGPT, Instagram, WhatsApp, Brave)**
24. ChatGPT importer: his own messages into the archive as a `chatgpt` thread family (dated, searchable) and into
    `distill` (years of questions = interests and projects). Reader exists; importer and a test on a synthetic
    export are the work.
25. WhatsApp: no reader. Per-chat `.txt` exports (one regex per locale line format) → the same archive, people and
    tie-strength path. Assumption to check with him: most close people are on WhatsApp, so today's closeness
    ranking is biased by source.
26. Brave: local History SQLite and Bookmarks JSON, zero export friction → a taste/topics-over-time source.
27. Spotify / YouTube Music → taste. Readers exist; the taste importer does not. Plays are a cleaner taste signal
    than Instagram captions (artists, eras, skips).
28. Refresh cadence: a monthly "export is N days old" line on the import card, and `refresh_memory --quick`
    scheduled (Task Scheduler) with its report line in NOW.md.
29. The Library (study notes RAG) should serve Well Wisher's Reader: "ask my notes" from the Study tab; it is the
    same chunker and gate already tested at 17 s per eval run.

**E. People and taste**
30. Tie strength was validated once against the Close Friends list (AUC 0.77, P@20 95 %), and the supervised fit
    disagreed with the hypothesis on reel-sharing. Expose the seven weights in the UI, or refit on the labels.
31. Alias editor: a spoken name → a person, editable; today resolution is fuzzy over the top 100 only.
32. Taste trajectory by year is computed and reaches conversation only as beliefs: add a recall path for "what
    was I into in 2022".
33. People and taste never rebuild (last 10-09): tie them to the refresh in 28.

**F. Engineering hygiene**
34. One embedder, not three: core, the app's learner and the Library each load bge-small + torch (about 700 MB
    private bytes in the app per the 10-15 note). ONNX Runtime for bge-small, or one shared embedding call over
    the local server.
35. One `remember` intent parser: `remember.py` (named facts) and `chat_memory.handle_command` (bare "remember
    that.") are two parsers for one intent.
36. One Hinglish stop list and stemmer: recall, chat_memory, people and taste each keep their own.
37. Re-measure per-turn assembly latency with the learned block in place (0.29 s median was before it).
38. A live-eval runbook: `pytest -m live` on the real stores with the output pasted into the private research
    file each time, so the quoted numbers stop going stale.
39. Privacy test for payloads: `/api/memory/search` and `/api/galaxy` never return more than k excerpts or the
    full text of a node without a click.
40. Unify the memory record (claim, kind, confidence, era, evidence, status, source) across the three stores. The
    biggest refactor here; everything in C becomes simpler after it.

**G. Bigger bets (after the exams)**
41. Nightly consolidation: refresh --quick, distill new messages, learn_chats backfill, re-verification
    questions queued, one report line.
42. Proactive memory: "you told me X last week" or "a year ago today" once a day, hedged, inside quiet hours,
    through the crew's event feed that already exists.
43. QLoRA on the 4B for the butler voice, only when 300+ flagged exchanges exist and an A/B shows the in-context
    route failing at tone (the 10-14 note's conditions).

### Order for the exam-season budget (3 h/week, bug-sized until 5 Nov)
A1, A2, A3, A5, A7 (each ≤20 min) → A4 (one distill run + a 15-minute review by him) → B8 (measure) → B9 →
C15, C16, C18 → D24, D27 → F34. The unification (F40) and importers for WhatsApp/Brave wait for after 29 Nov.

### Verified vs assumed
Verified: every count above; the three unmounted components; the dead voice rows; the empty belief queue; the
mojibake source; tests green. Assumed: that distilling his archive yields beliefs worth asking (the 10-14 note
warns the 4B writes weak ones); that WhatsApp holds his closest people; that ONNX bge-small matches the torch
embeddings closely enough to keep the measured gates (must be re-measured on the control queries).

### Sources
- Code: `yaadash/*.py`, `core/agent.py` (hooks at the persona, the command stage and the context assembly),
  `app/jarvis_app/{memory,imports,routes_library,routes_galaxy}.py`, `crew/agents/learner.py`,
  `app/ui/src/pages/Yaadash.tsx`, `app/ui/src/components/{MemoryGalaxy,GrowthChart,LibraryPanel}.tsx`.
- Records: `docs/DECISIONS.md` (2026-08-31, 2026-10-09 memory v3 and "every fact always"), the three notes
  linked at the top, `docs/ROADMAP.md` (Memory line), `data/notes/NOW.md` §1-§4.
- Store counts: LanceDB tables `memories`, `beliefs`, `archive_windows`; `data/yaadash/learned/*.json`.

### What it changed
Nothing in code yet. This file is the running Yaadash topic file from now on (CLAUDE.md: one file per topic),
with the list above as the backlog to tick off in NOW.md.
