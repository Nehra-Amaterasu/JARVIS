# Question sources: GATE / GRE / dMAT-level questions, and what we may legitimately take

Legend: **[opened]** = I read the page or file this session. **[search]** = only a search-result summary or a secondary site, not the primary page. **[unverified]** = could not open (403, parse error, blocked) or contradictory sources. No scraping was done; pages were read one at a time.

## 2026-11-09 (chunk H): the harvester is built; one supervised live fetch

**Question.** Do the terms below hold up when a program, not a person, reads the pages? One live fetch of one allowed source, into a scratch folder, nothing in the real `data/`.

**What was built** (`app/jarvis_app/ww_harvest.py`, `ww_bank_store.py`, `routes_ww_harvest.py`; 60 tests and 25 gate cases on recorded fixtures, no network). The code enforces this file: a verbatim record needs a recorded open licence line and a link, a pointer record is refused if it carries any text, the GATE PDF is read in memory and never cached, a source with no recorded licence stays off, and the harvester is off until the owner presses resume. Subjects map to the GATE EC headings of section 1 (control to Section 6, microelectronics to Sections 4 and 3, digital communication to Section 7, IC fabrication to Section 3 as the nearest line, maths and stochastic to Sections 1 and 7, network analysis to Section 2; IoT, EV, PIE and Constitution have none, so the gate tier refuses them with that reason).

**Live run (9 Nov, scratch bank, anonymous API, 3 requests of the 300 a day).** `python -m jarvis_app.ww_harvest --subject control --topic "Routh-Hurwitz stability" --sources stackexchange`: the Stack Exchange API (electronics and dsp sites), 3 questions stored with `license: CC BY-SA 3.0` (the posts are from 2012, 2016 and 2017, the licence the API itself reported in `content_license`), the post link and the author name in the source line, `origin: cc-verbatim`, tier gate; the dsp site returned none; `quota_remaining` fell from 300 to 297. What the live run found that the fixtures could not have: (1) `api.stackexchange.com/robots.txt` answers HTTP 400, and RFC 9309 treats a 4xx as no rules, so the harvester now allows it (a 5xx or a 401/403 still refuses); (2) 2 of 4 matching posts were missed because one spelled the topic "Routh Hurwitz", so topic matching now ignores hyphens; (3) electronics.stackexchange writes inline maths as backslash-dollar x backslash-dollar, which our renderer would print as literal dollars, so it is stored as `$x$`.

**Not run live, said plainly.** MIT OCW and OpenStax are tested on recorded-shape fixtures only: the OCW course folders in `GATE_MAP` (for example `6-302-feedback-systems-spring-2007`) and the OCW page layout are my best reading and unverified; a wrong folder is a refused fetch, never bad data. The OpenStax PDF route is also untested live. The official GATE PDF was not downloaded in any live run (no need to take that file to prove a point; its fetcher is tested on a made-up paper). Marks are a guess by length unless the text says "(10 points)".

**What it changed.** The "pointer" and "licence" rules are now checks in code, not prose. Open for the owner: switch the harvester on (Setup, Question harvester, or `--enable`), confirm the OCW course list, and answer question 19 on a Python PDF library (not needed: `pdftotext` works).

## 2026-11-09: where GATE/GRE/dMAT-level questions may legitimately come from

**Question.** The study app needs, per syllabus topic, a harder tier ("gate") beside the SEE-level "exam" tier. Which sources may we use without scraping behind a login or copying a paid bank, and in what form (link, paraphrase, own-written, or verbatim with licence)?

### Short answer

