# Career skill tree: VLSI / AI-hardware for an off-campus, tier-3 ECE route

**Date:** 2026-10-23
**For:** a B.Tech ECE student at a tier-3 college in India. Mission Germoney career track, repo this repository.
**Question:** Build a credible, practical, applied skill tree + certificate bank for two careers — "VLSI / digital design & verification engineer" and "AI/ML hardware architect" — for someone whose realistic route is off-campus hiring (and/or an MS in Germany), studying ~3 h/day, targeting a finished core by mid-2027. Which path gives a tier-3 fresher better odds, and which certificates are worth the money on a ~Rs 3,000/month budget (stretch to Rs 5,000+ for a truly credible course)?

## What was produced (data artifacts)
- `app/ui/src/germoney/data/bank/skilltree.json` — 57 nodes across 17 branches, 5 tiers, 130 daily "contract" tasks, 2 careers with per-node weights.
- `app/ui/src/germoney/data/bank/certs.json` — 51 certificates/credentials, ranked by credibility overall and per-career, with INR cost and free options.
- `app/ui/src/germoney/data/bank/resources-career.json` — 135 deduplicated resources (one owner node each), only legal/official links, all URL-checked.

## Recommendation (the path)
**Build a VLSI digital-design trunk, then branch into AI-hardware.** Reasons:
1. **Volume of fresher openings.** Design/verification hiring in India is far larger than AI-architecture hiring. Reports project the semiconductor workforce growing from ~220k toward ~1M jobs by 2026-27, with the sharpest talent shortage and pay pressure in **chip design and VLSI** specifically (Communications Today; Taggd India Decoding Jobs 2026). NVIDIA, Qualcomm and Intel post India new-grad RTL/verification roles; AI-accelerator roles in India (e.g. Google's "Silicon Architecture Engineer, University Graduate") are fewer and lean on accelerator-architecture experience a fresher rarely has.
2. **AI-hardware sits on top of the same base.** Computer architecture, RTL, SystemVerilog, and a performance-modelling project are the bridge. The trunk is not wasted effort if he pivots; it is the prerequisite.
3. **The MS-Germany option is served by the same trunk.** Device physics, CMOS VLSI, computer architecture and a research writeup double as MS-application and GATE material.
4. **Proof beats pedigree off-campus.** The consistent advice for tier-3 candidates: a public GitHub of real hardware work (RTL, UVM testbenches, a taped-out tile) plus targeted referral requests (send the exact job ID/link) (VLSI Verify; multiple tier-3 placement guides). The tree's projects are built to be that proof.
Do **not** force a final career choice now; the weights let the game steer 70-30 toward VLSI while keeping the AI-hardware branch alive, and the owner's own answer is to keep **both job and MS open and decide by mid-2027**.

## Key findings / numbers
### Jobs & salary (India, 2026 — all from career blogs/recruiters, treat as directional)
- VLSI fresher ranges quoted: ~Rs 3.5-6 LPA (GUVI) up to Rs 6-12 LPA (multiple); RTL ~Rs 6-8 LPA; DV tracks RTL; PD ~Rs 6-12 LPA. Qualcomm campus HW estimated Rs 6.2-7.5 LPA (unofficial).
- Who posts India fresher/new-grad hardware roles: NVIDIA (ASIC Engineer NCG 2026, Bengaluru; Formal Verification NCG, Gurugram/Bengaluru), Qualcomm (campus HW, multiple cities), Google India (Silicon Architecture Engineer, University Graduate — TPU power/perf modelling), Intel, Tenstorrent Bengaluru (mostly senior), InCore Semiconductors (SoC integration, open to freshers), Mindgrove (hiring post Series A, no public listing found).
- Germany ASIC design engineer average ~EUR 70.7k (Payscale 2026); entry proxy ~EUR 51k (lower decile). Relevant to the MS route.

### Certificates — credibility and cost (per-career ranking in certs.json)
- **NPTEL** proctored exams: ~**Rs 1,000** per course, enrolment free. IIT-run, recognised by Indian hiring managers, creditable. Best rupee-for-credibility option. (Next registration: Jan-Apr 2027 semester — this semester's windows closed 17-30 Aug 2026.)
- **Coursera** India region pricing: Specializations **Rs 1,699/month**; Coursera Plus Rs 2,099/mo or Rs 13,999/yr; **financial aid covers up to ~90%**, audit is free.
- **Linux Foundation LFD110** (Intro to RISC-V): **free**, Credly badge at 70%. LFD111 (Build a RISC-V core): audit free on edX.
- **Tiny Tapeout**: harden a GDS in CI **free**; fabrication only is paid (2025 projection ~EUR 70/tile, ~EUR 300 devkit — use the official calculator). Shuttles SKY26d and GF26c shown open on 2026-10-23.
- **IEEE SSCS PICO Chipathon**: free, open to anyone, selected designs fabricated. 2026 sign-up closed 1 May 2026 → target the 2027 call (watch from Feb 2027).
- **NVIDIA DLI**: many self-paced courses free; paid ones US$30-90; Associate certification exams from US$125 (third-party guide, confirm on NVIDIA).
- **Security**: NPTEL Ethical Hacking (Rs 1,000) cheapest credible; Cisco Ethical Hacker course+badge free (full cert needs a paid CTF); PortSwigger Web Security Academy labs free, BSCP exam ~US$99; eJPT ~US$249; CEH v13 Rs 35-45k (training-provider blogs, weak practitioner value); OSCP+ US$1,749 (~Rs 1.5L, gold standard, defer).
- **Paid VLSI institutes evaluated honestly**: Maven Silicon job-oriented programme Rs 2,00,000 + GST / 9 months (Careers360); ChipEdge Rs 90k-1.2L (own blog). What you pay for is commercial-tool lab access + placement pipeline, **not** the certificate. No independent placement audit found for either. Verdict: only post-graduation, only with batch-level placement data in writing.
- **ISC2 CC free program ended** (new enrolments closed 20 May 2026). **TensorFlow Developer Certificate retired** — ignore both.

### Budget ranking (the owner: ~Rs 3,000/month, stretch Rs 5,000+ for truly credible) — what this changed
Within Rs 3,000/month, the whole certificate strategy can be **free-or-near-free**:
1. **NPTEL exam, Rs ~1,000, one per semester window** — pick the single most role-relevant course per window. Priority order for the VLSI trunk: `VLSI Design Flow: RTL to GDS` (IIIT Delhi) → `Computer Architecture` (IIT Madras) → `Hardware Modeling using Verilog` → `CMOS Digital VLSI`. These are the highest-signal Rs 1,000 buys.
2. **LFD110 RISC-V badge — free** — do first, instant LinkedIn signal.
3. **Coursera ML/DL Specialization via financial aid (~Rs 170-510 effective, or free audit)** — apply for aid; pay at most ~10%.
4. **Tiny Tapeout CI hardening — free** (pay only if/when he wants real silicon; the GDS in CI is already strong proof).
5. **PortSwigger / HTB Academy / Cisco Ethical Hacker — free** for the security and ethical-hacking track; take the Rs 1,000 NPTEL Ethical Hacking exam for a certificate.

**Worth the stretch to Rs 5,000+ (one-off, not monthly):**
- **A Tiny Tapeout fabrication slot (~Rs 7k+ one-off)** — the single most differentiating credential a tier-3 fresher can hold; save for it rather than spending monthly.
- **NVIDIA DLI CUDA course (~Rs 7-8k one-off)** — only once he's on the AI-hardware branch and wants a hands-on GPU certificate for NVIDIA-style interviews.
- **PortSwigger BSCP (~Rs 8.7k) or HTB CPTS (~Rs 18k)** — only if security becomes a serious second track.
**Not worth it for his goals:** CEH (Rs 35-45k), OSCP (~Rs 1.5L), Maven/ChipEdge (Rs 1-2L), AWS/Google cloud-ML certs (low signal for chip roles). These are flagged `linkedin_worthy`/credibility accordingly in certs.json and should stay off the Rs 3,000 budget.

## Method / verification
- All 131 unique resource URLs checked with curl (status codes); dead/blocked ones replaced with working equivalents (e.g. nanoHUB → NPTEL Microelectronics IIT Roorkee; Arm AMBA landing → AXI spec IHI0022; Berkeley roofline mirror → EECS-2008-134 tech report). NPTEL course IDs verified by fetching `nptel.ac.in/courses/<id>` and reading the page title.
- Build script enforces: every prereq exists (math.* delegated to the maths agent's `math-track.json`, all 4 referenced ids confirmed present), every resource used by exactly one node (true dedup), every cert attached to a node, and an acyclic DAG.
- Only legal/official PDFs used; `legal_pdf_url` set only where the publisher hosts the PDF.

## Sources (key)
- NPTEL courses/fees: https://nptel.ac.in/courses/108106191 (VLSI Design Flow), /106105165 (Verilog), /106106134 (Computer Architecture), /106105194 (Hardware Security), /106105217 (Ethical Hacking), /106102576 (Intro to LLMs); fee ~Rs 1,000 per https://www.careers360.com/exams/nptel
- India semiconductor jobs: https://taggd.in/blogs/semiconductor-hiring-trends/ , https://www.communicationstoday.co.in/ , https://talentsprint.com/blog/vlsi-careers-india
- NVIDIA/Qualcomm/Google India roles: https://freshershunt.in/nvidia-careers-hiring-asic-engineer/ , https://ibmr-careerportal.prosple.com/graduate-employers/google-india/jobs-internships/silicon-architecture-engineer-university-graduate , https://freshershunt.in/qualcomm-campus-hiring-2026/
- Tiny Tapeout: https://tinytapeout.com/ ; pricing projection https://www.eenewseurope.com/en/tiny-tapeout-sees-industrial-boost-as-it-recovers-from-efabless-closure/
- SSCS PICO: https://sscs.ieee.org/technical-committees/tc-ose/sscs-pico-design-contest/
- LFD110/LFD111: https://training.linuxfoundation.org/training/introduction-to-riscv-lfd110x/ , https://training.linuxfoundation.org/training/building-a-riscv-cpu-core-lfd111x/
- Coursera India pricing/aid: https://cxotoday.com/media-coverage/coursera-introduces-region-aligned-pricing-to-make-learning-up-to-60-more-affordable-in-india/ , https://community.deeplearning.ai/t/financial-aid-for-courses/658259
- NVIDIA DLI: https://www.nvidia.com/en-in/training/ ; costs per https://justbeingresourceful.com/2026/09/12/nvidia-deep-learning-institute-every-course-certification-and-free-option-in-2026/
- Security certs: https://www.offsec.com/courses/pen-200/ , https://portswigger.net/web-security/certification , https://www.netacad.com/courses/ethical-hacker , https://www.isc2.org/insights/2026/04/one-million-certified-cyber-conclusion
- Maven/ChipEdge: https://www.careers360.com/college/49199/certificate/651461 , https://chipedge.com/resources/?p=41886
- Tier-3 off-campus advice: https://vlsiverify.com/blogs/career-in-vlsi/steps-to-start-vlsi-career/
- HDLBits (contract mapping): https://hdlbits.01xz.net/wiki/Problem_sets

## Open questions for the owner
1. Within the VLSI trunk, lean **RTL design**, **design verification (UVM)**, or **physical design/DFT**? It changes which tier-3/4 nodes to prioritise (DV is the largest hiring pool; PD/DFT are specialised).
2. Will he have **FPGA board** access, or should FPGA nodes stay simulation-only? (He owns an ESP32-S3, which the TinyML/embedded nodes already lean on.)
3. For the MS-Germany angle: target a **VLSI/microelectronics MS** or a **computer-architecture/AI-systems MS**? This shifts weight between the devices/analog branch and the architecture/AI-hardware branch.
4. Is he willing to **save for one Tiny Tapeout fabrication slot** (~Rs 7k+ one-off) as the flagship credential, or keep it to free CI hardening for now?
5. How serious is the **ethical-hacking** interest — a credible side-skill (free NPTEL + PortSwigger path), or a real second career worth a paid cert later (CPTS/OSCP)?
