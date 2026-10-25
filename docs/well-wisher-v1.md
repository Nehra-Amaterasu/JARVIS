# Well Wisher v1

Mission Germoney is now called **Well Wisher**. It works like the "System" in Solo Leveling, with one difference: it **advises and never decides**. It shows the record, suggests a next step and opens optional quest lines. The player chooses what to do.

Code: `app/jarvis_app/wellwisher.py` (the rules), `ww_engines.py` + `ww_*.py` (the engines, section 5), `germoney.Plan` (the only code that writes the plan state), `routes_mission.py` (the API), `app/ui/src/germoney/pages/Status.tsx` (the screen). Code ids such as `mission` and `germoney` stay as they are, so saved tabs and the voice intents keep working. Only the labels the player sees changed.

## 1. Rules

1. **Every stat and every XP point maps to a logged action.** The actions that count: a finished contract, time in the log, a learning entry, a quest session, a shipped project or certificate. Planning the day, rerolling it, starting or pausing a node, settings, the parking lot and choosing a career change no stat.
2. **What is not counted is shown, not hidden.** XP from the window games (Crucible, Drill and the rest, `POST /xp`), XP carried over from the old app, and nodes marked mastered without a finished contract all appear under "Not counted". The XP *level* still includes them, so nothing the player already earned is taken away. The stats and the rank leave them out.
3. **A rank-up needs proof.** Ranks run E → D → C → B → A → S. Each rank needs hours logged, nodes mastered with a finished contract, proof points (links), and from rank B up, shipped projects and certificates. XP never raises the rank. The screen lists exactly what is still missing for the next rank.
4. **Quest lines are optional and start off.** The System may suggest one ("Optional: …"), but only the player can turn it on.
5. **A quest level goes up only on proof.** The player must log the level's standard (sets × target) on **two different days**. Logging twice on the same day counts once. A session below the standard is still logged, but the level stays. A starting level the player picks (placement) sets the work he gets, but it never counts toward a stat.
6. **No shaming.** Advice is at most three lines, always worded as an option, and never "you must".

## 2. Screens

| Screen | What it shows |
|---|---|
| **Status** (new, docked, M14) | Rank and the requirements still missing (bars) · XP level · six stats, each with the server's sentence on how it was computed · "The System suggests" · today's quest · quest lines with on/off · not counted |
| **Today** | Unchanged, plus a **Today's quest** card: steps, cue and safety, one input per set, an optional link, and "Log session" |
| Tree / Focus / Log / Road | Unchanged; the nav brand is now `well_wisher` |

## 3. Data model

All of it lives inside the one plan key `@mission_v2`, and only `Plan` writes it.

```
st["quests"][line] = {
  on, since,
  levels{track: n},          # current level
  start_levels{track: n},    # placement; never counted
  hits{track: [dates]},      # distinct days the current standard was met
  last{track: date},         # rotation: the track rested longest is next
  earned{track: int},        # levels earned by proof   -> Vitality
  sessions{track: int}       # sessions logged with numbers -> Vitality
}
st["archive"] = {events, minutes{kind}, count{kind}, days[], xp_unbacked}
```

The plan keeps only the last 1500 events. Before `Plan.save()` trims the list, it folds the events it is about to drop into `archive` (`fold_events`), so a stat never goes down when the list is trimmed. The quest counters live in `st["quests"]` for the same reason.

The quest bank is `app/ui/src/germoney/data/bank/questlines.json`. It is not one of the skill-tree `BANK_FILES`, so the tree loader ignores it. A quest contract has the same shape as every other contract, with `source: "quest"`, `slot: "quest"`, a key of the form `quest/<line>/<track>/<date>` (valid only on its own date) and a `quest` object holding the level, the standard and the days still needed.

### Stats (all integers)

