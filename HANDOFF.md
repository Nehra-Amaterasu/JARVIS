# Handoff: Yaadash Keep/Wrong + reminders, UI speed (2026-10-25)

## Done (committed)
- 95d0e38 Radar layer chip removed (twin/layers.ts; radar wedge layer starts off). Test: layers.test.ts.
- c1efb04 Every tab except Core lazy-loaded (src/pageLoaders.ts), light tabs prefetched at idle. Test: pageLoaders.test.ts.
  - First-load JS 403.9 kB -> 305.9 kB (gzip 126.9 -> 100.1 kB); CSS 125.5 -> 110.2 kB (gzip 29.0 -> 26.4).
  - Cold FCP in headless Chrome at 4x CPU throttle: medians 244-476 ms before vs 244-772 ms after. Noise is larger than the difference on this laptop, so there is no measured first-paint gain.
- c9725c5 RemindersCard (it existed but no tab used it) now on the Yaadash tab, soonest first (upcoming() in lib/reminders.ts, tested).
- be249f0 Backend: chat_memory.review_queue()/review() + learned/reviews.json; GET /api/memory/learned, POST /api/memory/learned/{id} {verdict: keep|wrong}. Test: yaadash/tests/test_learned_review.py.

## In progress
- The UI "Keep / Wrong" card for the Yaadash tab. None of it is written yet.

## Exact next step
1. src/lib/learned.ts: types (LearnedItem, LearnedQueue matching review_queue output) + pure helper dropVerdict(queue, id, verdict).
2. src/components/LearnedReviewCard.tsx: usePoll(api('/api/memory/learned?n=8')), Keep/Wrong buttons -> post(`/api/memory/learned/${id}`, {verdict}), toast. Mount it in pages/Yaadash.tsx above <RemindersCard />.
3. src/__tests__/learned.test.ts: helper tests + a render test using vi.stubGlobal('fetch') + createRoot/act (same pattern as energy.test.ts).
4. Write docs/research/2026-10-25-ui-speed.md (use the numbers above; the probe was headless Chrome over CDP) and add an index line to docs/research/README.md.

## Test status
- UI: `npx vitest run` in app/ui: 26 files, 292 tests, all passing.
- yaadash: test_learned_review, test_learn_chats, test_memory_audit, test_memory_eval: 78 passed.
- The app-server tests were not run (out of scope). server.py passes py_compile.
