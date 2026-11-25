# Agents and integrations: running log, newest first

Open-source survey for the agent side of JARVIS: an agent runtime, memory designs worth borrowing, device
and web tools. Memory-only research is in [yaadash.md](yaadash.md).

## 2026-11-25: Hermes Agent, and a licence and maintenance check of 45 open-source projects

### Question
I collected leads on phone control, memory, RAG, extraction, home automation and agent runtimes. Which of
the underlying open-source projects are real, maintained and usable on this laptop (RTX 4050 6 GB, 16 GB
RAM, about 10 GB free disk, a local 4B model with an 8,192-token context)? And where does Hermes Agent
fit?

### Method
- Repository facts (stars, licence, last push, archived or not) read from the GitHub API on 25 Nov 2026.
  These are **verified**.
- Hermes Agent's behaviour read from its own docs in the repository at release v0.23.4 (24 Nov 2026):
  README, memory, local models, the Ollama guide, API server, MCP, security. **Verified as documented**,
  not run here.
- What each other project does comes from its repository description and, where noted, earlier reading.
  Capability claims I did not test are marked **assumed**.
- Nothing was installed.

### Hermes Agent (NousResearch/hermes-agent, MIT, Python, 266k stars, pushed 25 Nov 2026)
What the docs say:

| Topic | Documented fact |
|---|---|
| Platforms | Linux, macOS, WSL2 and native Windows (PowerShell installer, installs under `%LOCALAPPDATA%\hermes`; brings its own Python 3.14, Node.js, pnpm, ripgrep, FFmpeg) |
| Model floor | A model with at least 64,000 tokens of context; smaller windows are refused at start |
| Local models | The Ollama guide lists one model with reliable tool calling, `gemma4:31b` (about 20 GB on disk, 24+ GB RAM). The 3B and 9B rows are marked as unable to call tools. The local-models page says a GPU with 8 GB or more runs the small catalogue models |
| Small models and memory | The memory page warns that small local models claim a save without calling the tool |
| Memory | Two bounded files injected once per session: `MEMORY.md` (2,200 characters) and `USER.md` (1,375 characters). A write over the limit is an error, so the agent must consolidate. A frozen snapshot per session keeps the prompt prefix cached |
| Recall | `session_search`: SQLite FTS5 over past sessions, summarised by a model |
| Procedures | Skills: Markdown documents loaded on demand, in the agentskills.io format; the agent can write and improve them |
| Review | `write_approval` holds memory writes for a yes outside the interactive CLI |
| External memory | Memory providers are plug-ins (Honcho is the documented one) |
| API | An OpenAI-compatible server on `127.0.0.1:8642` behind a bearer key |
| Tools | An MCP client with per-server tool filtering; terminal back-ends local, Docker, SSH and others |
| Safety | Approval modes smart, manual, off; unattended sessions (API, webhooks, cron) default to deny on a dangerous command |
| Reach | One gateway process for Telegram, Discord, Slack, WhatsApp, Signal; cron jobs; subagents |

What that means here:
1. **It cannot be JARVIS's local brain.** The local model here is a 4B at 8,192 tokens on 6 GB of VRAM. The
   64,000-token floor and the tool-calling guidance rule it out. This is arithmetic on documented numbers.
2. **Its design is worth borrowing without installing it.** Four ideas map onto gaps I measured in Yaadash:
   a visible budget on the always-on memory block with an error on overflow (Yaadash silently keeps the
   newest 40 told facts and 30 corrections); full-text search over past sessions (Yaadash's chat index is
   vector-only); procedures stored as skills (Yaadash has no procedural memory); a held-for-approval write
   path (Yaadash has two separate review cards).
3. **It can be a worker beside JARVIS, on a cloud model.** JARVIS keeps voice, the room and memory. Hermes
   runs only when a task needs several dependent steps, is called over its local API, and reaches JARVIS's
   typed tools through an MCP export with a filter. Its own approvals stay on deny for unattended sessions.
   The cost is that a cloud model reads whatever the task carries, so items marked sensitive never go.
4. **The Hermes model family is a separate thing.** The current weights are 14B, 36B, 70B and 405B (Hugging
   Face, read 25 Nov). The only one that fits 6 GB is Hermes-3-Llama-3.2-3B from December 2024, a
   function-calling fine-tune. It is a candidate for a tool-selection bake-off against the current 4B, not a
   replacement on reputation.

