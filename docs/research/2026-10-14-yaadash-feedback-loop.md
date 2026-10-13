# Yaadash: what it is for, whether it works, and the chat feedback loop (2026-10-14)

Public design note. The per-probe results, the probe questions and what was learned from
the real conversations are private (`data/notes/research/2026-10-14-yaadash-audit.md`).

## Question

Why does JARVIS have a second brain (Yaadash) at all, is it doing its job, and can the
conversations with JARVIS (already saved as JSONL and reviewed by Claude) become a feedback
loop: read over, kept as memory, so JARVIS grows a personality and gets better at being his
butler? How does that compare with "Gemini-style" memory, and how much data would real
training need?

## What Yaadash is for

A 4B model knows nothing about its owner and forgets everything when the context window
rolls over (agent.py keeps 6 exchanges and drops them after 10 idle minutes). Yaadash is
the part that knows him: confirmed facts, people, his message archive, his taste. It was
built in four layers, each answering a different question:

| Layer | Store | Reaches the prompt | Answers |
|---|---|---|---|
| Confirmed facts | `memories` table, `authored:*` rows (62 rows) | **every turn**, in the system message (~950 tokens, cached prefix) | "what's my father's name?" |
| Past-chat fragments | `memories` table, `instagram:*` rows (929) | top 3 when cosine distance <= 0.32 | colour, never fact |
| Episodic recall + people | `archive_msgs.parquet` (109,819 messages), BM25 + `archive_windows` (14,013 windows), RRF | only when the message is about the past or names a person | "remember when I ...?" |
| Beliefs (active learning) | `beliefs` table (18) | unconfirmed claims >= 0.6 confidence, hedged | "is this still true?" |

## Is it working? (measured 2026-10-14, read-only, on the real stores)

20 probe questions whose answers are in the stores (private file has them):

| Probe set | n | Result |
|---|---|---|
| Confirmed facts | 3 | 3/3 in the system message (by construction: every fact, every turn) |
| Instagram archive recall | 10 | hit@1 2/10, hit@2 3/10, hit@5 3/10; answer reached the model's CONTEXT 3/10 |
| Things he told JARVIS in their own chats | 7 | **0/7** |

Latency of the per-turn memory assembly (recall + fragments + beliefs, warm): median
0.29 s, max 0.89 s.

Findings:

