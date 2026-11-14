# Well Wisher engine lane: research and measurements

The running research file of the engine lane (the Python side of Well Wisher). Newest section on top. The plan it serves is `docs/design/well-wisher-engine-plan.md`; the screens are the UI lane's (`docs/research/product-design-overhaul.md`).

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
