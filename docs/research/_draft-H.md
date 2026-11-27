## 2026-11-27: past-paper sources on the harvester screen, the Agents pose, and two shell fixes for the phone

Package H of the UI lane (rows R13, R11, R14 of plan 08). Draft file: the integrator folds it into the topic file and the index.

### R13. Past-paper sources on the harvester screen

**Question.** How does the harvester screen show the two past-paper sources (engine requests R-44, R-53, R-54) so that he reads a source's terms before any switch, a source that is off asks nobody, and nothing is called found or fetched that the engine did not report?

**Built.** `app/ui/src/ww/setup/PaperSources.tsx` (new), wired into `Harvester.tsx` as a third pane, "Past papers", beside Sources and Queue.
- Per source one soft card (no border, the surface tone): name, a state word (Off, On links only, On keeps local copies), the rights line, the terms note always on screen in the reading face (body size, reading leading, full ink), the hosts, the engine's own reason.
- Two separate switches, "Use this source" and "Keep a local copy" (role switch, aria-checked, a state word inside the key). The second is disabled with its reason until the source is on. A press sends only that switch to `PUT /api/mission/harvest/sources/{id}`; the card takes the source from the engine's `paper_source`.
- The address field with a "Save the address" key where `needs_address` is true. "Read the listing" stays blocked with a reason until the source is on and, for `papers_table`, until the engine has kept an address.
- Every refusal prints the engine's own sentence after the word "Refused:" (local copy before on, a bad address, 404). A fault from R-54 prints its `reason` the same way.
- Found papers: the listing is read only when he presses "Read the listing" (an optional search word goes in `q`). The state word is the engine's, and the count "N shown of the M listed, read DATE" is printed only under `live`. Three papers a page. Each row has "Open the link" (opens the publisher's page in his browser and records a pointer with R-54, no request by the engine) and, only while the local copy is on, "Fetch". A row says "on file" only when the listing or a fetch said so.
- One plain line says that nothing here downloads by itself. `pdf_reader.note` is printed under the pane with "PDF reading is available/not available".
- A source switched off clears the listing read under its old state and shows "This source is off, so it is not asked and nothing is listed", never a zero.

**Measured.** Unit tests: 7 of 7 in `src/ww/setup/__tests__/paperSources.test.tsx`. Browser (`e2e/paper-sources.spec.ts`, mocked harvest routes, invented hosts example.org): at 1366x768 the whole walk passed with the shared probe rooted on the pane (no key or field under 44 px, no text under 11 px, nothing sideways, no ellipsis) and the Setup centre did not scroll. First run the probe measured 40 px on every key and on the address field (the kit's 40); the pane now sets `--ctl-h` and the input to `--hit` (44).

**Found.** Setup, and with it the harvester, cannot be opened from the v2 or v3 shell: Alt+6 is swallowed by the shell, the settings views are not built, and the spine has no Setup row. It opens only in the older frame (`shell=off`, Setup tab or Alt+6). So the spec runs there, not under v3. This is the one thing the owner has to decide or the shell lane has to build before he can reach the screen in the new look.

**Not verified.** Against the real engine (only the mocked routes); the 390 px width inside the real older frame (that frame lays its Today and Proof panels over the page and its own centre is wider than the phone; the spec hides the two side panels at 390 px to measure the pane's own layout, so the claim is only "the pane has no sideways overflow of its own"); real publisher pages; opening the link in a real new tab (window.open is stubbed in the spec).

**Remains.** A "refresh" key for the listing (`refresh=1`) is not offered; the manifest (R-43) is not listed on this screen; a Setup entry in the v3 shell.

### R11. The Agents pose

**Built.** `app/ui/src/jarvis/planned.ts`, entry `jarvis.agents`: the line now begins "Agents are being planned; nothing runs here yet." and says honestly that the staff roster below only reports what runs now; `needs` says the memory lane designs the agents for memory and tasks, the engine lane builds them, and this row is their place. 136 characters, no digit, no date, no banned word (the registry lint holds).
**Home.** Left at `console.crew`. `shell/hosts.ts` maps `console.crew` to the planned pose and `shared/planned/stale.ts` expects a mounted home to show its plate; a Yadaash home (`memory.recall`) would add a count chip to the Recall view and make the stale check ask for a plate there. The Yadaash spine row already opens this entry through `shell/v3/subprojects.ts`, so the owner sees it under Yadaash either way.

### R14. Two shell fixes for the phone, and one export

**a. Sheet body.** Cause: `.s3-tray[data-sheet='open'] .s3-body` was `flex: 1 1 0%` with overflow visible. The tray's own box has a max-height (17.5rem short of the screen), so a long view ran out of the body and under the Done key. Fix in `shell-v3.css` (phone block): the body is `flex: 1 1 auto; min-height: 0; overflow-y: auto`, Done is `flex: none`, a 0.25rem padding with equal negative margin keeps a focus ring from being clipped. The Day view's scoped rule (`.s3-body:has(> .tv3) { flex: none }`) is more specific and still wins; its file is untouched. Measured at 390x844 on the Classroom sheets: tray 128 to 692, body 174 to 628, Done 632 to 676, the body scrolls (138, 118, 194 px of its own scroll) and the deepest content, 766 to 822, is inside that scroll, never under Done.

**b. 273 px of sideways scroll on `.s3-zones`.** Measured cause: a view that places no `<PhonePeeks />` gets the fallback row (`.s3-peeks-fallback`, a flex row) and the `.s3-peeks` inside it was `flex: none`, so it kept its max-content width: two pills side by side, each with a long note, 629 px in a 354 px row. `.s3-zones` is `overflow-y: auto`, which makes overflow-x auto, so it scrolled (scrollWidth 631 against 358), and focusing the Done key of the opening sheet moved it 273 px. Fix: `.s3-peeks-fallback > .s3-peeks { flex: 1 1 0%; min-width: 0 }`, plus `overflow-x: hidden` on the phone `.s3-zones` (a sideways scroll in a column of trays is never wanted). Measured after: scrollWidth 358 = clientWidth 358, scrollLeft 0, peeks 354, at every Due list and Assignment opening in the spec. The six waived probe lines in `e2e/classroom-due.spec.ts` (the one `if (look.id === 'v3' && size.w === 390)` splice) can come out; the integrator removes them.

**c.** `PeekCtx` and the `PeekApi` type are exported from `shell/v3/index.ts`.

**Regression runs.** tsc -b exit 0. Vitest (setup, jarvis, shell, ww, shared): 65 files, 1,772 of 1,772, exit 0. Playwright with --workers=1: paper-sources (2 sizes), shell-v3, one-look, day-fixes, classroom-due, core-talk-stage: 54 passed, exit 0. Privacy scan: 25 passed. Not run: classroom-due with its waiver taken out (the geometry above shows the cause gone, but the spec itself still has the waiver).
