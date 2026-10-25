# Skill tree v2: a third track, maths weights, monotonic tiers (2026-10-25)

## Question

The Mission Germoney skill tree had 57 career nodes, two careers (VLSI design, AI-hardware architect), no record of how much maths each node needs, and tiers that broke their own rule (`dig.logic` was tier 1 but needed `math.discrete`, tier 2). What should v2 add for the track the 10-23 career research recommended: **design verification as the entry job, AI-accelerator architecture and low power as the long-term job, India first, then a German chip-design MS (TU Dresden NES, TUM MCD, Stuttgart INFOTECH)**? And does the plan engine still behave once it is added?

## What changed

| Area | Before | After |
|---|---|---|
| Career nodes (`skilltree.json`) | 57 | **74** (+17) |
| All nodes incl. maths track | 73 | **90** |
| Careers | 2 | **3** (`dv_ai_accel` added; every career weighs all 74 career nodes) |
| Career resources | 135 | **155** (+20, each owned by one node) |
| Certificates | 51 | **52** (+ NPTEL Low Power VLSI; Siemens Verification Academy also covers coverage closure) |
| Maths weight per node | none | `maths: {math-node: 0..1}` on all 74 career nodes; 63 non-empty |
| Tier rule | 54 career + 11 maths nodes violated "tier > every prerequisite" | **0 violations**; tiers are now the longest-path depth (career nodes reach 14) |

### The 17 new nodes (tier after the recompute)

Entry role, design verification:
- `ver.cocotb` (6) cocotb Python testbenches
- `ver.sva` (7) SystemVerilog assertions
- `ver.coverage_closure` (8) functional coverage and closure
- `ver.ref_models` (8) reference models and scoreboards via DPI-C
- `ver.lowpower_dv` (10) power-aware verification
- `ver.accel_dv` (11) verifying ML-accelerator datapaths

Low power:
- `lp.power_fundamentals` (7) dynamic and leakage power, clock gating
- `lp.power_analysis` (8) activity-based power analysis
- `lp.power_management` (9) power domains, UPF, DVFS

AI-accelerator architecture, the long-term role:
- `aiacc.quant_numerics` (10) INT8, FP8 and bfloat16 for ML hardware
- `aiacc.dataflow_mapping` (11) loop nests, stationarity, tiling
- `aiacc.perf_energy` (12) roofline and energy modelling
- `aiacc.sparsity` (12) sparsity and compression in hardware
- `aiacc.lowpower_arch` (13) low-power accelerator architecture
- `aiacc.capstone` (14) a verified, power-characterised accelerator tile

Career:
- `career.ms_germany_hw` (6) MS dossier for TU Dresden NES, TUM MCD and Stuttgart INFOTECH
- `career.dv_jobs_india` (9) DV job hunt in India

Each new node has 3 contracts. Every contract has context, steps, a hint and a success check, and its id is unique across the bank. Each node also has a project with a LinkedIn line and a maths weight. The new nodes sit in existing branches (`verification`, `implementation`, `ai_hardware`, `soft_skills`), so the weekly rotation and the goal ladder serve them with no new mapping.

### How the maths weights are used (engine change)

A maths-track node has no career weight of its own. `career_weight()` now gives it the demand of the career nodes that need it: the sum over those nodes of `career weight x maths weight`, halved and capped at 1. So under any career, probability and linear algebra rank above a niche topic such as complex numbers. A second change applies on a rotation day whose track has nothing open (for example the ML day before the ML prerequisites are mastered). The day now works on the prerequisite closure of that track's locked nodes ("what unlocks it") before it borrows the best node from anywhere. Without these two changes, the deeper monotonic tiers starved the ML/AI branch for the VLSI career (0 minutes in 8 weeks).

## Sources (each link checked on 2026-10-25, HTTP 200)

