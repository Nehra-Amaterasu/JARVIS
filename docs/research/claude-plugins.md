# Claude Code plugins on this laptop

Running file, newest section first.

## 2026-11-28: why the plugins error and stall, and what was changed

**Question.** Many plugins (claude-mem, agentkeeper, ECC, agentic-sdlc, claude-damn and others) show errors or do not respond in running chats. Are they broken, and are they the bottleneck?

**Short answer.** Partly true, mostly for a different reason than expected. Most plugins are not broken. The bottleneck is how many there are: about 260 plugins load into every chat, and six chats ran at once. The errors come from four missing programs on this laptop, three duplicate installs, and hooks that run out of time on an overloaded machine.

### What was measured

Sources: the hook records in the four newest session transcripts under `~/.claude/projects/c--Projects-JARVIS/`, `claude plugin list --json`, each plugin's `hooks/hooks.json` and `.mcp.json`, and a process snapshot. Everything below was read, not estimated.

**Load per chat**

| What | Number |
|---|---|
| Plugins enabled | 262 of 265 (261 synced from the claude.ai account) |
| Skills / agents / commands they bring | 2,215 / 325 / 297 |
| Skills ever invoked (all time, `~/.claude.json` skillUsage) | 25 |
| Plugins with hooks | 37; hook commands: 39 SessionStart, 37 PreToolUse, 30 PostToolUse, 17 Stop, 12 UserPromptSubmit |
| MCP servers declared | 346, of which 18 are local processes (stdio) |
| First request of this chat | 221,380 input tokens before any work (180,727 written to cache + 40,653 read) |
| Of which: skill list / tool list / agent list / MCP instructions | 353 k / 171 k / 123 k / 72 k characters |

**Machine at the time (02:10, 28 Nov)**

| What | Number |
|---|---|
| CPU load | 96 % |
| Free RAM | 1.3 GB of 15.6 GB; commit 47.3 of 61.2 GB |
| Processes | 791: 106 node, 84 cmd, 62 bash, 26 python, 24 claude |
| Claude sessions | 6 VS Code sessions (oldest started 26 Nov 20:18) plus the desktop app |
| npx-launched MCP servers | about 70 (`npm\bin` + `.bin`), roughly 12 per session |
| `bash -c true` / `node -e 0` / venv python, idle cost | 95-115 ms / 147-156 ms / 206 ms |
| agentkeeper's PreToolUse hook alone, idle | 1.2-1.4 s per call |

**Hook cost per tool call (2,662 PreToolUse and 2,602 PostToolUse calls)**

| Event | Median summed hook time | Worst |
|---|---|---|
| PreToolUse | 4.8 s | 455 s |
| PostToolUse | 5.6 s | 143 s |
| UserPromptSubmit | 6.2 s | 357 s |
| SessionStart | 62 s | 908 s |

So a typical tool call waited about 10 s on hooks before and after it ran, and a new chat took about a minute to start.

**Errors (non-blocking failures) in the four sessions**

| Count | Plugin | Cause |
|---|---|---|
| 1,646 | claude-damn (`block-inline-scripts.py`) | `python3` resolves to the Windows Store stub, not a real Python |
| 1,604 + 302 | agentforce-adlc (Salesforce) | same `python3` stub; installed twice |
| 206 | handoff | `jq` is not installed |
| 58 | claude-mem | the `claude-mem` launcher is not built: Bun is not installed |
| 13 | agent-recall | its `agent-recall-session-start` command is not installed |
| 13 | agent-archive | session-start prints invalid JSON; its server answers 402 Payment Required |
| 6 | claude-mem-cowork | registry points at a folder that no longer exists |

**Timeouts (hook killed at its limit)**: 1,328 PostToolUse, 265 agentkeeper PreToolUse (5 s), 104 + 46 + 28 claude-eta (5 s / 3 s), 57 agentforce, 55 agentkeeper prompt hook, 58 claude-context-optimizer and ECC dispatchers. On an idle machine these hooks finish in 1-1.5 s; under 96 % CPU they pass 5 s. A hook that times out does nothing, so the guard it provides is silently off.

**Duplicates**: ECC was enabled twice, as a git clone in `~/.claude/skills/ecc` (v2.0.0, 28 hooks) and as the synced plugin (v2.2.3, 29 hooks), so its hooks ran twice per call and its 277 skills were listed twice. claude-mem had three cached versions (15.2.1, 17.0.0, 17.0.2) but only one id is active.

**Plugins that fight the project's own rules**: anchor-memory rewrites `.anchor/session-state.md` in the repository every session and points at a `HANDOFF.md`; handoff nudges for handoff files. The project keeps one living state file (`data/notes/NOW.md`) and forbids handoff files.

**Plugins that inject instructions into every chat without being usable**: hawkscan tells the model to scan after every change, but no StackHawk key or runtime exists; the three Carta plugins inject finance rules into every session; agent-archive forces a setup dialog.

