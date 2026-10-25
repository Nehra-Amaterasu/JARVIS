# Well Wisher engines 1-4: career, money, personality, insight (2026-10-25)

## Question

How should the four engines after the goal ladder and the evidence engine work, so
that each is a pure, testable function, says why for every line, never invents a
number, and never shames? And how should Today's 3 contracts be chosen from them?

## Findings

### 1. Recovery after missed days: a fresh start, not a debt
- Dai, Milkman and Riis (2014) found that goal pursuit rises after temporal
  landmarks: searches for "diet", gym visits and goal commitments all went up
  at the start of a new week, month, year or semester. Their 2015 follow-up argues
  that repeated fresh starts give more chances at change, so an early failure does
  not end the attempt.
- Breines and Chen (2012), four experiments: a self-compassionate view of a failure
  raised the motivation to improve. In one study, people who failed a test and took
  the self-compassionate view studied 25% longer for the retest and scored higher
  than people pushed to raise their self-esteem.
- **What it changed:** after `recovery_after_days` (2 by default) with nothing
  logged, the personality engine shrinks the day to two contracts, puts the
  shortest first and turns it into a 15-minute version. The sentence is "Welcome
  back. N days off happens." It says nothing about what was missed beyond the count.
  A shame word list (`ww_base.SHAME`) is checked in every engine test. The weekly
  review runs on the seven days ending today, so any day can be a fresh start.

### 2. Career timing: the open-source summer programme
- The official GSoC 2026 timeline: contributor applications from 16 Mar to
  31 Mar 18:00 UTC, accepted projects announced 30 Apr, coding from 25 May. The
  programme blog advises submitting at least three days before the deadline.
  Some organisations set earlier internal deadlines.
- **What it changed:** the GSoC template is "land one merged pull request before
  proposals open" when more than 30 days are left, and "write the proposal draft
  and send it to a mentor" inside 30 days. The real 2027 dates belong in the
  private inputs once they are published. The engine never assumes them.

### 3. Design decisions (no external source; stated so they can be changed)
| Engine | Rule | Numbers |
|---|---|---|
| career | score = urgency(days left) x (1 + share of asked-for nodes not mastered) x kind weight | urgency 1.0 within 7 days, 7/days after, at least 0.1; weights internship 1.0, gsoc/application/research 0.9, ms 0.8; applied x0.2 |
| career | an exam within 21 days is a gate; within 7 it is said once, on the top step | |
| money | rupees per hour = earned / hours, scored only after `review_after_weeks` | 4 weeks by default |
| money | projection = logged average monthly saving at 0%, plus the annuity future value at the return rate the inputs state: FV = m((1+i)^n - 1)/i, i = r/12 | horizons 1, 5, 10 years |
| money | an income goal shows the growth it needs: (target / income logged in the last 12 months)^(1/years) - 1 | unknown if nothing is logged |
| personality | the open-project cap is the inputs' number, at most 3 | hard ceiling 3 |
| insight | one change, first rule that fits: <=2 active days; <50% of planned done; a stalled node in progress; finished work without a link; else keep and stretch one | |
| today's 3 | ladder score + the score of a top-3 career step that asks for the contract's node; one per node; personality sets 3 or 2 | |

## Numbers on the fictional fixtures (app/jarvis_app/engine-inputs.example.json, day 2026-10-26)
- Career: next step "Draft the application ... First node: Verilog" for the example
  summer research programme, 35 days left, score 0.36; the example internal test
  7 days out is the gate. Order: summer programme 0.36, open-source proposals 0.18,
  the internship goal 0.10, the MS window 0.08.
- Money (test log): September savings rate 2,000 / 9,500 = 0.211; tutoring scored at
  Rs 450/h over 10 h after 6 weeks (above its assumed Rs 400/h); freelance "too
  early: 2 of 4 weeks"; projection average Rs 1,500/month = Rs 18,000 in a year at 0%.
- Personality: puzzle first, finish lines, variety and stretch all on; after 5 idle
  days, two contracts and the first is 15 minutes.
- Insight (test events): 4/7 active days, 180 minutes, 2 of 5 planned done (40%),
  so the one change is "plan two contracts a day instead of three".

## Privacy
The real inputs (`data/notes/well-wisher/engine-inputs.json`) and the knowledge
base stay private and git-ignored. Tracked tests use only the fictional example and
`app/tests/fixtures/ww-inputs-flat.json`, and the test setup points the engines at a
missing file, so a test never reads the private inputs.

## Sources
- Dai, Milkman, Riis (2014), The Fresh Start Effect, Management Science 60(10):2563-2582: https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf
- Wharton summary of the follow-up work: https://knowledge.wharton.upenn.edu/article/need-fresh-start-heres-begin/
- Breines, Chen (2012), Self-compassion increases self-improvement motivation, PSPB 38(9):1133-43: https://pubmed.ncbi.nlm.nih.gov/22645164/
- GSoC timeline: https://developers.google.com/open-source/gsoc/timeline
- GSoC 2026 organisations (advice to submit early): https://opensource.googleblog.com/2026/02/introducing-the-185-organizations-for-gsoc-2026.html

## What it changed
Built `ww_career.py`, `ww_money.py`, `ww_personality.py`, `ww_insight.py` and the
engine kit `ww_base.py`. Today's 3 now come from the goal ladder, career and
personality engines. Today has a weekly-review card, and "Jarvis, weekly review"
reads it out.