Unknown until measured: installed size on Windows, idle memory of the gateway, and whether a free cloud
tier is enough for a handful of tasks a day.

### The other projects, by area
Verdicts: **adopt** (plan to use), **borrow** (take the idea, not the code), **later** (needs something
this laptop lacks today), **no**.

**Memory and retrieval**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| openclaw/openclaw | MIT | 395k | 2026-11-25 | Borrow. Markdown files as the truth, a rebuildable SQLite index, hybrid search. TypeScript gateway, 17 GB repository: not something to install for its memory |
| NousResearch/hermes-agent | MIT | 266k | 2026-11-25 | Borrow now, worker later. See above |
| mem0ai/mem0 | Apache-2.0 | 69k | 2026-11-24 | No. A model call on every write (assumed from earlier reading); weak on correction and deletion |
| getzep/graphiti | Apache-2.0 | 33k | 2026-11-25 | Borrow. Facts with a validity interval. Needs a graph database and several model calls per episode |
| topoteretes/cognee | Apache-2.0 | 34k | 2026-11-25 | No. Graph-plus-vector memory built by model extraction (assumed); too heavy for a 4B |
| letta-ai/letta | Apache-2.0 | 26k | 2026-10-18 | No. The agent edits its own memory through tool calls; a 4B does this badly |
| HKUDS/LightRAG | MIT | 41k | 2026-11-24 | No. Corpus-wide graphs; my earlier 130k-node graph was about 95 % noise |
| supermemoryai/supermemory | MIT | 32k | 2026-11-24 | No. A TypeScript service; a second runtime for no measured gain |
| basicmachines-co/basic-memory | AGPL-3.0 | 4.7k | 2026-11-24 | Borrow the idea only. Same shape as OpenClaw's; AGPL code is not copied |
| NevaMind-AI/memU | unclear | 15k | 2026-11-24 | No. Licence not machine-readable |
| plastic-labs/honcho | AGPL-3.0 | 8.3k | 2026-11-24 | Borrow. Asking the user to settle an uncertain claim is Yaadash's review queue |
| asg017/sqlite-vec | Apache-2.0 | 8.3k | 2026-05-18 | Later. Quiet for six months; brute force over 14,013 windows already costs a few milliseconds |
| docling-project/docling | MIT | 71k | 2026-11-25 | Later, for exam papers with tables. Model downloads of unmeasured size |
| microsoft/markitdown | MIT | 198k | 2026-11-07 | Adopt candidate. Office and HTML files to Markdown, 5 MB repository; for formats the library does not read yet |
| vibrantlabsai/ragas | Apache-2.0 | 16k | 2026-11-14 | No as a gate. A small judge model is unreliable; hit@k needs no model |
| Graphify-Labs/graphify | Apache-2.0 | 153k | 2026-11-24 | No. It graphs a codebase, not a life |
| run-llama/llama_index, langchain-ai/langgraph | MIT | 53k, 45k | 2026-11 | No. Frameworks around a loop a 4B cannot run in a 2.3 s voice turn |

**Agent runtimes and protocols**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| modelcontextprotocol/python-sdk | MIT | 25k | 2026-11-17 | Adopt. Serves JARVIS's tool registry to Claude Code, Claude Desktop and Hermes |
| agentskills/agentskills | Apache-2.0 | 28k | 2026-11-04 | Adopt the format. One skill folder readable by Claude Code, Hermes and JARVIS |
| pydantic/pydantic-ai | MIT | 21k | 2026-11-25 | Later. Allowed inside a planner for typed outputs; not in the voice path |
| openai/openai-agents-python, google/adk-python, huggingface/smolagents | MIT, Apache-2.0, Apache-2.0 | 31k, 22k, 31k | 2026-11 | No. They add calls and tokens, not reliability, on a 4B; smolagents runs model-written code |