### What was changed (all reversible with `claude plugin enable <id>`)

Disabled at user scope (`enabledPlugins` in `~/.claude/settings.json`), taking effect when each chat restarts:

- duplicates and broken installs: `ecc@skills-dir` (the older copy; the synced v2.2.3 stays), `agentforce-adlc`, `handoff`, `agent-recall`, `agent-archive`;
- rules conflict: `anchor-memory`;
- top timeout offender with no working value: `claude-eta` (ETA estimates, 178 timeouts);
- enterprise tools unrelated to this work, each carrying hooks or session prompts: `carta-cap-table`, `carta-investors`, `carta-crm`, `cockroachdb`, `honeycomb`, `signoz`, `datadog`, `accelerate-ai-toolkit` (WordPress), `hawkscan`;
- local MCP servers that failed to connect in every session, each a process per chat: `browser-use` (re-downloads `browser-use@latest` through uvx each time, 30 s timeout), `desktop-commander`, `adb-mcp`, `gitkraken`, `prisma`, `backlog`, `argot`.

Kept and working: ECC (synced), agentkeeper (local mode, no account key), agentic-sdlc, claude-context-optimizer, security-guidance, claude-mem (newest copy; waits for Bun), and every skill-only plugin.

### Repaired after the owner's go-ahead (same day)

- **claude-damn: on.** `python3` now resolves to a hard link `python3.exe` beside `python.exe` in `%LOCALAPPDATA%\Programs\Python\Python314` (3.14.3), ahead of the Store stub on PATH. Tested through the hook: `ls -la` allowed, an inline heredoc denied, a 605-character command denied. Minutes later it denied a real 11-statement command of mine. Each check took 4-17 s on the loaded machine against its 10 s limit; idle Python starts in about 0.2 s.
- **claude-mem: on.** Bun 1.4.5 installed through winget (`Oven-sh.Bun`). The plugin's own `ensure-launcher.cjs` compiled `%LOCALAPPDATA%\claude-mem\bin\claude-mem.exe` (115 MB, protocol 4) and added that folder to the user PATH. Its SessionStart context hook then ran in 2.9 s with exit 0. `npx claude-mem install` was not used, because it fetches the latest package and could register a second copy. Its first output is an advert for its paid Cloud Sync, which would upload the recorded tool calls; it is not enabled.
- Chats that were open before this need a restart to pick up the new PATH and the disables.

### Second pass (same day, owner's correction): anchor-memory and claude-eta back on

- **claude-eta: re-enabled.** It times every task, learns real durations, and has a repair-loop detector: the same error 3 times gives a warning, 5 times blocks and forces a change of approach. That is useful in long agentic loops. Its timeouts came from the overload, not from a bug.
- **anchor-memory: on, as a local fork** in `~/.claude/skills/anchor-memory` (`anchor-memory@skills-dir`, v0.1.0-named.1); the synced copy stays disabled, so plugin updates cannot undo the change. The owner wants it because chats are exported to other agents, and there they arrive named by a summarizer's boilerplate first line ("This session is being continued from a previous conversation...").
  - Upstream it wrote only git status and recent commits (`.anchor/session-state.md`) and pointed at a `memory/HANDOFF.md` that this repo does not have. The generic names came from ECC's session file, which lists the first line of every message, system notices included.
  - The fork adds `hooks/chat-summary.mjs`, run by the Stop and PreCompact checkpoint. It writes one file per chat, `.anchor/sessions/<date>-<slug>-<id8>.md`, whose first line is the chat's name. The name is the first line of the first real prompt, after removing injected tag blocks (`<system-reminder>`, `<browser_instruction>`, ...) and skipping system notices; a chat that starts from a compaction takes the summary's `Title:` line. Below it sit a CHAT LABEL, the first line of each prompt, commits, files edited, and the last reply. SessionStart lists the six newest names. The folder carries its own `.gitignore` (`*`), because prompts are private and the repo is public; git reports it ignored.
  - Tested on the four newest transcripts (8 to 307 MB). All four were named from their real first prompt, including chats compacted 3 and 6 times, since the transcript keeps the full history. The transcript is streamed from a saved offset: the first run per chat took 7.5 to 32 s once, later runs 0.8 to 3 s (10.6 s on a chat being written at the same moment), against 2.8 s for the git commands the hook already ran.

### Still open

- **The real speed-up** is fewer chats open at once and fewer plugins per chat. Six chats × 262 plugins is what saturates the CPU. The 23 disables remove their hooks and processes but leave about 240 plugins, mostly skill-only, in every chat's context.
- agentkeeper costs 1.2-1.4 s idle on every tool call before and after (local mode); claude-context-optimizer's prompt coach injects guessed file names that are often wrong. Both are kept for now.

### What it changed

The "the plugins are broken" belief became a measured list: four missing programs, three duplicates, and load. The fix is subtraction plus two installs, not more plugins.