- Programme facts and the top-3 MS choice: [docs/research/2026-10-23-future-proof-careers-and-ms.md](2026-10-23-future-proof-careers-and-ms.md)
- Programme pages: [TU Dresden NES admission](https://tu-dresden.de/ing/elektrotechnik/studium/im_studium/studiengaenge/masters-programme-nanoelectronic-systems/prospective-students/admission-requirements), [TUM MCD](https://www.tum.de/en/studies/degree-programs/detail/microelectronics-and-chip-design-master-of-science-msc), [Stuttgart INFOTECH](https://www.uni-stuttgart.de/en/study/study-programs/Information-Technology-INFOTECH-M.Sc.-00001/), [DAAD programme database](https://www.daad.de/en/studying-in-germany/universities/all-degree-programmes/)
- Low-power course and certificate: [NPTEL Low Power VLSI Circuits & Systems, IIT Kharagpur](https://nptel.ac.in/courses/106105034) (title confirmed on the page). The exam fee of about Rs 1,000 is the usual NPTEL fee, as for the other NPTEL certs in the bank.
- Verification: [VA coverage cookbook](https://verificationacademy.com/cookbook/coverage), [VA low-power](https://verificationacademy.com/topics/low-power/), ChipVerify pages on [coverage](https://www.chipverify.com/systemverilog/systemverilog-functional-coverage), [SVA](https://www.chipverify.com/systemverilog/systemverilog-assertions) and [DPI](https://www.chipverify.com/systemverilog/systemverilog-dpi), [cocotb testbenches](https://docs.cocotb.org/en/stable/writing_testbenches.html), [VLSI Verify UVM](https://vlsiverify.com/uvm/), [NVDLA](https://nvdla.org/)
- Accelerators and power: [MIT 6.5930](https://csg.csail.mit.edu/6.5930/), [Accelergy](https://accelergy.mit.edu/), [OpenROAD docs](https://openroad.readthedocs.io/en/latest/), papers [FP8 formats 2209.05433](https://arxiv.org/abs/2209.05433), [Deep Compression 1510.00149](https://arxiv.org/abs/1510.00149), [EIE 1602.01528](https://arxiv.org/abs/1602.01528), [Eyeriss v2 1807.07928](https://arxiv.org/abs/1807.07928)

The new hosts (`csg.csail.mit.edu`, `accelergy.mit.edu`, `nvdla.org`, `openroad.readthedocs.io`, `www.daad.de`, `tu-dresden.de`, `www.tum.de`, `www.uni-stuttgart.de`) were added to the reviewed legal-host list in `app/tests/test_mission_audit.py`.

## Simulation results (the repo's own runs, `app/tests/test_mission_audit.py`)

8-week vision run (26 Oct to 20 Dec, every contract finished), share of minutes:

| Career | Trunk | Maths | AI/ML branch | Other | Mastered |
|---|---|---|---|---|---|
| none, before | 51 % | 24 % | 5 % | 20 % | 46 |
| none, v2 | 59 % | 29 % | 3 % | 9 % | 42 |
| vlsi_design, before | 52 % | 24 % | 4 % | 19 % | 46 |
| vlsi_design, v2 | 60 % | 31 % | 2 % | 8 % | 40 |
| ai_hw_architect, before | 48 % | 25 % | 5 % | 22 % | 46 |
| ai_hw_architect, v2 | 45 % | 38 % | 6 % | 11 % | 41 |
| dv_ai_accel, v2 (new) | 58 % | 31 % | 2 % | 9 % | 40 |

All rows pass the vision thresholds: trunk at least 35 %, trunk at least AI/ML, AI/ML above 0, maths at least 12 %. The ML/AI-hardware career now spends more on maths first, which matches its real prerequisites. The "other" share (security, soft skills, analog) falls because track days now unlock their own track.

90-day realistic run (skips, a 9-day gap, the fictional exam season): **0 issues** before and after; 39 exam days, 4 welcome-backs and no contract without a goal, all unchanged. Completions went from 138 to 117 and mastered nodes from 17 to 9. The run consumes randomness per contract, so a different path follows, and the deeper tiers put more maths before each node unlocks. This is fewer nodes mastered, not lost track.

## Tests

- Python, `app/tests` (`.venv`): new tests for the DAG with monotonic tiers, no orphans (no isolated node; every career node weighted by some career; every career weighs every career node), maths weights resolving and present wherever a maths prerequisite or a maths-heavy branch exists, every certificate link resolving in both directions, the third track's shape, and loader warnings for bad maths weights. The 8-week vision run is parametrised over the new career. `test_career_weight_and_campaigns_order_the_borrowed_work` was updated for the unlock-first rule.
- UI, vitest: the same invariants on the TS loader, plus a maths-weight parsing test. `tsc -b` is clean.

## What it changed

- The bank files (`app/ui/src/germoney/data/bank/*.json`) changed. All five are already tracked; the folder is git-ignored, so new files there need `git add -f`.
- Both loaders (`app/jarvis_app/germoney.py`, `app/ui/src/germoney/data/bank.ts`) keep `maths`.
- `career_weight` uses the maths demand, and empty track days unlock their own track first.

## Open questions

- Tiers are now 0-14 (longest path). The tree screen compresses tiers per branch, so the layout is fine, but the "tier N" label in the node panel reads large. Should it show a per-branch step instead?
- The maths-demand formula (sum / 2, capped at 1) is a judgment call, tuned only against the 8-week vision run.
- No cocotb- or UPF-specific certificate was added. None found is credible, and the projects are the proof.
- `boards.test.ts` (BoardPorts) failed once in three vitest runs. It is timing-related and unrelated to this change.
