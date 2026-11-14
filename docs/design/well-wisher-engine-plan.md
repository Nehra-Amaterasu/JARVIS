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

*(The first planning iteration writes wave E1 here: the packages of slice A, their owned files, the modules they extend, their route contracts R-01 onward, acceptance checks and tests.)*
