# Parity ledger: every classic feature and its home in shell v2

Decision D-V3-29 (docs/design/jarvis-product-overhaul.md, rows at "D-V3-29"): the overhaul is an upgrade, so every
feature of the classic interface has a home before the `app.shell` flag flips (B13 retires the old layout). This file
is that list. Written 14 Nov 2026 (package PL1, documents only; no code changed). Method: Grep and Glob over
`app/ui/src/{pages,components,jarvis,germoney,ww,lib}`, the route table in `app/jarvis_app/server.py` and the
`routes_*.py` docstrings, the id table `app/ui/src/shell/ids.ts`, the legacy host table `app/ui/src/shell/hosts.ts`,
and spec 3.1.2, 3.2, 15.6.2, 20.6 and 20.14.

## How to read the status column

- **BUILT**: the view in shell v2 is a registered view (`shell/views/*.view.ts`) and carries the feature.
  Today only `core.talk` is registered (`shell/views/core.view.ts`, package J01 plus RC1).
- **LEGACY HOST**: no new view yet; `shell/hosts.ts` draws the classic page inside the new canvas, so the feature
  works but is not yet better placed or better drawn. This counts as "has a home, not built yet".
- **NOT BUILT (pkg, wave)**: the spec names the home and the package that builds it.
- **NO HOME**: nothing in the spec or code carries it, or it was lost when the classic page was replaced.
- **not traced**: searched, nothing found; the search is stated.

Wave codes are those of spec 15.6.2 (UW7 and later are the unified waves after the craft pass).

## A. The five features the owner named (evening of 14 Nov)

