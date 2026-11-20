# Overhaul gaps: what is known to be short of the mark, fixed in one pass after the first complete version

Decided by the owner on 15 Nov 2026 (spec decision D-V3-36): **first one completed version** of the new interface across the whole application, **then** one polish pass through this list. JARVIS and Well Wisher are one application and stay one. A gap found on the way is written here, not fixed mid-wave, unless it is a hard gate (unreadable text, a number without a state, a broken control).

How to use: a builder, reviewer or juror who finds a shortfall adds a row. The polish pass (after B, "every section visible") takes the rows in order of the owner's weight. A row is closed with the commit that fixed it.

## A. Direction that governs every row

1. **One family of objects.** The owner likes the Well Wisher components and wants the same kind in JARVIS: the small ring in Focus, the dial, the rails, the clay keys. A form that works in one product is reused in the other with that product's ground and ink, never redrawn.
2. **Grammar by product.** JARVIS speaks in cybersigil (the sigil ring, formed marks, corner ticks); Well Wisher speaks in ASCII (rulers, banners, the capture line). Both use terminal forms.
3. **ASCII that moves.** He wants animated ASCII art: drawn in text, moving. Rules that still hold: motion is tied to a real state or a real event, never a looping decoration on an idle screen; no requestAnimationFrame at idle; a reduced-motion form that is the finished still; a Pause control where it runs longer than a moment.
4. **Order of work.** Finish the remaining sections first (below, part B); then this list (part C).

## B. Sections still showing the old interface (to rebuild before the polish pass)

| Section | State on 19 Nov | Package |
|---|---|---|
| JARVIS Core: Talk | rebuilt | done (J01, RC1, RP1) |
| JARVIS Core: Sound | **still classic** (found by the sweep of 19 Nov: the hosted page scrolls 339 px inside the laptop canvas and 748 px sideways at 390 px, with 36 px rows and 9.5 px text). No package was ever listed for it (part D, row D5) | needs a package (S01, proposed) |
| JARVIS Room | rebuilt (merged 16 Nov without a reviewer; bug hunt owed) | done (J02, RW1) |
| JARVIS Senses | rebuilt (merged 16 Nov without a reviewer; bug hunt owed) | done (J03) |
| JARVIS Memory | rebuilt (merged 16 Nov without a reviewer; bug hunt owed) | done (J04) |
| JARVIS Console | rebuilt (merged 16 Nov without a reviewer; bug hunt owed) | done (J05) |
| JARVIS classic pages, interim tidy | dropped: J02 to J05 replaced those pages | CP1 (dropped) |
| Well Wisher Day: Today, Month | rebuilt | done (L04, RT1, L01) |
| Well Wisher Day: Week, Body, Close | **still classic**: next build batch | L03 |
| Well Wisher Focus | rebuilt | done (Y02) |
| Well Wisher Study: Paper Desk, Review Desk | rebuilt | done (Y01) |
| Well Wisher Study: generator and print | built and merged 15 Nov without a reviewer; bug hunt and one real-paper trial owed | done (X03) |
| Well Wisher Study: intake desk | built and merged 16 Nov without a reviewer: first face of `study.library`, the classic Library is its second face; waits for the intake adapter | done (C03) |
| Well Wisher Study: plan, library face, dMAT | **still classic** (tidied under the shell): next build batch; Y03 also takes `study.dmat` | Y03 |
| Well Wisher Tree, Career | **still classic** (tidied under the shell): next build batch | T01, T02 |

## C. Gaps for the polish pass

| # | Where | Gap | Source |
|---|---|---|---|
| 1 | JARVIS Core, voice stage | The voice wavelength picture is a still image; it does not animate with the voice. It must move with the real level when one exists and rest as a formed still when none does | owner, 15 Nov |
| 2 | Well Wisher Day / Month | The calendar "needs to be better" (reviewed at 7.3): to be redrawn with the Focus ring's and the dial's quality | owner, 15 Nov |
| 3 | Odometer (shared number form) | "Needs refinement": the wheels, sockets and glint | owner, 15 Nov; reviewer 6.5 |
| 4 | JARVIS, every section | The old interface is still visible in sections; they need the same components as Well Wisher (part B) | owner, 15 Nov |
| 5 | Both products | Animated ASCII art; cybersigil forms across JARVIS beyond Core | owner, 15 Nov |
| 6 | Well Wisher pages at 390 px | Tree, Career and Study pages sit a screen below the Today column; fix once in the frame, then delete four workarounds | CP2 review |
| 7 | Focus, Session | The empty state is unbalanced; the terminal strip clips its last word at 390 px | Y02 review |
| 8 | Well Wisher left rail | Text readability was not covered by the colour fix | VIS1 review |
| 9 | Proof rail | Thin beside the left rail; Recall is an empty dashed line; Reminders are bare dashes | RT1 review |
| 10 | Review Desk | A dead gap above the action row; the crop badge truncates SIMULATED | RT1 review |
| 11 | Kit Switch | Still close to a plain pill beside the reference; the detent is a faint 2 px tick | RJ1 review |
| 12 | Matte black | The lift is judged on screenshots only; to be seen on the owner's panel | RJ1 review |
| 13 | Dashboard forms | CountdownDots is rows of loose dots, not a specimen | DB review |
| 14 | Core | Three phrasings of "no level"; an empty transcript well on first run | RC1 review |
| 15 | Shell at 390 px | The view strip scrolls sideways with a half tab; header lamps have no words | QG1 sweep, jury |
| 16 | Trim | Only the gallery demo uses the kit slider; real Trim users pass their own control | RD2 review |
| 17 | Specimen layout | The strata drawing is small in a large box | RD2 review |
| 18 | Tree | Top labels clipped by the stage; Career notes orphan a letter on the last line | CP2 review |
| 19 | Native select | Its popup is checked by computed colours only, never seen | VIS1 review |
| 20 | Evidence | Whole-product jury rerun owed after part B | integrator |

