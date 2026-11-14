# Well Wisher engine lane: the plan the engine loop runs from

This file is the working plan of the **engine lane**: the Python side of Well Wisher (the exam question engine, the intake and harvest of study material, the Google Classroom and Calendar link, and the engines behind Life, Tree and Career). It is owned and edited by the engine lane's chat. The **UI lane** (the programme chat) owns `app/ui/**` and reads this file for route contracts. What the features are for, and how they look, is in `docs/design/jarvis-product-overhaul.md` (section 20, and section 21 once merged); where the two differ on scope, the specification governs and this file is corrected; on route shapes and engine packages, this file governs.

The loop that runs this lane re-reads this file at every iteration, picks the next unbuilt slice in section 3, plans it into packages in section 9, builds them with agents, verifies, merges, and writes the result back here.

## 1. Why this lane exists and what comes first

The owner needs the app for a real exam season. The first features, in his words, are the exam generator and the Google Classroom connector, and they are built **beside** the UI overhaul, not after it, because their files do not overlap.

Order of value (each slice must work end to end before the next starts):

| Slice | The student can | Needs |
|---|---|---|
| **A. Exam slice** | drop PDFs with a text layer and slide decks into a folder; get questions segmented by rule, each with a page crop; accept, edit or reject them; tag unit, topic, type, marks; confirm a paper blueprint; generate a practice paper from the reviewed questions, the existing bank and the numerical templates; print the paper and its key; type marks back in | nothing new from the owner |
| **B. Scans** | the same for scanned or photographed pages, with all recognised text marked unverified until he confirms it | RapidOCR on the GPU (approved) |
| **C. Manual intake** | bring deadlines and course files in without any account: a folder drop, a pasted list, a calendar file; map each course to a subject; see deadlines on the Life calendar | nothing new from the owner |
| **D. Harvest** | have public previous-year papers fetched politely into the local store by per-source adapters (the university's public question-paper site, national entrance and aptitude exams), with a manifest of what came from where; a manual drop-in is always possible | source list confirmed by the owner |
| **E. Google link** | sign in himself in the browser; Classroom courses, coursework, materials and announcements synced read-only; a calendar link; disconnect and delete | the owner's OAuth client (section 8) |
| **F. Depth** | pattern statistics across years, "next three" suggestions, model-drafted variants reviewed before they enter the bank, rubric marking he confirms, timed attempts, spaced review, a readiness ledger and a "tonight" list | the local model; fsrs (approved) |
| **G. Life engines** | intents and recurrence, logs (body, money, habits), reminder delivery, the evidence ledger, tree and career data | later; planned in the specification |

## 2. What already exists (audited 14 Nov 2026; verify before relying on it)

- **Wiring.** `app/jarvis_app/server.py` builds the app; `register_feature_routes` imports every `jarvis_app/routes_*.py` and calls `register(app, svc, bus)`. A new routes file is mounted by existing. A route module that raises at import is skipped with only a bus event, so a typo shows up as a 404: every new routes file gets a test that its paths answer.
- **Auth.** Every `/api/*` route except health needs the `x-jarvis-token` header and a loopback Host; the phone listener serves only `/api/phone/*`. Anything the phone must reach lives under `/api/phone/`.
- **Storage.** No database in the Well Wisher code: JSON and JSONL files under the data directory (`JARVIS_DATA_DIR`, fixed at import by `paths.py`), written atomically. The question bank (`ww_bank_store.py`) lives under `WW_BANK_DIR` or `<data>/bank/questions/<subject>/*.jsonl`, with records that carry `origin`, `tier`, `unit`, `topic`, `marks`, `source`, `license` and a hash id, and with rules it enforces: a pointer record never carries text; verbatim text needs a recorded open licence.
- **Generator.** `ww_generator.generate(...)` is a pure, seeded paper generator over the bank and the numerical templates (`ww_numericals.py`); no model. It needs unit and topic tags and has no ingestion path.
- **Harvester.** `ww_harvest.py` is off until resumed, polite (one request at a time, robots.txt, a daily stop on 403 or 429), with injected transport for tests and a few open-licence sources. It reads PDFs through an external `pdftotext` binary.
- **Extraction that can be reused.** `yaadash/library.py` already extracts PDF (PyMuPDF), DOCX and PPTX into sections with an OCR hook.
- **Local model.** Only `ww_counsel.py` calls a model: Ollama on loopback, a 4B instruct model by default, JSON output, validated; failures return `no_model` or `unparsed`.
- **Checks.** `ww_check*.py` are the gate scripts (route drift between docstring tables, decorators and UI calls; engine purity; sweeps). `app/tests/conftest.py` forces a scratch data directory and blocks every non-loopback socket and port 8777. Root `tests/` scans tracked files for personal details and commit messages for attribution trailers. `requirements/check_requirements.py` fails on an unlisted import.
- **Machine.** Python 3.11 in `.venv`; an RTX 4050 laptop GPU with 6 GB; PyMuPDF, python-pptx, onnxruntime, keyring, pillow, numpy already installed; RapidOCR, the Google client libraries and fsrs not yet.

## 3. Rules of the lane

1. **Files.** The engine lane owns `app/jarvis_app/**`, `core/**` (only where a package names it), `app/tests/**`, `tools/engine/**`, `requirements/**`, this file, `docs/research/well-wisher-engine.md`, and its own section of the state file. It never edits `app/ui/**`, the specification, the UI lane's research file, or another package's paths. The UI reaches a route through an adapter file the UI lane owns.
2. **The board.** Before building, each package is claimed on the wave comms board (`python tools/wave_comms.py claim ...`); a claim that overlaps another active package in either lane is refused. The bulletin (`python tools/wave_comms.py show`) is pasted, unchanged, at the top of every agent prompt. Questions for the UI lane go through `ask`; nothing is assumed about the other lane that the board does not say.
3. **Honest states.** Every response that carries a value carries its state: `live`, `waiting`, `simulated`, `planned` or `fault`, with a reason. Recognised text is `unverified` until the student confirms it. Model output is a draft with `origin: "model-draft"` and never enters the bank or a mark without his confirmation; the model never grades alone. No route returns a pass probability or a predicted result.
4. **Privacy and licences.** The student's own papers, notes and Classroom material live only under the private data directory; no real paper text, course name, institution name, account name or date enters a tracked file. Test fixtures are invented. Harvest adapters respect robots.txt, rate limits and each source's terms, record the source and licence of every item, and store third-party text only in the private store.
5. **Network.** Nothing uses the network by default. Harvest and Google are opt-in, off until switched on, read-only, and tested with injected fake transports (the test suite blocks real sockets). Credentials are never written to a tracked file or printed: the OAuth client file is placed by the owner under the private data directory, and tokens live in the Windows credential store through keyring.
6. **The running app.** Never touch port 8777 or 8778, never restart the app, never run a gate script or the sandbox against real data without saying so first; tests use scratch data directories.
7. **Git.** Agents never run git write commands (their commit calls can hang): they leave work uncommitted and report a commit message. The lane's orchestrator commits in first person with the measurement and no attribution trailer, rebases on `origin/main`, runs the checks, and pushes.
8. **Installs.** Approved by the owner on 13 Nov 2026: PyMuPDF (present), RapidOCR with onnxruntime on the GPU, `google-api-python-client`, `google-auth-oauthlib`, `keyring` (present), `fsrs`. Each is added to `requirements/requirements.gpu.txt` in the commit that first imports it. Anything else is asked for.
9. **GPU.** 6 GB is shared by the voice stack, the local model and OCR. OCR and the model do not load together; a package that uses either states its peak memory in its record, and a test proves the path works on CPU when the GPU is busy.

## 4. Route contracts (the single source both lanes read)

Conventions for every new route:
- Path under `/api/mission/...` (the existing Well Wisher prefix), and a twin under `/api/phone/ww/...` only when the phone needs it.
- Registered in a `routes_ww_<area>.py` with `@app.get|post|put|delete("...")` decorators inside `register(app, svc, bus)`, listed in the module docstring's route table (the route-drift gate reads both).
- Success is a JSON object with `state`, `reason`, `source` and the payload; a list payload is `items` with `count`. Errors use the existing mapping (404 for an unknown id, 400 for a bad value) with a `detail` sentence.
- Blocking work runs in the thread pool; long jobs return a job id at once and report progress through a status route and a bus event, so the UI answers within 400 ms.

Each contract is written here before the UI builds against it, in this form: id, method and path, request, response example, states, errors, the package that adds it. The first contracts (slice A) are drafted by the lane's first planning iteration and listed in section 9; until a route is merged its row says `planned` and the UI uses a null adapter.

## 5. How a slice is built

1. **Plan.** Read section 9 and the specification's package blocks for the slice. Read the modules to be extended. Write the packages for one wave into section 9: for each, its purpose, the files it owns (disjoint within the wave), the module it extends, its routes with contracts, its acceptance checks and its tests. Prefer extending `ww_bank_store`, `ww_generator`, `ww_harvest` and `yaadash/library.py` to writing a parallel module. Claim the packages on the board.
2. **Build.** One workflow per wave: a builder per package in its own git worktree, then a reviewer per package (code, tests rerun, one mutation, the rules above), with a security reviewer for anything that touches the network, files outside the data directory, or credentials. Builders write tests first for the behaviour in the acceptance checks.
3. **Verify.** On the lane's branch, with real exit codes: the package tests, the full `app` test suite on a scratch data directory, `core` tests when core changed, the gate checks on synthetic data (`tests/test_ww_gate.py`), the root privacy and commit tests, and the requirements check. For a slice, an end-to-end test on invented fixture papers (drop, segment, review, bank, blueprint, paper, marks).
4. **Merge.** Commit per package, rebase on `origin/main`, rerun the suite, push, mark the packages merged on the board, and note it for the UI lane.
5. **Record.** Research and measurements go to `docs/research/well-wisher-engine.md` (newest dated section on top); section 9 of this file gets the wave's outcome; the state file gets one log line.

## 6. Tools

- Project tools: `tools/wave_comms.py` (the board), `python -m pytest` with the commands in the repository's `CLAUDE.md`, the gate scripts `python -m jarvis_app.ww_check_<x>`, `requirements/check_requirements.py`, `python -m jarvis_app.ww_sandbox` on its own port for a manual look.
- Agent tools: the workflow runner with scripts passed inline, subagents for exploration and review, the documentation lookup for library APIs (PyMuPDF, RapidOCR, the Google client libraries, fsrs) before writing against them, web search for a source's terms and robots rules, and the scheduling tool that keeps the loop running.

## 7. Verification standard

A package is done when: its tests fail without it and pass with it; a reviewer's one-line mutation is caught; every route answers and is in the docstring table; every value carries a state; no real socket, real data directory or credential was used in a test; the privacy tests pass; a measured number (time per page, pages per minute, memory) is in the record where speed or memory matters.

## 8. What only the owner can do: the Google sign-in

The classes are in his personal Google account and the Cloud project exists. Still to do, by him, once slice E's code is ready (the app shows these steps too):
1. In the Google Cloud console, under APIs and Services, enable the Google Classroom API and the Google Calendar API.
2. Configure the OAuth consent screen: user type External, publishing status Testing, and add his own account as a test user.
3. Add only read-only scopes: Classroom courses, coursework (his own), course materials and announcements, and Calendar read-only. No Drive scope: files are brought in by his own download.
4. Create credentials: an OAuth client ID of type Desktop app; download its JSON file.
5. Move that file himself into the private data directory at the path the app names on its connect screen. Nobody else opens it.
6. Press Connect in the app and approve in the browser. In testing mode Google may ask for consent again after some days; the app shows the token's state and never hides an expiry.

Until step 6, the connector's control reads PLANNED, then WAITING, and slice C's manual intake does the work.

## 9. Waves (written by the engine lane; newest on top)

### 9.0 Changes to route shapes and shared records (dated; the UI lane reads this at the start of each of its waves)

- 2026-11-14: first issue. Routes R-01 to R-27 and the records of `app/jarvis_app/ww_pyq/schema.py` (schema version 1).
- 2026-11-14 (after stage 1 of EW7; no path or payload name changed): (1) "reviewed questions" in the floor of R-09, R-16 and R-17 means **accepted** questions, because a pattern is counted over accepted questions only; (2) a draft always arrives `pending`, whatever status it carries; (3) setting a question's `text` by hand also sets `text_status: "verified"`; (4) R-06 clamps `limit` to 1..500 and `offset` to 0 or more instead of refusing; (5) a paper's `sha256` must be 64 lowercase hex or it is refused; (6) `Store` also has `update_questions(ids, changes, by)` (all or nothing, used by R-07) and `problems()` (files set aside as corrupt); (7) `parse_ics` returns skipped events in the list with `status: "skipped"` and a note, so C02 filters on `status`.
- 2026-11-14 (after stage 2 of EW7; all 27 routes are live; no path changed; payloads only gained fields): (1) **two floors, said apart.** R-09's `floor_met` counts accepted questions; the pattern floor of R-16 and R-17 counts accepted questions that carry a unit and a topic, because a pattern is counted per topic. `coverage.tagged` is that number, `patterns.n_untagged` the rest, and the waiting sentence says how many accepted questions still have no topic; (2) R-16 adds `topics[].typical_marks` and `patterns.n_untagged`; `patterns.families` lists only families of two or more questions; `years_since` is counted from the newest paper on file, not from today; (3) R-17 adds `footer` and `provisional`, and `gap_minutes` defaults to 60; (4) R-18 items add `held_by_hand` (a hand tag the rule did not touch); (5) R-19, R-20 and R-21 also raise an issue with code `exam_max` when the blueprint's total is not the exam row's maximum, and R-22 refuses such a blueprint; a blueprint is capped at 100 questions a section and 1000 marks (400 beyond); (6) R-22: a seat taken by a question from outside his own bank (a harvested disk-bank row) is emptied, because a slot's `source` is only `hand`, `rule`, `template` or `hollow`; (7) R-12 with `folder: true` and nothing new answers `live` "Nothing new in the folder." with `job: null`; a network or device path is refused with 400 before any file call; (8) R-13: a PDF over 300 pages, a page over 4.5e6 square points, or a deck that declares over 250 MB unzipped fails that file with a reason; (9) R-14 on a question without a page picture (a slide from a `.pptx`) is 404 "No page picture for this question."; (10) R-15 also refuses an empty body, a file whose first bytes are not a PDF or a zip, and a Windows device name; (11) a question with no marks of its own whose sub-parts all print marks gets their sum (`marks_source: "printed"`); (12) R-26 reads a bare number in the key's unit (key `3.3 kohm`, answer `3300` does not match; the note says which unit was read) and refuses an answer over 120 characters; (13) code contract: `Store.add_questions` keeps a well-formed, unused `id` a draft carries (the ingest names crops before the one write); `practise_next` also takes `attempts` and `minutes_per_mark`; `find_families` also takes `years_by_paper`; `Plan.paper_marks` takes `extra_bank`.

- 2026-11-14 (EW8 planned): routes R-28 to R-47 added (section 9.2.5). `schema.py` is version 2: `Question` gains `origin` (`paper`, `hand`, `template`, `model-draft`, `harvest`; a record without it reads as `paper`), `source_question` and `ocr_confidence`. No EW7 path or payload changed.

### 9.2 Wave EW8: scans, drafts, the intake store, the harvester core, the archive door (planned 14 Nov 2026)

**State: building.** One stage: the five packages own disjoint files and each imports EW7's merged code only.

#### 9.2.1 Reconciled with the specification

The specification's EW8 is X04, X07, C02, HV01, E17 and M01. **M01 is folded into the integrator's end-of-wave test**, because `app/tests/test_pyq_slice.py` (EW7) already drives an invented paper from upload to marks; EW8 extends that test with a scanned page through OCR. Differences that govern (D-V3-25):

1. **X04 also detects columns.** A two-column paper merges its columns in EW7 (known gap); X04 owns `segment.py` and `ingest.py` for this wave, so column detection goes with it.
2. **OCR runs on the CPU in EW8.** The installed `onnxruntime` 1.27.0 has no CUDA provider (`AzureExecutionProvider`, `CPUExecutionProvider` only). The GPU build is a different package (`onnxruntime-gpu`) that replaces `onnxruntime`, which the voice stack (`kokoro-onnx`) also uses, so it is not swapped while the app runs; it is the owner's step (section 8 of this file lists it once agreed). X04 asks for the CUDA provider when present and says which device ran.
3. **An accepted deadline is listed, not written into the date sheet.** C02's accepted rows are served by R-38 for the Life calendar; turning one into a date-sheet exam row is a later step with its own confirmation.
4. **E17 keeps its own listing.** A Classroom export is listed by E17 and its accepted entries go into the ingest; they become intake rows when C02 and E17 are joined in EW9.
5. **X07 extends `ww_counsel.py`** (new tasks and their validators) and adds no second model client. Tests use a fake provider; with no model the answer is `waiting` with the reason.

#### 9.2.2 Facts the builders rely on (checked 14 Nov)

- RapidOCR: `rapidocr-onnxruntime` 1.4.4 is installed (with `opencv-python` 5.0.0.93, `pyclipper` 1.4.0, `shapely` 2.2.0; 113 MB for OpenCV, 16 MB for RapidOCR with its models). `from rapidocr_onnxruntime import RapidOCR; eng = RapidOCR(); result, elapse = eng(bgr_image)` gives `[[box, text, confidence], ...]`; the models ship in the wheel, so nothing is downloaded (checked with every socket blocked). One invented 150 dpi page: engine load 3.3 s, 6.3 to 10.7 s a page on the CPU while builds ran, line confidence 0.95 to 0.97, process memory 141 MB.
- `ingest_pdf(..., ocr=None)` already accepts an `ocr` callable and records a page with no text layer as a fault. `yaadash/library.py` has its own OCR hook (`ocr_available`, `_ocr_page`, through Tesseract, which is not installed): X04 makes that hook use the same engine, so the Library and the paper ingest share one OCR.
- `ww_counsel.counsel(task, fields, provider)` loads `prompts/<task>.md` (system and user parts split by `---`), calls the provider, extracts JSON and validates it with `check_output`; failures return `no_model` or `unparsed`. Its tasks today are `grade_explain`, `quiz_from_text`, `parse_day`, `summarise`.
- `ww_harvest.py` holds `SOURCES`, the polite `Harvester` (robots once a day per host, one request at a time, 2 to 5 s apart, a daily stop on 403 or 429, an injected transport for tests), and `pdf_text` through `pdftotext`. `routes_ww_harvest.py` has the queue, sources, pause, resume and run routes.
- `ww_intake` (C01) gives `parse_paste`, `parse_ics` (skipped events come back with `status: "skipped"`) and `match_name`.
- `ww_pyq.ingest.IngestJob` is the one ingest job (one at a time, `Busy` when running); `app.state.pyq_ingest` holds it.

#### 9.2.3 Shared contract (integrator, before the builders)

- `schema.py` version 2: `Question.origin`, `source_question`, `ocr_confidence`; `ORIGINS`. Frozen for the wave.
- Requirements: the integrator pins `rapidocr-onnxruntime==1.4.4` and `opencv-python==5.0.0.93` (and lists `pyclipper` and `shapely` as indirect in `check_requirements.INDIRECT`) in the commit that merges X04, because the check refuses a pin nothing imports yet; no package edits `requirements/`.
- Store layout additions under the private data directory: `pyq/variants/<subject>.json`, `pyq/rubrics/<qid>.json`, `pyq/settings.json`, `pyq/takeout/<id>.json` and `pyq/takeout/<id>.zip`, `intake/rows.json`, `intake/files/` (copies the app owns), `bank/questions/_harvest/manifest.jsonl` (the harvester's existing folder).

#### 9.2.4 Packages

| Pkg | Purpose | Owns | Extends or reuses |
|---|---|---|---|
| **X04** | OCR of scanned pages behind the existing hook, text `unverified` with its confidence; column detection for two-column papers | `ww_pyq/ocr.py`, `ww_pyq/columns.py`, `ww_pyq/ingest.py`, `ww_pyq/segment.py`, `routes_ww_pyq_ocr.py`, `yaadash/library.py` (the OCR hook only), `app/tests/test_pyq_ocr.py`, `app/tests/test_pyq_columns.py` | EW7 ingest and segmentation; the library's hook |
| **X07** | Variants (numerical from templates, descriptive drafted by the local model) and rubric drafts, each pending until he accepts; the rules-only switch | `ww_pyq/variants.py`, `ww_pyq/rubric.py`, `ww_pyq/settings.py`, `routes_ww_pyq_drafts.py`, `ww_counsel.py`, `prompts/variant_descriptive.md`, `prompts/rubric_points.md`, `app/tests/test_pyq_drafts.py`, `app/tests/test_pyq_drafts_routes.py` | `ww_counsel` (tasks and validators), `ww_numericals.make`, E05 `Store` |
| **C02** | The intake store: pasted lines, calendar files and watched-folder files as rows with a state; Take actions; Delete removes only files the app owns | `ww_intake/store.py`, `routes_ww_intake.py`, `app/tests/test_intake_store.py`, `app/tests/test_intake_routes.py` | C01 parsers, E05 folder scan, the ingest job, the library's ingest job |
| **HV01** | Harvester core v2: the adapter interface and registry, the manifest, two switches per source, the rate rules, the drop-in, and PyMuPDF instead of `pdftotext` | `ww_harvest.py`, `ww_harvest_sources/__init__.py`, `routes_ww_harvest.py`, `ww_check_harvest.py`, `app/tests/test_harvest_core.py`, the existing `app/tests/test_ww_harvest.py` and `app/tests/test_harvest_routes.py` where behaviour changes | E06 `read_pdf_text`, the ingest job |
| **E17** | A Classroom export `.zip` he made himself: listed before anything is extracted, path escapes and size refused, accepted entries go to the ingest | `ww_pyq/takeout.py`, `routes_ww_pyq_takeout.py`, `app/tests/test_pyq_takeout.py` | E05 `Store`, the ingest job |

#### 9.2.5 Route contracts (envelope and errors as in section 4 and 9.1.5)

**X04, `routes_ww_pyq_ocr.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-28 | GET `/api/mission/pyq/ocr` | - | `engine: {name, version, device: "cpu"|"cuda", loaded: bool, models_on_disk: bool}`, `last: {pages, seconds_per_page, mean_confidence} or null` | `live` "OCR is ready on the CPU."; `fault` "No OCR engine is installed." | - |

Ingest behaviour (no new route): a page with no text layer is recognised; its questions have `text_status: "unverified"`, `ocr_confidence`, their crop, and the trace line `p3 ocr cpu 0.94 mean, 11 lines`; the paper's `method` is `ocr` or `mixed`; with no engine the page is still a fault and the rest imports. A recognised line below 0.6 confidence is kept in the text with no change but counted in the trace. A page is cut into columns before segmentation when a vertical gap of at least 18 pt runs down at least 70 percent of the text height; reading order is the left column, then the right.

**X07, `routes_ww_pyq_drafts.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-29 | POST `/api/mission/pyq/variants` | `{question_id, count?: 1..3}` | `items: [Variant]` (stored, `status: "pending"`) | `live`; `waiting` "The local model is not running." (descriptive only; numerical variants need no model); `planned` "Variants are off: rules only." when the switch is on | 400 the question has no text or no marks; 404 |
| R-30 | GET `/api/mission/pyq/variants?question=&subject=&status=` | - | `items: [Variant]` | `live`; `waiting` when none | - |
| R-31 | PATCH `/api/mission/pyq/variants/{id}` | `{status: "accepted"|"rejected", text?}` | `variant`, `question` when accepted (a new pending-free question: `status: "accepted"`, `status_by: "hand"`, `origin: "model-draft"` or `"template"`, `source_question`) | `live` | 400 accepting a draft outside the similarity band or with other marks; 404 |
| R-32 | POST `/api/mission/pyq/rubric/{qid}/draft` | - | `rubric: {question_id, points: [{text, marks}], origin: "model-draft", status: "pending", sum}` | `live`; `waiting` no model; `planned` rules only | 400 no marks; 404 |
| R-33 | GET `/api/mission/pyq/rubric/{qid}` | - | `rubric` or null | `live`; `waiting` "No rubric yet." | 404 |
| R-34 | PUT `/api/mission/pyq/rubric/{qid}` | `{points: [{text, marks}]}` | `rubric` with `status: "accepted"`, `origin: "hand"` when he wrote or changed it, else `"model-draft"` kept | `live` | 400 the points do not sum to the question's marks, 1 to 6 points, empty text |
| R-35 | GET and PUT `/api/mission/pyq/settings` | PUT `{rules_only: bool}` | `settings: {rules_only}` | `live` | 400 |

`Variant = {id, question_id, kind: "numerical"|"descriptive", text, marks, topic, unit, origin: "template"|"model-draft", checks: {similarity, band: [0.2, 0.7], marks_equal, topic_equal}, status, made}`. A descriptive draft outside the 5-word-shingle Jaccard band 0.2 to 0.7 is stored as `rejected` by rule with the reason, never offered as pending. The model is never asked for a grade, a numeric answer, a probability or a new topic, and nothing it writes enters the bank or a rubric without his accept.

**C02, `routes_ww_intake.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-36 | GET `/api/mission/intake?state=&source=` | - | `items: [IntakeRow]` | `live`; `waiting` "Nothing brought in yet." | 400 bad state |
| R-37 | POST `/api/mission/intake/paste` | `{text}` (at most 20,000 characters) | `items`: the new rows (`state: "new"`), `unread: [{line, text, reason}]` | `live` | 400 empty or too long |
| R-38 | POST `/api/mission/intake/ics` | raw `text/calendar` body, at most 2 MB | `items`: the new rows; `skipped: n` | `live` | 400 not a calendar; 413 |
| R-39 | PATCH `/api/mission/intake/{id}` | `{state: "accepted"|"declined", title?, date?, time?, subject?}` | `row` | `live` | 400 accepting an ambiguous date without choosing one; 404 |
| R-40 | POST `/api/mission/intake/{id}/take` | `{to: "papers"|"notes"}` (file rows only) | `row` (`state: "taken"`), `job` | `live` | 400 not a file row; 409 a job is running; 404 |
| R-41 | DELETE `/api/mission/intake/{id}` | - | `removed: {row: true, file: bool}` | `live` | 404 |
| R-42 | GET `/api/mission/intake/deadlines?from=&to=` | - | `items: [{id, title, date, time or null, subject, source}]` (accepted rows with a date) | `live`; `waiting` when none | 400 bad date |

`IntakeRow = {id, source: "paste"|"ics"|"folder", kind: "deadline"|"event"|"file", state: "new"|"accepted"|"declined"|"taken", title, date or null, time or null, readings (two when ambiguous), ambiguous: bool, subject or "", subject_suggestion: {subject, score} or null, repeats, file: {name, size, owned: bool} or null, raw_hash, added, updated}`. Folder files appear as rows on read (scan of the chosen folder; no timer). A subject suggestion uses `match_name` at 0.6 or more and is never applied by itself. Delete removes the row, and the file only when it lies under `intake/files/` (a copy the app owns); his own folders are never written.

**HV01, `routes_ww_harvest.py` (existing routes kept)**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-43 | GET `/api/mission/harvest/manifest?source=` | - | `items: [{source, url or "", fetched, bytes, sha256, robots_checked, terms_note, rights, local: path under the data directory or "pointer only", paper_id or null}]` | `live`; `waiting` "Nothing fetched or dropped yet." | - |
| R-44 | PUT `/api/mission/harvest/sources/{id}` | `{on?: bool, local_copy?: bool}` | `source: {id, name, rights, terms_note, on, local_copy, reason}` | `live`; `fault` "This source has no terms note; it stays off." | 400 `local_copy` on while `on` is off, or a source without a terms note; 404 |
| R-45 | POST `/api/mission/harvest/dropin` | `{path}` (an absolute file he downloaded himself, `.pdf`) | `entry` (manifest line, `source: "manual"`), `job` (the ingest) | `live` | 400 bad path (the R-12 rules), 409 |

Rate rules (in the framework, not in adapters): one request at a time, 2 to 5 s apart and at least 3 s per host, 200 a host a day, `robots.txt` read once a day per host and obeyed per path, a conditional request when an ETag or Last-Modified is known, backoff on 429 and 503, a stop for the day on a second 403 or 429. Every source is off; a local copy is a second switch; with every source off the harvester opens no socket.

**E17, `routes_ww_pyq_takeout.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-46 | POST `/api/mission/pyq/takeout` | `{path}` (an absolute `.zip`) or the raw zip body with `?name=` | `listing: {id, name, entries: [{name, size, kind: "pdf"|"pptx"|"other", refused: reason or null}], total_size, note}` | `live`; the note says "Files owned by others may be missing from your export." | 400 not a zip, a whole drive, a network path; 413 over 500 MB |
| R-47 | POST `/api/mission/pyq/takeout/{id}/accept` | `{entries: [name]}` | `job` (the ingest of the accepted entries) | `live` | 400 an entry not in the listing or refused; 404; 409 |

Nothing is extracted before R-47. An entry is refused (listed, never extracted) when its name is absolute, has a drive letter, contains `..`, a backslash path that escapes, a device name, or declares more than 100 MB, or when the archive declares more than 1 GB in all or over 5,000 entries.

#### 9.2.6 Acceptance checks and tests (written first)

**X04.** (1) A three-page fixture whose middle page is a picture of text: the picture page gives questions with `text_status: "unverified"`, confidence, crop and an `ocr` trace line; the two text pages are unchanged. (2) With the engine absent (patched), the picture page is a fault and the other pages import, as in EW7. (3) A two-column fixture: question counts equal the hand count and reading order is left column then right. (4) Single-column fixtures of EW7 are unchanged (their tests pass untouched). (5) The library's OCR hook uses the same engine and a library ingest of the scan gives text. (6) Pages per second, engine load time and process memory are measured and reported; the CPU path is the tested one; with the CUDA provider absent the device reads `cpu`. (7) No socket is opened while the engine loads (the conftest guard).

**X07.** (1) Numerical variants come only from `ww_numericals` templates and have keys. (2) A descriptive draft below 0.2 or above 0.7 similarity is rejected by rule. (3) No draft becomes a question until R-31 accepts it, and the new question carries `origin: "model-draft"` and `source_question`. (4) Rubric points must sum to the question's marks; a model draft that does not is returned with the difference and stays pending. (5) The rules-only switch makes every model path answer `planned` and calls no provider (a counting fake proves it). (6) With no model, `waiting`, never an invented draft. (7) The validators refuse a model answer that carries a grade, a probability or a topic that does not exist.

**C02.** (1) A pasted list and a calendar file become rows in state `new`; nothing reaches the date sheet or the question store until a row is accepted. (2) An ambiguous date cannot be accepted without a choice. (3) Folder files appear as rows and Take starts the ingest or the library ingest. (4) Delete never removes a file outside `intake/files/` (a test with a file in a temporary "his own" folder). (5) The same paste twice adds no duplicate rows (by raw hash). (6) Every route answers and is in the docstring table.

**HV01.** (1) With every source off, zero sockets (the transport is never called). (2) A source without a terms note cannot be switched on. (3) A `robots.txt` disallow stops that path; a second 403 stops the host for the day; 429 backs off. (4) A local copy needs the second switch; without it the manifest says "pointer only" and nothing is stored. (5) A dropped file joins the manifest as `source: "manual"` and enters the ingest. (6) `pdf_text` reads with PyMuPDF through `read_pdf_text`; the old `pdftotext` path is gone and the existing harvester tests pass, changed only where they pinned `pdftotext`. (7) Re-running is idempotent by hash.

**E17.** (1) A fixture zip is listed and nothing is extracted. (2) Entries with `../`, an absolute name, a drive letter or a device name are refused and never extracted. (3) A declared-size bomb is refused before reading. (4) Accepting two entries extracts only those, into the inbox, and starts the ingest. (5) The listing carries the note about files owned by others.

#### 9.2.7 Verification and merge

Each package: builder (tests first), reviewer (reruns, one mutation, contract check), and a security review for X04 (native libraries on hostile images), C02 (file deletion), HV01 (the network), E17 (archives). Then on `engine/main`: package tests, the full `app` suite on a scratch data directory, the gate, root privacy and commit tests, the requirements check, and the extended end-to-end test (a scanned page through OCR).

#### 9.2.8 Outcome

*(written when the wave merges)*

### 9.1 Wave EW7: the exam slice (planned 14 Nov 2026; the takeover note calls it "E1")

**State: merged (14 Nov 2026). All five packages are on main; routes R-01 to R-27 are live.** Stage 1 (E05, C01) first, then stage 2 (E06, E07, E08), because the three stage 2 packages import E05's `Store`.

#### 9.1.1 Reconciled with the specification

The package ids are the specification's (15.6 and the EW7 contract table of Appendix A): **E05** store, **E06** ingest, **E07** tags and patterns, **E08** blueprint and generator, **C01** intake parsers. The paths are the specification's. Where this plan differs, this plan governs (D-V3-25) and the difference is listed here so the UI lane can correct its side:

1. **Marks are never guessed for his own papers.** `ww_harvest.guess_marks` falls back to a guess by text length; E06 uses only its explicit pattern and leaves `marks: null`, `marks_source: "missing"` otherwise. A question with missing marks cannot be accepted.
2. **The folder watch has no background timer in EW7.** The folder is scanned when R-10 is read and when R-12 is called with `folder: true`. A timer inside the running app is a risk this wave does not need.
3. **Routes added to the specification's list:** R-04 and R-05 (edit and remove a paper), R-14 (move a crop's edges), R-15 (a file dropped in the browser has no path, so it is uploaded), R-23 and R-24 (read a generated paper), R-27 (marks for a generated paper). Families travel inside R-16; confirming a family is planned for EW8.
4. **Spaced review is not in EW7** (the specification already moved it to X09, EW9). E08 writes no scheduler.
5. **The gate.** E07 owns a new `ww_check_pyq.py`; the integrator adds its line to `ww_check.report()` after the merge, so no package edits `ww_check.py`.
6. **One existing file is edited:** E08 adds one optional argument to `germoney.Plan.paper_marks` (see E08). `ww_generator.py`, `ww_bank_store.py`, `ww_numericals.py`, `ww_harvest.py` and `yaadash/library.py` are imported and not edited.

#### 9.1.2 What the audit found (14 Nov; facts the builders rely on)

- `ww_generator.generate(exam, bank, units, states, marks, seed, tier, today)` is pure and seeded. It wants `bank` rows with `id`, `question` (text), `unit`, `topic`, `marks`, optional `section`, `tier`, `sitting` or `source`, `type`, `origin`. It adds the on-disk bank (`ww_bank_store.load_for`) and the numerical templates (`ww_numericals.pool`) itself, picks by section letter, then by equal marks, then anything, and reports a `shortfall`. It drops every key it does not know, so a crop is re-joined by question id afterwards. `paper_invariants(paper, exam)` returns the list of broken rules; an empty list is a balanced paper.
- `effective_pattern(exam)` uses `exam["pattern"]` (a list of `{name, questions, attempt, marks}`) when present. **A Blueprint is that list plus validation**, so `generate_paper` calls `generate` with a copy of the exam row whose `pattern` is the blueprint's sections.
- `ww_bank_store` refuses verbatim text without an open licence, which is right for harvested text and wrong for his own papers. So accepted questions stay in the private pyq store and reach the generator through the `bank` argument (`Store.bank_for`).
- `germoney.Plan.paper_marks(exam_id, payload)` looks a question id up in the typed bank, the disk bank and the numerical templates, and refuses any other id. A pyq question id is unknown to it today.
- `yaadash.library.extract(path)` returns `Extracted(kind, title, pages, sections[Section(page, loc, heading, text)], scanned, blank, ocr, notes)`. It gives page text only, no positions. E06 calls it for `.pptx` and for the scanned and blank page lists, and reads positions itself with PyMuPDF (`page.get_text("dict")`, `page.find_tables()`, `page.get_pixmap(dpi=150)`).
- `ww_harvest._PROB` and `split_problems` hold the start patterns for numbered problems in plain text. `ww_harvest.pdf_text` shells out to `pdftotext`; E06's `read_pdf_text` is the PyMuPDF reader HV01 switches to in EW8.
- `routes_library.IngestJob` is the job pattern: one thread, one job at a time, a lock around a state dict, a `wait()` for tests, 409 when busy.
- `register_feature_routes` mounts every `routes_*.py`; a module that raises at import is skipped with only a bus event. `routes_mission` sets `svc.plan` and sorts first, so later route files read the plan from `svc.plan` (as `routes_ww_mastery.py` does).
- The syllabus is `subject["units"]`: `[{n, title, exam_weight: high|med|low, topics: [str]}]`. There is no keyword list per topic; a topic's keywords are its own words and its unit title's words.
- `app/tests/conftest.py` sets a scratch `JARVIS_DATA_DIR` before `jarvis_app` is imported and blocks every non-loopback socket and port 8777. `python-multipart` is installed. PyMuPDF is 1.28.0, python-pptx 1.0.2, Python 3.11.9.
- **To correct later (not in EW7):** `ww_generator.py` names an institution in its docstring and in the `source` strings of `effective_pattern`. That is a tracked file. The engine lane rewords it in a later commit of its own with the tests that pin those strings.

#### 9.1.3 The shared contract (written by the integrator before the builders start)

- `app/jarvis_app/ww_pyq/schema.py`: `PaperMeta`, `QuestionDraft`, `Question`, `Crop`, `Part`, `Topic`, `Coverage`, `FolderState`, `TraceEvent`, the vocabularies and `STATES`. **Frozen for the wave.** A builder who needs a field stops and reports; the integrator adds it and logs it in 9.0.
- `app/jarvis_app/ww_pyq/api.py`: `ok(state, reason, source, **payload)`, `items(rows, state, reason, source)`, `guard(fn, ...)` and `Busy`. Every pyq route answers through these, so the envelope has one source.
- **Store root:** `paths.DATA / "pyq"` (private, never committed). Layout: `papers.json` (id to `PaperMeta`), `questions/<paper_id>.json` (list of `Question`), `originals/<sha256>.<ext>`, `pages/<paper_id>/p<nnn>.png`, `crops/<paper_id>/<qid>.png`, `folder.json`, `inbox/` (uploads), `blueprints/<exam_id>.json`, `generated/<id>.json`, `attempts.jsonl`. Every write is atomic (write a temporary file, then replace).
- **Ids:** paper `p-` plus 12 hex of the file's SHA-256; question `q-` plus 12 hex; generated paper `g-` plus 12 hex. Every id in a path is checked against `^[a-z]-[a-z0-9-]{1,40}$` before it touches the disk.

#### 9.1.4 Packages

| Pkg | Stage | Purpose | Owns | Extends or reuses (not edited unless stated) |
|---|---|---|---|---|
| **E05** | 1 | The private review-staging store with crops; the watched folder; the paper, question, crop, coverage and folder routes | `app/jarvis_app/ww_pyq/store.py`, `ww_pyq/folder.py`, `app/jarvis_app/routes_ww_pyq.py`, `app/tests/test_pyq_store.py`, `app/tests/test_pyq_routes.py` | `ww_bank_store.slug`, `norm_text` (read only); the job and path-check pattern of `routes_library.py` |
| **C01** | 1 | Pure parsers for the manual intake: pasted lines, calendar files, name match | `app/jarvis_app/ww_intake/{__init__,paste,ics,match}.py`, `app/tests/test_intake_parsers.py` | none (new) |
| **E06** | 2 | PDFs and slide decks to crop-first question drafts with a real event trace; the ingest job, upload and crop-edit routes | `ww_pyq/{ingest,segment,crops,slides}.py`, `routes_ww_pyq_ingest.py`, `app/tests/pyq_fixtures/**` (invented papers as data, built into PDFs at test time), `app/tests/test_pyq_ingest.py`, `app/tests/test_pyq_ingest_routes.py` | `yaadash.library.extract`; `ww_harvest._PROB`, `split_problems`, the explicit pattern of `guess_marks`; E05 `Store` |
| **E07** | 2 | Rule tags, families, counted patterns with their N, the Quiet list, the practise-next list, the purity gate | `ww_pyq/{tag,families,patterns,next}.py`, `routes_ww_pyq_patterns.py`, `app/jarvis_app/ww_check_pyq.py`, `app/tests/test_pyq_patterns.py`, `app/tests/test_pyq_patterns_routes.py` | `ww_generator.topic_key`, `topic_weights`, `proficiency`; E05 `Store` |
| **E08** | 2 | The blueprint (stored, validated, inferred), the generator around `ww_generator.generate`, the print set, the numeric check, marks for a generated paper | `ww_pyq/{blueprint,generate,printset,check}.py`, `routes_ww_pyq_gen.py`, `app/tests/test_pyq_gen.py`, `app/tests/test_pyq_gen_routes.py`, and one edit of `app/jarvis_app/germoney.py` (`Plan.paper_marks` gains `extra_bank: Optional[dict] = None`, merged into its id lookup; nothing else in that file) | `ww_generator.generate`, `effective_pattern`, `paper_invariants`; `ww_numericals`; E05 `Store` |

**Exports (names and signatures; another package calls only these).**

- **E05** `ww_pyq/store.py`: `class Store(root: Path)` with `add_paper(meta: PaperMeta) -> str` (idempotent by `sha256`), `get_paper(pid) -> PaperMeta` (KeyError when unknown), `list_papers(subject: str | None = None) -> list[PaperMeta]`, `update_paper(pid, changes: dict) -> PaperMeta`, `delete_paper(pid) -> None`, `find_by_sha(sha256) -> str | None`, `add_questions(paper_id, drafts: list[QuestionDraft]) -> list[str]`, `get_question(qid) -> Question`, `list_questions(paper_id=None, status=None, subject=None) -> list[Question]`, `update_question(qid, changes: dict, by: StatusBy = "hand") -> Question`, `set_status(qid, status, by) -> None`, `set_crop(qid, crop: Crop) -> Question`, `crop_path(qid) -> Path | None`, `coverage(subject) -> Coverage`, `bank_for(subject) -> list[dict]` (accepted questions with text, as `ww_generator` bank rows: `id`, `question`, `unit`, `topic`, `marks`, `section`, `tier: "exam"`, `type`, `sitting`, `origin: "own-paper"`), `paths` (`root`, `originals`, `pages`, `crops`, `inbox`, `blueprints`, `generated`); `default_store() -> Store` (one per process, at `paths.DATA / "pyq"`). `ww_pyq/folder.py`: `get_folder(store) -> FolderState`, `set_folder(store, path: str | None) -> FolderState`, `scan(store) -> FolderState`, `pending_paths(store) -> list[Path]`.
- **C01** `ww_intake/paste.py`: `parse_paste(text: str, now: datetime) -> ParseResult`; `ww_intake/ics.py`: `parse_ics(text: str, now: datetime, horizon_days: int = 120) -> list[IcsEvent]`; `ww_intake/match.py`: `match_name(a: str, b: str) -> float`. No routes (C02, EW8).
- **E06** `ww_pyq/ingest.py`: `ingest_pdf(path: Path, *, store: Store, meta: dict | None = None, ocr=None, on_event=None) -> IngestResult`, `ingest_slides(path: Path, *, store: Store, meta=None, on_event=None) -> IngestResult`, `ingest_file(path, *, store, meta=None, on_event=None) -> IngestResult` (by suffix), `read_pdf_text(data: bytes, first: int | None = None, last: int | None = None) -> str`, `class IngestJob`; `IngestResult = {paper: PaperMeta, question_ids: list[str], drafts: list[QuestionDraft], trace: list[TraceEvent], duplicate: bool}`. `ww_pyq/segment.py`: `segment_page(page: dict, *, page_no: int) -> list[Box]`, `read_marks(text) -> float | None`, `guess_type(text) -> QType`. `ww_pyq/crops.py`: `render_page(doc, page_no, out: Path, dpi=150) -> Path`, `render_crop(page_png: Path, bbox, page_size, out: Path) -> Path`.
- **E07** `ww_pyq/tag.py`: `topics_of(subject: dict) -> list[Topic]`, `tag_question(q: Question, topics: list[Topic]) -> TagResult`; `ww_pyq/families.py`: `find_families(qs: list[Question]) -> list[Family]`; `ww_pyq/patterns.py`: `wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]`, `compute_patterns(qs, papers, floor_papers=3, floor_questions=20) -> PatternSet`, `quiet_topics(qs, papers, r: int = 3) -> list[str]`; `ww_pyq/next.py`: `practise_next(patterns: PatternSet, proficiency: dict[str, float], gap_minutes: int) -> list[Pick]`.
- **E08** `ww_pyq/blueprint.py`: `infer_blueprint(paper: PaperMeta, qs: list[Question]) -> Blueprint`, `validate_blueprint(bp: Blueprint) -> list[Issue]`, `load_blueprint(store, exam_id) -> Blueprint | None`, `save_blueprint(store, exam_id, bp) -> Blueprint`; `ww_pyq/generate.py`: `generate_paper(bp, exam, subject, bank, states, marks, seed, *, attempts=None, families=None, today=None) -> GeneratedPaper`; `ww_pyq/printset.py`: `render_print(paper: GeneratedPaper, kind: Literal["paper","key","marking"]) -> str`; `ww_pyq/check.py`: `check_numeric(key: str, answer: str) -> CheckResult`.

#### 9.1.5 Route contracts

All under `/api/mission/pyq`, behind the token guard like every `/api/*` route. Success is `{state, reason, source, ...}`; a list is `items` with `count`. Errors are `{"detail": "<sentence>"}` with 400 (bad value), 404 (unknown id), 409 (a job is running), 413 (too large). The lamp is the `state` field. Until a route is merged the UI's null adapter answers `waiting`.

**E05, `routes_ww_pyq.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-01 | GET `/papers?subject=` | - | `items`: `PaperMeta` plus `counts: {questions, pending, accepted, rejected, marks_missing}` | `live`; `waiting` "No papers on file yet." when empty | - |
| R-02 | POST `/papers` | `{title, subject?, year?, exam_kind?, source_note?, questions?: [{text, marks?, section?, type?}]}` | `paper`, `question_ids` | `live` | 400 empty title, text over 2000 characters |
| R-03 | GET `/papers/{id}` | - | `paper`, `counts`, `pages: [{n, png: bool}]` | `live`; `fault` with the paper's `faults` joined when it has any | 404 |
| R-04 | PATCH `/papers/{id}` | any of `{title, subject, year, exam_kind, source_note}` | `paper` | `live` | 400 unknown field or a bad subject slug, 404 |
| R-05 | DELETE `/papers/{id}` | - | `removed: {questions, crops}` | `live` | 404 |
| R-06 | GET `/questions?paper=&subject=&status=&limit=&offset=` | - | `items`: `Question` plus `has_crop: bool`; `count`, `total` | `live`; `waiting` when empty | 400 bad status |
| R-07 | PATCH `/questions` | `{ids: [qid], set: {status?, text?, marks?, type?, unit?, topic?, section?, difficulty?}}` | `items`: the changed `Question`s | `live` | 400: accepting a question whose marks are missing ("Give its marks first."), a value outside its vocabulary, text over 2000; 404 any unknown id (nothing is changed) |
| R-08 | GET `/crops/{qid}` | - | `image/png` bytes (not JSON) | - | 404 "No crop for this question." |
| R-09 | GET `/coverage?subject=` | - | `coverage: Coverage` | `live` when the floor is met; `waiting` with "2 more papers, 9 more reviewed questions." otherwise | 400 missing subject |
| R-10 | GET `/folder` | - | `folder: FolderState` | `waiting` "No folder chosen." or "3 files not read yet."; `live` "Nothing new in the folder."; `fault` "The folder is not there." | - |
| R-11 | PUT `/folder` | `{path: "<absolute path>" or null}` | `folder: FolderState` | as R-10 | 400 not absolute, not a folder, or a whole drive |

Setting `text` or `marks` in R-07 sets `edited: true`, and `marks_source: "hand"` for marks; setting `unit` or `topic` sets `tag_source: "hand"`; a status is stored with `status_by: "hand"`.

**E06, `routes_ww_pyq_ingest.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-12 | POST `/ingest` | `{path: "<absolute file>"}` or `{folder: true}`, with optional `{subject, year, exam_kind, source_note}` | `job: {id, status: "running", total, done: 0}` | `live` "Reading 2 files." | 400 bad path or type, or no folder chosen; 409 a job is running |
| R-13 | GET `/ingest/{job}` (`job` may be `last`) | - | `job: {id, status: running|done|failed, done, total, current, files: [{file, status: added|duplicate|failed, paper_id, pages, questions, method, note}], trace: [TraceEvent], took_s}` | `live` while running and when done; `fault` when it failed or a file had faults, with the first reason; `waiting` "No ingest has run." | 404 unknown job |
| R-14 | PUT `/crops/{qid}` | `{bbox: [x0, y0, x1, y1]}` in PDF points | `question` (the crop re-rendered from the stored page image) | `live` | 400 a box outside the page or smaller than 8 pt; 404 |
| R-15 | POST `/upload?name=<file name>&subject=&year=` | the raw file bytes (`application/octet-stream`); `.pdf` or `.pptx`, at most 40 MB | `job` as R-12 (the file is saved under `inbox/` and read) | `live` | 400 bad name or type; 409; 413 |

Scanned pages: in EW7 a page with no text layer is recorded in the paper's `faults` ("p. 3: no text layer; OCR arrives in EW8"), the rest of the paper imports, and R-13 answers `fault`.

**E07, `routes_ww_pyq_patterns.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-16 | GET `/patterns?subject=` | - | `patterns: {n_papers, n_questions, papers: [{id, year, title}], topics: [{key, unit, topic, k, n, low, high, last_year, years_since, marks_weight: {mean, min, max}, questions: [qid]}], pairs: [{a, b, k, n}], quiet: {r, topics: [key]}, families: [{id, question_ids, years, confirmed: false}], sentence}`, `floor: {papers, questions, papers_needed, questions_needed}`, `footer` | `live` at 3 papers and 20 reviewed questions; else `waiting` "Too few papers to show a pattern: 2 more papers, 9 more reviewed questions." with the counts still present and `provisional: true` | 400 missing subject, 404 unknown subject |
| R-17 | GET `/practise-next?subject=&gap_minutes=` | - | `items: [{key, unit, topic, gain, terms: {marks_weight, seen_share, proficiency, measured: bool, minutes}, question_ids, reason}]`, `defaults: {minutes_per_mark}` | as R-16; `waiting` "No topic has 3 reviewed questions yet." when none is eligible | 400, 404 |
| R-18 | POST `/tags/suggest` | `{ids?: [qid], paper?: pid, apply?: false}` | `items: [{id, unit, topic, score, margin, tag_source: "rule"|"none", candidates: [{unit, topic, score}]}]`, `applied: n` | `live`; `waiting` "This subject has no syllabus topics yet." | 400 neither ids nor paper, or the paper has no subject; 404 |

`footer` is always "From papers on file. This prepares practice; it does not predict a paper or a result." With `apply: true`, R-18 writes a tag only where the rule is certain (score at least 0.25, margin at least 0.15) and never over a `hand` tag. A model proposal for an uncertain question is `planned` (EW8).

**E08, `routes_ww_pyq_gen.py`**

| Id | Method and path | Request | Response payload | States | Errors |
|---|---|---|---|---|---|
| R-19 | GET `/blueprints/{exam}` | - | `blueprint: Blueprint or null`, `issues: [Issue]`, `exam: {id, subject, title, max}` | `live` "Balanced: 60 marks."; `fault` with the first issue; `waiting` "No blueprint. Infer one from a paper on file." | 404 unknown exam |
| R-20 | PUT `/blueprints/{exam}` | `{blueprint: Blueprint}` | `blueprint`, `issues` | `live` or `fault` (an unbalanced blueprint is saved so he can keep editing; the generator refuses it) | 400 malformed, 404 |
| R-21 | POST `/blueprints/infer` | `{paper: pid, exam?: exam id}` | `blueprint` (`origin: "rule"`, not saved), `issues`, `trace: [str]` | `live`; `fault` when the inferred sections do not balance | 400 the paper has no accepted or pending questions with marks; 404 |
| R-22 | POST `/papers/generate` | `{exam, seed?: int, tier?: "exam"}` | `paper: GeneratedPaper` (stored) | `live`; `fault` never (see errors) | 400 "The blueprint does not balance: <first issue>." or no blueprint; 404 unknown exam |
| R-23 | GET `/generated?exam=` | - | `items: [{id, exam, seed, made, total_marks, counts}]` | `live`; `waiting` when none | - |
| R-24 | GET `/generated/{id}` | - | `paper: GeneratedPaper` | `live` | 404 |
| R-25 | GET `/generated/{id}/print?kind=paper|key|marking` | - | `text/html` (A4 stylesheet; not JSON) | - | 400 unknown kind ("night" answers 400 "The night sheet is planned."); 404 |
| R-26 | POST `/check` | `{key: "<number with optional unit>", answer: "<what he typed>"}` or `{question_id, answer}` | `check: {match: true|false|null, key, parsed, tolerance, note}` | `live`; `waiting` "This question has no numeric key." with `match: null` | 400 an answer that is not a number |
| R-27 | POST `/generated/{id}/marks` | `{items: [{id, got}]}` | `saved: n`, `total: {got, max}`, `marked_by: "you"` | `live` | 400 a mark below 0 or above the question's marks, or an id not on that paper; 404 |

`Blueprint = {exam, source_paper: pid or null, duration_min, total, origin: "hand"|"rule", sections: [{name, questions, attempt, marks, types: [QType], choice: "all"|"any"|"or-pairs", unit_limit: int or null}], updated}`. `Issue = {code, section: name or null, text}`. The three rules of `validate_blueprint`: the sum of `attempt` times `marks` equals `total`; `questions` is at least `attempt`; `or-pairs` needs an even `questions` with `attempt` equal to half.

`GeneratedPaper = {id, exam, subject, title, seed, made, header: "Practice paper from your bank. Not an official paper.", total_marks, duration_min, minutes_per_mark, sections: [{name, marks, attempt, set, slots: [{n, source: "hand"|"rule"|"template"|"hollow", question_id, text, has_crop, marks, unit, topic, type, reason, key?: str}]}], shortfall: [str], invariants: [], rule}`. A slot the bank and the templates cannot fill is `source: "hollow"` with `text: ""` and a `reason` ("needs 1 more 7-mark question"); it is listed in `shortfall`. A paper whose `ww_generator.paper_invariants` list is not empty is never stored or returned. `source` is `hand` for a question he accepted himself, `rule` for one accepted by a rule, `template` for a generated numerical. No slot has `source: "model"` in EW7.

R-27 writes one line per question to `attempts.jsonl` (`question_id, paper_id, got, max, marked_by: "you", date`) and passes the same marks to `Plan.paper_marks` with the paper's own questions as `extra_bank`, so the existing per-topic proficiency updates. Nothing in this wave returns a predicted mark or a pass chance.

#### 9.1.6 Acceptance checks and tests (tests are written first; each must fail without the package)

**E05.** (1) A paper added twice (same `sha256`) is one paper. (2) Ten stale-entry cases T1 to T10 hold: a questions file without its paper row, a paper row without its file, a crop path that is gone, a truncated JSON file, an unknown status, a record from schema version 0 with missing keys, a duplicate question id, a watched folder that vanished, an id with a path separator, a concurrent write from two threads (20 writers, nothing lost). (3) Accepting a question with missing marks is refused and changes nothing. (4) `bank_for` returns only accepted questions that have text, marks and the paper's subject, in the generator's row shape, and `ww_generator.generate` accepts those rows. (5) Every route of R-01 to R-11 answers through a `TestClient` with `register_feature_routes(only=...)`, carries `state`, `reason`, `source`, and is in the docstring table. (6) The folder routes refuse a relative path and a drive root and never read outside the chosen folder. (7) Nothing is written outside the scratch data directory.

**C01.** 40 cases for each parser, as data tables in the test file: date forms `18 Nov`, `18/11`, `Nov 18`, a weekday word, an optional time; an ambiguous date (`03/04`) is returned both ways with `ambiguous: true` and is never resolved by a guess; `.ics` line unfolding, `VEVENT`, `RRULE` weekly and daily expanded for 120 days, any other rule returned once with `repeats: "not expanded"`, `Z` and `TZID` times including a time-zone shift across midnight, an all-day event; `match_name` is symmetric, 1.0 for equal token sets and 0.0 for disjoint ones. Pure: no clock except the `now` argument, no file, no network.

**E06.** (1) Ten invented fixture papers (data in `app/tests/pyq_fixtures/`, turned into PDFs with PyMuPDF in a temporary folder at test time): the question count equals the hand count on at least 9 of 10, and printed marks are found on at least 90 percent of questions; the measured numbers go in the research file. (2) A table paper with question, marks, CO and BL columns is read as rows, with the trace line naming its columns. (3) Every draft from a text-layer page has a crop whose PNG exists and whose box contains the question's text blocks. (4) A page with no text layer is a fault in the paper's `faults`, the other pages import, and the job answers `fault`. (5) The same file twice is `duplicate` and adds nothing. (6) A `.pptx` deck gives one `slide` unit per slide with `text_status: "verified"` and no crop. (7) The upload route refuses a name with a path separator, a type that is not `.pdf` or `.pptx`, and a body over 40 MB, and writes only under `inbox/`. (8) The trace holds only events that happened (a test counts them against the fixture). (9) Time per page and peak memory for a 20-page fixture are measured and recorded. (10) `read_pdf_text` returns the same words as `yaadash.library.extract` on a fixture.

**E07.** (1) `wilson` matches a reference table to 4 decimal places (k of n for n from 1 to 10, checked against the formula computed with exact fractions in the test). (2) A question is tagged by rule only at score at least 0.25 and margin at least 0.15; a mutation that lowers the margin to 0 fails a test. (3) Families: two questions that differ only in their numbers merge; two different questions do not. (4) Below 3 papers or 20 reviewed questions the answer is `waiting` with the counts still needed. (5) Pairs are listed only when N is at least 4 and the pair occurs in at least 3 papers. (6) `practise_next` prints its terms, never picks more than 2 consecutive topics of one unit, and uses 0.5 with `measured: false` when a topic has fewer than 5 marked attempts. (7) No output string contains "important", "likely", "expected", "will be asked", "predict" (except in the fixed footer's "does not predict"), "probability" or "chance". (8) `ww_check_pyq.report()` runs each pure function twice on synthetic data and reports any difference.

**E08.** (1) `infer_blueprint` on an invented three-section paper returns the paper's marks per section, and the blueprint's total equals the paper's. (2) Each of the three rules of `validate_blueprint` has a failing case. (3) `generate_paper` with the same seed gives the same paper, and a different seed a different one, on a bank of 40 invented questions. (4) An unbalanced blueprint is refused with the first issue in the sentence (the 9 Nov bug: a 20-mark paper borrowing the 60-mark shape, pinned by a test). (5) A family appears at most once in a paper; a question attempted in the last 14 days is weighted 0.3. (6) A slot that cannot be filled is hollow and named in `shortfall`; the paper is still balanced. (7) The print HTML of kind `paper` carries the header sentence and the seed and no key; kind `key` carries the keys of the numerical slots. (8) `check_numeric` accepts a value within 1 percent or the last printed digit of the key and never returns a mark. (9) R-27 refuses a mark above the question's marks and an id not on the paper, writes `marked_by: "you"`, and the topic's proficiency moves. (10) The existing `ww_generator`, gate and mission tests pass unchanged.

#### 9.1.7 How the wave is verified and merged

Per package: its own tests; a reviewer reruns them, makes one mutation that a test must catch, and checks the contract (exports, routes, docstring table, states). E06 (files from a path he types, uploads, writes under the data directory) also gets a security review. Then, on `engine/main` rebased on `origin/main`: the full `app` suite on a scratch data directory, `core` tests untouched, `app/tests/test_ww_gate.py`, the root privacy and commit tests, and `requirements/check_requirements.py`. The end-to-end exam-path test is M01 (EW8); EW7 ends with a short integration test by the integrator: one invented 6-question paper through ingest, accept, blueprint inference, generate, print and marks.

#### 9.1.8 Stage 2 mechanisms (decided 14 Nov, after reading stage 1's code)

- **E08, how the wrapper keeps `ww_generator.py` unedited.** One call of `ww_generator.generate` with a copy of the exam row whose `pattern` is the blueprint's sections. Before the call the bank is prepared: one question per family is kept (seeded choice); a question attempted in the last 14 days is kept with probability 0.3 (seeded), which is the 0.3 weight as a thinning; a row keeps its `section` letter only when its marks equal that section's marks. After the call: a slot whose own question has other marks than the section, or a type the section does not allow, or that repeats a question, is emptied; an emptied or missing slot is filled from `ww_numericals.pool` templates not already on the paper, and what is still empty is a hollow slot named in `shortfall`. Then `ww_generator.paper_invariants` must return an empty list or nothing is stored.
- **E08, print.** The print HTML is self-contained: every crop is embedded as a base64 PNG, because an `<img>` request cannot carry the token header. Every text that came from a paper is HTML-escaped.
- **E06, ids and crops.** Question ids are given by `Store.add_questions`, so the ingest adds the drafts with their boxes first, then renders each crop to `crops/<paper_id>/<qid>.png` and calls `Store.set_crop`.
- **E07 and E08, the plan store.** A route reads the subject and the exam through `svc.plan` (set by `routes_mission`), the way `Plan.practice_paper` does: units from the subject, topic states from `exam_prep`, marks from `paper_marks`.
- **The gate.** `ww_check.py` now reads PATCH rows and every `routes_ww_pyq*.py` docstring (integrator's edit, 14 Nov): 11 pyq rows documented, 0 without a route.

#### 9.1.9 Outcome

**Stage 1 (14 Nov): merged to `engine/main`.** E05: 51 tests (store 40, routes 11); the review fixed two defects (a file hash that was not checked before it became an id, and a draft that could arrive already accepted) and its mutation (removing the "Give its marks first." refusal) failed 2 tests. C01: 194 tests in about 1 s; its mutation (removing the ambiguous-date branch) failed 7 tests. Open and accepted: the store has an in-process lock only (one app process owns the data directory); a pasted line with two date-like tokens keeps the stray number in its title.

**Stage 2 (14 Nov): merged.** Built in three worktrees at once in about 60 minutes (9 agents: a builder, a reviewer and, for E06 and E08, a security reviewer; Opus for the two builders with the hard code).

| Package | Tests | Measured | Review and security |
|---|---|---|---|
| E06 ingest | 87 | Ten invented papers: 10 of 10 question counts equal the hand count, 48 of 48 printed marks found, the one question without printed marks stays missing. 20 pages in 2.3 s (114 to 138 ms a page), traced Python peak 6.8 MB; 12 s before the crops stopped rewriting the questions file once each | Mutation (duplicate check off) caught. Fixed: Windows device names in an upload; network and device paths refused before any file call (a network name would have opened a connection); caps of 300 pages and 4.5e6 square points a page; a deck that declares over 250 MB unzipped; an upload name ending in a newline |
| E07 patterns | 70 | 7 pure functions run twice by the gate; 500 questions over 20 papers in 0.42 s | Mutation (the 5-attempt rule lowered to 3) caught. Fixed: the waiting sentence now says how many accepted questions have no topic |
| E08 generator | 78 | 2 ms a paper; the 14-day thinning measured at 0.33 over 200 seeds (target 0.3) | Mutation (rule two of the blueprint off) caught. Fixed: a 3-million-question blueprint hung the generator (now capped); an overflow in the numeric check |

**The wave as a whole.** `app/tests/test_pyq_slice.py` (the integrator's test) drives one invented six-question paper over HTTP through upload, read, tag, accept, blueprint inference, save, generate, print and marks: it passes, the bank is empty until he accepts, the same seed gives the same paper, and no answer contains a forecast word. All 27 routes mount in the full app and are in the docstring tables the gate reads (27 documented, 0 without a route). The gate runs the purity check (`ww_check.report()["pyq"]`).

**Left out or open, known.** (1) A two-column paper would have its columns merged: rows are grouped across the full width, and no two-column fixture exists; column detection goes to EW8 with OCR. (2) Scanned pages are a fault until OCR (X04, EW8). (3) Confirming a family, model proposals for an uncertain tag, variants and rubric points are EW8. (4) R-27 writes the proficiency first and the attempt line second; a failed append would leave the attempt unlogged (local file, accepted). (5) An upload with the name of a file already in `inbox/` replaces it; the original is kept by hash. (6) The store has an in-process lock only. (7) Every threshold is still the specification's assumption: none has met a real paper. (8) `ww_generator.py` still carries an institution name in its docstring and strings that predate the rule.

**What only the owner can do next.** Drop one real text-layer paper into the app once the UI lane's adapters (AD08) are merged, or hand it to the engine lane for a smoke test on a scratch data directory: that is the first real measurement of the segmentation and the tag thresholds.
