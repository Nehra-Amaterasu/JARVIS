## 2026-11-25: the Tree's node click and one clear path through Career

Question: why does the Tree glitch when a node is clicked (owner), and why is Career confusing to move through (owner)? Package N, rows R6 and R7 of plan 08. Method: reproduce in a real Chromium on the built app (dist-e2e, sandbox, v3 look), measure, fix, re-measure.

### R6. The Tree

**Measured cause of the click fault (1366x768, Influence and persuasion, 519 px stage).**
- The stage re-framed the whole branch on every selection (`TreeStage`, an effect on `openId` calling `frameBranch(..., max(k, 1.15))`). First click on a node: the canvas transform moved from `translate(-9.3,109.8)` to `translate(57.6,109.8)`, a 67 px slide sideways, so the next click landed on another node or on nothing (my 4-click probe: 3 of 4 clicks missed their target until coordinates were re-read).
- A click on a branch plate zoomed the canvas out from 120 % to 74 % (`toBranch` allowed a minimum of 0.6, and labels draw only from 1.15), so the labels vanished.
- A stage under 520 px was treated as a phone (`w < 520`), and the 519 px laptop stage centred the first node and cut the first plate at its left edge (-9 px).
- Tray 2 filled, but badly: the header grid gave the close key the glyph's 56 px column, the name fell into a 90 px column and wrapped one word a line ("Namin g ten comm on biase s"). The drawer also took keyboard focus on every node change, and the selected node drew a black focus rectangle round its label.

**Visible faults from the owner's picture.**
- Legend over the first row: it was absolutely placed inside the stage. Now its own row above the stage (`TreeKey`), the stage has `chrome={false}` under v3.
- Two plates with only "3 nodes": the plate name was drawn only when the whole plate lay inside the stage (`hubFits`). The data is not at fault: all branch names of all ten trees are non-empty (unit test). The name is now always drawn; a missing name would show the last part of its id (`hubName`). The count moved under the name, so name and count no longer overlap.
- First row half hidden: the view put the start row about a third down with the row above cut as a sliver. The top edge now snaps to a row boundary, and the first plate is whole (asserted: top, left, foot >= 0).

**What was built.** `ensureVisible` (pan only if the node is out of view, keep the zoom), hub click keeps labels (min zoom 1.15), selected node = `--acc-soft` tint (`sn-tint`) + `--hue` ring + thin outer halo (focus colour on keyboard focus), no focus rectangle, drawer `takeFocus` off in the tray, node tray header re-laid, ledger title brackets hidden, hover callout off for the open node, one toolbar row at 1366.

**Numbers.** `e2e/tree-click.spec.ts`: 3 of 3 pass (1366x768, 1920x1200, 390x844): the canvas transform and zoom are identical after three different nodes and the same node twice; tray 2 fills each time; Enter does the same and the canvas keeps focus; legend meets no row; every plate named; first row whole. vitest 1241 passed (36 files, set below), tsc exit 0.

**Not verified.** Touch input on a real phone; a tree with a stage narrower than 360 px; the classic (look off) page was only checked by the existing unit tests; dimmed branches (after Page Down) stay dimmed until Fit, unchanged.

**Remains.** At 1366 the stage is 519 px, so only two nodes of a row show with labels; the rest is a pan away. A wider canvas tray needs a shell ratio, not a Tree change. The ledger is still a mono terminal by its own spec.

### R7. Career

**What confused (measured on the old frame).** Three names for one thing (Runway, Flight board, Pipeline), a 5-column dot grid on every row, "WAITING: unconfirmed" on every row, two keys that both looked main (Add application, Do next step), and no plain "what next".

**What was built (v3 only; the older frame stays as a fixture).** `ApplicationsV3.tsx` + `Runway.tsx`:
- Tray 1 APPLICATIONS: one list, soonest closing date first (undated, closed, then ruled out); a row = days left (big, mono), name, programme, ONE stage chip, next step as a sentence, and one small "date not confirmed" tag only where the date is not confirmed. Honest: confirmed rows carry no tag.
- Tray 2 THIS APPLICATION (the soonest is chosen on open): five-step stepper (steps pressable, "Back to X" / "On to Y" keys, disabled at the ends with the reason), outcome select, Next step with its key "Do this step" and what it does, Closing date with "I checked this date today", notes and links.
- Tray 3 AHEAD: the soonest dated thing, the 120-day strip with a plain caption, the five stage counts, Campaigns under a plain heading.
- One main key: Add application (N). No "Runway", no "Flight board", plate brackets not drawn. Tab stays "Pipeline" (no registration or test renamed).
- Certs, Abroad, Money, Ladder: only a plain first sentence in the head of each (what it is for, what to press first).
- Phone: choosing a row opens tray 2 as a sheet (`PeekCtx` imported from `shell/v3/Sheets`, a deep import because the index does not export it).

**Numbers.** `e2e/career-way.spec.ts`: 3 of 3 pass at the three sizes (order, one chip a row, no WAITING in a row, choose, stepper forward and back through the mocked server, one primary key, keys >= 44 px, no text < 11 px, no sideways overflow). New unit tests: 10 (applications-v3), 7 (tree click).

**Not verified.** Against the real engine data (rows were invented and mocked in the page); Applications with many rows (list scrolls inside tray 1, not paged); the Add application drawer itself was not changed.

**Remains.** Tray 3's strip caption is the notch under the pointer (existing behaviour); at 1366 the strip and counts sit below the fold of tray 3 and scroll. The gallery notes (src/gallery/entries/T02.tsx) still say "Runway" (outside my paths).