### C.2 What the builders of the six unreviewed packages said they left short (their own lists, 16 Nov)

Copied on 19 Nov from each builder's report, shortened. "Route" means the screen waits for the engine lane and draws PLANNED or WAITING until then. None of these was checked by a reviewer. The generator's builder (X03) ran in an earlier workflow; its list is not in this journal.

| # | Where | Gap | Kind |
|---|---|---|---|
| 21 | Study, intake desk (C03) | No adapter yet: the desk shows WAITING in the real app and was only ever driven against a fixture. Needs the adapter over routes R-36 to R-42 and the archive listing | route |
| 22 | Study, intake desk (C03) | Undo needs a decide with state "new", which the route does not list; there is no parse-without-store route, so Paste and Calendar file create rows at once instead of previewing | route |
| 23 | Study, intake desk (C03) | Not built from the spec: "Accept and plan", "Plan a block", a per-course accept key, a source filter, the Open in Classroom and Open in Drive keys. The auto-accept switch was dropped on purpose (nothing is accepted without his press) | build |
| 24 | Study, intake desk (C03) | The Folder door is a status and instructions sheet; it does not pick a folder | build |
| 25 | Study, intake desk (C03) | Never driven inside the live shell, only as a gallery specimen. The selected-row surface it shares with the Paper Desk list wants one look | look |
| 26 | Room (J02) | Both phone views and the Switches view after the sigil marks were measured, not looked at | look |
| 27 | Room (J02) | The classic ceiling drawing (coves and lights lit from the report) is not redrawn | parity |
| 28 | Room (J02) | Heavy-load flags live in browser storage only; a second device does not share them. The setting is not in the settings index | route |
| 29 | Room (J02) | Saving a relay pin stays PLANNED (the adapter is null); per-channel schedules do not exist in any route, so the day ring draws only quiet hours and the auto-off night | route |
| 30 | Room (J02) | No energy figure is drawn anywhere; the Away card is hosted in a drawer with its classic look | decision, look |
| 31 | Room (J02) | The kit's Button, Chip, Field and Fold are sized for JARVIS by a small sheet inside the Room stylesheet; that belongs in a shared sheet. The key's "asked" sweep uses a literal 6 s, not a motion token | kit |
| 32 | Senses (J03) | Pause is window-level only (the engine keeps sensing); the motion tape holds only minutes this window was open; the arc cannot say which day the held-out check passed | route |
| 33 | Senses (J03) | The drill ring follows the server's gate of 7 days, not the spec's five rings | spec |
| 34 | Senses (J03) | The Measure my room and First light drawers are classic components under override styles and were never looked at; the drill, phone recording and train tabs render but their actions were not exercised | look, test |
| 35 | Senses (J03) | Two pieces of art have no manifest id (the waiting-for-source emblem, the vortex for WAITING); no idle-frame check was written; the bundle budget was not run by the builder | art, test |
| 36 | Senses (J03) | The phone shows all three views reflowed into one column where the spec says a status list only | spec |
| 37 | Memory (J04) | Drawn PLANNED because no route exists: delete one item, Wrong on one node, Fix and Delete for a person, a snapshot, delete raw signal and its retention, delete a namespace, span and format and single-chat export, a read route for outside assistants | route |
| 38 | Memory (J04) | A Fix is stored as a correction, not an edit of the archive line. Live Fix, capture and the review export were checked by stubbed tests only; the sandbox store is empty | route, test |
| 39 | Memory (J04) | Several PLANNED rows are literal text and are missing from the planned registry, so they do not open the "What is coming" card | build |
| 40 | Memory (J04) | The hold-to-confirm cursor, voice capture with its source tag, the reminder chip and bell are not built; the reminders strip shows one row, not two | build |
| 41 | Memory (J04) | Taste shows only when nothing is selected; on the phone the picture is replaced by a text list; the light theme was not looked at | look |
| 42 | Console (J05) | No route for a memory export, a hearing test, chat retrieval for outside agents or a caller for the always-on feed: each answers PLANNED | route |
| 43 | Console (J05) | Not drawn: the typed board address form and the hot-plug line of the classic boards card | parity |
| 44 | Console (J05) | Six classic cards (link, firmware, modules, exports, phone, remarks) keep their classic look and their own scrolling inside the folders | look |
| 45 | Console (J05) | The capture line shows on the phone (the spec says desktop only) and its unknown-verb text lacks the terminal prefix; the phone lamp list and last-events strip are not built | spec |
| 46 | Console (J05) | Core's sigil ring, pipeline ribbon and organ strip are not reused; the kit Rocker paints one warm half per rocker, so Hardware shows more than one accent fill; a decorative header tile measures 2.24:1 | kit, look |
| 47 | Console (J05) | Health leaves little slack at 665 px with four job rows; the light theme was checked on Health only; reduced motion was read from the stylesheet, not run | look, test |
| 48 | Parity ledger | Rows S01 to S05 still read "legacy host"; they are built by J03 | docs |

