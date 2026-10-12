# Tools, receipts and the honesty guard (ROADMAP A2, A3, A6)

How JARVIS does things, and how he is kept from saying he did things he did not.
Code: `core/tools/` (registry, tools, time parser, guard), `core/agent.py` (the turn),
`app/jarvis_app/reminders.py` + `routes_reminders.py` (reminders in the app),
`app/ui/src/components/Reminders*.tsx` (the card and the alert).

## 1. The registry

Every ability is declared once, in `core/tools/builtin.py`:

| Tool | Tier | What | Truth comes from |
|---|---|---|---|
| `get_datetime` | T0 | time, date, weekday | the laptop's clock |
| `room_state` | T0 | light and fan | app · Limbs (says "virtual room" with no relay board) |
| `presence` | T0 | who is in the room | app · Aankhen; simulated people are never reported |
| `memory_search` | T0 | search his memory | Yaadash |
| `list_reminders` | T0 | pending reminders | app · reminders |
| `set_device`, `set_scene` | T1 | switch light/fan, scenes | app · Limbs (or JARVIS's own virtual room without the app) |
| `set_reminder`, `cancel_reminder` | T1 | reminders, timers, alarms | app · reminders |
| `switch_later` | T1 | "fan off in 30 minutes" | app · reminders → Limbs when due |
| `send_message` | T2 | messages and calls | registered, **off**, never bound; no channel exists |
| — | T3 | money, anything irreversible | `register()` refuses a T3 tool |

T2 tools are switched on only by him (`JARVIS_T2_ENABLED=send_message`); even then
`send_message` sends nothing, because no channel exists, and its receipt says so.

Every call returns a **receipt**: `tool, tier, ok, did` (one true sentence), `source`,
`at`, `simulated`, `backs` (the kinds of claim it can support), `data`, `error`. A
call never raises; a broken tool, a bad argument or an unknown name is a failed receipt.

**Scope rule.** An action (T1/T2) the *model* chooses runs only if his words are about
that tool's domain (the tool's own trigger words). The first live run showed why:
"schedule a call with mum at nine" made the 4B model schedule a room scene. Reads may
be guessed at; actions may not. Deterministic fast paths are not limited by this rule.

## 2. A turn

1. **Fast paths, no model** (instant, a receipt for each action, the reply built from
   receipts): remember-that → reminders/timers/alarms/timed switches (`when.py`) →
   Mission Germoney → room commands → "what time is it". Reminders run before Mission
   ("remind me in 2 hours to study German" is not a German log) and before the room
   parser ("turn off the fan in 30 minutes" must not switch it now).
2. **The model.** The persona's capability list is generated from the registry
   (`Registry.capability_block()`): tools he can call, direct commands, what is
   switched off, and what is impossible. Tools are bound when the turn touches a tool's
   domain; chit-chat stays tool-free. Tool calls are taken from the streamed chunks
   (the old code threw the stream away and asked the model again); results go back as
   receipts; a second, low-temperature round answers from them. One tool round, at
   most four calls, no loops.
3. **The honesty guard** (`honesty.py`) checks every sentence before it is spoken.

## 3. The honesty guard

A sentence that **claims** an action (switch, schedule, reminder, message, tracking,
internet, media, memory, presence, "done") must have a successful receipt of that kind
from this turn, or it is replaced:

- a failed receipt wins: its own sentence is said ("…7 am today has already passed");
- something a tool could do but did not: "I haven't set a reminder; nothing was saved.
  Say, for example, 'remind me at 9 to call Mum'";
- something switched off: "I can't send messages or make calls for you: that is switched off";
- something nothing can do: "I have no internet access, so I can't search, see news or
  weather, upload, book or buy anything";
- a device no tool reaches: "I can't control that from here; I can only switch the
  room's light and fan".

An **offer** of something impossible ("Shall I text her?") is replaced too; an offer of
what a tool really does ("Shall I set a reminder?") is left alone. Negations,
conditionals and explanations ("when the input is low, the light is off") pass
untouched — 20 such sentences are in the tests. A claim backed only by the virtual
room gets "Virtual room only; no relay board is connected." once, at the end, unless
the reply already said so.

Streaming: text is released exactly where the voice would speak it
(`voice.split_ready`), so first audio is not delayed. In a round where the model may
still call a tool, a claiming sentence is held until the tools have run. A claim in an
early comma-flushed clause is judged with its whole sentence.

What is stored in memory is what was said after the guard, so an invented claim never
becomes a memory.

## 4. Reminders

Owned by the app (it stays open; JARVIS sleeps, restarts, runs in text mode):
`data/app/reminders.json`, atomic writes, a scheduler checking every second (chained
onto the server's lifespan from `routes_reminders.register`). When one is due: a bus
event always; `core.speak()` when JARVIS runs (audible only in voice mode — the event
says `spoken`); a timed switch drives Limbs. The window chimes and shows the alert when
JARVIS did not speak.

- Times are parsed by `core/tools/when.py` for both JARVIS and the app (English and
  Hinglish: "kal subah 7 baje", "saade 9", "paune 8", "dedh ghanta", "har roz raat 10
  baje"). Every confirmation says the resolved time back ("9 pm today").
- Ambiguity rules: "at 9" is the next 9:00 or 21:00; with a day, 7–11 is morning and
  1–6 afternoon; alarms prefer the morning; "this evening" said in the evening asks
  when; a question about a reminder lists them and never creates one.
- Fired late because the app was closed: said as missed. A timed switch more than 15
  minutes late is skipped. A daily reminder missed for days is announced once.
- `POST /api/reminders/{id}/ack` keeps "done" with the firing — the start of SIH-3's
  "haan, le li"; `…/snooze` re-arms it.

API: `GET/POST /api/reminders`, `POST /api/reminders/cancel`, `DELETE /api/reminders/{id}`,
`POST /api/reminders/{id}/snooze`, `POST /api/reminders/{id}/ack`. `POST` takes
`{text, when}` (a phrase), `{text, due}` (ISO or epoch), or `{phrase}` (the card's one box).

## 5. Measured

`core/tools/eval_live.py` runs 30 prompts (25 red-team, 5 tool) through the real
Qwen3-4B with stand-in memory and a scratch app server. Final run, 2026-10-12: the
model wrote an unbacked claim in 5 of 30 replies; JARVIS said 0 — checked by the
guard's detector **and read by hand**, because a detector cannot score what it does
not detect (three earlier runs found phrasings it missed; each is now a test). Plain
replies 1.0–1.6 s, tool turns 2.5–3.4 s (two model rounds, first chunk 0.2–0.75 s); the
first tool-bound call after the cache is lost re-prefills (11.5 s once, on an Ollama
server shared with other sessions).

## 6. Limits

- The guard is pattern-based: a new phrasing of a claim can pass until it is added. The
  red-team set and the live eval are how it grows.
- It polices claims of action, not invented facts ("your exam is on the 12th of
  October" said with no such fact is not caught unless it rides on a claim).
- Reminders fire only while the app is open on the laptop; there is no phone push yet
  (ROADMAP L6).