| id | Feature in plain words | Where it is today | Route or store | Home in shell v2 | Status |
|---|---|---|---|---|---|
| O1 | Export the conversations as a readable file ("Review for Claude", last 7 days, flagged turns first) | `pages/Core.tsx` `ReviewButton` (line 284); button "Review for Claude" (the code label; spec lines 166 and 3792 rename it "Share a review") and the icon button with aria-label "Open the reviews folder" | `POST /api/transcripts/export {days}` writes `data/reviews/review-*.md` (server.py 478, `transcripts.export_review`); `GET /api/transcripts/summary?days=`; `POST /api/open {which:"reviews"}` | `memory.keep`, Actions (spec 3.1.2 table, I39, 20.6 "Imports and exports"); package J04, UW10 | NOT BUILT (J04, UW10). Regression under the flag: the new `CoreTalk` has no export control (no `transcripts/export` anywhere under `jarvis/core`), and `memory.keep` is hosted by the classic Connect page, which has only the source imports. The export is unreachable in shell v2 today. |
| O1b | Choose the span, the format (Markdown, JSON, plain text) or one single chat to export | not in the classic UI (only a fixed 7 days, Markdown) | none (the route takes `days` only) | none named | NO HOME |
| O2 | Retrieval of JARVIS chats for Claude and other agents (an agent asks "what did we say about X") | not traced. The only hand-off is the review file of O1. `core/agent.py` `retrieval_query` is JARVIS's own recall of past chats, not an interface for outside agents. | none: Grep of `app/jarvis_app` and `core` for mcp, agent_read, chat_search, for_agents found no route | `console.crew` holds the PLANNED `jarvis.agents` card (spec line 2926), which is for agents that act on their own, not for retrieval; no retrieval surface exists | NO HOME |
| O3 | Rate a whole chat (a session) | not in the classic UI: Grep for rating, rate, thumb finds only the per-turn verdict buttons and unrelated relay and tariff ratings | none | none | NO HOME |
| O3b | Rate one response: Good, Wrong, Slow, Misheard, plus "what I expected" and "Teach him" (keeps the right answer as a correction) | `pages/Core.tsx` `TurnRow` (line 220), `teach-toggle` checkbox (line 269) | `POST /api/transcripts/flag {session,id,verdict,expected}` (server.py 467; `transcripts.VERDICTS` = wrong, slow, misheard, good); `POST /api/memory/teach` | `core.talk`, under each turn (`jarvis/core/Transcript.tsx` `onFlag`, `useCoreLive.ts`) | BUILT (J01, RC1). Teach is a native checkbox there (see switch-census.md). |
| O4a | Voice mode or text mode (wake with microphone, or type only, about 1 GB less VRAM) | `pages/Core.tsx` line 36 and 89 | `POST /api/core/start {mode}`, `/api/core/stop` | `core.talk` mode radio, `jarvis/core/CoreTalk.tsx` line 141 | BUILT (J01) |
| O4b | Choose JARVIS's voice (British, American, Indian English, offline Kokoro), speed, "Test voice" | `components/ConnectControls.tsx` `VoiceCard` (line 112); `lib/settings.ts` `loadVoice`, `chooseVoice`, `VOICE_GROUPS` | `GET/POST /api/settings/voice`, `POST /api/settings/voice/test`, `GET /api/settings/voice/preview` | spec 20.6: `core.talk` header (voice groups, speed slider, test). `jarvis/core` does not import `chooseVoice` (Grep). Meanwhile reachable through `console.connections` (LEGACY HOST). | LEGACY HOST; NOT BUILT on `core.talk` (needs a Core follow-up package, none assigned) |
| O4c | Accent steering: the tags `[us]`, `[uk]`, `[hi]` and `[in]` (as listed in `core/voice.py` and `pages/Core.tsx`) in a reply pick the accent, and are never shown | `pages/Core.tsx` line 26 (strip rule); `core/voice.py` | tags stripped in the client, accent applied in `core/voice.py` | `jarvis/core/model.ts` line 232 keeps the strip rule | BUILT (J01) |
| O4d | Spoken-word fixes (pronunciation table: word and "say as") with hear and remove | `components/ConnectControls.tsx` `PronunciationCard` (line 167) | `GET/POST/DELETE /api/settings/pronunciations`, `/api/settings/pronunciations/{w}` | spec 20.6: `core.talk` Trim, second tab. Not in `jarvis/core` (Grep). Reachable through the legacy Connect host. | LEGACY HOST; NOT BUILT on `core.talk` (Core follow-up, none assigned) |
| O4e | Offline voice module (Kokoro) and "free GPU" timed switches | `ConnectControls.tsx` `ModulesSection` (line 218) | `/api/settings/modules`, `/api/settings/modules/{id}`, `/api/settings/modules/unload_all/run` | `console.health` (spec 20.6) | LEGACY HOST (J05, UW10) |
| O5 | Static use of pictures: one art plate per section with a still and a reduced-motion form, never pasted, never in the public repo | `art/ArtSlot.tsx`, `art/art-manifest.json` (16 ids: `art.core.hill`, `art.core.hill-ring`, `art.core.hill-still`, `art.day.sun`, `art.focus.dots`, `art.memory.branch`, `art.proof.ring`, `art.room.faceplate`, `art.senses.spindle`, `art.study.island`, `art.tree.trunk`, `art.career.skyline`, `art.console.frame` and three shell textures); classic pictures: `PhoneCard` QR image (`components/PhoneCard.tsx` 116), `germoney/Reader.tsx` image viewer (196), photo proof (`germoney/ui.tsx` 277 and 295), the new-shell pairing QR (`ww/overlays/Phone.tsx` 134) | resolved by id in `art/resolve.ts`; private track `VITE_ART_TRACK=private` | one centrepiece per section (spec 8.1, G03 merged in UW5) | PARTIAL. Only `core.talk` mounts `ArtSlot` (`jarvis/core/CoreTalk.tsx`, id `art.core.hill-ring`). The other centrepieces mount with their section package (J02, J03, J04, J05, L01, L03, L04, Y01, Y02, tree). Corrected on verification: Well Wisher's photo proof and the pairing QR are static pictures too; neither is an ArtSlot plate, so the proof rail (L04) and the pairing sheet each need their own mount. |

## B. JARVIS classic features

Classic tabs come from `lib/store.ts` `TABS` and `components/Shell.tsx`; page files are in `app/ui/src/pages`.

