# Budget rules: how both lanes spend the usage window

Decided by the owner between 14 and 15 Nov 2026. Both chats (the UI lane and the engine lane) share one usage window of five hours. These rules are binding for both and are read at the start of every loop.

## 1. The cap

- A window's total spend for the project is **80 percent** of the limit. The other 20 percent is the owner's, for anything else.
- Split of the 80: **UI lane 50, engine lane 20, reserve 10** (fix agents and retries of either lane). The UI overhaul is priority one; the engine builds beside it only inside its share.
- Neither chat can read the meter. The owner tells a chat when the window is near its cap; until measured better, a lane assumes one wave of six Sonnet agents with its fixes costs about a third of the window (measured on 15 Nov: both lanes together used 38 points in about 40 minutes).
- At the cap a lane stops launching, lets running agents finish, checkpoint-commits its worktrees, writes its resume point in the state file, and waits for the next window.

## 2. One lane builds at a time

- The window is shared, so two lanes in parallel do not buy more work, only less waiting, and each idle orchestrator still spends on every tick. From 15 Nov: **the lanes take turns**. One lane holds the build turn (launches a wave); the other only answers board requests and integrates what it already has.
- The orchestrator of the UI lane (the programme chat) gives the turn. It tells the engine chat directly (a session message) and on the board (`python tools/wave_comms.py`), so the owner prompts one chat only.
- Default order per window: a UI wave first; the engine lane gets a turn when the UI lane is waiting on the owner, on a jury, or has used its share.

## 3. Agents

- Each package is given a model tier, an effort level and an expected first-pass result before launch, and the actual result is written beside it afterwards (the state file).
- Tiers: Haiku to verify documents by sampling; Sonnet for specified builds and all reviews; Opus only where design judgement or contrast arithmetic is the hard part, and it is said out loud. Inventory across the codebase needs Sonnet at medium effort or more (low effort got 10 of 21 rows wrong).
- At most **6 agents per wave**, at most **4 running Playwright at once**. Fix agents count against the reserve.
- A builder and a reviewer run only their own folders' tests and their own specs; the whole unit suite once at the end. A reviewer of anything that touches the kit, the lamp, the clay tokens or a shell view also runs the bench and the shell specs (a missed bench run cost a fix agent on 14 Nov).
- The integrator runs the full check (`python tools/integrate_wave.py`) **once per merge batch**, never per package.
- Prompts: every agent reads the same bulletin file first (the board's `show` output saved once), not a pasted copy; an agent reads spec sections by heading and line range, opens at most 10 images, and reports in a fixed short schema.
- An agent loads a skill only when the task is that skill's subject (for example an accessibility pass, a motion pass, a design critique), names it in its report, and never loads one "to be safe".

## 4. The orchestrator

- Loop ticks at least 30 minutes apart; a tick that finds nothing new does nothing but checkpoint.
- Read summaries and reports, never transcripts; print only the fields needed from a workflow journal.
- Long state goes in the state file and the research file, not in chat; replies are short points.
- One viewing checkout serves the new interface on its own port, so showing work never needs a second build of anything.
- Screenshots for a jury come from the harness with its geometry report; jurors read a bounded sample.

## 4b. Build first, verify after (owner, 15 Nov 2026, evening)

The owner: "the build is more important right now. First we build and polish it, then we verify it." Until every section is rebuilt (the gaps file, part B):

- **No reviewer per package.** A builder runs the type check and its own tests and reports; the integrator merges on that. Reviewers were half of every wave's agents, so a window now carries about twice the building.
- **One full check per window**, not per merge batch, plus the type check and the unit suite at each merge. A cross-package break found by the full check is fixed by one agent.
- **No jury and no bench-rule policing during the build.** One jury and one verification wave come after the polish pass; what a reviewer would have caught is expected to be found there and is written into the gaps file as it turns up.
- **Art limits relaxed.** Decorative and idle motion is allowed, animated ASCII above all; the one-canvas, no-WebGL and no-idle-animation limits no longer block a build. A reduced-motion still stays, because it costs one media query.
- **What does not relax** (these are the project's standing rules, not verification): no personal details in tracked files and the privacy scan before every push; nothing simulated shown as measured; no camera; never touch the running app's port or its served folder; commits in first person with no attribution.

## 4c. Verification is back, and the bar is a score (owner, 19 Nov 2026, late evening)

The owner: "use the verifications I denied on 14 Nov too; we cannot afford mistakes at this point since we need to move fast, hence we need to be refined. The task you count as completed should have a design score of more than 8. Bring the whole UI score to at least 8.1." This replaces 4b from this moment:

- **A package is done only when a jury scores its design above 8.0.** Built, tested and merged is "built", not "done". The state file and the gaps file say which of the two a package is.
- **Every package gets a reviewer** (a different agent from its builder) before it is merged, and a jury of two after the reviewer's findings are fixed. Below the bar, the jurors' findings go back to a builder and the package is judged again, up to three rounds; after that it is reported as "built, below the bar" with its score, never rounded up.
- **The whole application's score must reach 8.1** (design and usability, the jury rubric of 13 Nov). The last whole-application jury, before the six unreviewed merges, gave 6.9 and 7.3. A baseline jury is taken first so every later score has something to be compared with.
- **Any verification method may be used**: reviewers, juries, adversarial checks of findings, the view sweep, the full check. The caps of sections 1 and 3 on agents per wave no longer bind; what binds is the machine (memory commit and at most four Playwright runs at once) and the standing rules at the end of 4b, which never relax.
- The weekly usage meter stood at 92 percent when this was decided. Work is therefore laid out so that an agent cut off mid-run loses nothing: builders leave their work in their worktree, the integrator checkpoints it, and a workflow can be resumed.

## 5. What is measured

Each wave's log line carries: agents, agent tokens, minutes, hits against the estimate. Records so far: 15 agents 4.1 million tokens; 10 agents 2.3 million; 12 agents 3.1 million in 116 minutes; a fix agent about 0.25 million; a juror about 0.26 million.
