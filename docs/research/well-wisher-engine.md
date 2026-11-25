# Well Wisher engine lane: research and measurements

The running research file of the engine lane (the Python side of Well Wisher). Newest section on top. The plan it serves is `docs/design/well-wisher-engine-plan.md`; the screens are the UI lane's (`docs/research/product-design-overhaul.md`).

## 2026-11-25: Word papers into the paper desk, and marks that stand in a heading

**Question.** The owner's internal test papers and their solutions are Word files, and the paper desk read PDF only. Can they be read with pages and crops, without a new dependency, and does the reader then find their marks?

**Method.** All counts are from the files pulled from Classroom on 22 Nov, read into scratch stores, never the real one; only counts and frame lines were looked at. Kinds on file: 93 PDF papers, 24 `.docx` papers, 1 `.doc` paper; among notes 89 `.docx` and 28 `.doc`.

**Found.**

| | Before | After |
| --- | --- | --- |
| Word papers the desk could read | 0 of 25 | 24 of 25 (Word dropped the connection on one; it says so) |
| Time to print one to PDF with the local Word | - | 0.7 to 4.5 s, after a first start of 29 s |
| Questions in the 25 Word papers, with marks | 3 of 614 | 248 of 686; 10 papers are fully marked. The rest are question banks and assignment lists that print no marks |
| The 93 PDF papers: every question with marks | 1 | 20 |
| The 93 PDF papers: some marks / none / no question / scans | 17 / 45 / 11 / 13 | 15 / 28 / 11 / 13 |

- Why Word and not a parser: the desk is crop-first, and a `.docx` has no pages until something lays it out. These papers carry figures, equations (18 in one) and up to 25 tables. Word prints them as they print on paper; `python-docx` would give text with no place on a page. LibreOffice is not installed. No Python package is added: `ww_pyq/word.py` starts PowerShell with a fixed script and passes two paths as arguments.
- Why the marks were missing: in both layouts seen the marks are not in the table. One prints "PART A: ANSWER ALL THE QUESTIONS Each question carries 1 mark 4x1=4" above a table of question, CO and BL columns. The other prints "2. Attempt any three of the following: 10*3 = 30" above a table of "(a) | text | CO" rows, so the question number is outside the table too. The old reader took those instruction lines for questions.
- The marks rule (`ww_pyq/heads.py`): "each question carries N" is N; "a x b = t" must multiply out, and the marks factor is the one printed with M, or the other one when a Q is printed, or the one that is not the number to attempt (ALL means the questions under the heading, an OR pair counting once). A heading that gives a range, does not multiply out, or disagrees with itself gives nothing, with a trace line. Marks a question prints itself are kept.
- A watermark printed across some pages garbles the table header ("E / . / Questions 2 5"): such a table is still read by its rows (most start with a bare "(a)" and a sentence), and the last digit is dropped because it cannot be told whether it is a CO or a BL.
- A question that is only a picture (a circuit with "OR" between two pictures) arrives with no text and `text_status: "none"`: the crop is the question.

**Measured.** New tests: `test_pyq_heads.py` 34, `test_pyq_word.py` 14 and 1 opt-in real conversion (passed here in 28 s), `test_gcr_doc_notes.py` 3. The reader's earlier tests are unchanged and pass (65), as do the routes and the Google link's tests (111 and 94). The app suite's figure is in the log line of the push.

**Safety of the Word route.** A private copy is printed in a folder made for that call; Word runs hidden, in its own process, macros forced off, read only, with no dialogs; a `.docx` is checked as a zip first (declared size and part count); the call ends after 120 s and then exactly the Word it started is ended by process id. Left as it is: Word still parses a file from someone else, as PyMuPDF does a PDF.

**Not verified.** No Word paper was accepted and turned into a practice paper end to end in the real store: the counts come from scratch stores. The 13 scanned papers still give nothing (OCR is next). Two PDFs print rules the reader does not know and stay unmarked. The `.doc` notes were tested with a fake printer; the 28 real `.doc` notes are made at the next sync.