| id | Feature | Where today | Route or store | Home in shell v2 | Status |
|---|---|---|---|---|---|
| C01 | Wake and sleep JARVIS, boot steps, state chip | `pages/Core.tsx` `CorePage`, `BootSteps` | `/api/core/start`, `/api/core/stop`, `/api/core` | `core.talk` and the title-bar core chip | BUILT (J01) |
| C02 | Type to JARVIS in text mode | `Core.tsx` `Conversation` | `POST /api/core/say` | `core.talk` composer | BUILT (J01) |
| C03 | Conversation with turn flags and earlier turns | `Core.tsx` `Conversation`, `GET /api/core/transcript` | `lib/store.ts` | `core.talk` transcript and Earlier drawer | BUILT (J01) |
| C04 | Latency strip: heard, first word, full reply | `Core.tsx` `Latency`; `pages/System.tsx` `Stage` | `/api/settings/latency`, `/api/system` | `core.talk` pipeline ribbon (J01) and `console.health` | BUILT on talk (J01); health LEGACY HOST |
| C05 | Systems card and Staff roster on Core | `Core.tsx` `SystemsCard`; `components/Staff.tsx` | `/api/crew` | `console.health`, `console.crew` ("Assistants") | LEGACY HOST (J05, UW10) |
| C06 | Media: now playing, transport, source choice, receipts | `components/MediaCard.tsx`; `lib/media.ts` | `/api/media/state`, `/play`, `/control`, `/settings`, `/ack`, `/file/{id}`, `/local` | `core.sound` Now plate | LEGACY HOST; NOT BUILT (no package listed for `core.sound` in 15.6.2; see NO HOME list) |
| C07 | Library: ingest, ask, open a document | `components/LibraryPanel.tsx` | `/api/library`, `/ask`, `/doc/{id}`, `/ingest` | `core.sound` library list (spec region table) | LEGACY HOST; NOT BUILT (same gap as C06) |
| C08 | Spotify as a media source (the classic card lists Auto, Folder, YouTube, YT Music, Spotify). The "Spotify search button" is NOT classic: spec line 165 makes it new | `components/MediaCard.tsx` (header comment, source list) | `/api/media/play`, `/api/media/settings` | PLANNED plate in `core.sound` (registry `jarvis.spotify`); the source choice rides with C06 | has a home as PLANNED (C06 carries the source list) |
| C09 | Command palette (Ctrl K): go, do, ask; core, fan, light, scenes | `components/CommandPalette.tsx` | `/api/core/*`, `/api/limbs/fan`, `/light`, `/scene/{focus,sleep}`, `/api/aankhen/start` | shell palette (B05, `jarvis/shellPorts.ts`) | BUILT (B05) |
| C10 | Unprompted remarks switch ("Unprompted remarks") | `components/RemarksCard.tsx` | `/api/settings/proactive` | `console.connections` detail pane (spec 1193) | LEGACY HOST (J05) |
| R01 | Eight-channel wall box: power each channel, last mode | `components/WallBox.tsx`; `pages/Limbs.tsx` `DeviceCard` | `/api/limbs`, `/api/limbs/{id}`, `/api/limbs/scene/{mode}` | `room.switches` | LEGACY HOST (J02, UW9) |
| R02 | Modes (scenes): create, edit, delete | `Limbs.tsx` `Modes`, `ModeEditor` | `/api/limbs/modes/`, `/modes/new` | `room.rules` (spec: "Edit modes" goes to `room.rules`) | LEGACY HOST (J02, UW9) |
| R03 | Presence rule: lights follow presence, quiet hours | `Limbs.tsx` `PresenceRule` | `/api/limbs/presence-on`, `/presence-on/settings` | `room.rules` | LEGACY HOST (J02, UW9) |
| R04 | Away mode: arm, disarm, phones, neighbours, incidents | `components/AwayModeCard.tsx`, `SecurityAlert.tsx` | `/api/security`, `/arm`, `/disarm`, `/check`, `/config`, `/phones`, `/neighbors`, `/incidents` | `room.rules` (alert renamed MotionNotice) | LEGACY HOST (J02, UW9); spec says PLANNED or WAITING unless the backend is confirmed live |
| R05 | Energy: circuits, nudges, auto-off, tariff | `components/EnergyCard.tsx` | `/api/energy`, `/auto-off`, `/circuits/{id}`, `/nudges/{id}` | `room.rules` | LEGACY HOST (J02, UW9) |
| R06 | Relay wiring checklist and per-relay test | `components/RelayWiring.tsx` | `/api/limbs/{id}/test` | `console.hardware` | LEGACY HOST (J05, UW10). Conflict: spec line 346 says delete `RelayWiring` (Arduino Uno guide), which D-V3-29 does not allow; the owner decides (section D) |
| R07 | Reminders list and alerts | `components/RemindersCard.tsx`, `ReminderAlerts.tsx` | `/api/reminders`, `/api/reminders/{id}` | `memory.recall`; alerts mounted once in the shell | LEGACY HOST (J04, UW10) |
| S01 | Aankhen live view: twin, presence core, zones, motion | `pages/Aankhen.tsx`, `src/twin/**` | WebSocket frames, `/api/aankhen/start`, `/snapshot`, `/zones` | `senses.presence` | LEGACY HOST (J03, UW11) |
| S02 | Signal view (what the channel itself sees, renamed from Eyes) | `components/EyesView.tsx` | frame stream | `senses.signal` | LEGACY HOST (J03, UW11) |
| S03 | Teach and train: zone labels, mini drill, fan drill, correction, narrate labelling | `components/TeachTrainPanel.tsx`; `lib/teachTrain.ts` | `/api/aankhen/{correct,train,minidrill*,drill/fan,narrate/*}` | `senses.teach` | LEGACY HOST (J03, UW11) |
| S04 | Readiness, room measure, first light | `MeasureRoom.tsx`, `FirstLight.tsx` | `/api/aankhen/readiness`, `/room-measure`, `/firstlight*` | `senses.teach` and `senses.presence` | LEGACY HOST (J03, UW11) |
| S05 | Prediction bar and learned-model card | `PredictionBar.tsx`; `Aankhen.tsx` `LearnedCard` | frames | `senses.presence` | LEGACY HOST (J03, UW11) |
| M01 | Memory search and results | `pages/Yaadash.tsx` `Results` | `/api/memory/search` | `memory.recall` | LEGACY HOST (J04, UW10) |
| M02 | Belief queue: confirm or reject; questions | `Yaadash.tsx` `BeliefQueue` | `/api/memory/beliefs/{id}`, `/api/memory/questions` | `memory.beliefs` | LEGACY HOST (J04, UW10) |
| M03 | Learned lately review | `components/LearnedReviewCard.tsx`; `lib/learned.ts` | `/api/memory/learned`, `/learned/{id}` | `memory.beliefs` or `memory.recall` | LEGACY HOST (J04, UW10) |
| M04 | People (scored threads) | `Yaadash.tsx` `People` | `/api/memory/people` | `memory.people` | LEGACY HOST (J04, UW10) |
| M05 | Taste topics | `Yaadash.tsx` `Taste` | `/api/memory/taste` | `memory.recall` (spec 3.1.2) | LEGACY HOST (J04, UW10) |
| M06 | Memory galaxy (3D graph) and GrowthChart | `components/MemoryGalaxy.tsx`, `GrowthChart.tsx`; `lib/galaxy.ts` | `/api/galaxy`, `/api/galaxy/node` | retired by B13 (spec 3269 list: "Retire old layout, galaxy, GrowthChart") | has a decided end: retire (B13, owner OK). Confirm the owner agrees, because it is a feature loss. |
| M07 | Memory stats tiles (messages, people, facts, taste, waiting) | `Yaadash.tsx` `Stat` | `/api/memory/stats` | `memory.recall` header | LEGACY HOST (J04, UW10) |
| M08 | Memory exports: request, drop file, read what is in it, per source | `ConnectControls.tsx` `ExportsSection` | `/api/imports`, `/api/imports/{id}` (`imports.py`) | `memory.keep` (spec 3.1.2, 20.6) | LEGACY HOST (J04, UW10); the classic Connect page is the host of `memory.keep` today |
| M09 | Delete raw signal now; retention; backup snapshot count | not traced in classic `pages/*`; searched `pages/**` and `components/**` for "raw signal", "retention", "snapshot" (only Aankhen and shell hits, none a delete); `app/jarvis_app` for "retention" and "raw_signal": no hit | not traced as a classic feature | `memory.keep` (spec 20.6 table: SU14 Backup; line 440 "Delete raw signal now") | NOT BUILT (J04, UW10); the classic feature itself is not traced |
| K01 | Health: stages, logs, brain restart, steward run | `pages/System.tsx` | `/api/core/logs`, `/api/crew/steward/run`, `/api/system` | `console.health` | LEGACY HOST (J05, UW10) |
| K02 | Brain model choice and restart | `ConnectControls.tsx` `BrainCard` | `/api/settings/brain`, `/brain/restart` | `console.health` model radio group (20.6) | LEGACY HOST (J05) |
| K03 | Detected integrations (ports, models, exports) with copy-command | `pages/Connect.tsx` `Integration`; `/api/connect` | `/api/connect` | `console.connections` | LEGACY HOST (J05) |
| K04 | Phone pairing card (QR, devices, revoke) | `components/PhoneCard.tsx`; `lib/phone.ts` | `/api/remote`, `/api/remote/pair`, `/api/remote/devices/{device_id}` | shell sheet `pair` (spec: replaces Phone overlay) | LEGACY HOST (B09, J05); duplicate PhoneCard retired by B13 |
| K05 | Boards: list, scan, wifi, compile, flash, ESP32 link | `BoardPanel.tsx`, `BoardPorts.tsx`, `FirmwareCard.tsx`, `Esp32LinkCard.tsx` | `/api/board*`, `/api/boards*`, `/api/esp` | `console.hardware` | LEGACY HOST (J05, UW10). Flashing needs the app closed (project rule). |
| K06 | Event ticker (14 events) | `components/Shell.tsx` ticker | event bus | `console.events` and the Alt+L overlay | LEGACY HOST (hosts.ts `events`) |
| K07 | Keyboard: Ctrl K palette, Ctrl 1 to 6 tabs | `Shell.tsx` line 189 | none | shell key table (B05) | BUILT (B05) |

