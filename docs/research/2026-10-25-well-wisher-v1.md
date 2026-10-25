# Well Wisher v1: the System's stats and a calisthenics quest line (2026-10-25)

## Question
How can Mission Germoney become a Solo-Leveling-style "System" without engagement bait? The stats must come from evidence, a rank-up must need proof, and at least one life domain beyond study must work as an optional quest line.

## Findings
- **XP already had an unbacked path.** `POST /api/mission/xp` (the window games) adds XP that has no logged action behind it. `master_node` lets a node be marked mastered with no finished contract. v1 keeps both, so the player loses nothing he earned, but leaves them out of every stat and every rank and lists them under "Not counted".
- **Trimming the event list would lower stats.** `Plan.save()` keeps the last 1500 events. Any stat summed over events would drop as the list was trimmed. Fix: before trimming, fold the dropped events into `st["archive"]`. The test logs 1700 sessions of 30 minutes and checks that Focus stays at 850 h.
- **Fitness evidence.** The WHO 2020 guidelines recommend muscle-strengthening activity on 2 or more days a week for adults. So a 15-minute daily session that rotates four tracks gives each muscle group 1–2 sessions a week with rest in between.
- **The progression shape** follows the r/bodyweightfitness Recommended Routine: easy-to-hard steps (wall → incline → knee → full push-up; rows → negatives → pull-ups), each with a fixed standard of sets × reps. The rule "the same standard on two different days" stops one lucky day from counting as a level. It is my choice, not taken from the source.

## Numbers
- 6 stats, 6 ranks (E–S), 4 tracks, 24 levels in total.
- Session: 15 min, 10 XP. A level earned by proof: 25 XP, 3 Vitality.
- Tests: 18 new pytest tests (`app/tests/test_mission_wellwisher.py`) and 5 vitest tests (`mission-wellwisher.test.ts`). The germoney/mission suite went from 250 to 268 tests, all passing.

## Sources
- WHO guidelines on physical activity and sedentary behaviour (2020): https://www.who.int/publications/i/item/9789240015128
- r/bodyweightfitness Recommended Routine (progressions): https://www.reddit.com/r/bodyweightfitness/wiki/kb/recommended_routine/

## What it changed
- New `app/jarvis_app/wellwisher.py`, `questlines.json`, the Status screen, and the quest card on Today. The design is in `docs/well-wisher-v1.md`.