1. **Nothing from a conversation ever came back.** Every turn is written to `memories` as
   a `voice_interaction` row (156 rows, 10-08 to 10-13) and retrieval excludes that source
   on purpose (JARVIS's own wrong replies must not feed back). The transcripts themselves
   (`data/app/transcripts/*.jsonl`, flags) were read only by the review export and the
   crew's task ledger, never by memory. So corrections, preferences and instructions he
   gave by voice were lost when the 6-exchange buffer rolled over.
2. **"Remember that ..." had never stored anything**: 0 `authored:confirmed:told` rows and
   0 corrections. The explicit form works in tests, but the form he actually used,
   "Remember that." after stating something, names nothing: `remember.parse` returns None,
   the message reaches the model, the episodic-recall gate fires on "remember", finds
   nothing in the Instagram archive, and the model says "I don't have a record of that".
3. **The beliefs queue is empty**: 18 beliefs, all decided (14 confirmed, 3 outdated, 1
   rejected), all seeded from taste and people. `distill` (beliefs from his own messages)
   was never run, so there is nothing left to ask him.
4. **Archive recall misses mostly at the gate, not the ranking.** Of the 7 misses, BM25
   had the right message at rank 1-2 in 3, but the best vector window was 0.32-0.41 away,
   above the 0.32 relevance gate, so recall returned nothing at all. (Not changed here; see
   "Left".)
5. One stale authored fact about the hardware (written before the relays moved to another
   board) is in every system message; it is the likely source of JARVIS naming the wrong
   board for the fan. Authored facts were not edited (they are his); a learned correction
   now overrides it in context.

So: the purpose is sound and the always-on facts channel works; the archive recall works
for a third of questions; and the loop he expected, conversations becoming memory, did not
exist.

## What was built

`yaadash/learn_chats.py` (write side) + `yaadash/chat_memory.py` (read side) +
`crew/agents/learner.py` (when it runs). Everything lands in a new, separate store,
`data/yaadash/learned/`; the older stores are untouched.

1. **Incremental ingest.** A byte cursor per transcript file, complete lines only (a torn
   last line waits). Every turn is embedded (bge-small, CPU) into a `chat_turns` LanceDB
   table keyed `session#turn`, so re-running is a no-op and a lost cursor costs only time.
2. **Noise filter.** Never a fact: turns he flagged `misheard` (and anything resting only
   on them is retracted when the flag arrives later), a few garbled words or one word
   repeated, and any line JARVIS answered with "I didn't catch that".
3. **Distillation** when a session has been quiet 10 minutes and nobody is talking, by the
   local brain through Ollama (`format: json`, temperature 0.1). Kinds: fact, preference,
   correction, instruction, callback. Each memory must name the line of HIS it came from
   and share words with it, or it is dropped. Rules always run too (and alone when Ollama is
   down; such sessions are re-read by the model later): "call me X", spelled-out
   corrections that name a thing, warm reactions (love/laughter/"spot on") -> a style
   exemplar or a loved song, frustration (loops, false claims, long replies) -> a "don't",
   app flags (good -> exemplar, wrong + expected -> correction).
4. **Merge or supersede.** Same memory again -> support +1, confidence up, evidence
   appended. A memory that changes an active one (the model is asked a yes/no; without it, a
   correction naming the same thing) supersedes it; superseded memories are never shown. The
   parsed address can only be replaced by another address, never by the model's wording.
5. **At reply time** (one call per hook in agent.py):
   - `handle_command`: "Remember that." / "note it" / "I want you to remember it" /
     "isko yaad rakhna" saves his previous substantive statement (skipping other memory
     commands, questions and garble) as a told fact and confirms it in one sentence;
     "Remember what, sir?" when there is nothing. "Don't call me X, call me sir, always"
     is written to `prefs_live.json` at once.
   - `adjust_persona`: the address he asked for replaces "Call him sir now and then, Aman
     otherwise", plus a note on how his chats are kept and learned from, standing
     instructions and don'ts. Static until they change, so Ollama's cached prefix survives.
   - `context_block`: per turn, at most 1,000 characters (~250 tokens): relevant learned
     memories, dated excerpts of earlier chats when he asks about one ("what did I tell
     you about ...?"), and at most 2 style exemplars (only on small talk, or when related).
6. **When it runs:** the app's crew agent `learner` every 120 s (first pass 60 s after app
   start, catching up on everything missed); `python -m yaadash.learn_chats --since 7d`
   backfills from a terminal.

### Measured on the real transcripts (into a separate eval store, data/yaadash/learned_eval)

- Backfill of 5 days: 290 turns, 7 sessions, 74-142 s with the 4B model (rules-only pass:
  16 s). 18 memories kept, 7 merges, 2 supersessions.
- The 7 chat probes: **0/7 -> 5/7** answerable from the new block. The two misses: a
  question worded entirely unlike the learned memory (no shared word, distance 0.61), and a
  phrase buried in a long rambling turn.
- Off-topic messages (8: VLSI, Germany, small talk) that received learned memories or chat
  excerpts: 0/8.
- Block size max 962 characters; block latency median 0.13 s, max 0.20 s.
- His real 10-14 sequence replayed (private file has it): the bare "remember that" now saves
  the hardware correction he had just made and confirms it in one sentence; his longer
  follow-up "note it" command reaches back past it and says it is already saved; his request
  to be addressed differently parses to the right address and the name to avoid.
- Calibration that changed the design: learned memories sit 0.48-0.62 (bge cosine
  distance) from the questions they answer and also from unrelated ones, so distance alone
  cannot gate them. Relevance is now "shares a content word with the memory (or two with the
  line it came from), and distance <= 0.60"; distance only orders.

## How personality grows (honest version)

**Now: in-context learning, no training.** The model's weights do not change. What changes
is what it reads before it answers: his standing instructions and don'ts in the system
message, the memories relevant to this message, and one or two replies he enjoyed as tone
examples. That is the same family of mechanism as Gemini's "personal context" (it keeps key
details and preferences from past chats and brings them into new ones; Google launched it in
August 2025 [1][2]), done locally: no cloud, nothing leaves the laptop. It works from the very
next chat, needs no GPU time, is fully inspectable (`memories.json`) and is undoable (a
memory can be superseded or retracted). Its limit: a 4B model follows a few hundred tokens of
such guidance imperfectly, so the persona stays short and the code (echo guard, honesty
guard, deterministic commands) does the enforcing.