## C. Well Wisher (classic Mission Germoney pages in `app/ui/src/germoney/pages` and the newer `ww/**` workspaces)

Legacy ids resolve by the alias table (spec 3.2). Packages: L04 and Y01 are in this wave (wave 7).

| id | Feature | Where today | Home in shell v2 | Status |
|---|---|---|---|---|
| W01 | Today: next block, directions, countdown to papers | `germoney/pages/Today.tsx`, `Direction.tsx`; `ww/left/**` | `day.today` | NOT BUILT (L04, wave 7); LEGACY HOST meanwhile |
| W02 | Week, counters, attendance, quest card | `germoney/pages/Life.tsx`, `Classes.tsx`; `ww/life/**` | `day.week`, `day.body` | NOT BUILT (L03, UW9) |
| W03 | Gym log (Forge) | `germoney/pages/Forge.tsx`; `ww/life/GymCard.tsx` | `day.body` gym row | NOT BUILT (L03, UW9) |
| W04 | Month calendar | none classic; `day.month` is new (D-V2-10) | `day.month` | NOT BUILT (L01, UW7) |
| W05 | Close the day | none classic; `day.close` new | `day.close` | NOT BUILT (L03, UW9) |
| W06 | Proof: status rank, level, evidence cards, wins | `germoney/pages/Status.tsx`, `Proof.tsx`; `ww/proof/**`, `ww/frame/ProofRail.tsx` | `proof.rail`, `proof.panel` | NOT BUILT (L04, wave 7) |
| W07 | Focus timer and Crucible session | `germoney/pages/Crucible.tsx`, `Focus.tsx`; `ww/focus/Crucible.tsx` | `focus.start`, `focus.session` | NOT BUILT (Y02, UW7) |
| W08 | Break (rest) | none classic | `focus.rest` | NOT BUILT (Y02, UW7) |
| W09 | Drill (question practice) | `germoney/pages/Drill.tsx`; `ww/focus/Drill.tsx` | `focus.drill` and `study.practice` | NOT BUILT (Y02 and Y03, UW7 and UW8) |
| W10 | Papers, exams, past-paper bank | `germoney/pages/Exams.tsx`, `Study.tsx`; `ww/study/Papers.tsx` | `study.papers` | NOT BUILT (Y01, wave 7) |
| W11 | Schedule and study plan | `germoney/pages/Schedule.tsx`; `ww/study/Plan.tsx` | `study.plan` | NOT BUILT (Y03, UW8) |
| W12 | Library (interrogation: ask the notes) | `germoney/pages/Interrogation.tsx`; `ww/study/Library.tsx` | `study.library` | NOT BUILT (C03, UW8) |
| W13 | dMAT | `ww/study/Dmat.tsx` | `study.dmat` | LEGACY HOST; nothing listed (see NO HOME) |
| W14 | Syllabus tree and Inspector | `germoney/pages/Tree.tsx`; `ww/tree/**` | `tree.tree` | BUILT as before, kept whole (spec 3.1.2) |
| W15 | Career pipeline | `germoney/pages/Road.tsx`; `ww/career/PipelineView.tsx` | `career.pipeline` | LEGACY HOST; has a home: T02 (UW10), `ww/career/**` and `career-*.view.ts` (spec line 3444) |
| W16 | Certificates and exams on the path | `germoney/pages/Trials.tsx`; `ww/career/CertsView.tsx` | `career.certs`, `career.abroad` | LEGACY HOST; has a home: T02 (UW10), `ww/career/**` and `career-*.view.ts` (spec line 3444) |
| W17 | Money and rewards (Armory) | `germoney/pages/Armory.tsx`; `ww/career/MoneyView.tsx` | `career.money` | LEGACY HOST; has a home: T02 (UW10), `ww/career/**` and `career-*.view.ts` (spec line 3444) |
| W18 | Career plan (goals, parking) | `ww/career/PlanView.tsx` | `career.ladder` | LEGACY HOST; has a home: T02 (UW10), `ww/career/**` and `career-*.view.ts` (spec line 3444) |
| W19 | Terminal log | `germoney/pages/Log.tsx` | overlay `log` | has a home (overlay table, spec 3.2) |
| W20 | Setup: 18 sections of inputs (dates, exam details, class list, novelty-first) | `germoney/pages/Settings.tsx`, `SystemInputs.tsx`, `Calibration.tsx`; `ww/setup/**` | `settings.<section id>` sheet (L02 merged, `shared/trim`) | BUILT as sheet entry; the sections keep their logic |
| W21 | Reader (typeset notes, raw toggle, PDFs and images) | `germoney/Reader.tsx`; `ww/overlays/Reader.tsx` | overlay `reader` | has a home (overlay table) |
| W22 | Add to day, date sheet, log minutes | `ww/life/AddToDay.tsx`; `ww/overlays/DateSheet.tsx`, `LogMinutes.tsx` | overlays `add`, `date`, `log` | has a home (overlay table) |
| W23 | Game FX, dialogs, Mission card on Core | `germoney/game/**`; `MissionCard` | B01: MissionCard deleted, FxLayer mounted only in `ww` | decided removal (B01); not a feature loss |

