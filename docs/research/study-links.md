# Study links per syllabus topic: sources, ratings, design

## 2026-11-28: where rated study links per syllabus topic can lawfully come from, and the design

**Question.** For every topic of his syllabus, the app should list the best videos, lecture notes and course pages, ranked by rating and by how expert the source is, fetched from the subject's own topic list. He allowed network use on 27 Nov. Which sources can the app query lawfully and politely? What does each return that can stand for a rating or for expertise? What does each cost? What should the engine look like?

Tags: **[opened]** means I read the primary page on 27 Nov 2026. **[search]** means I only saw a search summary. **[code]** means read from this repository.

### Sources

| Source | Access | Key | Quota / rate | Rating or expertise signals | Terms and licence | Verdict |
|---|---|---|---|---|---|---|
| YouTube Data API v3 ([quota](https://developers.google.com/youtube/v3/determine_quota_cost), [search.list](https://developers.google.com/youtube/v3/docs/search/list), [videos](https://developers.google.com/youtube/v3/docs/videos), [channels.list](https://developers.google.com/youtube/v3/docs/channels/list)) [opened] | REST; `search.list` (snippet only), then `videos.list` for numbers | his API key | **`search.list` has its own bucket: 100 calls a day, 1 each.** Every other method draws on 10,000 units a day at 1 unit a call (`videos.list`, `channels.list`, `playlistItems.list`) | `statistics.viewCount`, `likeCount`, `commentCount`; `dislikeCount` private since 13 Dec 2021. `contentDetails.duration` (ISO 8601), `caption` "true"/"false", `definition`; `status.license`, `embeddable`; `snippet.channelId`, `channelTitle`, `publishedAt`, `defaultAudioLanguage`. Search filters: `channelId` (500 videos at most), `videoDuration` short/medium/long, `videoCaption`, `relevanceLanguage`, `regionCode`, `type=video` | [Developer policies](https://developers.google.com/youtube/terms/developer-policies) [opened]: data read without his login is "Non-Authorized Data", kept 30 days at most, then refreshed or deleted (III.E.4.c, d); its statistics never longer than 30 days (III.E.4.b). Numbers shown as returned (III.E.4.h). **No "new or derived data or metrics" from API data** (III.E.4.h(ii)); non-YouTube data shown beside it carries a clear note that it is not from YouTube. YouTube attribution per result (III.F.2.a). Search results not altered or mixed with other sources and shown as YouTube search (III.C.5). The site's own search pages are disallowed in [robots.txt](https://www.youtube.com/robots.txt) [opened], so the API is the only lawful route | **use first**, through the allow-list path (below) |
| NPTEL ([nptel.ac.in](https://nptel.ac.in/courses), [robots](https://nptel.ac.in/robots.txt), [YouTube courses](https://nptel.ac.in/yt-courses)) [opened] | No API and no course-list file found. The course list is a JavaScript app (course id in the address, title, professor, institute); a course page loads its lectures by script. The lectures sit on YouTube, for example `@nptel-nociitm9240` with playlists made into "YouTube Courses" | none | robots.txt allows everything, no crawl delay; the harvester's 3 s a host and 200 a day apply | The institution itself (IIT, IISc) is the expertise signal; the course id ties a playlist to a course | **No licence stated** on the course page or the YouTube project page; secondary sources say CC BY-SA [search]; earlier note: copyright page names the IITs, no licence ([question-sources.md](question-sources.md)) | **use first as pointers**: titles and links only, through YouTube's API |
| SWAYAM ([robots](https://swayam.gov.in/robots.txt)) [opened] | robots.txt answers 404 (read as no rules, RFC 9309); enrolment pages need a login | none | harvester limits | course and institute | not read | **pointer only**, by hand |
| MIT OpenCourseWare ([terms](https://ocw.mit.edu/terms/), [robots](https://ocw.mit.edu/robots.txt)) and the MIT Learn API ([search](https://api.learn.mit.edu/api/v1/learning_resources_search/?q=fourier%20transform&platform=ocw&resource_type=course&limit=3)) [opened] | Public JSON with no key: `learning_resources_search?q=&platform=ocw`. 2,588 OCW courses; "fourier transform" matched 57 | none | none published; robots.txt of api.learn.mit.edu answers 404 | `views` (for example 13,404 for RES.6-008 DSP), `level` (Undergraduate/Graduate), `course_feature` (Lecture Notes, Problem Sets, Exam Solutions...), `departments`, `license_cc` | CC BY-NC-SA 4.0; OCW's robots.txt says `Allow: /` with a sitemap; the terms say nothing on automated access; third-party items inside a course are excluded | **use first** |
| Wikipedia / Wikibooks ([etiquette](https://www.mediawiki.org/wiki/API:Etiquette), [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)) [opened] | MediaWiki API: `list=search`, then `prop=pageassessments\|info\|extracts` | none | no hard read limit; serial requests; `maxlag` for jobs with no one waiting. **A User-Agent without contact information may get 403 or be blocked without notice** | `pageassessments` gives a class and importance per WikiProject (Fourier transform: class B, importance Top in Mathematics); the class is set by editors | CC BY-SA text; a link plus the extract | **use first** for definitions; class shown as editors set it |
| Stack Exchange (electronics, dsp, math) [code] | already in `ww_harvest.py` | none | 300 a day for each IP without a key (`SE_DAILY`); the `backoff` field is honoured | question score, answer score, accepted answer | CC BY-SA 4.0 [search, earlier note] | **use later**, for "worked doubts" |
| Khan Academy [search] | public API gone (2019 plan for 2020; repository archived 2022; support: "no longer has a public API") | n/a | n/a | n/a | n/a | **do not use** (a link he types by hand only) |
| Coursera, edX [search] | no documented public catalogue API; Coursera's old one reported deprecated, edX's needs a partner token | n/a | n/a | n/a | n/a | **do not use** |
| All About Circuits | robots.txt answered 403 to my fetcher [opened, refused] | n/a | n/a | n/a | not read | **pointer only**, a link he adds himself |

### The YouTube key: his click path

1. Sign in at https://console.cloud.google.com with his Google account. Create a project (top bar, project picker, **New project**), named for example "study-links".
2. Open https://console.cloud.google.com/apis/library, search **YouTube Data API v3**, press **Enable**.
3. Open the **Credentials** page (APIs & Services, Credentials), press **Create credentials**, choose **API key**.
4. Click the key's name. Under **API restrictions** choose **Restrict key**, tick only YouTube Data API v3, press **Save**.
5. In the app, open the Study links source panel and paste the key once. The app saves it in the Windows credential store, never in a file, and shows only its last four characters. Steps 1 to 4 come from [getting started](https://developers.google.com/youtube/v3/getting-started) and [API keys](https://docs.cloud.google.com/docs/authentication/api-keys) [opened].

### The score, term by term

**YouTube rows get no composite score.** III.E.4.h(ii) bars "new or derived data or metrics" built from API data. So the app shows YouTube's numbers exactly as returned ("from YouTube, read 28 Nov"), and the order comes from facts the app holds itself: the allow-list, then YouTube's own relevance order. I read the clause as covering a weighted score of views and likes; this is my reading, not settled law.

**Other sources** get `score = A + L + F + D`, every term printed:

- `A` institution: 3 when the source is on his allow-list (IIT/IISc via NPTEL, MIT OCW, his university), else 0.
- `L` level: 2 for Undergraduate, 1 for Graduate, 0 when no level is given (OCW `level`).
- `F` materials: 1 each for Lecture Notes, Problem Sets and Exam Solutions in `course_feature`, 3 at most.
- `D` topic fit: 2 when every topic word appears in the title, 1 when half do, else 0.
- Shown beside the score, never added in: views (OCW), Wikipedia class and importance, and the day each was read.

**What it does not measure:** whether the content is correct; whether it matches his university's syllabus wording or depth; whether he will understand it. Studies of YouTube medical videos found no correlation, or a negative one, between popularity and quality ([Osman et al. 2022](https://link.springer.com/content/pdf/10.1186/s12909-022-03446-z.pdf) [search]). That is why views are never a term. Guo, Kim and Rubin (2014, [DOI](https://www.doi.org/10.1145/2556325.2566239) [search]) found that engagement falls after about 6 minutes. That supports showing the duration; it does not justify ranking by it.

### Matching a topic to a query

- **Allow-list path (no search quota).** Match each subject once to an NPTEL course, by hand or from the course title. Find that course's playlist with `playlists.list` (1 unit for 50 playlists) and its lectures with `playlistItems.list` (1 unit for 50 items). Then match each topic's words against the lecture titles on this PC. Nothing is searched, and nothing off-level arrives, because the course is already his level.
- **Search path (100 a day).** Build the query `"<topic>" <subject name>` with `type=video`, `relevanceLanguage=en`, `regionCode=IN`, `videoDuration=medium|long`, and `channelId` set when an allow-listed channel is chosen. Never add the unit title on its own: "Unit 3" and generic unit names pull in wrong-subject results. The risk of off-level or wrong-subject results is real (a "Fourier transform" search returns school and graduate videos alike), so search rows are marked "searched, not from your course".
- **Model rerank (optional, off by default, his usage).** One call per topic. **Asked:** given the subject, the unit, the topic and up to 10 candidates' titles and the first 300 characters of their descriptions, answer for each `{fits: yes|no, level: school|ug|pg|unclear}`. **Never asked:** whether a video is correct or good, to rate or order sources, to invent a link, or anything about him. Its answer may hide a row marked `no`, which stays visible under "hidden by the model"; it never changes a number. Whether YouTube's terms allow sending API text to another service is **not verified**, so the rerank applies only to rows from OCW, Wikipedia and NPTEL titles until that is read.

### Engine design, in build order

1. **Adapters** (`ww_links_sources/`): `mit_learn`, `wikipedia`, `youtube`, `nptel_youtube` (the allow-list path). Each is a parser like `ww_harvest_sources`: it gets bytes the Harvester fetched and returns `{title, url, source, numbers, read_at}`. The Harvester keeps its robots check, one request at a time, 3 s a host and 200 a day. On top come API quota counters (100 searches and 9,000 units a day, leaving a margin), and a User-Agent that adds a contact string he types (Wikimedia asks for one; it lives in settings, not in tracked files).
2. **Cache and manifest**: one manifest line per query `{query_id, source, query, params, read_at, items: [key], units}`, and one line per link `{key, title, url, source, numbers, read_at}`. YouTube lines are refreshed or deleted after 30 days. Pointers only, never content.
3. **Routes** (9.0 style; ids L-01 to L-06 to avoid R-numbers):
   - **L-01** GET `/api/mission/links/sources` answers `items: [{id, name, on, needs_key, key_set, terms_note, quota: {used, limit, resets_at}}]`.
   - **L-02** PUT `/api/mission/links/sources/{id}` takes `{on?: bool, contact?: str}`. 400 when the source has no terms note or the contact is over 120 characters; 404 for an unknown id.
   - **L-03** PUT `/api/mission/links/key` takes `{source: "youtube", key}`. The key goes to the credential store, and the answer is `{key_set: true, last4}`. DELETE removes it. 400 for an empty key or one over 100 characters; the key is never echoed or logged.
   - **L-04** POST `/api/mission/links/fetch` takes `{subject, topics?: [key], sources?: [id], use_model?: bool}` and starts a background job (409 while the harvester or another fetch runs). GET answers `{status, done, total, units_used, failures}`.
   - **L-05** GET `/api/mission/links?subject=&topic=` answers `items: [{key, title, url, source, kind: "video"|"notes"|"course"|"article", score or null, terms: {A, L, F, D} or null, numbers, numbers_from, read_at, path: "course"|"search", hidden_by_model}]`. States: `planned` (all sources off), `waiting` ("no key", "quota used, resets at 13:30 IST", "not fetched yet"), `live`.
   - **L-06** POST `/api/mission/links/{key}/pin` and `/hide` record his own choice, which outranks every score.
   - Errors for all: 400 for bad input, 404 for an unknown subject or topic, 409 while busy, 503 when the credential store cannot be read.

### First slice for one day

MIT Learn plus Wikipedia, with no key and no model: an adapter each, the manifest, L-01, L-02, L-04 and L-05, and tests against recorded responses. YouTube's allow-list path comes the next day, once he has made the key.

### Quota arithmetic for 9 subjects × 30 topics = 270 topics

- Allow-list path: playlists of one channel, about 1 to 80 units (the channel's playlist count is not verified), plus lectures at 9 courses × 2 to 3 units ≈ 27. `videos.list` for numbers: 270 topics × 10 videos ÷ 50 per call ≈ 54 units. Under 200 of 10,000.
- Search path: 270 searches need 3 days at 100 a day. A 30-day refresh of numbers costs about 54 units.
- Model: 270 calls; one measured call took 4 s on 1,330 tokens (5d54591), so about 18 minutes of his usage.

### Risks and what is not verified

- The derived-metric reading of III.E.4.h(ii), and whether YouTube text may go to the model: not settled. Read the [developer policies](https://developers.google.com/youtube/terms/developer-policies) in full before building L-05 for YouTube.
- NPTEL's licence is still unstated. Pointers are safe; copies are not.
- No terms for the MIT Learn API were found, and its robots.txt answers 404. It is the same data as the open OCW site, but this is unconfirmed.
- The YouTube channel handle `@nptel-nociitm9240` comes from NPTEL's own page; its id and playlist count were not checked.
- The 100-a-day `search.list` bucket is undated on Google's page, and older guides say 100 units of 10,000.

**What it changed.** YouTube rows carry no computed score, and YouTube is reached first through allow-listed course playlists rather than search. MIT Learn and Wikipedia need no key and are the first slice. The harvester's User-Agent needs a contact string before any Wikimedia request.
