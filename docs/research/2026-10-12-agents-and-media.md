# JARVIS research: agents, skills, music, Obsidian, graph viz

Researched 2026-10-12. Read-only: nothing was installed or downloaded. Each claim cites its source inline. **[2nd]** marks a claim backed only by secondary sources. **[unverified]** marks a claim I could not confirm. **[calc]** marks my own arithmetic.

**Repo facts I read (local, read-only) that shape the recommendations:**
- The desktop shell is **pywebview with `gui="edgechromium"`**, which means WebView2 (`app/jarvis_app/desktop.py`).
- The UI uses Vite, React 19, **three 0.186** and zustand (`app/ui/package.json`).
- `core/mcp_hardware_server.py` is a **FastMCP stdio** server. The pinned versions are `fastmcp==3.4.4`, `mcp==1.28.1`, `starlette==1.3.1`, `fastapi==0.139.2` and `lancedb==0.34.0`.

---

## 1. OpenClaw (formerly Clawdbot → Moltbot)

| Item | Fact |
|---|---|
| What | An open-source, self-hosted personal assistant that "works through the chat channels you already use", run by the OpenClaw Foundation with no paid tier. It has about 392k stars. ([README](https://github.com/openclaw/openclaw)) |
| Naming | GitHub advisories still list the npm package as `clawdbot` ([GHSA-g8p2-7wf7-98mq](https://github.com/advisories/GHSA-g8p2-7wf7-98mq)). The history Clawdbot (Nov 2025) → Moltbot (27 Jan 2026) → OpenClaw (30 Jan 2026) was attributed to an Anthropic trademark complaint **[2nd]** ([DigitalOcean](https://www.digitalocean.com/resources/article/what-is-openclaw)). |
| Runtime / license | TypeScript on **Node 24.16+ or 26.1+ (26 recommended)**, built as a pnpm monorepo. License is **MIT**. ([README](https://github.com/openclaw/openclaw)) |
| Release cadence | Versions use calendar numbering. The latest is **2026.10.2 (12 Oct 2026)**, which fixes "credential leaks across redaction chunk boundaries". ([releases](https://github.com/openclaw/openclaw/releases)) |
| Install | Windows: `iwr -useb https://openclaw.ai/install.ps1 \| iex`, or `npm i -g openclaw@latest`, then `openclaw onboard --install-daemon` ([README](https://github.com/openclaw/openclaw)). Native Windows is supported, and the docs say WSL2 is "the most Linux-compatible Gateway runtime". A native Gateway needs **Git for Windows on PATH**. Windows Hub (a WinUI tray app) needs Win10 20H2+. ([Windows docs](https://docs.openclaw.ai/platforms/windows)) |
| Architecture | A local **Gateway** is the control plane. It multiplexes WebSocket and HTTP on one port, and the examples use `127.0.0.1:18789`. On host installs it binds to loopback, but container images bind exposed by default. ([security](https://docs.openclaw.ai/gateway/security), [webhooks](https://docs.openclaw.ai/automation/cron-jobs/webhooks)) |
| Messaging | Discord, iMessage, Slack, Teams, Telegram, WhatsApp, Google Chat, Signal and "20+ more" ([README](https://github.com/openclaw/openclaw)). **WhatsApp runs over WhatsApp Web through Baileys with QR linking, not the Cloud API**, and a separate number is recommended ([WhatsApp](https://docs.openclaw.ai/channels/whatsapp)). Telegram uses a BotFather token with grammY and long polling by default ([Telegram](https://docs.openclaw.ai/channels/telegram)). Unknown DM senders get a pairing code, approved with `openclaw pairing approve <channel> <code>`. |
| Ollama | Supported. Use the **native API: `baseUrl: "http://host:11434"` with no `/v1`**. Using `/v1` "breaks tool calling", and the model then prints tool-call JSON as text. ([Ollama provider](https://docs.openclaw.ai/providers/ollama)) |
| Skills | `SKILL.md` with YAML frontmatter. The docs say "OpenClaw follows the AgentSkills spec". Gating lives in `metadata.openclaw` (`requires.bins/env/config`, `os`). Eligible skills are compiled into a **compact XML block in the system prompt** under a `skills.limits.maxSkillsPromptChars` budget. Skills that don't fit are reachable through `skills_search`, and `skills_read({name})` loads a full SKILL.md. Load precedence is workspace `skills/` > `.agents/skills` > `~/.agents/skills` > managed > bundled. The registry is ClawHub (`openclaw skills install @owner/slug`, `openclaw skills verify`). ([skills](https://docs.openclaw.ai/tools/skills)) |
| MCP | Both directions. **Client:** `mcp.servers` in config. Stdio entries take `command/args/env/cwd`. Streamable HTTP entries take `{"url","transport":"streamable-http","headers":{...}}`, and the CLI form is `openclaw mcp set <name> '<json>'`. **Server:** `openclaw mcp serve` is a stdio MCP bridge that exposes Gateway channel conversations through `conversations_list`, `messages_read`, `events_poll/wait`, `messages_send`, `permissions_respond` and related tools. ([cli/mcp](https://docs.openclaw.ai/cli/mcp), [transports](https://docs.openclaw.ai/cli/mcp/transports)) |
| Inbound HTTP | **Webhooks:** set `hooks.enabled: true` with a dedicated `hooks.token`, then `POST /hooks/agent` with `Authorization: Bearer`, a body of `{message, agentId, deliver, channel, to, sessionMode, waitForCompletion}` and an `Idempotency-Key` header. The response is `{ok, runId}`. ([webhooks](https://docs.openclaw.ai/automation/cron-jobs/webhooks)) **OpenAI-compatible** `/v1/chat/completions`, `/v1/responses` and `/v1/models` are **off by default** and enabled with `gateway.http.endpoints.chatCompletions.enabled`. The `model` value is `openclaw/<agentId>`. ([openai-http-api](https://docs.openclaw.ai/gateway/openai-http-api)) |

**Security (important):**
- **CVE-2026-25253 / GHSA-g8p2-7wf7-98mq:** a 1-click RCE, CVSS 8.8. The Control UI accepted a `gatewayUrl` query parameter and sent the gateway token to it, "even when it listens only on loopback". It affected versions ≤2026.1.28 and was fixed in 2026.1.29. ([GHSA](https://github.com/advisories/GHSA-g8p2-7wf7-98mq))
- **ClawHavoc:** 341 of 2,857 ClawHub skills were malicious. They used fake "prerequisites", and the Windows variant shipped a password-protected `openclaw-agent.zip` keylogger. ([The Hacker News, 2 Feb 2026](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)) Later counts of 824 to 1,400+ are **[2nd]**.
- The repo's advisory list runs to **73 pages**, and ten Moderate/High advisories were published on 11 Sep 2026 alone ([security tab](https://github.com/openclaw/openclaw/security)).
- The project says it "is not a hostile multi-tenant security boundary", and tools run on the host unless you configure sandboxing ([security](https://docs.openclaw.ai/gateway/security)).
- On model choice, the docs say: **"Do not run those workloads on weak model tiers."** Small models are acceptable only for chat-only bots with trusted input and no tools. If you must use a small model, they recommend sandboxing, read-only tools, keeping `web_*` and `browser` off, and `tools.exec.strictInlineEval`. ([prompt-injection](https://docs.openclaw.ai/gateway/security/prompt-injection))
- Run `openclaw security audit` after setup.

**Cleanest JARVIS integration**
- **(a) Expose JARVIS tools to OpenClaw.** Mount the FastMCP server inside the existing FastAPI app over streamable HTTP, using `mcp_app = mcp.http_app(path="/")`, `FastAPI(lifespan=mcp_app.lifespan)` and `app.mount("/mcp", mcp_app)` ([FastMCP docs](https://gofastmcp.com/integrations/fastapi)). Bind it to 127.0.0.1 and require a bearer token. Then register it once:
  `openclaw mcp set jarvis '{"url":"http://127.0.0.1:<port>/mcp","transport":"streamable-http","headers":{"Authorization":"Bearer <token>"}}'`

  Prefer this over stdio. A stdio entry (`command: python core/mcp_hardware_server.py`) would start a **second process** that cannot see JARVIS's live state. Add a small `jarvis-home/SKILL.md` that tells the agent when to use those tools.
- **(b) Receive tasks.**
  - OpenClaw → JARVIS: the task arrives as an MCP tool call.
  - JARVIS → OpenClaw: `POST /hooks/agent`, with `deliver/channel/to` if you want the reply to land in Telegram or WhatsApp.
  - To use OpenClaw **only as a messaging gateway** while Qwen3-4B stays the brain, have `core/mcp_client_bridge.py` spawn `openclaw mcp serve` and loop on `events_wait` → `messages_send`. **[unverified]** I could not confirm whether the Gateway's own agent still answers routed messages in this mode. Test it before relying on it.
- **Verdict.** The integration surface is excellent, but the security history is heavy and the docs explicitly discourage small models for tool use. If you adopt it, pin a release, set `tools.profile: "messaging"` or stricter, enable sandboxing, install no ClawHub skills without reading them, and keep Gateway, hooks and the HTTP API on loopback.

---

## 2. Hermes Agent (Nous Research)

| Item | Fact |
|---|---|
| What | "The self-improving AI agent built by Nous Research", with a built-in learning loop that turns non-trivial workflows into skills automatically ([repo](https://github.com/NousResearch/hermes-agent), [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)) |
| License | **MIT** ([repo](https://github.com/NousResearch/hermes-agent)) |
| Runtime | Python. First-party installs **run on Python 3.14** (pyproject allows `>=3.11,<3.15` without promising 3.11–3.13). The installer manages uv, Node, FFmpeg and ripgrep. ([installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)) |
| Latest | **v0.21.7 (11/12 Oct 2026)**. Source installs now track tagged releases rather than `main`. ([releases](https://github.com/NousResearch/hermes-agent/releases)) |
| Install (Windows) | **Native, no WSL needed**: `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`. A signed MSIX desktop app is also available. Data goes to `%LOCALAPPDATA%\hermes\`. ([installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)) |
| Messaging | A single gateway process serves Telegram, Discord, Slack, WhatsApp (including the Cloud API), Signal, Email, Matrix, Teams, Home Assistant and more. **Access is deny-by-default**: a user needs an allowlist entry or DM pairing (8-character codes valid for 1 h, locked after 5 failures). ([messaging](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/), [security](https://hermes-agent.nousresearch.com/docs/user-guide/security)) |
| Local models | Use `provider: custom` with `base_url: http://localhost:11434/v1`. Hermes **requires a ≥64,000-token context** and rejects anything smaller at startup. Ollama's default is 4k under 24 GB VRAM, and context **cannot be set over the OpenAI API**, so set `OLLAMA_CONTEXT_LENGTH` or `num_ctx` on the server. The docs warn that the full toolset plus the system prompt "can exceed a 32k context window". ([providers](https://hermes-agent.nousresearch.com/docs/integrations/providers), [Ollama](https://docs.ollama.com/context-length)) |
| Skills | `~/.hermes/skills/`, using SKILL.md and "compatible with the agentskills.io open standard". Hermes adds a `metadata.hermes` block (tags, category, requires_toolsets). Loading has three levels: `skills_list()` (about 3k tokens), `skill_view(name)` and `skill_view(name, path)`. The agent writes its own skills through `skill_manage`, and `skills.write_approval: true` stages those writes for review. Hub installs are scanned, and `--force` cannot override a "dangerous" verdict. ([skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)) |
| Memory | `MEMORY.md` (2,200 chars) and `USER.md` (1,375 chars) are injected as a frozen snapshot at session start, about 1,300 tokens fixed. Hermes also keeps SQLite **FTS5** search over all sessions (`state.db`) and supports optional external providers (Honcho, Mem0, Supermemory, Hindsight and others). ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)) |
| MCP | **Client:** `mcp_servers:` in `~/.hermes/config.yaml`, with stdio `command/args/env` or HTTP `url/headers`. `tools.include` and `tools.exclude` filter by glob, and tools are named `mcp_<server>_<tool>`. **Server:** `hermes mcp serve` is **stdio-only** and exposes 10 tools (conversations, messages_read, messages_send and others). Sending requires the gateway to be running. ([MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)) |
| API server | Set `API_SERVER_ENABLED=true` and `API_SERVER_KEY` (**required even on loopback**), then run `hermes gateway`. It listens on `127.0.0.1:8642` and offers `/v1/chat/completions`, `/v1/responses` (stateful), **`/v1/runs` with SSE events plus `/stop` and `/approval`**, and `/v1/models`, `/health` and `/v1/capabilities`. Tools execute **server-side**. ([api-server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)) |
| Security | Command approval modes are smart (default), manual and off. A hardline blocklist applies even in YOLO mode. The `local` terminal backend has **no isolation**, and Docker, SSH and Modal backends are available. Prompt-injection scanning of context files is "heuristics". ([security](https://hermes-agent.nousresearch.com/docs/user-guide/security)) |

**Hermes Agent vs the Hermes LLMs.** They are separate products.
- The **Hermes models** are Nous's open-weight fine-tunes.
- **Hermes 4** is hybrid reasoning with `<think>` blocks and `<tool_call>` tags. **Hermes-4-14B** is based on **Qwen3-14B** and licensed Apache-2.0 ([HF card](https://huggingface.co/NousResearch/Hermes-4-14B)), and the technical report is [arXiv 2508.18255](https://huggingface.co/papers/2508.18255) (Aug 2025). **Hermes 4.3 36B** is based on ByteDance Seed-OSS-36B and was trained decentralised over Psyche ([HF card](https://huggingface.co/NousResearch/Hermes-4.3-36B)). The 70B and 405B sizes are Llama-3.1-based **[2nd]**.
- **Hermes Agent** is model-agnostic agent software and works with Nous Portal, OpenRouter, OpenAI, any endpoint, and more.

**6 GB GPU reality check [calc]**
- Qwen3-4B has 36 layers, 8 KV heads and head_dim 128 ([config.json](https://huggingface.co/Qwen/Qwen3-4B/raw/main/config.json)). That works out to **144 KiB of KV cache per token in f16**.
- At Hermes's 64k minimum, the KV cache needs **≈8.8 GiB in f16**, **≈4.7 GiB with `q8_0`** and **≈2.5 GiB with `q4_0`**. Add about 2.5 GB of weights ([Ollama qwen3:4b](https://ollama.com/library/qwen3)).
- Only `q4_0` KV (which requires Flash Attention, per the [Ollama FAQ](https://docs.ollama.com/faq)) comes close to fitting, and it costs quality at long context.
- The original Qwen3-4B is **32,768 tokens native** (131k with YaRN) ([card](https://huggingface.co/Qwen/Qwen3-4B)). **Qwen3-4B-Instruct-2507** is 262,144 native but has no thinking mode ([card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)).
- **Conclusion:** running Hermes on local Qwen3-4B is marginal. Point Hermes at a hosted model, or don't let it be the brain.

**Cleanest JARVIS integration**
- **(a)** Use the same streamable-HTTP JARVIS MCP endpoint as in section 1:
  ```yaml
  mcp_servers:
    jarvis:
      url: "http://127.0.0.1:<port>/mcp"
      headers: {Authorization: "Bearer <token>"}
      tools: {include: ["room_*", "music_*"]}
  ```
- **(b)** JARVIS → Hermes: call `POST /v1/runs` and stream `/v1/runs/{id}/events`. Use `/approval` to surface Hermes's command approvals in the JARVIS UI, which gives you a clean human-in-the-loop path. Hermes → JARVIS happens through the MCP tool calls. If you want only the messaging gateway, spawn `hermes mcp serve` from `mcp_client_bridge.py`.
- **Verdict:** this is the better fit for JARVIS. It is Python, runs on native Windows, denies access by default, and has a documented run/approval API. The cost is the 64k-context requirement.

---

## 3. Agent Skills as a format

**Spec** ([agentskills.io/specification](https://agentskills.io/specification), [Anthropic overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview))
- A skill is a folder `skill-name/` with `SKILL.md` plus optional `scripts/`, `references/` and `assets/`.
- Frontmatter:
  - `name` is required: 1–64 characters, lowercase a–z, 0–9 and hyphens, no leading, trailing or double hyphens, and it must equal the directory name. Anthropic additionally forbids XML tags and the words "anthropic" and "claude".
  - `description` is required: 1–1024 characters, saying what the skill does and when to use it.
  - Optional fields are `license`, `compatibility` (≤500 characters), `metadata` (string→string map) and `allowed-tools` (experimental).
- Progressive disclosure happens in three steps:
  1. **Metadata**, about 100 tokens per skill, loaded at startup.
  2. **The body**, recommended under 5,000 tokens, loaded on activation. Keep SKILL.md under 500 lines.
  3. **Resources** on demand. Scripts are executed, and only their output enters context.
- Validate with `skills-ref validate ./my-skill`.
- The integration guide ([agentskills.io/integrate-skills](https://agentskills.io/integrate-skills)) recommends:
  - scanning `<project>/.agents/skills` and `~/.agents/skills` as the cross-client convention, with project overriding user
  - parsing leniently, but skipping any skill with no description
  - giving the catalog as `<available_skills>` XML
  - activating through file-read or a dedicated `activate_skill` tool with the name constrained to an **enum**
  - stripping frontmatter on activation and wrapping the body in `<skill_content>`
  - listing resources without reading them
  - **protecting skill content from compaction** and deduplicating activations
- Security: treat skills like installed software and audit them first ([Anthropic](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)).

**Compatibility**
- **OpenClaw** follows the AgentSkills spec and scans `~/.agents/skills` ([docs](https://docs.openclaw.ai/tools/skills)).
- **Hermes** is "compatible with the agentskills.io open standard" and can install from `anthropics/skills`, `openai/skills`, skills.sh and ClawHub ([docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)).
- Both extend `metadata` with nested objects (`metadata.openclaw`, `metadata.hermes`), but the spec defines `metadata` as a string→string map. **A skill written to the strict spec loads in all three clients, and each client ignores the other clients' extension blocks.**

**On-demand skill loader for Qwen3-4B.** This is my design. It mirrors OpenClaw's `skills_search` and Hermes's `skills_list`/`skill_view`.
1. **Discover** skills from `C:\Projects\JARVIS\skills\*\SKILL.md` and `~/.agents/skills`. Parse leniently and cache `{name, description, path}`.
2. **Index** `name + description` as embeddings in a LanceDB table next to Yaadash.
3. **Per turn:** run a vector search and keep the top 3 above a score threshold. Inject only those as `<available_skills>` (about 300 tokens), not the whole library. Register `activate_skill(name: enum[top-3])` and skip registering it when no skills match.
4. **On activation:** return the body without frontmatter, wrapped in `<skill_content>`, plus a resource list. For a 4B model, **cap bodies at about 1–1.5k tokens**. That cap is my recommendation and is stricter than the spec's 5k.
5. **Pin and evict:** pin active skill content against summarisation and unload it when the task ends. Scripts run in JARVIS's allowlisted executor, and only their stdout goes back to the model.
6. **Shortcut:** route high-frequency intents (music, lights) deterministically and skip the skill step for them, since small models are weakest at deciding when to use a tool.

---

## 4. Spotify Web API (state on 2026-10-12)

**Developer mode, which is your only realistic tier**
- The **app owner must have Premium**, or the app stops working ([quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)). This rule applied to new apps from 11 Feb 2026 and to existing apps from 9 Mar 2026 ([Feb-2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)).
- An app allows **5 allowlisted users**. Unlisted users get 403.
- New developers get **1 Client ID**, raised to **25 in July 2026**. Existing apps are grandfathered. ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide))
- Dev-mode apps share a quota, and exceeding it returns 429 `QUOTA_EXCEEDED` ([quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)).

**Extended quota**
- Since 15 May 2025 Spotify accepts **organisations only**, requiring a registered business, a launched service and **≥250k MAU**. Review takes up to 6 weeks. ([quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)) JARVIS cannot qualify.

**OAuth for a desktop app**
- Use **Authorization Code + PKCE**, recommended where a client secret can't be stored. The code_verifier is 43–128 characters. ([PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow))
- The redirect URI must be **`http://127.0.0.1:<port>/callback` or `http://[::1]`**. **`localhost` is not allowed.** Loopback URIs may use dynamic ports. These rules apply to new apps from 9 Apr 2025, with all clients expected to migrate by Nov 2025. ([redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri))
- **Refresh tokens last 6 months from authorization, and refreshing does not extend them.** Plan a re-auth prompt, and handle `invalid_grant` by restarting the auth flow. ([refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens))

**What you can do**
- **Read state without Premium:** current playback (`user-read-playback-state`, no Premium note) ([ref](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback)), devices (`GET /me/player/devices`) ([ref](https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices)), recently played (max 50, no podcasts) ([ref](https://developer.spotify.com/documentation/web-api/reference/get-recently-played)), and top artists and tracks for `short_term` (about 4 weeks), `medium_term` (about 6 months) and `long_term` (about 1 year), max 50 ([ref](https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks)).
- **Control playback with Premium:**
  - Commands: play/transfer, pause, seek, volume and queue. Each page says "This API only works for users who have Spotify Premium" (scope `user-modify-playback-state`). ([start playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback), [queue](https://developer.spotify.com/documentation/web-api/reference/add-to-queue))
  - **Execution order across Player calls is not guaranteed.**
- **Spotify Connect control:** the Web API controls whatever **Connect devices** the user has, such as the desktop app, phone or speakers.
  - Some device models are not listed at all.
  - Devices with `is_restricted=true` "will not accept" Web API commands. ([devices](https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices))
- **Web Playback SDK:** this turns the browser into a Connect device. It needs Premium and must not be used commercially without approval ([SDK](https://developer.spotify.com/documentation/web-playback-sdk)). It relies on EME/Widevine. **[unverified] Widevine availability inside WebView2 is not confirmed**, and Electron users report license-server 500s ([community](https://community.spotify.com/t5/Spotify-for-Developers/Issue-using-Widevine-DRM-development-license-in-an-Electron-app/m-p/6068831/highlight/true)). **Recommendation:** let the Spotify desktop app be the player and have JARVIS control it through the Web API.

**Deprecations**
- **27 Nov 2024:** new apps and dev-mode apps lost **Related Artists, Recommendations, Audio Features, Audio Analysis, Featured Playlists, Category's Playlists, 30-second preview URLs in multi-get, and algorithmic/editorial playlists** ([Spotify blog](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)). Verified.
- **Feb 2026, dev mode:**
  - Removed: batch `GET /tracks|albums|artists…`, `/browse/*`, `/artists/{id}/top-tracks`, `GET /users/{id}` and `/users/{id}/playlists`, and `/markets`.
  - Per-type save and follow endpoints were replaced by `PUT/DELETE /me/library` with URIs.
  - `/playlists/{id}/tracks` became `/items`, and it only returns content for playlists you own or collaborate on.
  - Search `limit` max dropped from 50 to **10**.
  - `popularity` and `available_markets` were removed from tracks, and `followers` and `popularity` from artists.
  - `GET /me` lost `email`, `country` and `product`. ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide))
- **Developer Terms v10 (effective 15 May 2025)** prohibit "using the Spotify Platform or any Spotify Content to train a machine learning or AI model", forbid storing Spotify Content indefinitely, and restrict local caching ([terms](https://developer.spotify.com/terms)). Do not build the taste model from API-harvested data you store long-term.

**Extended streaming history (your GDPR export)**
- Spotify documents it as covering the **lifetime of your account**, delivered as JSON, with 21 fields described in an included "Read Me First" file ([Spotify support](https://support.spotify.com/us/article/understanding-your-data/)).
- **Request it** under Account → Privacy → Download your data: tick "Extended streaming history" and confirm the email. Delivery takes **"up to 30 days"**, with users reporting 1–5 days **[2nd]** ([guide](https://takeoutday.org/guides/download-spotify-data)).
- **The 21 fields:** `ts, username, platform, ms_played, conn_country, ip_addr_decrypted, user_agent_decrypted, master_metadata_track_name, master_metadata_album_artist_name, master_metadata_album_album_name, spotify_track_uri, episode_name, episode_show_name, spotify_episode_uri, reason_start, reason_end, shuffle, skipped, offline, offline_timestamp, incognito_mode` ([community README](https://github.com/Wallerand/spotify-unwrapped), consistent with Spotify's description). **[unverified]** Newer exports may use `ip_addr` and add audiobook fields.
- **For the taste model:** this file is your own personal data, obtained through a data-access request rather than the Developer Platform. My reading is that the Developer Terms' ML clause targets Platform data, but **this is not legal advice**. The useful signals are `ms_played`, `skipped`, `reason_end` (for example `fwdbtn`, `trackdone`), hour-of-day and `shuffle`. Ingest it into Yaadash offline.

**Live listening log without the API:** Windows `GlobalSystemMediaTransportControlsSessionManager` (Win10 1809+) "provides access to playback sessions throughout the system" and lets you control them ([Microsoft Learn](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager)). From Python, use the pywinrt package `winrt-Windows.Media.Control` (3.2.1, Python ≥3.9) ([PyPI](https://pypi.org/project/winrt-Windows.Media.Control/)). **[unverified]** I did not confirm two things: that the documented `globalMediaControl` capability is not enforced for unpackaged Python, and that the Spotify desktop app publishes an SMTC session. Test both.

---

## 5. Local music playback and YouTube Music

**Option A, recommended for a UI-first player.**
- The React `<audio>` element runs inside the existing WebView2 window, and FastAPI streams files with `FileResponse`. Starlette `FileResponse` **supports HTTP Range** with 206/416 responses ([Starlette docs](https://starlette.dev/responses/)), so seeking works.
- Range parsing had a DoS bug (CVE-2025-62727) fixed in 0.49.1 ([IBM bulletin](https://www.ibm.com/support/pages/node/7260257)). JARVIS pins Starlette 1.3.1, which is fine.
- Use the **Media Session API** for metadata and media keys ([web.dev](https://web.dev/articles/media-session)). **[unverified]** I could not confirm that WebView2 forwards Media Session to the Windows SMTC overlay or media keys, so test it.

**Option B, recommended if voice must control music with the window closed.**
- Play from Python with **python-mpv**. It is GPL-2+ or LGPL-2.1+ depending on the libmpv build, Python ≥3.9, needs the libmpv DLL on PATH or next to `mpv.py`, and the maintainer warns "expect some pain" on Windows ([repo](https://github.com/jaseg/python-mpv)). Alternatives are python-vlc and similar.
- Push now-playing to the UI over the existing WebSocket. SMTC integration from Python goes through pywinrt **[unverified for unpackaged apps]**.

**YouTube Music**
- **ytmusicapi 1.12.3** (16 Sep 2026, MIT, Python ≥3.10) is an "Unofficial API for YouTube Music". It covers search, library, playlists, history and uploads. ([repo](https://github.com/sigma67/ytmusicapi), [PyPI](https://pypi.org/project/ytmusicapi/))
- Since Nov 2024 its OAuth flow needs your own YouTube Data API client ID and secret of type "TVs and Limited Input devices" ([docs](https://ytmusicapi.readthedocs.io/en/stable/setup/oauth.html)).
- **ToS risk:** YouTube's terms bar accessing the Service "using any automated means (such as robots, botnets or scrapers)" and bar downloading content except as expressly authorized or with permission ([YouTube ToS](https://www.youtube.com/t/terms)).
- **Recommendation:** at most, use ytmusicapi for occasional read-only library and history sync on your own account, and accept the account risk. **Do not stream-rip.** Play local files or Spotify instead.

---

## 6. Obsidian vault I/O

**Format**
- A vault is a plain folder of Markdown files, plus a `.obsidian/` folder for per-vault settings, themes and plugins. Obsidian "automatically refreshes your vault to keep up with any external changes". Git-ignore `.obsidian/workspace.json`. Don't nest vaults. ([data storage](https://obsidian.md/help/data-storage))
- **Properties** are YAML between `---` lines. The types are Text, List, Number, Checkbox, Date, Date & time and Tags, and a type applies to that property name **vault-wide**. Links inside properties **must be quoted**, as in `"[[Link]]"`. Nested properties are not editable in the UI. The defaults are `tags`, `aliases` and `cssclasses`. ([properties](https://obsidian.md/help/properties))
- **Links:** `[[Note]]`, `[[Note#Heading]]`, `[[Note#^block-id]]`, `[[Note|alias]]` and the embed form `![[…]]`. Obsidian **updates links when you rename inside Obsidian** ([links](https://obsidian.md/help/links)). Renames by an external app are therefore not link-safe (my inference).

**Safe two-way sync from JARVIS (best practice)**
1. **Read** files directly. You don't need Obsidian running. Parse frontmatter leniently, extract links with a regex covering the five forms above, and skip `.obsidian/` and `.trash/`.
2. **Write**:
   - Put new notes in a dedicated folder such as `JARVIS/`. For existing notes, append under a JARVIS-owned heading only.
   - Use atomic writes: write a temp file in the same directory, then `os.replace`.
   - Check concurrency first: compare mtime and content hash and abort or merge if the file changed.
   - Round-trip frontmatter so unknown keys and their order survive (for example with ruamel.yaml), and add a stable `jarvis_id` property.
   - Never write into `.obsidian/` and never rename or move notes yourself.
   - Watch for changes with a debounced filesystem watcher.
3. **OneDrive caveat:** your Documents folder is in OneDrive. Sync clients can create conflict copies, so keep JARVIS writes small and atomic (my caution).
4. **When Obsidian is running, prefer its own write paths**, which keep links and indexing correct:
   - The **Local REST API plugin 5.4.0** (6 Oct 2026, MIT) serves HTTPS on `127.0.0.1:27124` with a self-signed certificate (optional HTTP on 27123) and uses a bearer API key. PATCH can target a heading, block or frontmatter key, and JsonLogic search and commands are available. It has a **built-in MCP server at `/mcp/` over streamable HTTP**, so `mcp_client_bridge.py` can connect directly. As of 5.4.0 it blocks `.obsidian/` by default. ([repo](https://github.com/coddingtonbear/obsidian-local-rest-api), [releases](https://github.com/coddingtonbear/obsidian-local-rest-api/releases))
   - The **official Obsidian CLI** needs installer 1.12.7+ and is enabled under Settings → General. It requires the app running and auto-launches it. Commands include `obsidian create name=… content=…`, `daily:append`, `property:set` and `search`. ([CLI help](https://obsidian.md/help/cli), [changelog 1.12.4](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/))

---

## 7. Memory-graph visualisation, 5k–50k nodes

| Option | Documented numbers / facts | Fit |
|---|---|---|
| **three.js `Points` with custom BufferGeometry** (already in JARVIS, three 0.186) | The official points example renders **500,000 particles** (`const particles = 500000;`) in one geometry ([example source](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_buffergeometry_points.html)) | Best for 20k–50k nodes with **precomputed** positions |
| **three.js `InstancedMesh`** | The docs say it reduces draw calls ([docs](https://threejs.org/docs/pages/InstancedMesh.html)). The instancing performance example compares instanced, merged and naive rendering for **1–10,000** meshes in one draw call ([example](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgl_instancing_performance.html)) | Use when nodes need real shapes, up to about 10k |
| **3d-force-graph / react-force-graph** (MIT, three.js, d3-force-3d or ngraph) | Its "Larger graph" example is "~4k elements". It exposes `warmupTicks`, `cooldownTicks/Time`, `pauseAnimation` and `enablePointerInteraction` (turning that off helps performance). ([repo](https://github.com/vasturiano/3d-force-graph)) | Live physics up to about 5k nodes |
| **cosmos.gl** (`@cosmos.gl/graph`, MIT, peer dependency luma.gl ~9.3) | GPU layout and rendering of "hundreds of thousands of points and links on modern hardware". It is 2D. `setPointPositions(Float32Array)` and `setLinks(Float32Array)` set the data. ([repo](https://github.com/cosmograph-org/cosmos)) | Live 2D layout from 50k nodes upward |
| sigma.js (MIT, WebGL, graphology) | Says it renders large graphs fast, but the site gives no numbers ([site](https://www.sigmajs.org/)) | Alternative 2D option |

**Recommendation**
- Compute layout in the backend, not in the browser. For example, project Yaadash embeddings to 3D with UMAP and cache them, or run a force layout offline.
- Render nodes with **one `THREE.Points`** that has per-vertex color and size attributes.
- Render edges with **one `LineSegments`** buffer containing only the top-k or kNN edges, not all edges.
- For picking, use a GPU color-ID pass or a CPU KD-tree rather than raycasting 50k objects.
- Use `InstancedMesh` only for the highlighted subgraph.
- If you want live physics, use react-force-graph-3d at 5k nodes or fewer, or cosmos.gl in 2D for larger graphs.

---

## Unverified items to test before relying on them
- Whether `openclaw mcp serve` suppresses the Gateway's own agent replies when it is used as a pure messaging bridge.
- Whether WebView2 supports Widevine (needed for the Spotify Web Playback SDK) and whether it forwards Media Session to SMTC.
- Whether GSMTC works from unpackaged Python, and whether the Spotify desktop app publishes an SMTC session.
- The newer Spotify export field names (`ip_addr`, audiobook fields) and the official delivery-time wording.
- The Hermes 70B and 405B base models and the Clawdbot/Moltbot rename dates (secondary sources only).
