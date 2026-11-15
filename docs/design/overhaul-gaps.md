# Overhaul gaps: what is known to be short of the mark, fixed in one pass after the first complete version

Decided by the owner on 15 Nov 2026 (spec decision D-V3-36): **first one completed version** of the new interface across the whole application, **then** one polish pass through this list. JARVIS and Well Wisher are one application and stay one. A gap found on the way is written here, not fixed mid-wave, unless it is a hard gate (unreadable text, a number without a state, a broken control).

How to use: a builder, reviewer or juror who finds a shortfall adds a row. The polish pass (after B, "every section visible") takes the rows in order of the owner's weight. A row is closed with the commit that fixed it.

## A. Direction that governs every row

1. **One family of objects.** The owner likes the Well Wisher components and wants the same kind in JARVIS: the small ring in Focus, the dial, the rails, the clay keys. A form that works in one product is reused in the other with that product's ground and ink, never redrawn.
2. **Grammar by product.** JARVIS speaks in cybersigil (the sigil ring, formed marks, corner ticks); Well Wisher speaks in ASCII (rulers, banners, the capture line). Both use terminal forms.
3. **ASCII that moves.** He wants animated ASCII art: drawn in text, moving. Rules that still hold: motion is tied to a real state or a real event, never a looping decoration on an idle screen; no requestAnimationFrame at idle; a reduced-motion form that is the finished still; a Pause control where it runs longer than a moment.
4. **Order of work.** Finish the remaining sections first (below, part B); then this list (part C).

## B. Sections still showing the old interface (to rebuild before the polish pass)

| Section | State on 15 Nov | Package |
|---|---|---|
| JARVIS Core | rebuilt | done (J01, RC1, RP1) |
| JARVIS Room | classic page hosted in the new shell; the relay pin map is new | J02 |
| JARVIS Senses | classic page hosted | J03 |
| JARVIS Memory | classic page hosted | J04 |
| JARVIS Console | classic page hosted | J05 |
| JARVIS classic pages, interim tidy | builder cut off, checkpointed | CP1 |
| Well Wisher Day: Today, Month | rebuilt | done (L04, RT1, L01) |
| Well Wisher Day: Week, Body, Close | classic page hosted | L03 |
| Well Wisher Focus | rebuilt | done (Y02) |
| Well Wisher Study: Paper Desk, Review Desk | rebuilt | done (Y01) |
| Well Wisher Study: generator and print | built, review owed | X03 |
| Well Wisher Study: intake desk | builder cut off, checkpointed | C03 |
| Well Wisher Study: plan and practice, library | classic pages tidied under the shell | Y03 |
| Well Wisher Tree, Career | classic pages tidied under the shell | T01, T02 |

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

## D. Asked for and not yet in the product (audit of 15 Nov 2026)

Source: a read of the compacted chats and the owner's direction notes against the plan files and the merged code on 15 Nov. These rows are to be fixed later, not now: the build of part B comes first, then the polish of part C, then these. "Needs a package" means no wave in 15.6.1 or the reserve list (21.9) names it.

| id | Area | Asked for (neutral words) | Status on 15 Nov | Package or wave |
|---|---|---|---|---|
| D1 | JARVIS Core | The voice picture moves with the real voice level and rests as a formed still | PARTLY: still image; Python half of B07 merged | B07 UI half (needs a wave slot) |
| D2 | JARVIS Core / Memory | Choose the span, format or one chat when exporting chats | NO HOME (parity O1b) | engine route plus J04 |
| D3 | JARVIS Core / Console | An outside agent can ask JARVIS what was said about a topic (read-only, token-guarded) | NO HOME (parity O2) | engine route plus J04 and J05 |
| D4 | JARVIS Core | Rate a whole chat, not only single replies | NO HOME (parity O3) | engine verdict record plus J01 follow-up |
| D5 | JARVIS Core | The pronunciation table and the media plate and library inside Core | PARTLY: reachable only in classic pages | J01 reopened or a new sound package (needs a package) |
| D6 | JARVIS Room | Relay pins editable in a compact form with a confirm step | BUILT (RW1); the Room section itself is still classic | J02 (UW9) |
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
