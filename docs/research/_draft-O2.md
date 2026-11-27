## 2026-11-27: the paper desk after its first pass (split tray, provisional counts, draft edits)

**Question.** After package O, what was still open: the third tray held too much at 1366 x 768, a draft's unit and topic could not be corrected, the UI ignored two engine rules (R-16 `provisional`, R-17 `terms.syllabus_weight`), the import tray opened under a resting pointer at 390 px, and two older browser specs needed a look.

**Built (app/ui only).**
- **Three trays, one job each.** COVERAGE: the Topics by year grid (never under 18 rem; its own chrome is 205 px and two topic rows are 88 px more), the provisional note, the one primary, the ledger (three readouts a row instead of five in a column), the practise-next note, the trace. PAPERS: the chosen paper's facts with its OCR panel on top, then the list (it scrolls), then the import tray. DRAFTS: the face switch and the "Draft questions from my notes" panel, open from the start. The OCR key is now the first thing in its panel and sits inside the visible part of the tray; the spec measures that at 1366 x 768 and 390 x 844. The "no text layer" fault lines became one line beside the key with the page numbers; every other fault line (under the gate with its confidence, a whole page to split, an unreadable page) is printed as the engine wrote it.
- **Drafts.** Edit then accept shows Unit and Topic; the PATCH carries `unit` and `topic` only when they changed (R-52). The engine still checks the topic against the syllabus and answers in its own sentence.
- **R-16 provisional.** `pyq.ts` keeps the counts of a WAITING answer with `provisional: true` as `{topics: [], papers, topicCounts: {}, provisional, questions}`; `loadDesk` keeps the desk's own state and prints "3 questions in 2 papers so far: too few to call a pattern." plus the engine's sentence. No topic row, no weight and no suggestion is drawn from those counts (the spec checks that "Sampling" is absent from the grid).
- **R-17 terms.** `GainItem.terms` carries the engine's printed terms as words: marks weight, share of papers, proficiency (from his marks, or "not measured yet"), syllabus weight "3 of 3 (high)", minutes. Nothing screen-side consumed R-17 before; the desk now prints the first three picks under the ledger. `PracticeCell.tsx` was not touched: it never read practise-next.
- **Import tray.** `ImportTray` ignores hover at 700 px and below and opens on a press or a focus; the pointer workaround in the spec is gone.

**Measured.** See the report for the test counts. Screenshots in `$TEMP/ui-desk-shots`.

**Not verified.** Still no real engine, scan, OCR engine or local model: R-16, R-17 and the draft routes are mocked with the plan's field names. A phone was not used; 390 px is a desktop browser window driven with a mouse.

**Remains.** A queue for "read the next paper" over 3,374 scan pages; the practise-next note shows only three picks and no gap-minutes control (R-17 takes `gap_minutes`).