### C.3 What the view sweep of 19 Nov found (every view of the shell, 1366x768 and 390x844, against the sandbox)

`e2e/sweep-views.spec.ts` walked all 36 views at both sizes: 72 pictures, **no page error, no console error and no failed request anywhere**; 60 of 72 with nothing measured wrong. Then eleven pictures were looked at by the integrator. "Gate" marks unreadable or clipped text, which the rule at the top of this file says is fixed at once, not in the polish pass.

| # | Where | Gap | Kind |
|---|---|---|---|
| 49 | Room, Switches (board card) | The row of channel marks under REPORTING is cut off at the top by the dark strip it sits in | gate |
| 50 | Room, Rules | The reason beside each WAITING or LIVE lamp is cut with an ellipsis after about ten characters, so the state cannot be read; the Heavy loads note is cut the same way | gate |
| 51 | Console, Crew (route plates) | All 14 plates clamp their text and slice the last line through the middle of the letters | gate |
| 52 | Study, intake desk | Each door's WAITING reason is cut with an ellipsis at both sizes; the heading and the footnote sit against the canvas edge, out of line with the cards; the footnote touches the bottom edge. The Practice view's heading has the same edge fault and its step switch runs into the right edge | gate, look |
| 53 | Console, Hardware | Classic controls inside the folders: targets of 28 to 34 px, 10.5 px text, a button label on three lines (the measured side of row 44) | look |
| 54 | JARVIS, every rebuilt section | Three button shapes for one job: soft pills in Room; square keys with a hairline in Senses, Memory and Console. Every card carries a hairline outline. Beside the Well Wisher pages in the same window, JARVIS reads as outlined boxes, not as the same soft clay | kit |
| 55 | Senses, Presence | Three warm fills on one screen (start, on, off) and a native select; the rule is one accent per screen | kit, look |
| 56 | Phone width | Text cut with an ellipsis in Memory (Beliefs, People), Console (Events, Connections); the header lamps still have no words (row 15) | look |
| 57 | Senses, Signal | No control at all on the view; the wells are large and empty while WAITING | look |

### C.4 Found at integration on 20 Nov, after nine merges

| # | Where | Gap | Kind |
|---|---|---|---|
| 58 | Well Wisher, the shell row | The Season switch and the Roadmap key have no home. They lived on the legacy frame, which carried them into the shell's view row; since every Well Wisher view has its own registration the frame is never mounted. `e2e/shell-fixes.spec.ts` test (a) is marked to be fixed until they have one. The new shell of design language v3 is to give them a place | parity |
| 59 | Day, Body | The water gauge's arc jumps instead of filling, and three shadow changes (Day, Career) are instant: the motion rules allow no transition on an arc length or a shadow. A token-driven way to move them is owed | motion |
| 60 | Every rebuilt section | No package of 19 and 20 Nov is done: jury scores are 6.6 to 7.2 where judged (Week, Body, Close 6.6; Study plan and dMAT 6.6; Core Sound 7.2; Senses 6.8), and Tree, Career, Focus and Room have no jury score. They are judged again under design language v3 | score |

## D. Asked for and not yet in the product (audit of 15 Nov 2026)

Source: a read of the compacted chats and the owner's direction notes against the plan files and the merged code on 15 Nov. These rows are to be fixed later, not now: the build of part B comes first, then the polish of part C, then these. "Needs a package" means no wave in 15.6.1 or the reserve list (21.9) names it.

