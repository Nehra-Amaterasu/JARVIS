# Mission Germoney v2: rebuilding the data model and the engine (2026-10-23)

## Question

The first Mission rework changed the labels, not the data. Contracts came from a fixed
pool of strings with no "how", the "skill tree" was a reading page, contracts, daily
missions and campaigns were not tied to it, and there were 14 screens with six to-do
systems and two XP systems (private audit, 2026-10-14). The questions:

1. How should the game load the new research bank (skill tree, certificates,
   resources, maths track) safely while other agents are still writing it?
2. What makes a skill tree a *real* tree, and how should it be drawn?
3. How should daily contracts, exam mode, the weekly rotation and campaigns be
   generated *from* the tree and the academics, so every contract carries its context?
4. What collapses to what (screens, to-do systems, XP), and how is every save kept?
5. What must move to the server so voice works with the window closed?

## Findings and decisions

### 1. The bank loader: two loaders, one rule set, shared fixtures

- The bank is bundled into the UI with `import.meta.glob('./bank/*.json')`, which
  includes exactly the files present at build time. Any subset works.
- The server reads the same files from disk (cached by mtime and size, so files that
  land while the app runs are picked up). It needs them because voice runs without
  the window.
- Rules (identical in `data/bank.ts` and `germoney.merge_bank`): an unknown id is a
  **warning** and the reference is dropped, because a typo in one prerequisite must
  not lock a node forever. A prerequisite **cycle** is an **error**, because the tree
  would be unplayable. A file of the wrong shape is an error and is skipped.
- Both loaders are tested against the same fixture files
  (`app/ui/src/__tests__/fixtures/`), so they cannot drift silently.

**Checked against the real bank (main @ c81188c, 2026-10-23):** 73 nodes (57 tree +
16 maths), 254 contracts, 237 resources, 51 certificates, 2 careers. No errors.
The schema differed from the brief in five ways, all fixed in the loaders, none in
the data:

| Real bank | Brief assumed | Loader now |
|---|---|---|
| `covers` is sometimes a string | a list | a string is a list of one |
| certificate `credibility` is 1-5 | a word | number or word; 4+ counts as "very credible" for the stretch budget |
| a resource's `certificate` is a cert id or an object `{provider, exam_fee_inr, note}` | a string | both kept |
| contract ids are global (`math.numerical_methods.c01`) | unique per node | an index from contract id to node, used by the maths rescue |
| `math-track.practice_engine.rules` is an object (`placement`, `daily_session`, `spacing`, ...) | a list | the evening routine is read from `daily_session.evening_*` |

**Data problem to report (not edited):** 11 math-track nodes (12 references) list *resource* ids
(`math.r.nptel_*`) in their `certs` field, 8 distinct ids. They are not in
certs.json. The loader resolves each from the resource's own `certificate` object and
warns once per id. The bank authors may want to add them to certs.json.

The private academics file also differs from the brief, which is expected because it
was written later:

- Dates come from a calendar (internals start, end-sem start, which is approximate,
  and a re-sit block whose dates are set later), not one `exam_date` per subject.
- Unit weights are words (high / med / low). The loader maps them to 0.4 / 0.25 / 0.1.
- `plan.by_days_left` is a list of phases with day-by-day blocks, weekday templates
  and milestones.
- A separate maths-rescue file gives a triage of bank contracts for a maths re-sit.

The engine follows the phase plan when one covers today. Otherwise it falls back to
"an exam within 14 days, re-sits first". It never invents a date: a re-sit with no
date is reported as "date to confirm", and the voice says the expected window.

### 2. The skill tree as a DAG, drawn like the games

- Statuses: **locked** until every prerequisite is mastered, then **available**, then
  **in progress**, then **mastered**. The server and the window compute this with the
  same rule.
- Node attributes are certificates earned, projects shipped and achievements, each
  with its LinkedIn/GitHub link. Shipping a campaign adds its project automatically.
