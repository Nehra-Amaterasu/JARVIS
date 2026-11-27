# Career engines: what the career side does and what to build next

## 2026-11-27: what the career side does today and the actions to build next

**Question.** The owner agreed that pasting his material into a chat model answers as well as this app. So which career actions need a clock, a measured memory, hands or proof, and what does the code already give them? Read-only audit of `C:/Projects/JARVIS-engine` at `9739847`. Nothing was built or run. His private inputs were read for key names only.

### What exists

| Module | What it does | Routes | Tests | Stubbed, unused or lost |
|---|---|---|---|---|
| `ww_career.py:65-160` | Pure ranking: urgency x (1 + share of asked nodes not mastered) x kind weight (`:24-28`, `:117`). One fixed-template step per item (`:36-58`). | via `/api/mission/engine/career`, voice `career_next` (`germoney.py:3567`) | `test_ww_career.py`, 7 tests | The step says "note the date you applied and when to follow up" (`:39`), but nothing computes a follow-up date. "At target" comes from a self-rated `level` (`:113`). |
| `germoney.Applications` (`:3715-3861`) | Merges the research calendar with his overrides. Holds the pipeline (7 statuses), the prep tasks with a `due` date, and the goals with milestones tied to nodes. | `routes_mission.py:494-516, 556` | `test_mission_plan.py:605, 618, 629` | `set_status` writes a dated `history` (`:3822`), but `clean_application` (`:3699-3712`) drops it from every view. `verified` is a boolean with no "checked on" date. No reminder is raised for an application. The routes return no `state` envelope (plan rule 3). |
| `ww_engines.evidence` (`:565-637`) | Awards XP by rule, or 0 with the reason. | `/api/mission/engines` | `test_mission_engines.py` | The `commit` rule (`:570`) is never fed: `actions_from_plan` emits no commit kind (`:617-637`). |
| `Plan.add_attribute` (`:2471-2496`), campaign `ship` (`:2651-2658`) | Certificates, projects and achievements on a node, each with an optional link. | `/api/mission/node/{nid}/{op}`, `/campaign/{op}` | `test_mission_plan.py` | Awards 150, 200 or 300 XP with no link, while the evidence engine gives the same records 0 (`ww_engines.py:572-573`). |
| `ww_trees.py:45-89` | Life trees. A node is mastered from filed links or from numbers other engines count. | `/api/mission/trees`, `/trees/{tree}/{node}/proof` | `test_ww_trees.py` | Proofs are a `{tree:{node:[...]}}` map in the plan state, not a shared ledger. |
| `ww_proof.py`, `github_activity.py` | The streak from public events. `local_commits` (`:89-119`) already gives sha, repo, subject and url. | `/api/mission/engine/proof` | `test_ww_proof.py` | `days()` throws away repo names and links, so commits never become dated proof lines. |
| `normalize_inputs` (`ww_engines.py:233-252`) | Normalises the private inputs. | `/api/mission/inputs` | `test_ww_wiring.py` | Deadlines keep only `id, title, date, kind, skills`. Skills keep only `id, name, level, target, weight`: the `evidence` key his file carries is dropped silently. |
| `ww_harvest.Harvester.get_fresh` (`:539-555`), `ww_harvest_sources.listing` (`:219-260`) | Polite conditional GET (ETag, Last-Modified), robots, 3 s a host, 200 a host a day, off until switched on. | R-43 to R-45, R-53, R-54 | `test_ww_harvest.py` | A new reading overwrites the old one, so no diff can be computed. Adapters exist for paper listings only. |
| `reminders.py`, G-17 | The app owns a scheduler. A reminder is made from a press. | `/api/reminders`, G-17 | `test_gcr_*` | Never used by the career side. |
| `routes_mission.py:171-185` | `drift_loop`, a 30-minute clock that speaks one nudge. | n/a | n/a | No career check runs on it. |
| `ladder_view`, `serves_for` (`germoney.py:3986-4061`) | Says why a contract serves this year's milestone. | `/api/mission/ladder` | `test_mission_plan.py:651` | n/a |