| id | Area | Asked for (neutral words) | Status on 15 Nov | Package or wave |
|---|---|---|---|---|
| D1 | JARVIS Core | The voice picture moves with the real voice level and rests as a formed still | PARTLY: still image; Python half of B07 merged | B07 UI half (needs a wave slot) |
| D2 | JARVIS Core / Memory | Choose the span, format or one chat when exporting chats | NO HOME (parity O1b) | engine route plus J04 |
| D3 | JARVIS Core / Console | An outside agent can ask JARVIS what was said about a topic (read-only, token-guarded) | NO HOME (parity O2) | engine route plus J04 and J05 |
| D4 | JARVIS Core | Rate a whole chat, not only single replies | NO HOME (parity O3) | engine verdict record plus J01 follow-up |
| D5 | JARVIS Core | The pronunciation table and the media plate and library inside Core | PARTLY: reachable only in classic pages | J01 reopened or a new sound package (needs a package) |
| D6 | JARVIS Room | Relay pins editable in a compact form with a confirm step | BUILT (RW1, J02); saving a pin waits for a route (C.2 row 29) | engine route |
| D7 | JARVIS Senses | Aankhen section with the shared components and its charts | classic page hosted | J03 (UW11) |
| D8 | JARVIS Memory | New interactive Yaadash components; weekly review and corrections | classic page hosted; review is reserve | J04 (UW10), JH07 (reserve) |
| D9 | JARVIS Console | Terminal-style console, crew roster, connections and hardware | classic page hosted | J05 (UW10) |
| D10 | JARVIS agents | An agents console, scene and rule engine, devices and energy view, briefing drawer, notices | reserve list only; no `core/agents` or `core/rules` code | JH02, JH05, JH09 to JH11 (reserve; needs a scheduled wave) |
| D11 | Well Wisher Day | Week, body (gym, water, medicines) and day-close views | classic page hosted | L03 (UW9) |
| D12 | Well Wisher Day | The month calendar redrawn to the Focus ring's quality, with a link to the user's own calendar | PARTLY: Month built; calendar link planned | gap C2; E13 (UW12) |
| D13 | Well Wisher Study | Intake desk for notes, decks and scans | builder cut off; checkpointed | C03 relaunch, then AD09 (UW9) |
| D14 | Well Wisher Study | Question-paper generator reviewed and merged; tested on one real paper | built, review owed | X03 integration; owner smoke test |
| D15 | Well Wisher Study | Scanned pages read by OCR, drafts that wait for acceptance, a question harvester, a Classroom export door | planned, work paused | EW8 relaunch |
| D16 | Well Wisher Study | Spaced review of mistakes | planned | X09, EW9 |
| D17 | Well Wisher Study | Study plan and practice, library and the dMAT view | classic pages tidied; dMAT view has no owner | Y03 (propose Y03 for study.dmat) |
| D18 | Well Wisher Classroom | Read classes, notes and deadlines from the user's Classroom | planned; no OAuth client yet | C06 (EW9), C08 (UW11), AD11 (UW12); owner sign-in |
| D19 | Well Wisher Tree | Ten expanded skill trees with imagery; keyboard navigation; in-app links | pages tidied only | T01 (UW9), E10, E11 (UW12) |
| D20 | Well Wisher Career | Revamp: internships, jobs, courses abroad, certificates, money plan | page tidied only | T02 (UW10) |
| D21 | Well Wisher habits | Counters, impulse tracking and ranking views | classic counters only; desks deferred | H04, H05 (reserve) |
| D22 | Well Wisher spending | Daily spending view | engine exists; desk deferred | H08 (reserve) |
| D23 | Well Wisher shelf | Books, music and media with explain-back | NOT PLANNED beyond a deferred shelf | H06, H07 (reserve); media parts need a package |
| D24 | Well Wisher planners | Holiday and equipment planners | NOT PLANNED | needs a package |
| D25 | Well Wisher mail | Read the user's mail and take basic actions on it | NOT PLANNED | needs a package |
| D26 | Yaadash into Well Wisher | The planner and counsel use stored memory | NOT PLANNED as work; only a shared memory port in the spec | needs a package (engine, then adapter) |
| D27 | Phone | Well Wisher Study page and the phone companion tabs | partial web page; companion is reserve | B09 (UW13), JH08, DB10 (reserve); Study page needs a package |
| D28 | Dashboards | Dashboards for every section | 4 forms built | DB05 to DB09 (UW10, UW11) |
| D29 | Whole application | Retire the old layout after the owner's OK | not started | B13 (UW14) |
| D30 | Verification | One jury and one verification wave after the build; the pass line 8.0 has not been reached | owed by the 15 Nov decision | Q01 to Q04 (UW14) and the polish pass |
