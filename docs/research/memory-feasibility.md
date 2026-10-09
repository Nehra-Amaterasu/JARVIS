# Design Notes: Personal Memory at N = 1

How I reasoned about building a memory system for exactly one user, on one laptop
(RTX 4050 6 GB, 16 GB RAM, i5-14th gen), and what I deliberately chose *not* to build.
Implementation details and measurements live in [`DECISIONS.md`](../DECISIONS.md).

---

## 1. Three layers that get conflated

"Memory with machine learning" is really three systems that fail in different ways:

| Layer | Job | Tool | Cost here |
|---|---|---|---|
| **Retrieval** | find the right memory for a question | BM25 + vectors | trivial |
| **Structured ML** | learn patterns *over* memories — closeness, taste, era | sklearn / pandas | small data, CPU |
| **Generation** | reason, phrase, advise | the local LLM | the only GPU-bound layer |

The key realisation: the machine-learning layer is the **cheapest** one. My data is
~10⁵ rows, not 10⁹. A tie-strength model over 500 threads trains in milliseconds. The
6 GB VRAM ceiling that shapes every other decision only constrains generation.

## 2. What "growing" actually means

A memory that grows is not one that invents knowledge. It is a loop:

```
new data → extract → store → derive features → hypotheses → I confirm/correct → facts
```

The compounding step is the last one. A system that asks a handful of well-chosen
questions a day accumulates hundreds of *verified* facts a year — worth more than
any volume of scraped text, because they are true and endorsed.

## 3. Two stores, because one filter can't serve two jobs

Identity questions ("what do I study?") need short chatter filtered out — volume
drowns facts. Episodic questions ("remind me of that joke") need the opposite: a
punchline is short, and meaningless without the other person's reply.

So there are two stores: a filtered **identity** store on the hot path, and an
unfiltered **archive** searched only when a question is about the past or a person.

The binding constraint on episodic memory is **data availability, not algorithms**.
No retrieval method recovers a conversation that was never captured.

## 4. Tie strength

Hypothesis I started with: *volume of forwarded reels doesn't make someone close;
years of sustained contact does.* That matches the tie-strength literature
(Granovetter 1973; Gilbert & Karahalios, CHI 2009), which weights duration,
reciprocity and intimacy above raw volume.

Features per person: span, share of weeks with contact, reciprocity, calls and
voice notes, text depth (log-damped), recency, who starts conversations, and the
share of the thread that is reels. Everything is computable from a message export.

The hypothesis was then tested against labelled data — see `DECISIONS.md`. It held
at the top of the ranking and partly failed in the supervised fit.

## 5. Recommendation at N = 1

Industrial recommenders (collaborative filtering) work by finding *other users*
like you. With one user that is not hard — it's undefined. What works at N = 1:

- **content-based** profiling (topic models over what I engage with),
- **temporal** tracking, so past taste and current taste are distinguished,
- recommending **my own forgotten material back to me** — saved posts, old
  conversations — which is the genuinely useful case and has no competitor.

Out-recommending a streaming service is not the goal. Knowing my taste well enough
to talk to me like someone who knows it is.

## 6. Fine-tuning vs. retrieval

| | Fine-tuning | Retrieval |
|---|---|---|
| Teaches | style, tone | facts, content |
| Fits | "sound like me" | "know about me" |

Fine-tuning on books does not make a model wiser — it has already read them; it
mostly shifts prose style. Facts belong in retrieval, and reference material belongs
in a **separate** store from personal memory, or it buries the personal signal.
LoRA on a 4B model is possible on 6 GB, but it is the highest-effort, lowest-certainty
item here and does not solve memory, so it is parked.

## 7. Not assuming: confidence, provenance, era

Every inferred claim carries:

```yaml
claim: "He engages with anime edits content a lot in the past, less now."
confidence: 0.6        # inferred, not confirmed
era: before 2025
evidence: [taste topic, share 5.9%]
status: unconfirmed    # unconfirmed | confirmed | rejected | outdated
```

Unconfirmed claims reach the model labelled as guesses it must hedge. Social media
is partial evidence of who someone *was* at a given time — never a complete account
of who they are now. That is a schema property, not a prompt hope.

## 8. What I am deliberately not building

- A collaborative-filtering recommender — undefined at N = 1.
- Fine-tuning as a memory mechanism — wrong tool.
- A large auto-generated knowledge graph — an earlier version of this project had a
  130k-node graph that turned out ~95% noise. Structure comes from confirmed facts.
- Vector-indexed identity documents — high risk, no identity value.
- Heavy agent-orchestration frameworks — the bottleneck was always data quality.

## 9. Where it stands

Built and measured: archive, people, hybrid recall, tie strength, taste, beliefs,
active learning, refresh pipeline. Not yet done: large-scale LLM distillation, and a
reliable pre-2023 data source. Details in [`DECISIONS.md`](../DECISIONS.md).
