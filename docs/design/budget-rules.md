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

## 5. What is measured

Each wave's log line carries: agents, agent tokens, minutes, hits against the estimate. Records so far: 15 agents 4.1 million tokens; 10 agents 2.3 million; 12 agents 3.1 million in 116 minutes; a fix agent about 0.25 million; a juror about 0.26 million.