**Later: a LoRA/QLoRA fine-tune of the 4B brain**, so the butler voice is in the weights:

- Data: LIMA showed 1,000 carefully curated prompt/response pairs were enough to teach a
  65B model a response style [3]; Unsloth's guidance treats under ~300 rows as small (start
  from the instruct model, which JARVIS already uses) and 300-1,000 high-quality rows as
  workable [4]; third-party guides put ~100 rows as the floor with marginal gains [5]. For a
  *style* (not new knowledge) on top of an instruct model, a realistic target is **300-1,000
  exchanges he flagged good or rewrote**, in his real mix of English and Hinglish. Today the
  store has 1 exemplar he flagged good and 0 rewrites, so this is months of flagged chats
  away, or a deliberate session of rewriting bad replies.
- Hardware: QLoRA trains LoRA adapters on a frozen 4-bit model [6]. Unsloth lists QLoRA
  minimums of 3.5 GB for 3B and 5 GB for 7B models (no 4B row) [7]; a 4B model sits between,
  roughly 4-5 GB at short sequence lengths, which fits the RTX 4050's 6 GB only with batch 1,
  ~1-2k-token sequences, and Ollama/JARVIS stopped while it trains. 16-bit LoRA (8 GB for 3B
  [7]) does not fit.
- Time: a few hundred short examples for 2-3 epochs is minutes-to-an-hour on a GPU of this
  class (QLoRA's own large runs were 24 hours for far bigger models on a 48 GB card [6]); the
  adapter is then merged and re-quantised to GGUF for Ollama.
- When it is worth it: when (a) there are 300+ curated good exchanges, and (b) the in-context
  route measurably fails at tone (for example, the echo guard or the persona rules being
  ignored in an A/B over the same scripted conversation). Not before: a fine-tune on a few
  dozen noisy, misheard voice turns would bake the mistakes in, and it cannot be "superseded"
  the way a memory can.

Packages a fine-tune would need (not installed, nothing downloaded): `unsloth` (or `peft` +
`bitsandbytes` + `trl`), and llama.cpp's converter to GGUF.

## Left

- Archive recall gate (finding 4): let a strong BM25 hit through when the vector gate
  rejects; needs a re-run of the yaadash control-query abstain set before changing.
- The 4B distiller writes some weak memories (a misheard model name became a "correction");
  the evidence check catches inventions, not mishearings. A review card in the app (confirm
  / reject learned memories, like beliefs) is the natural next step.
- `voice_interaction` rows are still written every turn and never read; they could stop.
- The stale hardware fact in `data/identity/core_facts.md` is his to edit.

## Sources

1. Google, "Gemini launches new personalisation features in the UK": https://blog.google/company-news/inside-google/around-the-globe/google-europe/united-kingdom/gemini-launches-new-personalisation-features-in-the-uk/
2. 9to5Google, Gemini personal context (Aug 2025): https://9to5google.com/2025/08/13/gemini-personal-context/
3. Zhou et al., "LIMA: Less Is More for Alignment" (2023): https://arxiv.org/abs/2305.11206
4. Unsloth, "What model should I use for fine-tuning?": https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/what-model-should-i-use
5. Dataset size recommendations (third party): https://artificial-intelligence-wiki.com/ai-development/training-and-fine-tuning/dataset-size-recommendations/
6. Dettmers et al., "QLoRA: Efficient Finetuning of Quantized LLMs" (NeurIPS 2023): https://arxiv.org/abs/2305.14314
7. Unsloth requirements (VRAM table): https://unsloth.ai/docs/get-started/fine-tuning-for-beginners/unsloth-requirements

## What it changed

New: `yaadash/learn_chats.py`, `yaadash/chat_memory.py`, `crew/agents/learner.py`, tests.
Changed: three hooks in `core/agent.py`; the crew gains a fourth agent
(`app/jarvis_app/routes_crew.py`); test conftests point the learned store at scratch folders.