**Specification.** `jarvis-product-overhaul.md` 20.8.4 defines the evidence table: six kinds, an unlock rule, STALE windows. 20.8.6 defines Runway, Ladder and Path, Abroad, Certificates and Money. A.E09 (`ww_evidence.py`) and A.E12 (`ww_career_data.py`, "checked on" stamps) are the planned engine packages. The proposals below keep those names.

### Gaps against the eight candidates

1. **Deadlines with documents and lead times.** Missing. Deadlines carry no documents, and tasks have a `due` date but no lead time and no reminder. **Keep.**
2. **Page watch with a diff.** The polite fetch exists, but the previous reading is overwritten. **Keep**, as a new adapter kind that keeps its snapshots.
3. **Evidence ledger.** The pieces are scattered across four stores, and two XP rules disagree. **Keep, first.**
4. **Application packet.** Missing. A project's `linkedin_line` in the bank is a template, not drawn from evidence. **Keep, changed:** every bullet cites a ledger line.
5. **Skill tree done only with an artefact.** Life trees do this already. The skill tree's `mastered` and the career engine's "at target" do not. **Keep, changed:** this is a rule change on the career engine, not a new engine.
6. **Outreach tracker.** Half there: the dated history is stored but hidden. **Keep.**
7. **Move-abroad arithmetic.** Done once, a chat does the sum as well. **Changed:** kept only as a generator of dated deadline rows that age with their stamps.
8. **Aptitude practice.** The pyq tonight sheet and ledger (R-55 to R-62) already keep scores per topic per day. **Dropped as a separate engine:** aptitude becomes a subject in the pyq store.

**Dropped by the test:** "which programme suits me", "write my statement" and "rate my profile". One message to a chat answers each, and a model must not score him.

### Proposed actions, in build order

All responses use the `ww_pyq/api.py` envelope (`state`, `reason`, `source`), with errors 400, 404 and 409. Ids start at K-01. Nothing is sent, submitted or fetched without his press or his switch.

**1. Evidence ledger (A.E09).** *Proof:* a chat cannot open his commits. *Extends:* `ww_engines.evidence`, `github_activity.local_commits`, `add_attribute`, `ww_trees` proofs.
- **K-01** GET `/api/mission/evidence?node=&kind=&from=&to=` answers `items: [{id, at, kind: artefact|commit|certificate|test|session|witness, node_ids, title, link or file, source, weight, hard}]`. States: `live`, and `waiting` "No evidence yet."
- **K-02** POST `/api/mission/evidence` takes `{kind, title, link?, file?, node_ids}`. 400 when there is neither a link nor a file under the private directory.
- **K-03** DELETE `/api/mission/evidence/{id}` is a soft delete, and everything that reads the ledger recomputes.
- **K-04** POST `/api/mission/evidence/import-commits` reads `work_repos` with local git only, no network. A second run adds nothing.
- *Tests:* commits import once. A record without a link is refused. A delete lowers the tree. The XP of the plan equals the XP of the evidence engine.
- *Owner:* which repositories count, and links to certificates.

**2. Deadline rows with documents and reminders (A.E12 store).** *Clock:* a chat does not wake up on a date. *Extends:* `Applications`, `normalize_inputs` deadlines, `reminders.py`.
- **K-05** GET `/api/mission/career/deadlines` answers `items: [{id, title, closes, checked_on, requires: [{doc, lead_days, start_by, ready, task_id}], next_start_by}]`. A date older than 30 days without a check is `waiting` "unconfirmed".
- **K-06** PUT `/api/mission/career/deadlines/{id}` takes `{requires, closes?, checked_on?}`.
- **K-07** POST `/api/mission/career/deadlines/{id}/remind` makes one reminder per document at `start_by`. A second press answers the existing reminders. A switch `auto_remind` exists and is off by default.
- *Tests:* `start_by` is `closes` minus `lead_days`. No reminder is made without the press or the switch. There is never a duplicate. A past `start_by` is 400.
- *Owner:* the documents and lead times for each programme.

