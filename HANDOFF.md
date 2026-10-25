# Handoff: Well Wisher v1 (worktree agent-a25fa3e98b9c02a87, base f7682d0)

## Done (committed, not pushed or merged)
- d6f8ae4: `app/jarvis_app/wellwisher.py`: Status window. 6 stats built from logged actions only, each with the sentence that computes it. Ranks E–S are proof-gated. An event archive means trimming events never drops a stat. Also the calisthenics quest line (`app/ui/src/germoney/data/bank/questlines.json`, force-added). Routes: status, quests, quest/{line}, quest/{line}/log.
- 380cd95: UI renamed to Well Wisher (nav brand `well_wisher`, dock divider, ticker tag, Core card). New Status screen (`pages/Status.tsx`, docked as M14). Quest card on Today.
- b4b88d1: `docs/well-wisher-v1.md`, plus a research note and its index line.
- 20c3494: `app/jarvis_app/ww_engines.py`, a registry of 8 pure engines. Built: goal_ladder and evidence. The other six are interfaces only. Inputs come from `data/notes/well-wisher/engine-inputs.json`; if that file is missing, `engine-inputs.example.json` (fictional) is used. Adds `GET /api/mission/engines`. Last "Mission Germoney" strings renamed.

## Test status
- `pytest app/tests -k "germoney or mission"`: 268 passed at d6f8ae4. The 12 new engine tests also pass (30/30 for wellwisher + engines). The full -k run was not repeated after 20c3494.
- vitest, all germoney files (mission-*, game-*): 111 passed. `tsc -p tsconfig.app.json` clean. Needs `app/ui/node_modules`, a junction to the main checkout (git-ignored).

## In progress / exact next step
1. Rerun the full `pytest app/tests -k "germoney or mission"` once.
2. Add an "Engines" section to `docs/well-wisher-v1.md`: registry contract, inputs schema, the ladder scoring rule (urgency × weight × gap, one pick per node first).
3. Optional UI: show `/api/mission/engines` → `ladder.today` ("Today's three, and why") on Status.
4. When the other agent writes `engine-inputs.json`, check its keys against `normalize_inputs`. It also accepts `goals` as an alias for `life_goals`.

## Notes
- The live app still shows `m:ss:on_ger-money` until this branch is merged and the UI is rebuilt.
- `app/ui/src/germoney/data/exercises.ts` (pre-existing, tracked) contains body weight and height in a comment. It is personal data and should be scrubbed.
