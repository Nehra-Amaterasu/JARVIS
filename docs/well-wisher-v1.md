# Well Wisher v1

Mission Germoney is now called **Well Wisher**. It works like the "System" in Solo Leveling, with one difference: it **advises and never decides**. It shows the record, suggests a next step and opens optional quest lines. The player chooses what to do.

Code: `app/jarvis_app/wellwisher.py` (the rules), `germoney.Plan` (the only code that writes the plan state), `routes_mission.py` (the API), `app/ui/src/germoney/pages/Status.tsx` (the screen). Code ids such as `mission` and `germoney` stay as they are, so saved tabs and the voice intents keep working. Only the labels the player sees changed.

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

## 5. Deferred (not in v1)

- **Money / skills for income.** First it needs an evidence source: a paid gig, an invoice or a portfolio link. Until then it would only count claims. The research is in the private 1-crore and internship notes (G-011).
- **Social / articulation.** First it needs a way to log a real conversation or a recorded explanation without storing anyone else's words.
- **Style and brain quiz (G-012).** These have no real action that could be logged yet.
- Voice intents for the Status window and quest logging ("Jarvis, log push: 15, 15, 14").
- Moving the window games (`POST /xp`) onto logged actions. For now their XP is shown as not counted.
- Styling the Status screen beyond the existing card classes.

Both planned domains appear on the Status screen as "planned", each with this reason.