**3. Follow-ups (outreach).** *Memory:* the dated history already exists. *Extends:* `clean_application` keeps `history`.
- **K-08** GET `/api/mission/career/followups` answers `items: [{application, applied_at, follow_up_on, days_since, contact_note}]`. `follow_up_on` is `applied_at` plus `follow_up_days`, 14 by default and typed by him.
- **K-09** POST `/api/mission/career/outreach` stores a draft row.
- **K-10** POST `/api/mission/career/outreach/{id}/sent` is his own mark after he sent it himself. The app only opens a `mailto:` on a press.
- *Tests:* history survives `view()`. No route sends anything (socket blocked in tests). A follow-up date moves when he edits `follow_up_days`.
- *Owner:* contacts, which stay private.

**4. Official page watch.** *Clock and network, opt-in:* a chat does not re-read a page every day. *Extends:* `ww_harvest_sources` with a `watch` adapter that keeps its last N snapshots.
- **K-11** GET `/api/mission/career/watch` answers `items: [{id, address, application, on, read_at, changed_at, state}]`.
- **K-12** PUT `/api/mission/career/watch/{id}` takes `{address, on, application}`.
- **K-13** POST `/api/mission/career/watch/{id}/check` sends one conditional request.
- **K-14** GET `/api/mission/career/watch/{id}/diff` answers the lines added or removed, with dates and money amounts highlighted.
- States: `planned` when off, `live` "unchanged since ...", `fault` with the refusal. The daily check rides the existing clock only when `on`. A diff never edits a deadline: it raises "changed: confirm", and his confirmation sets `checked_on`.
- *Tests:* a 304 reuses the reading. An off watch makes no request. Each refusal holds for a day. The diff ignores markup-only changes.
- *Owner:* the page addresses and the terms reading for each host.

**5. Evidenced skills and gaps.** *Proof. Extends:* `ww_career.py`. An asked node counts only with a hard ledger line; a self-rated level shows CLAIMED.
- **K-15** GET `/api/mission/career/gaps` answers `items: [{node, asked_by: [application], evidence: [ids], status: evidenced|claimed|open|stale}]`.
- *Tests:* a self-mark alone is `claimed`. The ranking changes when one line is added.
- *Owner:* nothing new.

**6. Application packet, stopped before submit.** *Hands and proof:* it writes into his private folder. *Extends:* ledger, Applications, `ww_counsel`.
- **K-16** GET `/api/mission/career/packet/{aid}` answers `checklist: [{requirement, met_by: doc or evidence id or null}]` and `bullets: [{text, evidence_id, link, origin: rule|model-draft}]`.
- **K-17** POST `/api/mission/career/packet/{aid}/build` writes Markdown and a manifest under the private directory and answers `folder`.
- **K-18** POST `/api/mission/career/packet/{aid}/open` opens the portal page, http(s) only.
- The validator refuses a bullet with no `evidence_id`, and a model draft stays `pending` until he presses accept.
- *Tests:* a bullet without evidence is refused. Nothing posts. A rebuild keeps his edits.
- *Owner:* his CV base text and the requirements.

**7. Abroad schedule, backwards from an intake date.** *Clock:* rows age. *Extends:* K-05 rows.
- **K-19** PUT `/api/mission/career/abroad` takes `{intake, steps: [{name, lead_days, checked_on}], costs: [{item, amount, currency, checked_on}], rate: {value, date}}`.
- **K-20** GET `/api/mission/career/abroad/plan` answers dated `start_by` rows, which are added to K-05 on his press, and `gap` = costs minus the sources he typed. There are no interest rates and no forecast.
- *Tests:* each figure without a stamp is `waiting`. Rupee and euro columns stay apart. A changed intake date moves every row.
- *Owner:* every figure, each checked on the official page.

### Risks and what is not verified

- **Privacy.** `germoney.py:3676-3682` (`DEFAULT_GOALS`) and `:3893-3912` (`DEFAULT_LADDER`) put personal goal titles, amounts and target places into tracked code. The privacy test did not flag them; they should move to the private file.
- **Not checked.** The UI's reading of `/api/mission/applications`. Whether `history` breaks the UI once it is kept. The test count of `test_mission_engines.py`. The terms of any programme page. Whether any official page sends an ETag.
- **Route ids.** K-01 to K-20 are proposals. They must be entered in plan 9.0 before anyone builds against them.
- **The XP disagreement** (finding 1) changes the totals already shown. Reconciling them lowers his XP, and he should be told before it ships.
- **Sources:** code only. No web page was opened for this audit.
