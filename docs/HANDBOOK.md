# Handbook: running and growing JARVIS without any one AI vendor

Written 2026-11-01 so the project goes on when the Claude subscription ends. Everything here runs on this laptop; where a model is needed, it is the local one or any API you choose.

## 1. What needs no model at all
- **The app** (`JARVIS.pyw`): the desktop window, the server on 127.0.0.1:8777, every Well Wisher engine (`app/jarvis_app/ww_*.py`), Aankhen, Limbs, the phone path.
- **The tests:** `.venv\Scripts\python.exe -m pytest aankhen/tests crew/tests core/tests` at the root; `..\.venv\Scripts\python.exe -m pytest tests` from `app/` with `JARVIS_DATA_DIR` set to a scratch folder; `npx vitest run` and `npx tsc -b` in `app/ui`.
- **The build:** `npm run build` in `app/ui`, only with the app closed (it serves `dist`). With the app open, build to `dist-next` and swap later.
- **Commits:** first person, why + the measurement, no trailers. Push headless with the gh token (`docs/HANDBOOK.md` §5).

## 2. Where a model is used, and which one
| Job | Who does it | How |
|---|---|---|
| JARVIS's voice and answers | Ollama, `qwen3:4b-instruct-2507-q4_K_M` (Connect → Brain) | `core/` |
| Grading an explain-back, quiz from notes, parsing a day sentence, summarising a reel | **Counsel** (`app/jarvis_app/ww_counsel.py`) | `POST /api/mission/counsel/<task>`; prompts in `app/jarvis_app/prompts/*.md` (edit them freely) |
| Writing revision sheets, practice papers, research | you, with any model as a drafting aid | the sheets are Markdown in `data/notes/exams/`; every number goes through a `checks/*.py` script |
| Building features | you, with any coding model pointed at this repo | start from `CLAUDE.md`, `AGENTS.md`, `data/notes/NOW.md`, then the engine you are changing |

**Counsel providers.** Default: Ollama on this laptop. To use an API instead, set in the environment (never in a file): `COUNSEL_API_URL` (an OpenAI-style base, for example a Gemini or OpenRouter endpoint), `COUNSEL_API_KEY`, optional `COUNSEL_MODEL`. The Anthropic API also works pay-per-use without a subscription, through any OpenAI-compatible gateway or a 20-line provider in `ww_counsel.py`. With nothing reachable the answer is `status: no_model`, and the UI says so.

## 3. The shape of Well Wisher (so you can add to it)
- **Engines are pure functions:** `engine(inputs, today, **data) -> dict`, registered in `ENGINE_TABLE` in `ww_engines.py`, one file each, with tests that check purity (same input, same answer; input never mutated). Adding one = one file + one line + tests.
- **Inputs** come from `data/notes/well-wisher/engine-inputs.json` (private), edited in Settings → What the System knows.
- **State** is the plan state in the app's KV store; every tap is a method on `germoney.Plan` that validates, writes, and returns the engine's new answer.
- **Routes** are in `routes_mission.py`, one per engine view and one per tap; the docstring at the top lists them.
- **Screens** are in `app/ui/src/germoney/pages/`, one per section; a card fetches its engine and posts its taps.
- **Rules that never change:** every stat moves only with a logged action; no number is shown as measured unless it is; no camera; no personal data in tracked files; never shame.

## 4. The study material pipeline (you can run it alone)
1. Put the syllabus (units, topics, weights) into `data/app/germoney/academics/academics.json`.
2. Type the date sheet in Settings → What the System knows → Date sheet (units, target, difficulty, may-not-sit).
3. Write or draft a sheet per subject in `data/notes/exams/<pack>/`, formulas as `$N_s$`, `$e^{-x^2/4Dt}$`.
4. Put every worked number into `checks/verify_*.py` and run it; fix the sheet to the script, never the other way.
5. Practice paper + key in the exam's pattern; tap topics and type marks in Study → Internals.
6. The engine plans the days; the Director orders them; your marks on the day are the scoreboard.

## 5. Headless git push
`git push` hangs here (the credential manager wants a window). Use:
```
TOK=$(gh auth token); B=$(printf 'x-access-token:%s' "$TOK" | base64 -w0)
git -c credential.helper= -c "http.extraheader=Authorization: basic $B" push origin main
```
and kill any leftover `git-credential-manager.exe` from an earlier attempt.

## 6. What lives where
- `data/notes/NOW.md`: the one living state file. Read it first, edit it in place.
- `data/notes/research/chats/2026-10-26-master-context.md`: who you are, the vision, the decisions.
- `docs/research/<topic>.md` and `data/notes/research/<topic>.md`: every piece of research, newest section on top.
- `data/notes/well-wisher/PLAN.md`: the staged build plan (§1, 1 Nov) and the v2 pitch (§0, 27 Oct).
- `~/.claude/projects/c--Projects-JARVIS/memory/`: Claude's own notes about you; copy anything you want to keep into `data/notes/` before the subscription ends (they are plain Markdown).