1. **Best legal supply for GATE-level items is our own writing** (and the generator's parametric templates), pinned to the official GATE EC syllabus headings. Real GATE papers are copyrighted by the organising IIT ("All Rights Reserved"); keep them as a **link + topic tag + marks** record, never as stored text, unless written permission is obtained.
2. **Verbatim reuse is clean only for CC material:** MIT OpenCourseWare (CC BY-NC-SA 4.0 **[opened]**), OpenStax (CC BY-NC-SA per its FAQ **[opened]**, some titles may differ), Stack Exchange posts (CC BY-SA 4.0 **[search]**). The app is a personal, non-commercial study tool, so NC is satisfied; **ShareAlike** means the stored text stays CC BY-SA/NC-SA and carries attribution.
3. **dMAT is not a subject exam.** It is the Digital Master Test, a German Master's aptitude test (core: Figure Sequences, Mathematical Equations, Latin Squares; plus a subject module). Practice material is copyrighted by g.a.s.t.; use it for his own prep, do not import into the bank.
4. **GRE General quant is below engineering level.** Only GRE Subject Tests (Mathematics/Physics) are comparable, and even those are rarely required now.

### 1. GATE

| Item | Finding | Status |
|---|---|---|
| Organiser 2026 | IIT Guwahati; footer "(c) GATE 2026, Indian Institute of Technology Guwahati. All Rights Reserved." Home: https://gate2026.iitg.ac.in | [opened] |
| 2026 papers + keys | Page "GATE 2026 MASTER QUESTION PAPERS AND ANSWER KEYS": https://gate2026.iitg.ac.in/QPs-answer-keys.html . EC links: `doc/download/2026/QPs/EC.pdf`, `doc/download/2026/Keys/EC_Keys.pdf`. Only 2026 on that page; keys had a challenge window 25-28 Feb 2026. | [opened] |
| Format | PDF only (links end in .pdf). No JSON/HTML text. Text extraction needed (see section 6). | [opened] |
| Reuse terms | The page states only "All Rights Reserved"; **no licence, no reuse grant**. Treat as reserved. | [opened] |
| Older years | Search summaries say the official portals carry 2007-2026 (IIT Madras for GATE 2027 hosts year-wise papers 2021-2026 and a bulk archive). Per-year organisers: e.g. 2023 = IIT Kanpur. I could not open an official archive page, so exact URLs per year are not confirmed. Third-party mirrors (Careers360, OneStopGATE) exist; their redistribution rights are unclear, so do not use them as a source of text. | [search] |
| Syllabus | https://gate2026.iitg.ac.in/doc/GATE2026_Syllabus/EC_2026_Syllabus.pdf (PDF, text extracted offline with `pdftotext`). Headings below quoted verbatim. | [opened] |

**GATE EC 2026 syllabus -> his subjects (headings verbatim)**

| His subject | Official section | Official topic text (trimmed) |
|---|---|---|
| Control Systems | Section 6: Control Systems | "Basic control system components; Feedback principle; Transfer function; Block diagram representation; Signal flow graph; Transient and steady-state analysis of LTI systems; Frequency response; Routh-Hurwitz and Nyquist stability criteria; Bode and root-locus plots; Lag, lead and lag-lead compensation; State variable model and solution of state equation of LTI systems." |
| Microelectronic Circuits | Section 4: Analog Circuits; Section 3: Electronic Devices | "BJT and MOSFET Amplifiers: Biasing, AC coupling, small signal analysis, frequency response. Current mirrors and differential amplifiers." Devices: "P-N junction, Zener diode, BJT, MOS capacitor, MOSFET..." |
| Digital Communication | Section 7: Communications | "Random Processes", "Information Theory: Entropy, mutual information and channel capacity theorem", "Digital Communications: PCM, DPCM, digital modulation schemes (ASK, PSK, FSK, QAM), bandwidth, inter-symbol interference, MAP, ML detection, matched filter receiver, SNR and BER. Fundamentals of error correction, Hamming codes, CRC." Sampling: Section 2 "Continuous-time Signals: ... sampling theorem and applications". |
| IC Fabrication | **Not a GATE EC section.** Nearest: Section 3 Electronic Devices (energy bands, carrier transport, MOS capacitor, MOSFET). Oxidation/diffusion/implant/litho have no GATE EC line; GATE-tier items for this subject must be device-physics-flavoured or come from other sources (MIT OCW 6.774, NPTEL VLSI). | [opened] |
| Applied Maths & Stochastic (backlog) | Section 1: Engineering Mathematics (Calculus: "multiple integrals, line, surface and volume integrals"; Vector Analysis "Gauss's, Green's and Stokes' theorems"; "Probability and Statistics"); Section 7 "Random Processes: Auto correlation and power spectral density, properties of white noise, filtering of random signals through LTI systems" | |
| Network Analysis & Synthesis (backlog) | Section 2: Networks, Signals and Systems | "Circuit Analysis: Node and mesh analysis, superposition, Thevenin's theorem, Norton's... Laplace transform. Linear 2-port network parameters, wye-delta transformation." **Network synthesis is not in GATE EC** (needs textbook / NPTEL). |
| IoT, EV, PIE, Constitution | No GATE equivalent | tag `tier` only "exam" |

**GATE Overflow (gateoverflow.in).** Home page and /terms returned HTTP 403 to my fetcher; searches returned nothing from the site. **Licence, scraping and API terms: [unverified].** Do not assume CC BY-SA. Use only as a link target ("see GO question ID") until the owner reads its footer/terms or asks the operators. Its answers are user-written and the questions are copied from copyrighted papers, so even a CC licence on posts would not clean the question text.

### 2. NPTEL / SWAYAM

| Item | Finding | Status |
|---|---|---|
| Copyright page | https://gate.nptel.ac.in/copyrights.html lists "(c) 2020 by" IIT Bombay, Delhi, Guwahati, Kharagpur, Kanpur, Madras, Roorkee and IISc, with a no-liability disclaimer. **No licence named.** | [opened] |
| Licence | Secondary sources say CC BY-NC-SA (SpicyIP 2014; a slide deck citing an NPTEL licence note); one Wikipedia mirror says CC BY-SA; some say it varies per item. **Not confirmed from NPTEL itself.** Archive home https://archive.nptel.ac.in and https://nptel.ac.in show no licence line. | [search], [opened] negative |
| Scale | nptel.ac.in says 2,027 courses offered; archive "2400+ courses available for self study" (https://archive.nptel.ac.in/course.html). | [opened] |
| Assignments / solutions | Not verified: I did not open a course's assignment page. From general knowledge (not verified here): live-run courses post weekly assignments with a deadline and release solutions afterwards, and archived courses keep PDFs. Check each course page. | [unverified] |

Rule until the licence is confirmed: **link + topic + paraphrase**, not verbatim copy. Write an email to NPTEL support (support@nptel.iitm.ac.in, listed on the home page) if verbatim use is wanted.

### 3. GRE

| Item | Finding | Status |
|---|---|---|
| Subject Tests today | ETS pages could not be loaded (parse error). Search: Chemistry discontinued after April 2023; Mathematics, Physics, Psychology moved to computer delivery from Sept 2023 (Physics and Psychology shortened to 2 h); a Sept 2026 third-party article says Math/Physics/Psychology still run. Official 2026 status: **not confirmed**. Check https://www.ets.org/gre/test-takers/subject-tests/about.html . | [search] |
| Free official prep | POWERPREP and Math Review exist on ets.org (general knowledge; page did not load). ETS content is copyrighted; use as practice, not as bank text. | [unverified] |
| Level | **GRE General Quantitative Reasoning is school-level maths (arithmetic, algebra, geometry, data analysis); far below GATE EC.** It is useless for the "gate" tier. GRE Mathematics Subject Test (calculus, linear algebra, abstract algebra) is the only GRE item near his Applied Maths backlog, and only for maths. No ECE GRE subject test exists. | stated from general knowledge |

### 4. dMAT (what it is)

| Item | Finding | Status |
|---|---|---|
| Name | **Digital Master Test**, run by g.a.s.t. (TestDaF-Institut, Bochum). Not "digital maths test". | [opened] https://aps-india.de/dmat/ , https://www.d-mat.de/en/dmat-in-india/ |
| Who | Indian Master's applicants with a degree in Engineering/Technology (all B.Tech), Commerce & Economics, Business & Management, Tourism/Hospitality; intakes from Summer Semester 2027; exemptions for those who registered/shipped documents before 29 June 2026 or already hold an APS certificate. Additional to APS, not a replacement. | [opened] |
| Fee / dates | EUR 150 (g.a.s.t.); cycles 16 Jan 2027 and 13 Mar 2027 (India centres incl. New Delhi). | [opened] |
| Structure | Core Module (3 subtests: Figure Sequences, Mathematical Equations, Latin Squares) + Subject Module (typed problem + single-choice questions, "transfer and application rather than memorised factual knowledge"). About 3 h with a 30-minute break; no notes allowed. | [opened] prep PDF |
| Official sample | "Preparatory Materials" PDF, 57 pages, with exercises at several difficulty levels and sample solutions: https://www.d-mat.de/wp-content/uploads/2026/09/260902_dMAT_General-Academic-Module_Preparatoy-Materials_EN.pdf . Copyright notice: "All texts, images and graphics ... are protected by copyright. Any use not permitted by g.a.s.t. is punishable by law." Intro videos are linked from the India page. | [opened] |
| Relevance | It is a reasoning test, so it does not feed the SEE-level topic bank. A **separate "dMAT practice" mode** (figure sequences, equation puzzles, Latin squares) can be generated by our own code (rules are public) without copying g.a.s.t. items. Whether the owner's "dMAT" means this test: **assumed yes** (matches APS/Germany plan in memory), not confirmed with him. | |

### 5. Other banks

| Source | Licence / terms | Use |
|---|---|---|
| MIT OpenCourseWare | CC BY-NC-SA 4.0 [opened] https://ocw.mit.edu/terms/ ; third-party content inside courses is excluded; the page also says OCW may be used for AI training if attribution, non-commercial and ShareAlike are met. Relevant: 6.003 Signals & Systems, 6.002 Circuits, 6.011 Intro to Communication, Control & Signal Processing, 6.041 Probabilistic Systems, 18.02/18.04, 6.012 Microelectronic Devices, 6.774 VLSI/fab. | Best verbatim source. Store title, course number, URL, "CC BY-NC-SA 4.0, MIT OCW". |
| OpenStax | FAQ says all content CC BY-NC-SA [opened] https://openstax.org/faq ; a search found a conflicting "CC BY 4.0" footer on one page, so read each book's licence line. Instructor solution manuals are verified-educator only: do not use. | End-of-chapter problems from Calculus, University Physics are usable with attribution; no ECE-specific title. |
| LibreTexts | Per-page licence (mostly CC BY-NC-SA / CC BY). Not opened. | [unverified] check each page footer. |
| Stack Exchange (e.g. electronics.stackexchange, dsp.stackexchange, math.stackexchange) | User posts CC BY-SA 4.0 (and since 2009 cc-wiki) [search]. API: anonymous 300 requests/IP/day, 10,000 with a registered app key; honour the `backoff` field, ignoring it leads to 503 then IP ban [search; apis.io summary]. Data dump moved behind login in July 2024 with a "for own use, do not train LLMs" condition [search; devclass / heise]. My fetcher was blocked from stackexchange.com, so the API terms text is **[unverified]**. | Use the API (not the dump, not HTML scraping). Questions only; keep post URL, author display name, licence, in the source line. Answers rarely are exam-style. |
| Reddit | Free API ~100 queries/min per OAuth client, 10/min unauthenticated [search, 2023 announcement]; model-training use needs consent [search]. Help-centre page returned 403. | Not worth it: posts are chat, not questions. Skip. |
| Indian coaching banks (Made Easy, Gate Academy, ACE, etc.) | Paid, copyrighted. | **Out.** No copying, no paraphrase of their solutions. |
| Textbook end-of-chapter problems (Sedra-Smith, Ogata, Haykin, Proakis, Nise, Boylestad) | Copyrighted. | Record only: book, edition, chapter, problem number, as a **pointer** ("Ogata 5th ed. 6-12") so he can open his own copy; write our own parametric problem on the same idea (change the numbers/structure). |

### 6. Pipeline notes

- **Politeness.** Check `robots.txt` per host before any fetch; one request at a time, 1 request / 2-5 s, a descriptive User-Agent with a contact, cache every page on disk, never log in, never hit a 403/429 twice, honour the Stack Exchange `backoff` value. Fetch only a human-sized list (a few papers), not the site.
- **PDF text offline.** `pdftotext` (poppler) is already on this machine at `/mingw64/bin/pdftotext` and extracted the GATE syllabus and the dMAT PDF cleanly with `-layout` [opened]. The project venv has **no pypdf, fitz or pdfminer**; adding one (for example `pypdf`, pure Python) **needs the owner's approval**. Math-heavy GATE PDFs lose symbols and figures with any text extractor; expect to retype or re-draw formulas and circuits by hand, and OCR is not needed for text PDFs.
- **Source line per question.** The generator already carries `sitting`/`source` (`ww_generator.py` line 131: `q.get("sitting") or q.get("source")`). Proposed additive fields on `question_bank` entries, all optional, none breaking the generator: `tier` ("exam"|"gate"), `source` (human text, e.g. "MIT OCW 6.003 Spring 2012 PS3, CC BY-NC-SA 4.0"), `source_url`, `license` ("own" | "CC BY-NC-SA 4.0" | "CC BY-SA 4.0" | "pointer-only"), `origin` ("own-written" | "cc-verbatim" | "pointer"), and `ref` (book/problem number or GATE year+paper+Q number). The paper footer prints `source:` already, so the attribution travels with each printed question.
- **Provenance rule for the bank.** `origin: pointer` items carry no stem text, only topic, marks and the reference; the generator may list them as "Solve: Ogata 6-12" without the app storing the copyrighted text.

### What it changed

- Feeds Sprint 2 item 4 of the Well Wisher plan (the question bank): tier "gate" will be filled mainly with own-written/parametric items mapped to the section headings above, plus CC BY-NC-SA verbatim items from MIT OCW and OpenStax with a licence field, plus pointer-only records for real GATE questions and textbooks.
- IC Fabrication and Network Synthesis have no GATE EC line; their "gate" tier must come from OCW/NPTEL/textbooks, not GATE.
- dMAT becomes a separate generated practice mode (rules public, items our own), not a bank source.
- Open items for the owner: (a) read GATE Overflow's terms page and tell me the licence; (b) approve a `pypdf` install if we want PDF ingestion in Python; (c) confirm "dMAT" means the Digital Master Test.

### Sources

- GATE 2026 portal https://gate2026.iitg.ac.in , papers https://gate2026.iitg.ac.in/QPs-answer-keys.html , syllabus PDF above.
- APS India dMAT https://aps-india.de/dmat/ ; g.a.s.t. dMAT https://www.d-mat.de/en/dmat-in-india/ ; prep PDF above.
- NPTEL https://nptel.ac.in , https://archive.nptel.ac.in , https://gate.nptel.ac.in/copyrights.html ; SpicyIP https://spicyip.com/2014/02/national-program-on-technology-enhanced-learning-indias-contribution-to-the-open-education-movement.html
- MIT OCW terms https://ocw.mit.edu/terms/ ; OpenStax FAQ https://openstax.org/faq and https://help.openstax.org/s/article/Licensing-information-of-OpenStax-textbooks
- ETS subject test changes https://www.ets.org/gre/score-users/subject-test-changes.html (not loaded; via search)
- Stack Exchange dump change https://www.devclass.com/development/2024/07/30/stack-exchange-restricts-access-to-dump-of-user-contributed-data-critics-complain-this-contradicts-license/1625192 ; https://heise.de/-9823083
- Reddit API 2023 post https://www.reddit.com/r/modnews/comments/13wshdp/api_update_continued_access_to_our_api_for/ (via mirrors)