- Visual: the reference games disagree on gating, and that shaped the choice.
  *Assassin's Creed Origins* has 3 trees (Hunter, Warrior, Seer) with about 60 skills,
  where any skill linked to an unlocked one can be bought, so it is a loose graph
  ([AC wiki: Skill Tree (Origins)](https://assassinscreedwiki.accesstheanimus.com/wiki/Skill_Tree_(Assassin%27s_Creed:_Origins)),
  [Fandom: Bayek abilities breakdown](https://www.fandom.com/articles/assassins-creed-origins-bayek-abilities-breakdown)).
  *Cyberpunk 2077 2.0* cut perks ("less is more"), gated trees by attributes, and put
  a strong capstone at the top of each tree
  ([Prima Games: the new skill tree](https://primagames.com/gaming/understanding-the-new-skill-tree-in-cyberpunk-2077-all-new-perks-and-attributes),
  [GamerGuides: perk changes in 2.0](https://www.gamerguides.com/cyberpunk-2077/guide/introduction/guide-information/perk-changes-in-cyberpunk-2-0-how-perks-work-in-patch-2-0)).
  A study plan needs *strict* prerequisites (Verilog before UART). That is the DAG-of-
  skill-nodes model used in engines such as
  [Aethyr's SkillTree issue](https://git.cleverlibre.org/aethyr/Aethyr/issues/227),
  including capstones that need two branches
  ([Aethyr epic #224](https://git.cleverlibre.org/aethyr/Aethyr/issues/224)).
- Layout (pure, tested): a trunk at the bottom, the branches fanned over 150°, tiers
  as rings 115 px apart (compressed per branch, so a branch that starts at tier 2 still
  sits on the first ring), and curved prerequisite edges. The real bank draws as 73
  nodes, 118 edges and 18 branches in one SVG.
- Accessibility: every node is a focusable `role=button` with a status label, Enter
  opens it, and the arrow keys move to the nearest node in that direction. Status is
  shown by shape and dash pattern as well as colour.
- Career overlay: a soft halo whose size and opacity follow the chosen career's weight
  for the node. With no career chosen, each node uses the best weight either career
  gives it.

### 3. The engine: contracts from the tree, with their context

- **Day plan**: library block (3 h, weekdays, the rotation's track), protected
  social/rest slot (never filled), evening block (practice questions + JARVIS),
  weekend: one light contract. The day is **frozen** once built, so finishing one
  contract never reshuffles the rest. It is rebuilt only if the exam subject changes,
  the bank was empty, or he asks.
- **Ranking**: in-progress nodes first (+100), the node the rotation stopped at last
  week (+20), the career weight (×50), membership of an active campaign (+40),
  staleness (up to +14), lower tiers first. New nodes only while the WIP cap has room.
- **Context on every contract**: the node's primary resource, *and the lesson of each
  prerequisite it builds on* (so an HDLBits contract links the digital-logic lesson),
  a backup, legal PDFs, steps, a hint and a "done when". This follows the
  implementation-intentions evidence: plans that fix when, where and how beat bare
  goals, d = 0.65 over 94 tests (Gollwitzer & Sheeran 2006; figure and CI as quoted in
  [Frontiers in Psychology 2021](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.565202/pdf);
  I did not read the original chapter).
- **Evening**: spaced recall on a node from another track, last worked 1+ days ago.
  In exam mode it is the rescue's foundation contract for the next unit. The bank's own
  practice_engine cites the spacing and retrieval evidence (Cepeda et al. 2008;
  Dunlosky et al. 2013; Roediger & Karpicke 2006).
- **Exam mode**: the phase plan, or the 14-day window; re-sits first; high-weight
  units first; `skip_if_short` units dropped with 7 days or less left; past papers in
  the steps. "Exam mode for X" forces a subject for 14 days.
- **Weekly rotation** (editable): Mon digital/HDL, Tue maths, Wed ML/DL, Thu
  academics, Fri comp-arch/RISC-V/security. A track that has nothing open borrows
  the best node anywhere and says so.
- **Campaigns**: a node with a project plus its unmastered prerequisite closure, with
  hours left, weeks at about 6 h/week, a finish line, and ship steps (GitHub, the
  LinkedIn line, the certificate). At most 3 active.
- **Certificates against the budget**: free / in budget (≤ ₹3,000) / stretch (≤
  ₹5,000 and credibility 4/5+) / over budget.

Shaped by a private personality report (scores not recorded here): starting is easy,
finishing is hard, routine confines. So: a cap of 3 nodes and 3 campaigns, an
explicit finish line and ship step on every campaign, a parking lot for new ideas,
variety through the rotation, the day's small wins on Today, and no shaming copy.
Rule 1 no longer drops a rank or locks a Purgatory.

### 4. What was removed or merged

| Before | After |
|---|---|
| 14 screens (HQ, Contracts, Campaign, Trials, Drill, Armory, Crucible, Forge, Syllabus, Terminal, Interrogation, Proof, Schedule, Calibration) | 5: **Today** (HQ + Contracts + Schedule), **Tree** (Syllabus), **Focus** (Crucible + Drill), **Log** (Terminal + Forge + Interrogation + Proof), **Road** (Campaign + Trials + Armory shop/War Chest); settings and Calibration in a drawer |
| 6 to-do systems (contracts, AI side quests, weekly operations, boss steps, Boot Camp, Overdrive/Sunday checklists) | 1: plan contracts |
| 2 XP systems (engine level from XP; `player.level` rank 1-10) | 1: the server's XP total (migrated from the save); level from XP; rank retired |
| 4 log paths with different effects | 1: the plan's log (form, voice, gym) |
| static contract pool (`game/contracts.ts`), weekly operations (`game/operations.ts`), side-quest engine (`utils/quest-engine.ts`), unused `data/quest-hints.ts`, static syllabus (`data/knowledge-base.ts`) | deleted; the universities list was kept (`data/universities.ts`) |
| 12 monthly bosses with HP | retired as a mechanic; shown as the Season One record on the Road; their deliverables are tree projects now |

### 5. Saves and migration

- Nothing is deleted. The old keys (`@silicon_game_v1`, `@silicon_player_v2`, logs,
  proofs, workouts, failures) stay. The plan is a new key, `@mission_v2`, in the same
  store, so the daily snapshots (14 kept) cover it (tested).
- First v2 load: the plan's XP starts from `@silicon_player_v2.xp`. In the window, every
  active weekly-operation stake is paid back (once, flagged `v2`), and an old
  Purgatory is lifted with its level restored.
- Plan events (contracts done, time logged) are applied to the Floor and the ledger
  exactly once (`g.synced`). They pay Marks but never XP twice.

### 6. Added the same day: the internship campaign, real papers, the ladder, gaps, the profile, the learning log

- **Internships** are a campaign of their own: a private pipeline (`applications.json`
  plus a research calendar `internships.json`), with statuses idea / preparing /
  applied / interview / offer / rejected / not eligible (with a reason), countdowns,
  "verify the date" flags, prep tasks, and deadlines within 14 days on Today and by
  voice. Seeded from the private internship note: 8 to prepare and 4 ruled out.
- **Real papers**: the rebuilt academics file has a question bank (42 / 26 / 20
  questions for each re-sit subject), a paper pattern and a pass rule. Exam contracts
  pull real questions at about 3 minutes a mark (the SEE's pace: 60 marks in 3 h) and
  never repeat a finished one. SEE marks needed = max(SEE floor, ⌈45 % × 100⌉ − IA
  carried): the end-sem marks needed for each re-sit. A file route serves notes and papers only from the
  academics folder and the OneDrive COLLEGE folder (resolved path, allowed extensions;
  traversal tested).
- **The goal ladder**: vision (fixed) → year milestones → quarter / month / week
  (derived) → contracts, each tagged with the milestone it serves; a monthly review.
- **Gaps**: welcome back after 4 idle days (no streak drama; what slipped, said
  plainly), refreshers for mastered nodes after 30 days, and a drift nudge after 3 days
  (once a day, never in quiet hours). The idea that effortful recall restores what
  decayed is the same retrieval evidence the bank cites.
- **The profile** (private, no scores): puzzle before theory, 2-3 choices, short
  sprints, the cap, quiet hours. JARVIS's mission context includes its rules.
- **The learning log**: free text, voice or files, saved under
  `learning/YYYY/MM/<date>_<slug>/` with a `meta.json`, matched to tree nodes by shared
  words with node names and outcomes (correctable), and paid in XP. Limits: 6 files,
  10 MB each, allowed types only, base names only (no paths).

## Numbers

- Python: 121 tests in `test_mission_plan.py` + `test_game_bridge.py` after the
  additions (100 at the first commit).
- UI: 238 tests (22 files), including the loader on the real bank.
- Real bank: 73 nodes / 254 contracts / 51 certs, 0 errors, 8 warnings (all one kind,
  above).

## What it changed

- `app/jarvis_app/germoney.py` (the plan engine), `app/jarvis_app/routes_mission.py`
  (`/api/mission/*`), `core/mission.py` (voice intents through the server).
- `app/ui/src/germoney/`: `data/bank.ts`, `game/tree.ts`, `game/plan.ts`, the five
  screens and the drawer, and the store, bridge and player-store changes.
- `docs/design/mission-game.md` (the v2 section).

## Sources

- [AC wiki: Skill Tree (Assassin's Creed: Origins)](https://assassinscreedwiki.accesstheanimus.com/wiki/Skill_Tree_(Assassin%27s_Creed:_Origins))
- [Fandom: Assassin's Creed Origins, Bayek abilities breakdown](https://www.fandom.com/articles/assassins-creed-origins-bayek-abilities-breakdown)
- [Prima Games: the new skill tree in Cyberpunk 2077](https://primagames.com/gaming/understanding-the-new-skill-tree-in-cyberpunk-2077-all-new-perks-and-attributes)
- [GamerGuides: perk changes in Cyberpunk 2.0](https://www.gamerguides.com/cyberpunk-2077/guide/introduction/guide-information/perk-changes-in-cyberpunk-2-0-how-perks-work-in-patch-2-0)
- [Aethyr: SkillTree as a DAG with prerequisites and tiers (#227)](https://git.cleverlibre.org/aethyr/Aethyr/issues/227), [capstones across branches (#224)](https://git.cleverlibre.org/aethyr/Aethyr/issues/224)
- [Frontiers in Psychology 2021, quoting Gollwitzer & Sheeran 2006 (d = 0.65)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.565202/pdf)
- Spacing and retrieval evidence as cited inside the bank's `math-track.json` practice_engine (Cepeda et al. 2008; Dunlosky et al. 2013; Roediger & Karpicke 2006).
- Private: `data/notes/research/2026-10-14-feature-inventory.md` (the audit).