| Stat | Formula | Evidence |
|---|---|---|
| Knowledge | 5 × nodes mastered with ≥1 finished contract + finished tree contracts | `st.contracts`, `st.nodes` |
| Focus | ⌊minutes in contracts + log + learning entries ÷ 60⌋ | events + archive |
| Consistency | days in the last 30 with ≥1 logged action | events + archive days |
| Proof | contracts finished with a link + 3 × projects with a link + 3 × certificates with a link | `st.contracts`, node attributes, `st.certs` |
| Recall | practice, refresher and exam contracts finished (past-paper questions answered are shown alongside) | `st.contracts`, `questions_done` |
| Vitality | quest sessions logged with numbers + 3 × levels earned | `st.quests` |

Recall uses counts only. It never reads marks or grades.

### Rank requirements

| Rank | Hours | Nodes | Proof | Projects | Certs |
|---|---|---|---|---|---|
| D | 10 | 1 | – | – | – |
| C | 40 | 4 | 5 | – | – |
| B | 120 | 10 | 15 | 1 | – |
| A | 300 | 20 | 40 | 3 | 1 |
| S | 600 | 35 | 80 | 6 | 3 |

### The fitness quest line (calisthenics)

There are four tracks: Push (7 levels), Pull (7), Legs (5) and Core (5). Each starts at the easiest home version (wall push-up, towel row, assisted squat, 20 s plank). From Pull level 4 on, the line needs a pull-up bar. Each session takes about 15 minutes and gives 10 XP. A level earned by proof gives 25 XP. The daily track is the one trained today, or else the one rested longest, so each muscle group rests between sessions. Every level has a form cue and a safety line ("stop on sharp pain… not medical advice").

## 4. API

```
GET  /api/mission/status              Status window (read only)
GET  /api/mission/quests              lines, the record (a copy; reading never writes), today's quest contract
PUT  /api/mission/quest/{line}        {on, levels?}         on/off + placement
POST /api/mission/quest/{line}/log    {track, sets:[n..], proof?}
```

```
GET    /api/mission/engines           every engine over his data: ladder, evidence, career, money, personality,
                                      insight, today's 3, the registry (name, version, about), each engine's status
GET    /api/mission/engine/{name}     one engine by name, schema checked (status "invalid_input" + problems if not)
GET    /api/mission/weekly            the weekly review; `say` is what JARVIS reads
GET    /api/mission/money             the money engine (education, not investment advice)
POST   /api/mission/money             {kind: income|expense|saving|budget|experiment, amount, date?, hours?, experiment?, note?}
DELETE /api/mission/money/{id}        remove one money-log entry
GET    /api/mission/today             now also carries `three` (Today's 3) and `weekly` (the review card)
```

Voice (core/mission.py, answered by `POST /api/mission/voice`): "Jarvis, weekly review" / "how did my week go" → `weekly_review`; "what's my next career step" → `career_next`.

## 5. Engines

Every engine is a pure function `engine(inputs, today, **data) -> dict`: no file, clock or network inside it, the same arguments give the same answer, and the arguments are never changed. Every answer carries `engine`, `version` and `status` (`ok`, `not_built`, or `invalid_input` from `run()`). The System advises: engines rank and explain, they never change the plan.

| Engine | File | Version | What it says |
|---|---|---|---|
| goal_ladder | ww_engines.py | 2 | life goals (or flat dated goals) → this quarter → this week; scores each offered contract by the rung it serves (a listed skill 1.0, an exam contract for an exam 1.0, a shared word 0.6) |
| evidence | ww_engines.py | 1 | each action's XP by its rule, or 0 with the reason; no action, no XP |
| career | ww_career.py | 1 | career deadlines + pipeline + dated career goals ranked by urgency × (1 + share of asked-for nodes not mastered) × kind weight; one step from a template, why, days left; an exam within a week is a gate |
| money | ww_money.py | 1 | months (income, spent, saved, savings rate, budget left), income experiments in Rs/hour after their review weeks (4), a projection at 0% plus the stated return with every assumption printed; unknowns stay unknown; education only |
| personality | ww_personality.py | 1 | framing from the profile lines (puzzle first, finish lines, variety, stretch), the hard cap of 3 open projects, recovery after 2+ idle days (2 contracts, the first 15 minutes) |
| body | ww_engines.py | 0 | interface only |
| learning | ww_engines.py | 0 | interface only |
| insight | ww_insight.py | 1 | the weekly review: totals, what moved, what stalled, one change by a fixed rule list, each line with its numbers; `weekly_say()` speaks it |