## D. The NO HOME list, with the package that should take each

| id | What | Proposed package |
|---|---|---|
| O1 (regression) | Export of the reviewed chats is unreachable under the flag today | J04 owns the `memory.keep` Actions. Ask the UI lane to move J04's "Share a review" earlier, or add a stop-gap "Share a review" row to the Core Earlier drawer until J04 lands, so the flag never ships without it |
| O1b | Choice of span, format and single-chat export | Engine lane: extend `/api/transcripts/export` with `format` and `session`; J04 draws it in `memory.keep` |
| O2 | Chat retrieval for Claude and other agents | Engine lane: a read-only local route (for example `/api/transcripts/query`, token-guarded, signal-only, no personal data in tracked files); UI half in J05 (`console.crew`, "Agents" card) and J04 (`memory.keep` shows what an agent may read, from the egress register) |
| O3 | Rate a whole chat | Engine lane: a `session` verdict beside `flags.jsonl`; UI half J01 follow-up on the Core header plus J04 listing in `memory.keep` |
| O4b, O4d | Voice choice and the pronunciation table on `core.talk` (today only in the classic Connect page) | A Core follow-up package (J01 reopened) with L02's Trim; until then they stay reachable in `console.connections` |
| C06, C07 | `core.sound`: media plate and library list | No package in 15.6.2 owns `core.sound`. Propose J01 follow-up or a new "J06 Sound" before B13 |
| W13 | `study.dmat`: the view is defined (spec section at line 1031, listed under `study` at line 339), but no package in 15.6.2 owns it | Propose Y03 for `study.dmat`; the lane decides |
| R06, M06 | `RelayWiring` and the galaxy: spec line 346 deletes them ("Deleted or demoted, not carried over"); D-V3-29 says every feature keeps a home | Owner decides before B13: keep (R06 in `console.hardware`; galaxy in `memory`) or delete, and the decision is written into D-V3-29 |
| W24 | Well Wisher data export and import (`GET /api/germoney/export`, `POST /api/germoney/import`, server.py 527 and 533) | L02 setup sheet (the classic export buttons are in `germoney/pages/Settings.tsx` 177 and `ww/setup/sectionsPlan.tsx` 171) |
| W25 | Calendar feed: today's blocks, one block as .ics, create a block (`/api/germoney/calendar/*`; caller `germoney/pages/Schedule.tsx`) | L01 month and week forms; the feed itself has no spec row |
| W26 | Rule 1 GitHub activity, public and cached 30 minutes (`/api/germoney/github`); UI caller not traced | L04 Today, a Direction row (no spec row names it) |
| W27 | Live arXiv papers for the syllabus (`/api/germoney/arxiv`); UI caller not traced; 0 spec hits | Y03 study plan or C03 library |
| W28 | General AI counsel tasks (`/api/germoney/ai/{task}`, `/api/mission/counsel/{task}`); the spec names only `ww_counsel.py` for variants (X07, spec line 5449) | X07 owner, as the one model caller |
| W29 | Knowledge harvester queue, sources, run, pause, resume (`/api/mission/harvest/*`, routes_ww_harvest.py) | spec 21.3.6 has the harvester and Q-V3-7, but no package in 15.6.2: C03 library host or an engine-lane intake package |
| W30 | Academic record: exam dates and academic file (`/api/mission/academics`, `/academics/file`); 0 spec hits | L02 setup sheet |
| W31 | Resources: tap progress, weekly and totals (`/api/mission/resource/{rid}/tap`, `/api/mission/resources/progress`); 0 spec hits for "resources" | T01 tree, as a node count |
| P1 | Phone Study page, installable, same origin (`/phone/ww`, routes_phone_ww.py; caller `ww/study/api.ts`) | Spec "One phone" (line 155) gives one pairing; no package in 15.6.2 names the page: J05 or Y02 |
| P2 | Phone as a remote: talk, hear, limbs, scenes, power normal (`/api/phone/core/*`, `/say`, `/hear`, `/limbs/{dev_id}`, `/scene/{name}`) | J02 `room.switches` for limbs; J01 for talk; spec line 155 names the surface, not each control |
| A1 | Always-on feed: remark queue and remark decisions (`GET /api/alwayson`, routes_alwayson.py); no UI caller in `app/ui/src`; 0 spec hits | J05 `console.connections` detail, beside C10 |
| M09 | Delete raw signal now, retention, backup count | J04 (`memory.keep`); the classic feature itself is not traced, so first confirm what exists in `app/jarvis_app` |
| M06 | Galaxy and GrowthChart | B13 retires them: the owner must confirm the loss before B13 |
| O5 | Pictures in Well Wisher beyond the Reader | Each section package mounts its own `ArtSlot` (G03 contract); L04 and Y01 in this wave |

## E. Verification (second pass, 14 Nov, read-only)

- Checked against code: the five owner features (O1, O2, O3, O3b, O4a, O5) and 15 other rows (C06, C08, C10, R04, R06, R07, S03, M06, M08, K04, W13, W15 to W18). 10 of the 21 needed a correction (O1 label, O2 home, O5 scope, C08, R06 spec conflict, K04 route prefix, W15 to W18 home). After the corrections the rows match the code, except the open decisions in section D.
- Added the 11 rows missed on the first pass (W24 to W31, P1, P2, A1), each listed in section D with its proposed home.
- Error rate of the sample: 10 of 21 rows before correction (about half); all corrected in this file.

Search notes for the "not traced" rows: Grep of `app/jarvis_app/*.py` and `core/*.py` for `mcp|agent_read|for_agents|chat_search`
returns only `core/agent.py` (JARVIS's own recall); Grep of `app/ui/src` for `rating|rateChat|thumb` finds only the
per-turn verdict buttons.