**Sources.** The trial scripts and their counts (private scratch, 25 Nov); the files stay in the private data folder.

**What it changed.** `ww_pyq/heads.py` (new), `segment.py` and `ingest.py` (part headings, rule lines, `ingest_word`), `ww_pyq/word.py` and `word_to_pdf.ps1` (new), `folder.py`, `routes_ww_pyq_ingest.py`, `routes_ww_gcr.py` (G-13 and the automatic hand-off take Word files), `ww_gcr/sync.py` (`.doc` notes). Plan 9.0 has the dated line for the UI lane.

## 2026-11-22 (evening): the Google link after an independent review

**Question.** An independent review of the Google link (`app/jarvis_app/ww_gcr/`, `routes_ww_gcr.py`) found ways to lose his hand edits, to end a whole run on one bad file, to show counts that were not true, and to trust names and ids from Google. Can each be closed with a test that fails on the old code, without changing the route contract the UI codes against?

**Fixed, each with the failure it prevents** (numbers are the review's):
- A1 One re-entrant lock per store folder for the whole process, and `GcrStore.update(fn)`. Before, the routes built a store per request, so its lock protected nothing.
- A2 The sync writes one course record, one file record or the run's faults onto a freshly read manifest, never a whole copy loaded at the start. A kind or subject set by hand and a `paper_id` written during a run were silently reverted. PATCH is no longer 409 during a sync; one file is on its way to the paper desk at most once (a set, checked and marked under one lock), and a sync is 409 only while a hand-off is in flight.
- A3 A damaged manifest is moved to `manifest.json.bad-<UTC time>`, and `ManifestError` carries a sentence; every route answers `fault` with it. Before, any read error returned a blank manifest, and the next save wrote it over the real one. Only the sync may rebuild from blank; a hand edit in that state is a fault, not a one-line manifest.
- A4 Unique temporary file per write, flushed and fsynced, then `os.replace` up to 10 times 50 ms apart on PermissionError (the note writer and the download too). Before, two writers shared `manifest.json.tmp`, and a reader's open handle on Windows ended the whole sync. A download that still cannot take its name is a fault of that one file ("open in another program").
- B5 A dropped connection or a refused disk is a fault of that file; an unexpected error is a fault of that course; an account that fails does not stop the next one, and the job is `failed` only when every account failed.
- B6 Each file record is saved as soon as it is fetched: a run that dies keeps what it fetched.
- B7 A `fetched` event after a successful fetch; the job counts only those, and a failed run reports the real partial counts. A run that failed after starting 4 fetches and finishing 2 showed 4; it shows 2. `files` counts unique ids.
- B8 A stop leaves every loop (the attachment loop kept calling Google), the job ends `stopped` with "Stopped before it finished.", and `synced_at` is left as it was.
- B9 A 401 forgets the account's cached token, gets a new one and retries once. Before, a rejected token was reused for up to 3000 s. `GoogleApi(token=..., transport=...)` still works; `on_unauthorized` is the new seam.
- B10 After `invalid_grant`, the status is `fault` with the revoked/7-day sentence until a connect or a refresh succeeds. Before, it said `live` from the credential store alone.
- B11 The files route counts any live account as connected, not only the main one.
- C12 A name gives an extension only from a closed list of 26 document, picture and archive types; anything else is `bin`. "Notes v1.5 final" gave `5final`, and `lecture.exe` would have been saved as `.exe`.
- C13 Every download gets the Mark of the Web (`:Zone.Identifier`, ZoneId=3), so Word and PowerPoint open it in Protected View. Ignored where there are no streams; skipped off Windows.
- C14 One Drive file attached in two courses or posts stays with the first; the other places go to `also_in`. Before, it was downloaded into both folders and its record flipped between them on every run.
- C15 A failed re-fetch keeps the good copy, its note and its `modified`; state stays `live`, `stale: true`, and the reason says the newer version could not be fetched. Before, path and note were wiped.
- C16 `exportSizeLimitExceeded` reads "Too large for Google to export as PDF (over 10 MB): open it in Google Drive." A lasting refusal (403, 404, 413) is not asked again until the file's `modified` changes.
- C17 Shortcuts are followed one hop; a Form, Site, Map, Jamboard or any other non-exportable Google type is a link of the course, not a download.
- C18 Folder listings are `orderBy: name` (the cap keeps the same files every run), and a fault line says when the 200-file cap or the two-level depth cut a folder short.
- C19 Drive ids are checked against `_SAFE_ID` at every entry (attachment, shortcut target, folder, child); course ids against the same alphabet. An id that fails is skipped with a fault line and never reaches a path or a URL.
- C20 Titles, course and post names, and section headings in a note are one line: a newline can no longer end the front matter or add a heading.
- D21 The hand-off waits at most 10 minutes for the paper desk and honours the stop event. The thread starts inside the try, so the mark is always released. Before, a desk job stuck in `running` made every later sync 409 until the app restarted.
- D22 A file that already has a `paper_id` answers "Already at the paper desk." with that id, and nothing is sent again.
- E23 An offline disconnect still forgets the token here and says so ("Forgotten on this PC. Google could not be told..."); the account's index entry goes even when deleting the secret fails.
- E24 `{"courses": []}` is a 400 with a sentence. Before, it was read as "all courses".
- E25 The docstrings now say the status carries the short names he chose, never an address.

**Measured.** `test_gcr_core.py`, `test_gcr_routes.py` and `test_ww_gate.py`: 85 passed (as before). The new `test_gcr_integrity.py`: 38 passed; the same 38 run against the committed code: 35 failed and 3 errored (fixtures that need the new in-memory failure record), so every one pins a real fault. All four files: 123 passed in 37 s. One manifest update with 1000 files (481 KB, read, write and fsync) takes 43 ms, so one save per fetched file costs less than the download it follows, and an unchanged file is not saved at all.

**Tests changed on purpose.** In `test_gcr_core`, the file whose owner forbids downloads is no longer fetched again on the second run (C16), and the fake now answers `shortcutDetails` and `webViewLink`. In `test_gcr_routes`, a PATCH during a sync is 200 or 404, not 409 (A2), and the file item has two new fields, `stale` and `also_in`. No field was removed or renamed; the job status `stopped` is new, and G-05 shows it as state `waiting`.

**Chosen not to fix, and why.**
- Course ids are checked with the Drive alphabet but a length of 1 to 120, not `_SAFE_ID`'s 6 to 120. The real ids are 12 to 13 digits, the fixture's are 4, and the danger is the characters, not the length.
- Only lasting refusals skip the retry. A 429, a 5xx, a dropped connection or a busy disk is asked again on the next run, because waiting is what cures those.
- The "set aside" fault is remembered in memory. After an app restart, a set-aside manifest reads as "no course read yet"; the damaged copy stays on disk next to it.
- A revoke answered with 400 counts as told: Google already holds that token as dead, so there is nothing left for him to remove.
- There is still no stop route: only the app's shutdown sets the stop event.
- Notes are now written with LF line endings (text mode on Windows wrote CRLF before). Every reader here handles both.

**What the list missed, now fixed too.** The note writer had the same fixed `.tmp` name and single replace, and its OSError would have ended the run. A failed fetch that recorded Google's newer `modified` would have made the next run call a never-fetched version "unchanged"; the record keeps the copy's `modified` and the failed version separately. The sync's own end-of-run hand-off and a hand press on the same file could both send it; both now go through the same set.

**Open.** Nothing was run against the real Google or his store: only the fake. Two accounts that both see one file now fetch it once (one `seen` set per run), but which account fetches it depends on the order of the accounts.

## 2026-11-22 (later): the Google link's routes

**Question.** The core of the Google link (sign-in, Classroom reading, a sync to disk) had no door. Can the UI reach it through one contract, can a Classroom test paper reach the paper desk without a second ingest path, and can the audit sandbox be kept from signing in?

**Built.** `app/jarvis_app/routes_ww_gcr.py` (auto-mounted), routes G-01 to G-13 under `/api/mission/gcr`, the table in its docstring; two lines in `ww_check.py` and `ww_sandbox.py`; `tests/test_gcr_routes.py`.
- One sign-in thread and one sync thread, each 409 on a second start. A failed sign-in keeps its sentence and G-01 shows it as `fault` until the next Connect. A sign-in that dies at the start of a sync ends the job `failed` with its sentence.
- G-13 calls the existing `IngestJob` of the paper desk (`app.state.pyq_ingest`, or a private one when that feature is not mounted), so the two doors share one lock and one 409. A thread waits for the job and writes `paper_id` on the file record. A paper the rule found is sent the same way at the end of a sync, one after another, counted as `papers_sent`; one that fails is a line in `fault_lines` and the rest go on.
- `JARVIS_GOOGLE=off` makes every route answer `planned` with one reason and Connect and Sync 400. The sandbox sets it and no longer copies `gcr/` (originals can be gigabytes).
- G-12 opens a file only when its extension is on a closed list of 11 document types; a manifest line naming an `.exe` is 400 and the opener is not called.

**Measured.** `tests/test_gcr_routes.py` 25 passed; with `test_gcr_core.py` (21) 46 passed. With `test_ww_gate.py` and every `test_pyq_*.py`: 352 passed in 88 s. `ww_check_pyq`: ok, 7 functions checked twice. `check_requirements.py`: OK (no new dependency). The route gate (`ww_check.route_drift`) reports no doc row without a route and no UI call without a route.

**What surprised me.**
- The route gate reads docstring tables only from a fixed file list (`DOC_FILES`); a new routes file is silently outside it until added. Added `routes_ww_gcr.py` explicitly.
- Starlette's `FileResponse(filename=...)` writes `filename*=utf-8''...` as soon as the name has a space, not the plain quoted name the contract asks for; the header is now built by hand from an ASCII-only name.
- An empty id (`PATCH /files/`) lands on the list route's address and answers 405, not 404; nothing is written either way, and the test says so.
- The sync thread writes the whole manifest after every course, so a hand edit (G-07, G-09) or a G-13 write during a run would be lost. They are 409 while a sync runs, and a sync is 409 while a hand-off is pending. That is a limit, not a feature: two writers of one JSON file.

**Open.** Counts shown while a sync runs are approximations from its events (courses read, files being fetched); the real counts replace them when it ends. A sign-in cannot be cancelled while its browser tab waits (it times out at 300 s). Original bytes are served by the same app that holds the token header, so an iframe or new tab on G-11 needs the UI's own way of sending the token; not tested here. Nothing was run against the real Google: only the fake.

## 2026-11-22: the first real papers through the reader, and a table grammar for them

**Question.** The exam slice was proved on invented papers only. Does the reader work on the owner's real past papers, and can a practice paper be planned from one?

**Method.** The 16 end-semester papers already in the private data folder (one university, three sittings, 11 courses) were read with `ingest_file` into a scratch store, never the real one. Counted per paper: questions, questions with marks, the sum of marks, sections. One paper's drafts and PyMuPDF's own table rows were printed side by side.

**Found.**

| | Before | After |
| --- | --- | --- |
| Papers with no text layer (scans) | 5 of 16, 0 questions | the same: the scan package (X04) was planned and never built |
| Text-layer papers | 11 | 11 |
| Questions read | 121 (11 a paper), text scrambled | 220 (20 a paper) |
| Questions with marks | 1 of 121 | 220 of 220 |
| Sum of marks a paper | 0 | 105 (5 of 2, 10 of 7 in OR pairs, 5 of 5), which is the paper's 60 once the choices are taken |
| Blueprint inferred from each paper | none possible | on 9 of 11: A 5 of 5 at 2, B 5 of 10 at 7, C 3 of 5 at 5, total 60, no issue; the other 2 raise one issue each (see below) |
| Time a paper | 0.8 to 2.6 s | 1.0 to 2.4 s |

- Why it failed: these papers are ruled tables with no header that names a marks column, so `read_tables` called each "not a question table" and the line reader then walked through the table cells in reading order. A question had no marks, so it could not be accepted: the chain stopped at its second step for every real paper.
- The layout: an instruction row heads each group ("1. | Attempt ALL questions in brief. | 2 x 5 = 10 | BL | CO"); the rows under it are lettered parts, with an OR row between alternatives; the last section is whole numbered questions under an unnumbered instruction row. PyMuPDF's `find_tables` already returned these rows cleanly.
- The marks rule: the arithmetic is marks times count on the papers seen ("7 x 1 = 07" is one question of 7), but the order is not relied on. The factor equal to the number to attempt (ALL means every item under the row) is the count; anything that does not multiply out or fits neither way stays missing with a trace line. Never guessed.
- Three faults met on the real papers and fixed, each with a test on an invented paper: a table cut by a page break comes back with other columns (6 became 5, the label "b." became "b"), which lost one question on 6 papers; in one paper the cut-off piece had swallowed the data table of the question above it (9 columns); and data tables inside statistics questions (rows of x and f) gave 7 false questions on 3 papers until tables with no instruction row were left alone.
- Each item is one question ("1a", "2b", "7") with its own crop, CO and Bloom level, so a two-mark part can be practised alone. Formula text comes out flattened; the crop is what the student reads.

**What it changed.** `app/jarvis_app/ww_pyq/segment.py` (the instruction-table grammar, `close_tables`), `ingest.py` (one state kept across pages, marks set before stitching, a table row takes no loose lines), `app/tests/test_pyq_instruction_tables.py` (12 tests). Existing paper tests: 243 of 243 unchanged.

**Left open.** Scans: 5 of the 16 papers give nothing until OCR exists. Two papers print "Max. Marks: 100" over a frame whose own arithmetic gives 60 attempted: the papers disagree with themselves, the reader reports the printed 100, and a blueprint inferred from either will say so. Only one university's layout was seen; other layouts keep the old paths. Source: the trial script and its counts (private scratch, 22 Nov); the papers themselves stay in the private data folder.

## 2026-11-14 (night): wave EW7 built, what it measured and what its reviews found

**Question.** Does the exam slice work end to end on invented papers, how fast is it, and what did independent review find that the builders missed?

**How it was built.** Five packages in two stages, each in its own git worktree, a builder then a reviewer (one deliberate mutation each), and a security reviewer for the two packages that read files from typed paths or return HTML. 13 agents in all, about 23 minutes for stage 1 and 60 for stage 2. Agents did not run git; the integrator committed, squashed and pushed.

**Numbers.**

| What | Result |
|---|---|
| Tests added by the wave | E05 51, C01 194, E06 87, E07 70, E08 78, the end-to-end slice test 1, the state-file tool 5 |
| Segmentation on ten invented fixture papers (plain, sections, a ruled table with CO and BL, multi-page, OR pairs, sub-parts, a page with no text layer, a slide-deck PDF, five ways of printing marks, MCQ types) | Question count equals the hand count on 10 of 10; printed marks found on 48 of 48; the one question with no printed marks reads missing, not a guess |
| Ingest speed, 20-page fixture (100 questions), this laptop while other builds ran | 2.29, 2.77, 2.29 s: 114 to 138 ms a page. Per page: PNG encode 70 to 110 ms, pixmap 28 ms, crop save about 6 ms each, text 0.8 ms; `find_tables` (61 ms) runs only on pages with drawn lines |
| Ingest memory | Traced Python peak 6.8 MB for 20 pages (one 150 dpi page image at a time); process peak 98 MB with the libraries. MuPDF's own allocations are not seen by tracemalloc |
| What made ingest 5 times faster | 12.0 s to 2.3 s: 7.1 s was 100 calls of `Store.set_crop`, each rewriting the questions file. The ingest now names each crop before one `add_questions` write |
| Patterns | 500 questions over 20 papers in 0.42 s; 7 pure functions give the same answer twice |
| Generator | 2 ms a paper; a question attempted in the last 14 days appears in 0.33 of the papers its unattempted twin appears in (200 seeds; the target weight is 0.3) |
| Full app suite before the wave, after stage 1, after stage 2 | 1603, 1848, then the figure in the log line of the push |
| Mutations | 5 of 5 caught by a test that existed (one reviewer's first mutation was behaviourally equivalent over HTTP and was replaced) |

**What review found that the builders had not** (each is now a test).

1. The store built a paper id from an unchecked file hash, and a draft could arrive already accepted (E05 reviewer).
2. An upload named after a Windows device (`nul.pdf`, `com1.pptx`) would have sent the bytes to the device (E06 reviewer).
3. The path route called `exists()` on whatever was typed. On Windows a network name there opens a connection to that host and offers the login to it. Network and device paths are now refused before any file call (E06 security).
4. No limit on a PDF's page count or page size: one 14000 pt page would have drawn 2.5 GB at 150 dpi (E06 security).
5. A slide deck is a zip: one that declares hundreds of megabytes went straight to the reader (E06 security).
6. A blueprint with three million questions in a section balanced and matched the exam's maximum, so the generator tried to build it and hung (E08 security).
7. `0e999999` as an answer raised an overflow in the numeric check (E08 security).

**What a builder decided differently from the plan, and kept.** The ingest does not pass PDFs through `yaadash.library.extract`: its "at least 3 words" test is weaker than the specification's (40 characters, 80 percent word-like tokens), and a second parse doubled the time. Slide decks do go through it. The pattern floor counts accepted questions that have a topic, not all accepted ones, because a pattern is counted per topic; the waiting sentence says how many have none.

**Not verified.** No real paper has been read. The fixtures are invented and drawn by the same library that reads them, so 10 of 10 is the easy case: real papers bring two columns, headers and footers, mixed fonts, scanned pages and maths. A two-column paper is known to merge. The tag thresholds (0.25 score, 0.15 margin) have no accuracy figure until hand tags exist to compare with.

**Sources.** The agents' structured reports (workflows wf_3d16c161-145 and wf_60f545e6-d32) and the reruns by the reviewers and the integrator; the code under `app/jarvis_app/ww_pyq/`.

**What it changed.** The plan file: section 9.0 (thirteen notes for the UI lane, no path changed) and 9.1.9 (the outcome). Next: wave EW8 (OCR, column detection, variants and rubric drafts, the intake store, the harvester core, the archive door, the exam-path test).

## 2026-11-14: the audit before wave EW7 (the exam slice), and two checks that were already red

**Question.** What do the existing modules give the exam slice, where would a new package duplicate them, and is the base green before the lane starts?

**What was read.** `ww_bank_store.py`, `ww_generator.py`, `ww_harvest.py`, `ww_numericals.py`, `ww_exams.py`, `yaadash/library.py`, `routes_library.py`, `routes_mission.py`, `routes_ww_mastery.py`, `germoney.Plan.practice_paper` and `paper_marks`, `server.register_feature_routes`, `app/tests/conftest.py`, `ww_check.py` (the route-drift patterns), and the specification's sections 15.6, 20.7.9, 21.3, 21.10 and the Appendix A blocks of E05 to E08, C01 and M01.

**Findings (each one changed the plan, section 9.1 of the plan file).**

1. **The generator already takes a bank as an argument.** `ww_generator.generate(exam, bank, units, states, marks, seed, tier)` is pure and adds the disk bank and the numerical templates itself. A blueprint is the exam row's `pattern` list plus validation, so the new generator is a wrapper, not a second generator. It drops unknown keys, so a crop is joined back by question id.
2. **The bank store refuses his own papers by design.** `ww_bank_store` accepts verbatim text only with an open licence. Accepted questions from his own papers therefore stay in a private store and reach the generator through the `bank` argument. `ww_bank_store` is not edited.
3. **Marks cannot be filed for a new kind of question id.** `Plan.paper_marks` knows three id families (typed bank, disk bank, numerical templates). One optional argument (`extra_bank`) is the smallest change that lets a paper built from his own questions be marked through the existing proficiency loop.
4. **The library extractor gives text without positions.** `yaadash.library.extract` returns page text, slide text and the lists of scanned and blank pages. Crops need block positions, so the ingest reads geometry with PyMuPDF directly and calls `extract` only for slide decks and for the scanned-page verdict.
5. **`guess_marks` guesses.** Its fallback maps text length onto 2, 5 or 7 marks. For his own papers a guessed mark would be a made-up number, so the ingest uses only the explicit pattern and leaves marks missing; a question with missing marks cannot be accepted.
6. **The harvester still shells out to `pdftotext`.** The ingest exports `read_pdf_text` (PyMuPDF) so the harvester core can switch to it in EW8 and there is one PDF reader.
7. **The syllabus has no keyword list per topic.** `subject["units"]` is `[{n, title, exam_weight, topics: [str]}]`. Rule tagging scores a question against the words of each topic and its unit title.
8. **A tracked file names an institution.** `ww_generator.py` does, in its docstring and in the `source` strings of `effective_pattern`. It predates the rule; the lane rewords it in a later commit with the tests that pin those strings.

**Numbers.**

| What | Result |
|---|---|
| The flaky settings test the UI lane reported (request 1 on the board): `imports.status()` sorted a folder by `stat()` while the copy thread renamed its `.part` file | The UI lane saw 2 failures in 7 runs. After skipping temporary names before any `stat` and tolerating a vanished file: 8 of 8 runs pass (42 tests each, 8 to 79 s a run on a busy laptop). Eight runs do not prove a race is gone; the cause named in the request is removed |
| Root privacy and commit tests on `origin/main` (d0be389), before any engine work | 24 pass, 1 fails: `test_no_commit_carries_ai_attribution` finds commit `efe496f` (9 Nov, a docs commit) with an attribution trailer. It is in pushed history; removing it means rewriting history, which is the owner's call. The lane checks its own commits with `tests/check_commits.py origin/main..HEAD` |
| `requirements/check_requirements.py` on `origin/main` | NOT OK: `lxml` (imported by `ww_harvest.py`) and `sympy` (imported by `ww_numericals.py`) were not listed. Both are installed (lxml 6.1.1, sympy 1.13.1) and are now pinned in `requirements.gpu.txt` |
| Installed versions the exam slice builds on | Python 3.11.9, PyMuPDF 1.28.0, python-pptx 1.0.2, `python-multipart` present |

**Not verified.** No real paper has been read yet: every threshold in the plan (the 40-character and 80 percent text-layer test, the 12 pt margin, the 0.25 score and 0.15 margin for a rule tag, the floors of 3 papers and 20 questions) is an assumption from the specification, to be tuned on his real papers after the slice works on invented ones.

**Sources.** The repository files named above; the specification `docs/design/jarvis-product-overhaul.md`.

**What it changed.** Section 9.1 of the plan file: the wave's packages, the shared schema (`app/jarvis_app/ww_pyq/schema.py`), the response envelope (`ww_pyq/api.py`) and the route contracts R-01 to R-27.
