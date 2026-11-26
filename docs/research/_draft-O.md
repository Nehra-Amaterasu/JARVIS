## 2026-11-27: OCR on demand, Word papers and drafts from notes on the paper desk

**Question.** The engine now reads scans only when asked (R-28, R-48, R-49), takes Word papers (R-12, R-15), sends picture-only questions with `text_status: "none"`, and drafts questions from his notes (R-50 to R-52). What must the paper desk show so that none of it is read as verified?

**Built (UI only, app/ui).**
- Client: `adapters/pyqExtras.ts` (`PyqClient`: ocrStatus, ocrStart, ocrStop, draftsMake, draftsList, draftsDecide), types in `adapters/types.ts`, exported as `pyqClient` from `pyq.register.ts`. It is not a member of the frozen sixteen-member Study port. A 409 or 400 is the engine's own sentence; gate off or no token calls nothing.
- `ports.ts`, paper desk types only: `PaperRow` gained optional `subject`, `faults`, `method`; `QuestionRow` gained optional `ocrConfidence`, `wholePage`, `origin`. `pyqMap.ts` fills them only when the engine sent them.
- `papers/OcrPanel.tsx`: fault lines of the paper, a "Read with OCR" key when a line says "no text layer; run OCR on this paper", then page N of M, pages read, pages under the gate, seconds per page, a Stop key; polls R-28 every 2.5 s only while a job runs and stops on unmount; end word Done, Failed or Stopped; asks the desk to read the paper again once.
- `papers/DraftsPanel.tsx`: "Draft questions from my notes" (subject, topic, unit, count 1 to 5, marks); drafts list with the notes' titles, the engine's checks in words, Accept (needs marks), Edit then accept, Reject; each draft is labelled "written by the local model, not checked"; accepted ones still say the model wrote them.
- Review: `CropCard` prints "Read by OCR, check it." with the engine's confidence and "text unverified"; a whole page (label p3) says to split it by hand; a picture-only question shows its crop at up to 220 px instead of 88 px.
- Import accepts `.pdf`, `.docx`, `.doc` (and their MIME types); the refusal sentence names Word.
- v3 DETAIL tray: the chosen paper, its OCR panel and the upload notice now come before the coverage ledger, and the tray scrolls instead of squeezing (before the change the readouts shrank into each other at 1366 x 768).

**Measured.** vitest (study, ww, shared): 1,472 passed before the last additions, plus 23 in `ocr.test.tsx` and the adapter tests in `pyqExtras.test.ts`. Playwright `e2e/paper-ocr.spec.ts`: 6 tests (3 each at 1366 x 768 and 390 x 844, v3), all pass, asserting 44 px keys, no text under 11 px, nothing wider than its panel, no sideways page scroll, no use of the word "verified" for OCR or drafts, and no R-28 call after a job ended. Privacy scan: 25 passed.

**Not verified.** No real engine, scan, Word, OCR engine or local model was used: every route is mocked with invented data ("Mock paper A", "Signals Studio"), so the wording of real fault lines and the real seconds per page are the plan file's, not observed. Phone behaviour was driven with a mouse, not touch. The draft panel's topic suggestions come from the patterns route and are only suggestions; the engine checks the topic.

**Remains.** The engine's R-01 must keep sending `faults` and `method` on each paper (the OCR key depends on it). A paper with 3,374 scan pages in one folder needs a "read the next paper" queue, which the plan does not have. Editing a draft's unit or topic before accepting is not on the screen (R-52 allows it).