**Today's 3** (`ww_engines.today_three`): the goal ladder scores every open contract on today's list; career adds the score of a top-3 career step that asks for the contract's node; personality decides how many (3, or 2 after a gap), keeps one per node, puts the shortest first after a gap and writes each pick's framing. Each pick lists the engines behind it. `Plan.today()` attaches it as `three`. If the inputs can't be read, `three` and `weekly` are `null` and the day is unchanged.

**Inputs** (`load_inputs`): `data/notes/well-wisher/engine-inputs.json` (private, git-ignored; `JARVIS_ENGINE_INPUTS` overrides the path), else the fictional `engine-inputs.example.json`. The answer's `source` says which. Schema 2 reads life goals and flat goals (`horizon`, `metric`, `target`, `deadline`), deadlines with or without ids (`title` or `item`), skill levels as numbers or words, `income_experiments`, `money.assumptions`, `profile` (traits, weak_points, prefers; no test scores) and `rules`. A missing `kind` is inferred from the words (`KIND_WORDS`). `max_open_projects` is capped at 3 and `never_shame` cannot be turned off. The test setup points the path at a missing file, so tests always use the example.

The money log is `st["money"]["entries"]` in the plan state; only `Plan` writes it.

## 6. Adding an engine

1. Write one file, `app/jarvis_app/ww_<name>.py`, with a pure function and an `ENGINE` spec:

   ```python
   from .ww_base import EngineSpec

   def sleep(inputs: dict, today: str, nights=None) -> dict:
       ...
       return {"engine": "sleep", "version": 1, "status": "ok", "date": today, ...}

   ENGINE = EngineSpec(
       name="sleep", version=1, fn=sleep, about="One line on what it says.",
       needs=("nights from Aankhen",),
       inputs={"habits": {"type": "list"}},                     # sections of the normalized inputs it reads
       data={"nights": {"type": "list", "items": {"type": "dict", "required": {"date": {"type": "date"}}}}},
   )
   ```

2. Add one line to `ENGINE_TABLE` in `ww_engines.py`: `("sleep", "ww_sleep"),`.

That's all. `run("sleep", inputs, today, nights=...)` now checks the schema before it calls the function, `/api/mission/engine/sleep` serves it (add its data to the `args` table in `Plan.engine` if it needs plan data), `/api/mission/engines` lists it, and `test_mission_engines.py` checks that it is pure. Bump `version` whenever the same input would give a different answer. Schemas use the small checker in `ww_base.check` (`str`, `num`, `int`, `bool`, `date`, `month`, `list` with `items`, `dict` with `required`/`values`, `optional`). Put its tests in `app/tests/test_ww_<name>.py` with fictional data only.

## 7. Deferred (not in v1)

- **Money as a quest line / stat.** The money engine reads the money log (education only), but no stat or XP moves on money yet beyond the evidence audit's `money_saved` rule; a stat needs an outside source of evidence: a paid gig, an invoice or a portfolio link. The research is in the private 1-crore and internship notes (G-011).
- **Social / articulation.** First it needs a way to log a real conversation or a recorded explanation without storing anyone else's words.
- **Style and brain quiz (G-012).** These have no real action that could be logged yet.
- Voice intents for the Status window and quest logging ("Jarvis, log push: 15, 15, 14").
- Moving the window games (`POST /xp`) onto logged actions. For now their XP is shown as not counted.
- Styling the Status screen beyond the existing card classes.

Both planned domains appear on the Status screen as "planned", each with this reason.
