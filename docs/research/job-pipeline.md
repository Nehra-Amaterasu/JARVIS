# Job pipeline: from finding a posting to counting the replies

## 2026-11-28: one pipeline from finding a job to tracking the reply, and what is lawful

**Question.** The owner wants the career side to find postings like the ones he applied to, match them against his proof, prepare each application, hand it over for his own submit, track it, and count what works. Which sources may be read by a program, what record shape lets every engine share one data set, and which routes come first? Design only: no code changed. Pages were opened with a fetch tool on 28 Nov; "opened" below means the primary page was read in this session.

### 1. Sources for FIND

| Source | Access | Rate limit (stated) | Fields | Opened | Verdict |
|---|---|---|---|---|---|
| Greenhouse Job Board API, `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` ([docs](https://docs.greenhouse.io/job-board.html)) | No key for GET; "Only the application submission endpoint ... requires Basic Auth" (the employer's key) | "Requests may be rate limited", no number | id, title, location, absolute_url, metadata, content, departments, offices; `GET .../jobs/{id}?questions=true` returns the form's fields | Yes | **Use.** Public, documented, and the only one that exposes the form questions. |
| Lever Postings API, `GET api.lever.co/v0/postings/{site}?mode=json` ([docs](https://github.com/lever/postings-api)) | No key for GET; applying needs the employer's key | Only the POST: 429 above 2 a second; none for GET | id, text, categories, country, workplaceType, description, lists, hostedUrl, applyUrl, salaryRange | Yes | **Use.** Does not "Expose custom questions", so the answer sheet is typed or read from the page by him. |
| Ashby Posting API, `GET api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` ([docs](https://developers.ashbyhq.com/docs/public-job-posting-api)) | Not stated; examples carry no key | Not stated | title, location, isRemote, workplaceType, employmentType, description, publishedAt, jobUrl, applyUrl, compensation tiers | Yes | **Use.** Read-only; it "doesn't submit applications". |
| Remotive, `GET remotive.com/api/remote-jobs` | Open | "max. 4 times a day"; "excessive requests will be blocked" | id, url, title, company_name, category, tags, job_type, publication_date, candidate_required_location, salary, description | Yes (the API's own notice) | **Use**, at most 4 reads a day, with a link back and "Remotive" named; jobs are 24 h delayed; reposting to third-party sites is refused. |
| Remote OK, `GET remoteok.com/api` | Open | None stated | id, date, company, position, tags, description, location, apply_url, salary_min, salary_max, url | Yes (the first item is the legal notice) | **Use** with a followed link back and "Remote OK" named, or access is suspended. |
| Hacker News API, `hacker-news.firebaseio.com/v0/` ([docs](https://github.com/HackerNews/API)) | Open | "There is currently no rate limit" | item: id, by, time, text (HTML), kids | Yes | **Use** for the monthly "Who is hiring" thread: comments are free text, so the model extracts requirements into the fixed schema (section 4). That the thread is posted by the user `whoishiring` is not on that page. |
| We Work Remotely RSS | The feed page answered 403 to the fetcher | n/a | n/a | No (403) | **Not verified.** Do not build on it until its page is read. |
| Adzuna API (India is a market, code `in`) | Free key | Not on an official page I read; third-party figures disagree | n/a | Search snippets of its [terms](https://developer.adzuna.com/docs/terms_of_service) only | **Later**: the free tier is "for evaluating the API" and needs an attribution mark; read the terms page before use. |
| Company career pages | Many are Greenhouse, Lever or Ashby boards underneath | per host | per board | n/a | **Use through the three APIs above**; a plain page goes through the existing polite fetcher (robots.txt, 3 s a host, 200 a day, off by default). |

**What the large boards say (the owner's belief checked).** He believes reading the big boards by program does not break their terms. On the pages read, that is not true:

- **LinkedIn**, [User Agreement](https://www.linkedin.com/legal/user-agreement) section 8.2 (opened): members agree not to "Develop, support or use software, devices, scripts, robots or any other means or processes" to scrape the Services, not to bypass "use limits", and not to "Use bots or other unauthorized automated methods to access the Services". In *hiQ v. LinkedIn* (N.D. Cal., Nov 2022) the court found the scraper in breach of this agreement; it settled under a permanent injunction ([LinkedIn's note](https://news.linkedin.com/2022/november/court-order-affirms-linkedin-s-legal-positions-against-hiq-in-da), [summary](https://en.wikipedia.com/wiki/HiQ_Labs_v._LinkedIn)). What is true in his favour: the Ninth Circuit held that breaking a public site's terms alone is not a crime under the US computer-fraud statute. Breach of contract and a banned account remain.
- **Indeed**, [legal page](https://www.indeed.com/legal) (opened, about 200,000 of 349,000 characters read): job seekers may not use "any automation, scripting, or bots to automate the Indeed Apply process outside of Indeed's official vendors"; employers' sourcing terms forbid "scraping the database". I did not find a general job-seeker clause on crawling listings in the part read; the rest of the page is unread.
- **Naukri**, [terms](https://www.naukri.com/termsconditions) (search snippet only, page not opened): lists "Use automated means to crawl and/or scrape content" as prohibited.

**Verdict.** The big boards are read by him in his own browser. The app takes a posting from them only when he pastes its link and text (route K-25), and never fetches those hosts.

### 2. Inputs from the other chat (summarised, no personal detail)

A ranked list of remote AI-data and rating platforms with official links; a night working window; resume versions built from one fact sheet; a tracker with statuses; a scan script that scraped two large boards with a third-party library. That script conflicts with section 1 and is not carried into this lane. Specifics stay private.

### 3. One shared data model

Six records, one id space, all in the private data directory:

- **Opportunity** `{id: "op-…", source, external_id, url, apply_url, org, title, location, remote, hours_text, pay_text, posted_at, read_at, text_sha256, requirements: Req[] | null, req_origin: rule|model-draft|accepted, state: new|shortlisted|skipped|applied|closed, reason}`. Key `(source, external_id)`, so a second read adds nothing.
- **Application** = the existing `germoney.Applications` row, gaining `opportunity_id`, `resume_doc_id`, `source`. Its dated `history` (kept since EW10) is the status line.
- **Document** `{id: "d-…", kind: resume|cover|answer_sheet|certificate|packet, version, path, sha256, made, built_from}`. Resumes are registered, not copied; `version` is what LEARN counts by.
- **Evidence line** = the EW10 ledger line, unchanged: proof only with a link or a file.
- **Contact** `{id: "c-…", note, channel}`: private, never an address the app sends to. The outreach store's `to_note` moves here.
- **Event** `{id, at, kind, application_id, opportunity_id?, doc_id?, contact_id?, note}`, kinds `found, matched, packet_built, handover_opened, submitted_by_him, reply, outreach_draft, outreach_sent, follow_up_due`. One append-only `career/events.jsonl`. Deadline rows (K-05) and follow-ups (K-08) read events; turnout (K-36) counts them.

**Migration.** Nothing moves at once: Applications gains three optional fields; outreach rows stay and emit events; a one-time import turns existing `history` entries into events. **Study join:** skill-tree nodes are the shared vocabulary (`Req.skill` maps to node ids; evidence lines carry `node_ids`); a subject's marks join only as an evidence line of kind `test` with a marksheet file.

### 4. MATCH without a model scoring him

`Req = {skill, must: bool, quote}`, each with the line of the posting it came from. The match prints counted terms, never one score:

- **Skills:** for each `must` requirement, the evidence lines whose nodes cover it, or "none"; shown as "3 of 5 required skills have proof".
- **Hours:** overlap in minutes between the posting's stated hours (converted from its zone) and his typed window; "not stated" when the posting says nothing.
- **Location and eligibility:** each rule he typed (countries, student status, degree words, fees asked) checked against the posting text, with the quoted line.
- **Pay:** shown as printed, with currency; never converted to a guess.

The model may: extract `Req` from a posting into this schema (stays `pending` until he accepts); draft bullets and answers that each cite an evidence id. It may not: rate him, rank postings by fit, or write a claim without a citation. A validator refuses any bullet or answer without `evidence_id` or `fact_ref`.

### 5. What "increase the turnout" can be measured by

Counted from events, each with its n: applications he submitted per week; share with any reply within 30 days; median days to first reply; each by source, role family and resume version. A cell with fewer than 5 applications prints the count and "too few to compare". No forecast, no trend line. The app cannot get an interview or an offer; it can shorten the time from finding to sending and show which version was answered.

### 6. Form filling

- **Feasible and lawful:** the packet (chosen resume, tailored bullets with citations, cover note) and a per-form **answer sheet** (Greenhouse questions when its API gives them; otherwise the questions he pastes), each answer with a copy button; then the app opens `apply_url` in his browser.
- **Browser automation that fills and stops before submit:** possible, but the large boards forbid it (section 1), hosted forms carry bot checks, and a field he did not read is an answer he did not give. **Recommendation:** no automation; answer sheet plus open-the-page. Revisit only for a host whose terms allow it.

### 7. Routes, first two slices (proposals; enter in plan 9.0 before building)

All answers use the `ww_pyq/api.py` envelope with 400, 404 and 409; nothing is submitted, no account made, no password typed.

**Slice 1: FIND and MATCH**
- **K-21** GET `/api/mission/career/sources` answers `items: [{id, kind: greenhouse|lever|ashby|remotive|remoteok|hn, board, on, terms_read_on, last_read, state}]`; `planned` when off.
- **K-22** PUT `/api/mission/career/sources/{id}` `{kind, board, on, terms_read_on}`; 400 for an unknown kind, a host outside the kind, or `on` without `terms_read_on`.
- **K-23** POST `/api/mission/career/sources/{id}/read`: one read through the polite fetcher; answers `added, already, reason`; Remotive refused (409) after 4 reads that day.
- **K-24** GET `/api/mission/career/opportunities?state=&source=&q=`.
- **K-25** POST `/api/mission/career/opportunities` `{url, title, org, text}`: his paste; the host is never fetched.
- **K-26** PUT `/api/mission/career/profile` `{window: {from, to, tz}, countries, student, exclude_words}`.
- **K-27** GET `/api/mission/career/opportunities/{id}/match`: the terms of section 4; `waiting` "requirements not accepted yet".
- **K-28** POST `/api/mission/career/opportunities/{id}/requirements` `{mode: rule|model}`; a model draft is `pending`; PUT accepts or edits.
- **K-29** POST `/api/mission/career/opportunities/{id}/decide` `{state: shortlisted|skipped, reason}`.

**Slice 2: PREPARE, HAND OVER, TRACK** (uses K-16 to K-18)
- **K-30** POST `/api/mission/career/opportunities/{id}/application` `{resume_doc_id}`: creates the Applications row at `preparing`; 409 if one exists.
- **K-31** GET `/api/mission/career/applications/{aid}/answers`: `items: [{qid, question, required, answer, origin: fact|typed|model-draft, state: pending|accepted, evidence_ids}]`.
- **K-32** PUT `/api/mission/career/applications/{aid}/answers/{qid}`: edit or accept.
- **K-33** POST `/api/mission/career/applications/{aid}/handover`: builds the packet, opens `apply_url` (http(s), host of the opportunity); 409 while any required answer is pending; status stays `preparing`.
- **K-34** POST `/api/mission/career/applications/{aid}/submitted` `{on?}`: his mark; status `applied`; starts the K-08 clock; second press 409.
- **K-35** POST `/api/mission/career/applications/{aid}/reply` `{on, kind: ack|test|interview|rejection|offer, note}`.
- **K-36** GET `/api/mission/career/turnout?from=&to=`: section 5, every cell with n.

**Acceptance tests (one line each).** A second read of the same board adds 0 · a big-board host in K-22 or K-23 is 400 · Remotive's fifth read in a day is 409 · a source cannot be switched on without a terms date · a pasted posting makes no request (socket blocked) · match prints "none" for a must-skill with no evidence · a model requirement stays pending until accepted · an answer or bullet with no citation is refused · handover with a pending required answer is 409 · no route sends a POST to any job host (socket blocked in tests) · `submitted` writes one history entry and one event · turnout prints "too few to compare" under 5 · deleting an evidence line changes the match.

**What only the owner can supply:** the board names to watch; his hours window, countries and eligibility words; which resume version is current; consent before any posting text goes to the outside model (it leaves the PC and costs his usage); every submit; every reply he receives.

### Risks and what is not verified

- Ashby's auth and all GET rate limits are not stated; Greenhouse says only "may be rate limited". Reads stay at the fetcher's 3 s a host.
- We Work Remotely (403) and Adzuna's terms were not read; Naukri's terms were seen in a search snippet only; about 40% of Indeed's legal page was not read.
- Not legal advice: it records what the pages say.
- Model extraction can misquote a posting; every `Req` keeps its quote.

**What it changed.** FIND uses the ATS and remote-board APIs only; the big boards become paste-in; no form automation; route ids K-21 to K-36 proposed.