**Phone, desktop and browser**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| Genymobile/scrcpy | Apache-2.0 | 156k | 2026-11-24 | Adopt for the phone link. Carries `adb` |
| openatx/uiautomator2 | MIT | 8.5k | 2026-11-17 | Later. Typed reads of the Android screen for narrow tools |
| mobile-next/mobile-mcp, droidrun/mobilerun, minitap-ai/mobile-use | Apache-2.0, MIT, Apache-2.0 | 11k, 10k, 3.4k | 2026-11 | No on a primary phone. Open-ended screen control by a model can send or buy by mistake |
| CursorTouch/Windows-MCP | MIT | 12k | 2026-11-25 | No as a tool. Read for its UI Automation approach |
| microsoft/playwright-mcp, browser-use/browser-use | Apache-2.0, MIT | 40k, 122k | 2026-11 | Later. Supervised search-and-prefill only; payment stays his |

**Web extraction**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| D4Vinci/Scrapling | BSD-3-Clause | 106k | 2026-11-24 | Later. Only if pages that need a browser matter |
| unclecode/crawl4ai | Apache-2.0 | 88k | 2026-11-23 | Later. Same; its description now leads with a hosted service |
| jina-ai/reader | Apache-2.0 | 12k | 2026-05-22 | No by default. The hosted prefix sends each URL to their server |
| firecrawl/firecrawl | AGPL-3.0 | 209k | 2026-11-25 | No. Hosted-first, AGPL |

The planned route stays a search library plus a local extractor that turns a page into text before the
model sees it. That is what keeps tokens low.

**Home automation**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| home-assistant/core | Apache-2.0 | 93k | 2026-11-25 | Later. Needs an always-on host; the laptop is not one |
| esphome/esphome | mixed | 12k | 2026-11-25 | Later. The relay box runs its own signed firmware; a second firmware gains nothing today |

**Security testing of my own app**

| Project | Licence | Stars | Last push | Verdict and reason |
|---|---|---:|---|---|
| usestrix/strix | Apache-2.0 | 77k | 2026-11-25 | Later, against a scratch instance of this app only. Needs a strong model (assumed) |
| KeygraphHQ/shannon | AGPL-3.0 | 52k | 2026-11-25 | Later, same scope |
| GreyDGL/PentestGPT | MIT | 17k | 2026-07-14 | No. Quiet since July |

A dependency audit and auth tests on the local routes come first; they need no model.

**Video clipping** (outside JARVIS; noted, not planned)

| Project | Licence | Stars | Last push | Note |
|---|---|---:|---|---|
| mutonby/openshorts | MIT | 9.9k | 2026-11-24 | Docker; transcribes with faster-whisper, which this laptop already runs |
| FujiwaraChoki/supoclip | unclear | 4.2k | 2026-11-24 | Licence not machine-readable |

### Numbers that decide things
| Number | Value | Source |
|---|---|---|
| Hermes Agent context floor | 64,000 tokens | its quickstart and local-models docs |
| JARVIS local context | 8,192 tokens | `num_ctx` in this repository |
| Hermes always-on memory | 2,200 + 1,375 characters | its memory doc |
| JARVIS always-on facts | about 950 tokens, capped at 40 told + 30 corrections | `yaadash/yaadash_v2.py` |
| Smallest current Hermes model | 14B | Hugging Face, NousResearch |
| Free disk when written | 10.6 GB | measured |

### Sources
- GitHub API, `repos/<owner>/<name>`, read 25 Nov 2026, for every repository named above.
- Hermes Agent docs at v0.23.4: [README](https://github.com/NousResearch/hermes-agent/blob/main/README.md),
  [memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md),
  [local models](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/local-models.md),
  [Ollama guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/local-ollama-setup.md),
  [API server](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md),
  [MCP](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/mcp.md),
  [security](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/security.md),
  [skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md).
- Hermes model list: [NousResearch on Hugging Face](https://huggingface.co/NousResearch).
- Agent Skills format: [agentskills.io](https://agentskills.io/specification).
- Clipping tools found by search: [openshorts](https://github.com/mutonby/openshorts),
  [supoclip](https://github.com/FujiwaraChoki/supoclip).

### What it changed
- The agent plan gains a definition of an agent, a skills folder in the Agent Skills format, and an MCP
  export that moves ahead of the planning lane, because every outside runtime needs it.
- Hermes Agent enters the plan in two ways: four of its memory ideas now, and a measured trial as a worker
  on a cloud model later, compared with a small executor of my own on the same five tasks.
- The memory plan gains procedural memory, a budget meter on the always-on block and full-text search over
  my chats with JARVIS.
- No project in the tables is installed until disk is above 15 GB free and I have agreed to each one.
