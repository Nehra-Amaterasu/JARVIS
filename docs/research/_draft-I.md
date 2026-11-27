## 2026-11-27: the intake desk on the engine's store, and the Classroom export door

**Question.** The intake desk (package C03) was a designed screen on a port with a null adapter: every door and the ledger said WAITING, and the
fixture desk drew invented rows. Board request 15 (R-36 to R-42, the intake store) and request 16 (R-46 and R-47, the Classroom export door) are
merged on main 7e7e3c1. Can the desk hold what he brings in as rows with a state kept by the engine, and can he point the app at a Classroom export
and send entries to the paper desk one at a time, with nothing written or extracted without his press?

**Before.** `IntakeDeskPort` existed with `nullIntakeDesk`; nothing registered a real desk. Fixtures drew invented rows (SIMULATED). The Archive door
took a file, listed invented entries and "queued" the ones he had kept with a switch each and one Queue key (the plan's E17, never built). Undo and
"Back to new" were drawn and sent `state: new`, which no engine route takes.

**Built.**
- `app/ui/src/ww/study/intake/adapters/store.ts` and `store.register.ts`: the real adapter over R-36 to R-42 and R-46, R-47 (list, paste, ics, accept
  or decline, take, delete, export by path or by file, one entry per accept call). The engine's state and sentence are passed through; a 400, 404,
  409 or 503 prints the engine's own sentence (WAITING, not a fault); with the gate off or no token nothing is called and every member answers
  what the null desk answers. A paste is sent as text and the engine's rows come back: the browser parses no date. The register file calls
  `registerIntakeDesk` and is imported by the desk.
- Fault with problems: the adapter keeps `problems` of the last list; the ledger prints them under "Fault: <the engine's newest sentence>" and
  under live rows as a note. Never an empty desk.
- No Undo: `port.noUndo` is set by the real adapter (R-39 takes accepted or declined only). No Undo toast, no U key, no "Back to new"; a declined row
  offers "Accept instead", an accepted one "Decline instead". The fixture desk keeps Undo.
- An ambiguous row names the two readings with the engine's order word ("3 Dec, day first", "12 Mar 2027, month first"); Accept stays refused until he
  picks one and sends that date. The row's `repeats` word ("expanded", "not expanded") is the engine's.
- Archive door (R25): a path field with "List it" (R-46 by path), the file well kept as the second way (R-46 by raw body with `?name=`), the entries with
  name, size, kind (PDF, PPTX) and the engine's verdict (a refused entry prints its sentence; a kind "other" says only .pdf and .pptx are read), a
  "Send to paper desk" key per entry, and the engine's answer printed under that entry. Nothing is extracted before that press.
- After a paste or a calendar file the desk reads the list again (see the first mismatch below).
- Phone: a row's second line wrapped nowhere and was cut with an ellipsis at 390 px (21 rows in the probe); under v3 on a phone a row may be two lines.
  The subject box and its suggestion chip no longer share one line in the 300 px detail tray (the box read "No").

**Numbers.** tsc 0 errors. vitest `src/ww/study src/__tests__/ww src/__tests__/shared`: 51 files, 1,557 tests passed (63 under `ww/study/intake`, 26 of
them the adapter's). Browser, mocked routes, `e2e/intake-store.spec.ts`: 4 of 4 passed (1366x768 and 390x844, v3), probe clean: no text under 11 px,
no key under 44 px, no sideways scroll, no document scroll, no ellipsis. `e2e/c03-intake.spec.ts`: 13 passed, 1 skipped (as before), 1 first-run
`page.goto net::ERR_ABORTED` that passed on its own rerun (2 of 2). Browser, no mocks, `e2e/real-intake.spec.ts` against `--seed study` on 8992: 1 of 1
passed; every comparison between a screen and its route matched (the list and the count, the paste reading with its unread line, the ambiguous row
and the date the route kept, the decline and the route's state, the export listing with each entry's key, the accept answer, and the fault with the
engine's problem lines); the spec writes its own mismatch file and it read "none".

**Mismatches: the plan text, the engine's tests and what a screen needed.**
1. R-39 has no way back to new. The designed desk (and the port's own comment) assumed Undo sends `new`. Dealt with in the UI (no Undo). A declined row
   can be accepted and an accepted one declined, so "Accept instead" and "Decline instead" exist.
2. The brief said Delete is refused for files the app does not own. The route does not refuse: for a folder row it hides the row and answers
   `removed {row: true, file: false}`, "Row removed." The screen already says "Your own files were not touched" from `removed.file`. The refusal
   the mocked spec shows is the route's 404 "No such row." (a row deleted in another window).
3. An intake row carries no `raw` line. The detail says "Read from a pasted line, today at 09:00" and the row's title; the original text is not shown
   because the store did not keep it. `readings` are `{date, order}` objects, not strings; the desk takes the dates and uses the order as a word.
4. The store keeps `problems` for the life of the process. After `rows.json` was set aside and put back, the next list (live rows) still carries the old
   problem lines, so the desk prints "The store set these aside" under good rows until the app restarts. Found by the no-mock run. For the engine lane.
5. A pasted line with no date is a row (state new, date null, "No date" group), not an unread line. "viva on Thursday" is read with a date; the only
   lines that are unread are those with nothing left once date and time are taken out ("9 Dec 5pm"). The mocked fixtures were corrected to that sentence.
6. No route lists class names or maps them to subjects, so Courses and Subjects stays WAITING (the null desk's sentence). The suggested subject is an
   id of the plan; the desk takes labels from `GET /api/mission/academics` (not an intake route).
7. R-38 asks for a `text/calendar` body; the shared upload helper sends `application/octet-stream`. The route does not look at it, so it works.
8. R-46 answers entries by `name` only (no entry id) and `kind` "other" with `refused: null`; R-47 refuses an "other" with 400 only when asked. The
   desk draws no key for an "other" entry, and uses the name as the id.
9. The seed of 27 Nov has no intake rows or archive, so the no-mock spec makes its own through the desk (paste, accept, a zip built in a scratch folder).
10. The folder door's lamp still comes from `StudyPort.intake()` (null adapter: "choose a folder to watch"); there is no route that says which folder is
    watched. Folder rows do appear in the list.

**Not verified.** A real Classroom export from Google; a zip near 500 MB or the 413 path in a browser; the file-picker way of listing in a real browser
(the path way is run against the real route; the picker is unit-tested with a fake engine); `Take` against a mounted paper desk or notes library (409
and 503 are mocked; a real take needs a folder row, and the seed has no watched folder); a phone-width run against the real routes (1366x768 only);
Delete of an owned copy (no route creates one yet); R-42 (`/deadlines`) is not read by any screen.

**What it changed.** The intake desk and the export door are real when a token is present; the older fixture desk stays for the gallery and tests.
